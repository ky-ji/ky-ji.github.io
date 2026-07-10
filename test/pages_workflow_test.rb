require "minitest/autorun"
require "yaml"

class PagesWorkflowTest < Minitest::Test
  ROOT = File.expand_path("..", __dir__)
  WORKFLOW_PATH = File.join(ROOT, ".github/workflows/pages.yml")
  WORKFLOW = File.exist?(WORKFLOW_PATH) ? File.read(WORKFLOW_PATH) : ""
  GITIGNORE = File.read(File.join(ROOT, ".gitignore"))

  def workflow
    @workflow ||= WORKFLOW.empty? ? {} : YAML.safe_load(WORKFLOW, aliases: true)
  end

  def triggers
    workflow.fetch("on") { workflow.fetch(true, {}) }
  end

  def jobs
    workflow.fetch("jobs", {})
  end

  def build_job
    jobs.fetch("build", {})
  end

  def build_steps
    build_job["steps"] || []
  end

  def deploy_job
    jobs.fetch("deploy", {})
  end

  def named_step(name)
    build_steps.find { |step| step["name"] == name } || {}
  end

  def build_step_using(action)
    build_steps.find { |step| step["uses"] == action } || {}
  end

  def all_build_commands
    build_steps.map { |step| step["run"] }.compact.join("\n")
  end

  def test_has_all_required_triggers
    refute_empty WORKFLOW, "expected .github/workflows/pages.yml to exist"
    assert_equal ["main"], triggers.dig("push", "branches")
    assert_equal ["main"], triggers.dig("pull_request", "branches")
    assert_equal true,
      triggers.dig("workflow_dispatch", "inputs", "deploy", "default")
    assert_equal "boolean",
      triggers.dig("workflow_dispatch", "inputs", "deploy", "type")
    assert_equal [{"cron" => "17 */6 * * *"}], triggers["schedule"]
  end

  def test_uses_least_privilege_permissions
    assert_equal({"contents" => "read"}, workflow["permissions"])
    assert_equal({"contents" => "read"}, jobs.dig("build", "permissions"))
    assert_equal "write", deploy_job.dig("permissions", "pages")
    assert_equal "write", deploy_job.dig("permissions", "id-token")
    refute jobs.dig("build", "permissions").key?("pages")
    refute jobs.dig("build", "permissions").key?("id-token")
  end

  def test_pins_required_action_majors
    uses = (build_steps + Array(deploy_job["steps"])).map { |step| step["uses"] }.compact

    %w[
      actions/checkout@v7
      ruby/setup-ruby@v1
      actions/setup-node@v6
      actions/configure-pages@v6
      actions/upload-pages-artifact@v5
      actions/deploy-pages@v5
    ].each { |action| assert_includes uses, action }
  end

  def test_build_job_uses_pinned_runtime_configuration
    ruby_setup = build_step_using("ruby/setup-ruby@v1")
    node_setup = build_step_using("actions/setup-node@v6")

    assert_equal "ubuntu-latest", build_job["runs-on"]
    assert_equal "2.6", ruby_setup.dig("with", "ruby-version")
    assert_equal true, ruby_setup.dig("with", "bundler-cache")
    assert_equal "22", node_setup.dig("with", "node-version")
  end

  def test_runs_all_tests_before_snapshot_generation
    ruby_command = all_build_commands.lines.find { |line| line.include?('Dir["test/*_test.rb"]') }
    refute_nil ruby_command
    assert_includes all_build_commands, "test/visitor_analytics_core_test.cjs"
    assert_includes all_build_commands, "test/visitor_analytics_controller_test.cjs"

    snapshot_offset = WORKFLOW.index("name: Build visitor snapshot")
    refute_nil snapshot_offset
    assert_operator WORKFLOW.index('Dir["test/*_test.rb"]'), :<, snapshot_offset
    assert_operator WORKFLOW.index("test/visitor_analytics_core_test.cjs"), :<, snapshot_offset
    assert_operator WORKFLOW.index("test/visitor_analytics_controller_test.cjs"), :<, snapshot_offset
  end

  def test_non_pull_requests_build_the_visitor_snapshot
    step = named_step("Build visitor snapshot")
    assert_includes step["if"], "github.event_name != 'pull_request'"
    assert_includes step["run"], "scripts/build_visitor_stats.rb"
    assert_includes step["run"], "--output assets/data/visitor-stats.json"
    assert_includes step["run"],
      "--fallback-url https://ky-ji.github.io/assets/data/visitor-stats.json"
  end

  def test_pull_requests_use_the_aggregate_fixture_without_secrets
    step = named_step("Prepare visitor snapshot fixture")
    assert_includes step["if"], "github.event_name == 'pull_request'"
    assert_includes step["run"], "mkdir -p assets/data"
    assert_includes step["run"],
      "cp test/fixtures/visitor-stats.json assets/data/visitor-stats.json"
    assert_operator build_steps.index(step), :<,
      build_steps.index(named_step("Build site"))
    refute_includes step.to_s, "secrets."
  end

  def test_builds_and_uploads_the_production_site
    build = named_step("Build site")
    upload = build_steps.find do |step|
      step["uses"] == "actions/upload-pages-artifact@v5"
    end

    assert_equal "production", build.dig("env", "JEKYLL_ENV")
    assert_match(/bundle exec jekyll build/, build["run"])
    assert_equal "_site", upload.dig("with", "path")
  end

  def test_deploy_job_targets_github_pages_and_honors_dispatch_input
    assert_equal "build", deploy_job["needs"]
    assert_equal "ubuntu-latest", deploy_job["runs-on"]
    assert_includes deploy_job["if"], "github.event_name != 'pull_request'"
    assert_includes deploy_job["if"], "github.event_name != 'workflow_dispatch'"
    assert_includes deploy_job["if"], "inputs.deploy"
    assert_equal "github-pages", deploy_job.dig("environment", "name")
    assert_equal "${{ steps.deployment.outputs.page_url }}",
      deploy_job.dig("environment", "url")

    deployment = Array(deploy_job["steps"]).find do |step|
      step["uses"] == "actions/deploy-pages@v5"
    end
    assert_equal "deployment", deployment["id"]
  end

  def test_configures_visitor_analytics_and_limits_secret_exposure
    assert_equal "ky-ji", workflow.dig("env", "GOATCOUNTER_SITE_CODE")
    assert_equal "2026-07-10T00:00:00+09:00",
      workflow.dig("env", "VISITOR_ANALYTICS_START")
    assert_equal 1, WORKFLOW.scan("secrets.GOATCOUNTER_API_KEY").length
    assert_equal "${{ secrets.GOATCOUNTER_API_KEY }}",
      named_step("Build visitor snapshot").dig("env", "GOATCOUNTER_API_KEY")

    other_steps = build_steps.reject { |step| step["name"] == "Build visitor snapshot" }
    refute_includes other_steps.to_s, "GOATCOUNTER_API_KEY"
    refute_match(/\b(?:ghp_|github_pat_)[A-Za-z0-9_]+/, WORKFLOW)
  end

  def test_avoids_sensitive_debug_output
    refute_match(/^\s*(?:printenv|env)(?:\s|$)/, WORKFLOW)
    refute_match(/\bset\s+-x\b/, WORKFLOW)
    refute_match(/\bcat\s+[^\n]*\.csv\b/i, WORKFLOW)
    refute_includes WORKFLOW, "/tmp"
  end

  def test_uses_stable_pages_concurrency
    assert_equal "Deploy GitHub Pages", workflow["name"]
    assert_equal "pages", workflow.dig("concurrency", "group")
    assert_equal false, workflow.dig("concurrency", "cancel-in-progress")
  end

  def test_ignores_only_the_generated_visitor_snapshot
    lines = GITIGNORE.lines.map(&:chomp)
    assert_includes lines, "assets/data/visitor-stats.json"
    refute_includes lines, "assets/data/"
  end
end
