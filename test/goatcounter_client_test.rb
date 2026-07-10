require "minitest/autorun"
require "json"
require "stringio"
require "timeout"
require "webrick"
require "zlib"
require_relative "../lib/goatcounter_client"

class GoatCounterClientTest < Minitest::Test
  def setup
    @csv = File.read(File.expand_path("fixtures/goatcounter_pageviews.csv", __dir__))
    @requests = []
    @sleeps = []
    @polls = 0
    @create_status = 202
    @create_body = JSON.generate("id" => 42)
    @create_stream = nil
    @status_status = 200
    @status_body = proc do |poll|
      JSON.generate(
        "id" => 42,
        "finished_at" => (poll > 1 ? "2026-07-10T03:00:00Z" : nil)
      )
    end
    @downloads = 0
    @download_status = 200
    @download_body = gzip(@csv)
    @download_stream = nil

    @server = WEBrick::HTTPServer.new(
      Port: 0,
      BindAddress: "127.0.0.1",
      Logger: WEBrick::Log.new(File::NULL),
      AccessLog: []
    )
    mount_fake_api
    @thread = Thread.new { @server.start }
    Timeout.timeout(2) { sleep(0.001) until @server.status == :Running }
  end

  def teardown
    @server.shutdown
    @thread.join
  end

  def test_creates_polls_and_downloads_completed_csv_export
    clock = clock_returning(0.0)

    assert_equal @csv, client(monotonic_clock: clock).export_csv(timeout: 5)

    assert_equal ["POST", "GET", "GET", "GET"], @requests.map { |request| request[:method] }
    assert_equal [
      "/api/v0/export",
      "/api/v0/export/42",
      "/api/v0/export/42",
      "/api/v0/export/42/download"
    ], @requests.map { |request| request[:path] }
    assert_equal ["Bearer secret-token"] * 4,
      @requests.map { |request| request[:authorization] }
    assert_equal({"format" => "csv"}, JSON.parse(@requests.first[:body]))
    assert_match(%r{\Aapplication/json\b}, @requests.first[:content_type])
    assert_equal [2], @sleeps
  end

  def test_times_out_when_export_never_finishes
    @status_body = proc { |_poll| JSON.generate("id" => 42, "finished_at" => nil) }
    clock = clock_returning(*([0.0] * 8), 0.5, 0.5, 1.0)

    error = assert_raises(GoatCounterClient::TimeoutError) do
      client(monotonic_clock: clock).export_csv(timeout: 1)
    end

    assert_match(/timeout/i, error.message)
    assert_equal 1, @polls
    refute @requests.any? { |request| request[:path].end_with?("/download") }
  end

  def test_total_deadline_is_established_before_create_request
    clock = clock_returning(0.0, 1.0)

    error = assert_raises(GoatCounterClient::TimeoutError) do
      client(monotonic_clock: clock).export_csv(timeout: 1)
    end

    assert_match(/timeout/i, error.message)
    assert_empty @requests
    assert_empty @sleeps
    refute_match(/secret-token/, error.message)
  end

  def test_times_out_during_trickled_create_body
    @create_stream = trickled_body(JSON.generate("id" => 42))
    started_at = Process.clock_gettime(Process::CLOCK_MONOTONIC)

    error = assert_raises(GoatCounterClient::TimeoutError) do
      client.export_csv(timeout: 0.12)
    end
    elapsed = Process.clock_gettime(Process::CLOCK_MONOTONIC) - started_at

    assert_operator elapsed, :<, 0.8
    assert_match(/timeout/i, error.message)
    refute_match(/secret-token/, error.message)
    assert_equal ["/api/v0/export"], @requests.map { |request| request[:path] }
  end

  def test_times_out_during_trickled_download_body
    @status_body = proc do |_poll|
      JSON.generate("id" => 42, "finished_at" => "2026-07-10T03:00:00Z")
    end
    @download_stream = trickled_body(gzip(@csv))
    started_at = Process.clock_gettime(Process::CLOCK_MONOTONIC)

    error = assert_raises(GoatCounterClient::TimeoutError) do
      client.export_csv(timeout: 0.12)
    end
    elapsed = Process.clock_gettime(Process::CLOCK_MONOTONIC) - started_at

    assert_operator elapsed, :<, 0.8
    assert_match(/timeout/i, error.message)
    refute_match(/secret-token/, error.message)
    assert_equal 1, @downloads
  end

  def test_rejects_completion_that_arrives_after_deadline
    @status_body = proc do |_poll|
      JSON.generate("id" => 42, "finished_at" => "2026-07-10T03:00:00Z")
    end
    clock = clock_returning(*([0.0] * 6), 1.1)

    assert_raises(GoatCounterClient::TimeoutError) do
      client(monotonic_clock: clock).export_csv(timeout: 1)
    end

    assert_equal 1, @polls
    assert_empty @sleeps
    refute @requests.any? { |request| request[:path].end_with?("/download") }
  end

  def test_does_not_start_status_poll_at_deadline
    @status_body = proc { |_poll| JSON.generate("id" => 42, "finished_at" => nil) }
    clock = clock_returning(*([0.0] * 5), 1.0)

    assert_raises(GoatCounterClient::TimeoutError) do
      client(monotonic_clock: clock).export_csv(timeout: 1)
    end

    assert_equal 0, @polls
    assert_equal ["/api/v0/export"], @requests.map { |request| request[:path] }
  end

  def test_sleeps_only_for_sub_two_second_remaining_duration
    @status_body = proc { |_poll| JSON.generate("id" => 42, "finished_at" => nil) }
    clock = clock_returning(*([0.0] * 8), 0.25, 0.25, 1.0)

    assert_raises(GoatCounterClient::TimeoutError) do
      client(monotonic_clock: clock).export_csv(timeout: 1)
    end

    assert_equal 1, @polls
    assert_equal 1, @sleeps.length
    assert_in_delta 0.75, @sleeps.first, 0.000_001
  end

  def test_rejects_non_success_create_response
    @create_status = 503
    @create_body = "private create response"

    assert_response_error_without_secrets { client.export_csv }
    assert_equal ["/api/v0/export"], @requests.map { |request| request[:path] }
  end

  def test_rejects_non_success_status_response
    @status_status = 429
    @status_body = proc { |_poll| "private status response" }

    assert_response_error_without_secrets { client.export_csv }
    assert_equal ["/api/v0/export", "/api/v0/export/42"],
      @requests.map { |request| request[:path] }
  end

  def test_rejects_non_success_download_response
    @status_body = proc do |_poll|
      JSON.generate("id" => 42, "finished_at" => "2026-07-10T03:00:00Z")
    end
    @download_status = 502
    @download_body = "private download response"

    assert_response_error_without_secrets { client.export_csv }
    assert_equal "/api/v0/export/42/download", @requests.last[:path]
  end

  def test_rejects_wrong_create_success_statuses
    [200, 201, 206].each do |status|
      @create_status = status
      @create_body = JSON.generate("id" => 42, "private" => "private-create-response")

      error = assert_raises(GoatCounterClient::ResponseError) { client.export_csv }
      assert_match(/HTTP/i, error.message)
      refute_match(/private-create-response|secret-token/, error.message)
    end
  end

  def test_rejects_wrong_status_success_statuses
    [201, 202, 206].each do |status|
      @status_status = status
      @status_body = proc do |_poll|
        JSON.generate(
          "id" => 42,
          "finished_at" => "2026-07-10T03:00:00Z",
          "private" => "private-status-response"
        )
      end

      error = assert_raises(GoatCounterClient::ResponseError) { client.export_csv }
      assert_match(/HTTP/i, error.message)
      refute_match(/private-status-response|secret-token/, error.message)
    end
  end

  def test_rejects_wrong_download_success_statuses
    [201, 204, 206].each do |status|
      @status_body = proc do |_poll|
        JSON.generate("id" => 42, "finished_at" => "2026-07-10T03:00:00Z")
      end
      @download_status = status
      @download_body = "private-download-response"

      error = assert_raises(GoatCounterClient::ResponseError) { client.export_csv }
      assert_match(/HTTP/i, error.message)
      refute_match(/private-download-response|secret-token/, error.message)
    end
  end

  def test_download_accepted_then_ready_returns_to_status_polling
    @status_body = proc do |_poll|
      JSON.generate("id" => 42, "finished_at" => "2026-07-10T03:00:00Z")
    end
    @download_status = proc { |download| download == 1 ? 202 : 200 }
    @download_body = proc do |download|
      download == 1 ? "private-pending-download" : gzip(@csv)
    end

    assert_equal @csv, client.export_csv(timeout: 5)
    assert_equal 2, @downloads
    assert_equal [
      "/api/v0/export",
      "/api/v0/export/42",
      "/api/v0/export/42/download",
      "/api/v0/export/42",
      "/api/v0/export/42/download"
    ], @requests.map { |request| request[:path] }
    assert_equal ["Bearer secret-token"] * 5,
      @requests.map { |request| request[:authorization] }
  end

  def test_rejects_status_error_immediately
    @status_body = proc do |_poll|
      JSON.generate("id" => 42, "finished_at" => nil, "error" => "export failed privately")
    end

    error = assert_raises(GoatCounterClient::ResponseError) { client.export_csv }

    assert_match(/export status/i, error.message)
    refute_match(/failed privately|secret-token/, error.message)
    assert_equal 1, @polls
    assert_empty @sleeps
    refute @requests.any? { |request| request[:path].end_with?("/download") }
  end

  def test_rejects_array_finished_at
    assert_invalid_finished_at([])
  end

  def test_rejects_boolean_finished_at
    assert_invalid_finished_at(false)
  end

  def test_rejects_empty_finished_at
    assert_invalid_finished_at("")
  end

  def test_rejects_unparseable_finished_at
    assert_invalid_finished_at("private-finished-at")
  end

  def test_rejects_array_status_error_as_malformed
    assert_invalid_status_error([])
  end

  def test_rejects_boolean_status_error_as_malformed
    assert_invalid_status_error(false)
  end

  def test_rejects_nonempty_whitespace_status_error
    @status_body = proc do |_poll|
      JSON.generate(
        "id" => 42,
        "finished_at" => "2026-07-10T03:00:00Z",
        "error" => "  "
      )
    end

    error = assert_raises(GoatCounterClient::ResponseError) { client.export_csv }

    assert_match(/export status reported an error/i, error.message)
    refute_match(/secret-token/, error.message)
    refute @requests.any? { |request| request[:path].end_with?("/download") }
  end

  def test_rejects_malformed_status_export_id
    @status_body = proc do |_poll|
      JSON.generate(
        "id" => "private-status-id",
        "finished_at" => "2026-07-10T03:00:00Z"
      )
    end

    error = assert_raises(GoatCounterClient::ResponseError) { client.export_csv }

    assert_match(/export id/i, error.message)
    refute_match(/private-status-id|secret-token/, error.message)
    refute @requests.any? { |request| request[:path].end_with?("/download") }
  end

  def test_rejects_mismatched_status_export_id
    @status_body = proc do |_poll|
      JSON.generate(
        "id" => 43,
        "finished_at" => "2026-07-10T03:00:00Z"
      )
    end

    error = assert_raises(GoatCounterClient::ResponseError) { client.export_csv }

    assert_match(/export id/i, error.message)
    refute_match(/secret-token/, error.message)
    refute @requests.any? { |request| request[:path].end_with?("/download") }
  end

  def test_rejects_malformed_json_without_echoing_it
    @create_body = "not-json-private-response"

    error = assert_raises(GoatCounterClient::ResponseError) { client.export_csv }

    assert_match(/JSON/i, error.message)
    refute_match(/not-json-private-response|secret-token/, error.message)
  end

  def test_rejects_malformed_status_json
    @status_body = proc { |_poll| "not-json-private-status" }

    error = assert_raises(GoatCounterClient::ResponseError) { client.export_csv }

    assert_match(/JSON/i, error.message)
    refute_match(/not-json-private-status|secret-token/, error.message)
    assert_equal 1, @polls
  end

  def test_rejects_malformed_create_response_shapes_and_ids
    invalid_responses = [
      [],
      {},
      {"id" => "../private-export"},
      {"id" => 1.5}
    ]

    invalid_responses.each do |response|
      @create_body = JSON.generate(response)
      error = assert_raises(GoatCounterClient::ResponseError) { client.export_csv }
      assert_match(/export id|response shape/i, error.message)
      refute_match(/private-export|secret-token/, error.message)
    end
  end

  def test_rejects_malformed_status_response_shape
    @status_body = proc { |_poll| JSON.generate([]) }

    error = assert_raises(GoatCounterClient::ResponseError) { client.export_csv }

    assert_match(/response shape/i, error.message)
    assert_equal 1, @polls
  end

  def test_rejects_invalid_gzip_without_echoing_it
    @status_body = proc do |_poll|
      JSON.generate("id" => 42, "finished_at" => "2026-07-10T03:00:00Z")
    end
    @download_body = "not-gzip-private-response"

    error = assert_raises(GoatCounterClient::ResponseError) { client.export_csv }

    assert_match(/gzip/i, error.message)
    refute_match(/not-gzip-private-response|secret-token/, error.message)
  end

  def test_wraps_truncated_gzip_footer_as_response_error
    @status_body = proc do |_poll|
      JSON.generate("id" => 42, "finished_at" => "2026-07-10T03:00:00Z")
    end
    compressed = gzip(@csv)
    @download_body = compressed.byteslice(0, compressed.bytesize - 8)

    error = assert_raises(GoatCounterClient::ResponseError) { client.export_csv }

    assert_match(/gzip/i, error.message)
    refute_match(/secret-token|2Path,Title,Event/, error.message)
  end

  def test_defaults_to_site_specific_goatcounter_url
    default_client = GoatCounterClient.new(site_code: "example", token: "token")

    assert_equal "https://example.goatcounter.com",
      default_client.instance_variable_get(:@base_url)
  end

  def test_rejects_invalid_site_codes_before_request
    invalid_codes = [
      nil,
      "",
      "Ky-Ji",
      "-ky-ji",
      "ky-ji-",
      "ky.ji",
      "ky/ji",
      "a" * 64
    ]

    invalid_codes.each do |site_code|
      assert_configuration_rejected(site_code: site_code)
    end
  end

  def test_rejects_empty_and_non_string_tokens_before_request
    [nil, "", 42].each do |token|
      assert_configuration_rejected(token: token)
    end
  end

  def test_rejects_arbitrary_https_and_decorated_production_urls
    invalid_urls = [
      "https://example.com",
      "https://ky-ji.goatcounter.com/path",
      "https://ky-ji.goatcounter.com/?private=query",
      "https://ky-ji.goatcounter.com/#private-fragment",
      "https://private-user@ky-ji.goatcounter.com"
    ]

    invalid_urls.each do |url|
      assert_configuration_rejected(base_url: url)
    end
  end

  def test_rejects_plaintext_non_loopback_url
    assert_configuration_rejected(base_url: "http://192.0.2.1:8080")
  end

  def test_rejects_loopback_without_explicit_permission
    assert_configuration_rejected(base_url: base_url, allow_insecure_loopback: false)
  end

  def test_accepts_exact_production_url_with_trailing_slash
    configured = GoatCounterClient.new(
      site_code: "ky-ji",
      token: "secret-token",
      base_url: "https://ky-ji.goatcounter.com/"
    )

    assert_equal "https://ky-ji.goatcounter.com",
      configured.instance_variable_get(:@base_url)
    assert_empty @requests
  end

  def test_accepts_explicit_ipv6_loopback_configuration
    configured = GoatCounterClient.new(
      site_code: "ky-ji",
      token: "secret-token",
      base_url: "http://[::1]:8080/",
      allow_insecure_loopback: true
    )

    assert_equal "http://[::1]:8080", configured.instance_variable_get(:@base_url)
    assert_empty @requests
  end

  private

  def client(monotonic_clock: nil)
    options = {
      site_code: "ky-ji",
      token: "secret-token",
      base_url: base_url,
      sleeper: proc { |seconds| @sleeps << seconds },
      allow_insecure_loopback: true
    }
    options[:monotonic_clock] = monotonic_clock if monotonic_clock
    GoatCounterClient.new(**options)
  end

  def base_url
    port = @server.listeners.first.addr[1]
    "http://127.0.0.1:" + port.to_s
  end

  def mount_fake_api
    @server.mount_proc("/api/v0/export/42/download") do |request, response|
      record(request)
      @downloads += 1
      response.status = dynamic_value(@download_status, @downloads)
      assign_body(
        response,
        @download_stream || dynamic_value(@download_body, @downloads)
      )
    end
    @server.mount_proc("/api/v0/export/42") do |request, response|
      record(request)
      @polls += 1
      response.status = @status_status
      response["Content-Type"] = "application/json"
      response.body = @status_body.call(@polls)
    end
    @server.mount_proc("/api/v0/export") do |request, response|
      record(request)
      response.status = @create_status
      response["Content-Type"] = "application/json"
      assign_body(response, @create_stream || @create_body)
    end
  end

  def record(request)
    @requests << {
      method: request.request_method,
      path: request.path,
      authorization: request["Authorization"],
      content_type: request["Content-Type"],
      body: request.body
    }
  end

  def dynamic_value(value, count)
    value.respond_to?(:call) ? value.call(count) : value
  end

  def assign_body(response, body)
    if body.respond_to?(:call)
      response.chunked = true
    end
    response.body = body
  end

  def gzip(value)
    buffer = StringIO.new
    Zlib::GzipWriter.wrap(buffer) { |writer| writer.write(value) }
    buffer.string
  end

  def clock_returning(*values)
    last = values.last
    proc { values.empty? ? last : values.shift }
  end

  def trickled_body(value, delay: 0.04, pieces: 6)
    slice_size = [(value.bytesize.to_f / pieces).ceil, 1].max
    chunks = value.bytes.each_slice(slice_size).map { |bytes| bytes.pack("C*") }
    proc do |output|
      chunks.each_with_index do |chunk, index|
        output.write(chunk)
        sleep(delay) unless index == chunks.length - 1
      end
    end
  end

  def assert_invalid_finished_at(value)
    @status_body = proc do |_poll|
      JSON.generate("id" => 42, "finished_at" => value)
    end
    error = assert_raises(GoatCounterClient::ResponseError) do
      client.export_csv(timeout: 1)
    end

    assert_match(/finished_at/i, error.message)
    refute_match(/private-finished-at|secret-token/, error.message)
    refute @requests.any? { |request| request[:path].end_with?("/download") }
  end

  def assert_invalid_status_error(value)
    @status_body = proc do |_poll|
      JSON.generate(
        "id" => 42,
        "finished_at" => "2026-07-10T03:00:00Z",
        "error" => value
      )
    end

    error = assert_raises(GoatCounterClient::ResponseError) { client.export_csv }

    assert_match(/invalid export status error field/i, error.message)
    refute_match(/secret-token/, error.message)
    refute @requests.any? { |request| request[:path].end_with?("/download") }
  end

  def assert_response_error_without_secrets
    error = assert_raises(GoatCounterClient::ResponseError) { yield }
    assert_match(/HTTP/i, error.message)
    refute_match(/private .* response|secret-token/, error.message)
  end

  def assert_configuration_rejected(options = {})
    defaults = {
      site_code: "ky-ji",
      token: "private-configuration-token",
      base_url: base_url,
      allow_insecure_loopback: true
    }

    error = assert_raises(ArgumentError) do
      GoatCounterClient.new(**defaults.merge(options))
    end

    refute_match(/private-configuration-token/, error.message)
    assert_empty @requests
  end
end
