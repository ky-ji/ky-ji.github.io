require "minitest/autorun"
require "json"
require "open3"
require "rbconfig"
require "stringio"
require "timeout"
require "tmpdir"
require "webrick"
require "zlib"
require_relative "../lib/visitor_analytics"

class BuildVisitorStatsTest < Minitest::Test
  ROOT = File.expand_path("..", __dir__)
  SCRIPT = File.join(ROOT, "scripts/build_visitor_stats.rb")
  SECRET = "integration-secret-token"
  START = "2026-07-01T00:00:00+09:00"

  def setup
    @csv = File.read(File.expand_path("fixtures/goatcounter_pageviews.csv", __dir__))
    @fallback_fixture = File.read(File.expand_path("fixtures/visitor-stats.json", __dir__))
    @requests = []
    @create_status = 202
    @create_body = JSON.generate("id" => 42)
    @status_status = 200
    @status_body = JSON.generate(
      "id" => 42,
      "finished_at" => "2026-07-10T03:00:00Z"
    )
    @download_status = 200
    @download_body = gzip(@csv)
    @fallback_status = 200
    @fallback_body = @fallback_fixture

    @server = WEBrick::HTTPServer.new(
      Port: 0,
      BindAddress: "127.0.0.1",
      Logger: WEBrick::Log.new(File::NULL),
      AccessLog: []
    )
    mount_fake_endpoints
    @thread = Thread.new { @server.start }
    Timeout.timeout(2) { sleep(0.001) until @server.status == :Running }
  end

  def teardown
    @server.shutdown
    @thread.join
  end

  def test_snapshot_fixture_is_strictly_valid
    snapshot = JSON.parse(@fallback_fixture)
    pageviews = %w[7d 30d all].map do |period|
      snapshot.dig("periods", period, "pageviews")
    end
    visitors = %w[7d 30d all].map do |period|
      snapshot.dig("periods", period, "visitors")
    end

    assert VisitorAnalytics.valid_snapshot?(snapshot)
    assert_equal [3, 4, 4], pageviews
    assert_equal [1, 2, 2], visitors
    assert_equal [
      {"code" => "KR", "visitors" => 1},
      {"code" => "US", "visitors" => 1}
    ], snapshot.dig("periods", "all", "countries")
  end

  def test_fresh_export_writes_a_valid_strict_snapshot
    Dir.mktmpdir("visitor-stats-test") do |directory|
      output = File.join(directory, "visitor-stats.json")

      stdout, stderr, status = run_script(output: output)

      assert status.success?, stderr
      assert_empty stdout
      assert_empty stderr
      assert File.file?(output), "expected the workflow to write its output"
      snapshot = JSON.parse(File.read(output))
      assert VisitorAnalytics.valid_snapshot?(snapshot)
      assert_equal "ky-ji.github.io", snapshot["site"]
      assert_equal START, snapshot["data_since"]
      assert_equal 4, snapshot.dig("periods", "all", "pageviews")
      assert_equal 2, snapshot.dig("periods", "all", "visitors")
      assert_equal [
        {"code" => "KR", "visitors" => 1},
        {"code" => "US", "visitors" => 1}
      ], snapshot.dig("periods", "all", "countries")
      assert_equal ["Bearer " + SECRET] * 3, api_requests.map { |request| request[:authorization] }
      refute requested?("/fallback.json")
      assert_equal ["visitor-stats.json"], Dir.children(directory)
      assert_no_secret_or_private_data(stdout, stderr)
    end
  end

  def test_failed_fresh_api_reuses_valid_fallback_fixture
    @create_status = 503
    @create_body = "private-fresh-api-response"

    Dir.mktmpdir("visitor-stats-test") do |directory|
      output = File.join(directory, "visitor-stats.json")

      stdout, stderr, status = run_script(output: output)

      assert status.success?, stderr
      assert_empty stdout
      assert_equal "Fresh visitor snapshot unavailable: GoatCounterClient::ResponseError\n", stderr
      assert_equal JSON.parse(@fallback_fixture), JSON.parse(File.read(output))
      assert requested?("/fallback.json")
      assert_equal ["visitor-stats.json"], Dir.children(directory)
      assert_no_secret_or_private_data(stdout, stderr)
    end
  end

  def test_invalid_generated_snapshot_reuses_valid_fallback_fixture
    Dir.mktmpdir("visitor-stats-test") do |directory|
      output = File.join(directory, "visitor-stats.json")

      stdout, stderr, status = run_script(
        output: output,
        start: "2099-07-01T00:00:00+09:00"
      )

      assert status.success?, stderr
      assert_empty stdout
      assert_match(/Fresh visitor snapshot unavailable: \S+\n\z/, stderr)
      assert_equal JSON.parse(@fallback_fixture), JSON.parse(File.read(output))
      assert requested?("/fallback.json")
      assert_no_secret_or_private_data(stdout, stderr)
    end
  end

  def test_invalid_fallback_exits_nonzero_and_preserves_existing_output
    @create_status = 500
    @create_body = "private-fresh-api-response"
    @fallback_body = JSON.generate(
      "schema_version" => 1,
      "private" => "private-invalid-fallback"
    )

    Dir.mktmpdir("visitor-stats-test") do |directory|
      output = File.join(directory, "visitor-stats.json")
      original = "pre-existing-output\nwith exact bytes\n"
      File.binwrite(output, original)

      stdout, stderr, status = run_script(output: output)

      refute status.success?
      assert_empty stdout
      assert_equal original, File.binread(output)
      assert_match(/No valid visitor snapshot source/, stderr)
      assert requested?("/fallback.json")
      assert_equal ["visitor-stats.json"], Dir.children(directory)
      assert_no_secret_or_private_data(stdout, stderr)
    end
  end

  def test_unavailable_fallback_exits_nonzero_without_creating_output
    @create_status = 500
    @create_body = "private-fresh-api-response"
    @fallback_status = 404
    @fallback_body = "private-unavailable-fallback"

    Dir.mktmpdir("visitor-stats-test") do |directory|
      output = File.join(directory, "visitor-stats.json")

      stdout, stderr, status = run_script(output: output)

      refute status.success?
      assert_empty stdout
      refute File.exist?(output)
      assert_match(/No valid visitor snapshot source/, stderr)
      assert requested?("/fallback.json")
      assert_empty Dir.children(directory)
      assert_no_secret_or_private_data(stdout, stderr)
    end
  end

  def test_requires_all_build_environment_variables
    %w[GOATCOUNTER_SITE_CODE GOATCOUNTER_API_KEY VISITOR_ANALYTICS_START].each do |name|
      Dir.mktmpdir("visitor-stats-test") do |directory|
        output = File.join(directory, "visitor-stats.json")
        stdout, stderr, status = run_script(output: output, omitted_env: name)

        refute status.success?, name
        assert_empty stdout
        refute File.exist?(output)
        assert_includes stderr, name
        assert_no_secret_or_private_data(stdout, stderr)
      end
    end
  end

  private

  def run_script(output:, start: START, omitted_env: nil)
    environment = {
      "GOATCOUNTER_SITE_CODE" => "ky-ji",
      "GOATCOUNTER_API_KEY" => SECRET,
      "VISITOR_ANALYTICS_START" => start,
      "GOATCOUNTER_BASE_URL" => base_url,
      "HTTP_PROXY" => nil,
      "HTTPS_PROXY" => nil,
      "http_proxy" => nil,
      "https_proxy" => nil,
      "NO_PROXY" => "127.0.0.1"
    }
    environment[omitted_env] = nil if omitted_env

    Open3.capture3(
      environment,
      RbConfig.ruby,
      SCRIPT,
      "--output", output,
      "--fallback-url", base_url + "/fallback.json",
      chdir: ROOT
    )
  end

  def mount_fake_endpoints
    @server.mount_proc("/api/v0/export/42/download") do |request, response|
      record(request)
      response.status = @download_status
      response.body = @download_body
    end
    @server.mount_proc("/api/v0/export/42") do |request, response|
      record(request)
      response.status = @status_status
      response["Content-Type"] = "application/json"
      response.body = @status_body
    end
    @server.mount_proc("/api/v0/export") do |request, response|
      record(request)
      response.status = @create_status
      response["Content-Type"] = "application/json"
      response.body = @create_body
    end
    @server.mount_proc("/fallback.json") do |request, response|
      record(request)
      response.status = @fallback_status
      response["Content-Type"] = "application/json"
      response.body = @fallback_body
    end
  end

  def record(request)
    @requests << {
      path: request.path,
      authorization: request["Authorization"]
    }
  end

  def api_requests
    @requests.select { |request| request[:path].start_with?("/api/v0/") }
  end

  def requested?(path)
    @requests.any? { |request| request[:path] == path }
  end

  def base_url
    port = @server.listeners.first.addr[1]
    "http://127.0.0.1:" + port.to_s
  end

  def gzip(value)
    buffer = StringIO.new
    Zlib::GzipWriter.wrap(buffer) { |writer| writer.write(value) }
    buffer.string
  end

  def assert_no_secret_or_private_data(stdout, stderr)
    output = stdout + stderr
    refute_includes output, SECRET
    refute_match(/private-(?:fresh|invalid|unavailable)/, output)
    refute_includes output, "2Path,Title,Event"
    refute_includes output, '"schema_version"'
  end
end
