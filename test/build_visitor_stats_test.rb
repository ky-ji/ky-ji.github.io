require "minitest/autorun"
require "json"
require "open3"
require "rbconfig"
require "stringio"
require "timeout"
require "tmpdir"
require "uri"
require "webrick"
require "zlib"
require_relative "../lib/visitor_analytics"

class BuildVisitorStatsTest < Minitest::Test
  ROOT = File.expand_path("..", __dir__)
  SCRIPT = File.join(ROOT, "scripts/build_visitor_stats.rb")
  SECRET = "integration-secret-token"
  START = "2026-07-01T00:00:00+09:00"
  SUBPROCESS_TIMEOUT = 10
  SUBPROCESS_TERM_GRACE = 0.5

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
    @total_status = 200
    @total_body = JSON.generate(
      "total" => 4,
      "total_events" => 4,
      "stats" => []
    )
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

  def test_help_documents_both_defaults
    stdout, stderr, status = capture_subprocess(
      {},
      RbConfig.ruby,
      SCRIPT,
      "--help",
      timeout: SUBPROCESS_TIMEOUT,
      chdir: ROOT
    )

    assert status.success?, stderr
    assert_empty stderr
    assert_includes stdout, "Output path (default: assets/data/visitor-stats.json)"
    assert_includes stdout,
      "Fallback URL (default: https://ky-ji.github.io/assets/data/visitor-stats.json)"
  end

  def test_subprocess_watchdog_terminates_hung_child
    started_at = Process.clock_gettime(Process::CLOCK_MONOTONIC)

    error = assert_raises(Timeout::Error) do
      capture_subprocess(
        {},
        RbConfig.ruby,
        "-e",
        "sleep 30",
        timeout: 0.1,
        chdir: ROOT
      )
    end
    elapsed = Process.clock_gettime(Process::CLOCK_MONOTONIC) - started_at

    assert_operator elapsed, :<, 2
    assert_match(/subprocess timed out/i, error.message)
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
      refute requested?("/api/v0/stats/total")
      refute requested?("/fallback.json")
      assert_equal ["visitor-stats.json"], Dir.children(directory)
      assert_no_secret_or_private_data(stdout, stderr)
    end
  end

  def test_empty_account_bootstraps_a_strict_zero_snapshot
    @create_status = 404
    @create_body = "private-fresh-api-response"
    @total_body = JSON.generate(
      "total" => 0,
      "total_events" => 0,
      "stats" => [{"name" => "private-stats-bucket"}]
    )
    @fallback_status = 503
    @fallback_body = "private-unavailable-fallback"

    Dir.mktmpdir("visitor-stats-test") do |directory|
      output = File.join(directory, "visitor-stats.json")

      stdout, stderr, status = run_script(output: output)

      assert status.success?, stderr
      assert_empty stdout
      assert_empty stderr
      snapshot = JSON.parse(File.read(output))
      assert VisitorAnalytics.valid_snapshot?(snapshot)
      assert_equal "ky-ji.github.io", snapshot["site"]
      assert_equal START, snapshot["data_since"]
      %w[7d 30d all].each do |period|
        assert_equal({
          "pageviews" => 0,
          "visitors" => 0,
          "countries" => []
        }, snapshot.dig("periods", period))
      end
      assert_equal ["/api/v0/export", "/api/v0/stats/total"],
        api_requests.map { |request| request[:path] }
      assert_equal ["Bearer " + SECRET] * 2,
        api_requests.map { |request| request[:authorization] }
      refute requested?("/fallback.json")

      stats_request = api_requests.last
      stats_params = URI.decode_www_form(stats_request[:query]).to_h
      assert_equal START, stats_params["start"]
      assert_equal Time.iso8601(snapshot["generated_at"]),
        Time.iso8601(stats_params["end"])
      assert_equal URI.encode_www_form(
        "start" => START,
        "end" => stats_params["end"]
      ), stats_request[:query]
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
      assert requested?("/api/v0/stats/total")
      assert requested?("/fallback.json")
      assert_equal ["visitor-stats.json"], Dir.children(directory)
      assert_no_secret_or_private_data(stdout, stderr)
    end
  end

  def test_malformed_zero_check_reuses_valid_fallback_fixture
    @create_status = 404
    @create_body = "private-fresh-api-response"
    @total_body = JSON.generate("total" => "private-stats-total")

    Dir.mktmpdir("visitor-stats-test") do |directory|
      output = File.join(directory, "visitor-stats.json")

      stdout, stderr, status = run_script(output: output)

      assert status.success?, stderr
      assert_empty stdout
      assert_equal "Fresh visitor snapshot unavailable: GoatCounterClient::ResponseError\n", stderr
      assert_equal JSON.parse(@fallback_fixture), JSON.parse(File.read(output))
      assert requested?("/api/v0/stats/total")
      assert requested?("/fallback.json")
      assert_no_secret_or_private_data(stdout, stderr)
    end
  end

  def test_failed_zero_check_reuses_valid_fallback_fixture
    @create_status = 404
    @create_body = "private-fresh-api-response"
    @total_status = 401
    @total_body = "private-stats-response"

    Dir.mktmpdir("visitor-stats-test") do |directory|
      output = File.join(directory, "visitor-stats.json")

      stdout, stderr, status = run_script(output: output)

      assert status.success?, stderr
      assert_empty stdout
      assert_equal "Fresh visitor snapshot unavailable: GoatCounterClient::ResponseError\n", stderr
      assert_equal JSON.parse(@fallback_fixture), JSON.parse(File.read(output))
      assert requested?("/api/v0/stats/total")
      assert requested?("/fallback.json")
      assert_no_secret_or_private_data(stdout, stderr)
    end
  end

  def test_malformed_zero_check_with_unavailable_fallback_preserves_output
    @create_status = 404
    @create_body = "private-fresh-api-response"
    @total_body = JSON.generate("total" => "private-stats-total")
    @fallback_status = 404
    @fallback_body = "private-unavailable-fallback"

    Dir.mktmpdir("visitor-stats-test") do |directory|
      output = File.join(directory, "visitor-stats.json")
      original = "pre-existing-output\nwith exact bytes\n"
      File.binwrite(output, original)

      stdout, stderr, status = run_script(output: output)

      refute status.success?
      assert_empty stdout
      assert_equal original, File.binread(output)
      assert_match(/No valid visitor snapshot source/, stderr)
      assert requested?("/api/v0/stats/total")
      assert requested?("/fallback.json")
      assert_equal ["visitor-stats.json"], Dir.children(directory)
      assert_no_secret_or_private_data(stdout, stderr)
    end
  end

  def test_invalid_generated_snapshot_reuses_valid_fallback_fixture
    start_time = Time.now + (4 * 60)
    start = start_time.getlocal(9 * 60 * 60).iso8601
    fallback = JSON.parse(@fallback_fixture)
    fallback["data_since"] = start
    fallback["generated_at"] = start_time.utc.iso8601
    @fallback_body = JSON.generate(fallback)

    Dir.mktmpdir("visitor-stats-test") do |directory|
      output = File.join(directory, "visitor-stats.json")

      stdout, stderr, status = run_script(
        output: output,
        start: start
      )

      assert status.success?, stderr
      assert_empty stdout
      assert_match(/Fresh visitor snapshot unavailable: \S+\n\z/, stderr)
      assert_equal fallback, JSON.parse(File.read(output))
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

  def test_fallback_with_wrong_site_preserves_existing_output
    snapshot = JSON.parse(@fallback_fixture)
    snapshot["site"] = "private.example"

    assert_rejected_fallback_preserves_output(snapshot)
  end

  def test_fallback_with_wrong_start_instant_preserves_existing_output
    snapshot = JSON.parse(@fallback_fixture)
    snapshot["data_since"] = "2026-07-01T00:00:01+09:00"

    assert_rejected_fallback_preserves_output(snapshot)
  end

  def test_fallback_with_far_future_generation_time_preserves_existing_output
    snapshot = JSON.parse(@fallback_fixture)
    snapshot["generated_at"] = "2099-01-01T00:00:00Z"

    assert_rejected_fallback_preserves_output(snapshot)
  end

  def test_old_fallback_with_equivalent_start_instant_is_accepted
    @create_status = 500
    @create_body = "private-fresh-api-response"
    snapshot = JSON.parse(@fallback_fixture)
    snapshot["data_since"] = "2026-06-30T15:00:00Z"
    snapshot["generated_at"] = "2026-07-01T00:00:00Z"
    @fallback_body = JSON.generate(snapshot)

    Dir.mktmpdir("visitor-stats-test") do |directory|
      output = File.join(directory, "visitor-stats.json")

      stdout, stderr, status = run_script(output: output)

      assert status.success?, stderr
      assert_empty stdout
      assert_equal snapshot, JSON.parse(File.read(output))
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

  def test_local_api_requires_explicit_loopback_environment_switch
    @fallback_status = 503
    @fallback_body = "private-unavailable-fallback"

    Dir.mktmpdir("visitor-stats-test") do |directory|
      output = File.join(directory, "visitor-stats.json")

      stdout, stderr, status = run_script(
        output: output,
        allow_insecure_loopback: false
      )

      refute status.success?
      assert_empty stdout
      assert_empty api_requests
      refute File.exist?(output)
      assert_match(/Fresh visitor snapshot unavailable: ArgumentError/, stderr)
      assert_no_secret_or_private_data(stdout, stderr)
    end
  end

  private

  def run_script(
    output:,
    start: START,
    omitted_env: nil,
    allow_insecure_loopback: true
  )
    environment = {
      "GOATCOUNTER_SITE_CODE" => "ky-ji",
      "GOATCOUNTER_API_KEY" => SECRET,
      "VISITOR_ANALYTICS_START" => start,
      "GOATCOUNTER_BASE_URL" => base_url,
      "GOATCOUNTER_ALLOW_INSECURE_LOOPBACK" => (allow_insecure_loopback ? "1" : nil),
      "HTTP_PROXY" => nil,
      "HTTPS_PROXY" => nil,
      "http_proxy" => nil,
      "https_proxy" => nil,
      "NO_PROXY" => "127.0.0.1"
    }
    environment[omitted_env] = nil if omitted_env

    capture_subprocess(
      environment,
      RbConfig.ruby,
      SCRIPT,
      "--output", output,
      "--fallback-url", base_url + "/fallback.json",
      timeout: SUBPROCESS_TIMEOUT,
      chdir: ROOT
    )
  end

  def capture_subprocess(environment, *command, timeout:, chdir:)
    streams = []
    wait_thread = nil
    stdout_reader = nil
    stderr_reader = nil
    timed_out = false

    begin
      stdin, stdout, stderr, wait_thread = Open3.popen3(
        environment,
        *command,
        chdir: chdir,
        pgroup: true
      )
      streams = [stdin, stdout, stderr]
      stdin.close
      stdout_reader = Thread.new { stdout.read }
      stderr_reader = Thread.new { stderr.read }

      unless wait_thread.join(timeout)
        timed_out = true
        terminate_subprocess(wait_thread)
      end

      stdout_text = stdout_reader.value
      stderr_text = stderr_reader.value
      raise Timeout::Error, "subprocess timed out" if timed_out

      [stdout_text, stderr_text, wait_thread.value]
    ensure
      terminate_subprocess(wait_thread) if wait_thread && wait_thread.alive?
      streams.each { |stream| close_stream(stream) }
      stdout_reader.join if stdout_reader && stdout_reader.alive?
      stderr_reader.join if stderr_reader && stderr_reader.alive?
    end
  end

  def terminate_subprocess(wait_thread)
    return unless wait_thread && wait_thread.alive?

    signal_process_group("TERM", wait_thread.pid)
    return if wait_thread.join(SUBPROCESS_TERM_GRACE)

    signal_process_group("KILL", wait_thread.pid)
    wait_thread.join
  end

  def signal_process_group(signal, pid)
    Process.kill(signal, -pid)
  rescue Errno::ESRCH
    begin
      Process.kill(signal, pid)
    rescue Errno::ESRCH
      nil
    end
  end

  def close_stream(stream)
    stream.close unless stream.closed?
  rescue IOError
    nil
  end

  def mount_fake_endpoints
    @server.mount_proc("/api/v0/stats/total") do |request, response|
      record(request)
      response.status = @total_status
      response["Content-Type"] = "application/json"
      response.body = @total_body
    end
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
      query: request.query_string,
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
    refute_match(/private-(?:fresh|invalid|unavailable|stats)/, output)
    refute_includes output, "2Path,Title,Event"
    refute_includes output, '"schema_version"'
  end

  def assert_rejected_fallback_preserves_output(snapshot)
    @create_status = 500
    @create_body = "private-fresh-api-response"
    @fallback_body = JSON.generate(snapshot)

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
end
