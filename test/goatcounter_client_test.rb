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
    @status_status = 200
    @status_body = proc do |poll|
      JSON.generate(
        "id" => 42,
        "finished_at" => (poll > 1 ? "2026-07-10T03:00:00Z" : nil)
      )
    end
    @download_status = 200
    @download_body = gzip(@csv)

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
    clock = clock_returning(0.0, 0.0, 0.1, 2.1, 2.2)

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
    clock = clock_returning(0.0, 0.0, 0.5, 1.0)

    error = assert_raises(GoatCounterClient::TimeoutError) do
      client(monotonic_clock: clock).export_csv(timeout: 1)
    end

    assert_match(/timeout/i, error.message)
    assert_equal 1, @polls
    refute @requests.any? { |request| request[:path].end_with?("/download") }
  end

  def test_rejects_completion_that_arrives_after_deadline
    @status_body = proc do |_poll|
      JSON.generate("id" => 42, "finished_at" => "2026-07-10T03:00:00Z")
    end
    clock = clock_returning(0.0, 0.0, 1.1)

    assert_raises(GoatCounterClient::TimeoutError) do
      client(monotonic_clock: clock).export_csv(timeout: 1)
    end

    assert_equal 1, @polls
    assert_empty @sleeps
    refute @requests.any? { |request| request[:path].end_with?("/download") }
  end

  def test_does_not_start_status_poll_at_deadline
    @status_body = proc { |_poll| JSON.generate("id" => 42, "finished_at" => nil) }
    clock = clock_returning(0.0, 1.0)

    assert_raises(GoatCounterClient::TimeoutError) do
      client(monotonic_clock: clock).export_csv(timeout: 1)
    end

    assert_equal 0, @polls
    assert_equal ["/api/v0/export"], @requests.map { |request| request[:path] }
  end

  def test_sleeps_only_for_sub_two_second_remaining_duration
    @status_body = proc { |_poll| JSON.generate("id" => 42, "finished_at" => nil) }
    clock = clock_returning(0.0, 0.0, 0.25, 1.0)

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

  private

  def client(monotonic_clock: nil)
    options = {
      site_code: "ky-ji",
      token: "secret-token",
      base_url: base_url,
      sleeper: proc { |seconds| @sleeps << seconds }
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
      response.status = @download_status
      response.body = @download_body
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
      response.body = @create_body
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

  def gzip(value)
    buffer = StringIO.new
    Zlib::GzipWriter.wrap(buffer) { |writer| writer.write(value) }
    buffer.string
  end

  def clock_returning(*values)
    last = values.last
    proc { values.empty? ? last : values.shift }
  end

  def assert_invalid_finished_at(value)
    @status_body = proc do |_poll|
      JSON.generate("id" => 42, "finished_at" => value)
    end
    clock = clock_returning(0.0, 0.0, 0.25, 1.0)

    error = assert_raises(GoatCounterClient::ResponseError) do
      client(monotonic_clock: clock).export_csv(timeout: 1)
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
end
