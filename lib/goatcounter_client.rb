require "json"
require "net/http"
require "stringio"
require "time"
require "timeout"
require "uri"
require "zlib"

class GoatCounterClient
  SITE_CODE_PATTERN = /\A[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\z/.freeze
  LOOPBACK_HOSTS = ["127.0.0.1", "::1"].freeze
  TIMEOUT_MESSAGE = "GoatCounter export operation reached its timeout".freeze

  class ResponseError < StandardError; end
  class ExportUnavailableError < ResponseError; end
  class TimeoutError < StandardError; end

  def initialize(
    site_code:,
    token:,
    base_url: nil,
    sleeper: Kernel.method(:sleep),
    monotonic_clock: proc { Process.clock_gettime(Process::CLOCK_MONOTONIC) },
    allow_insecure_loopback: false
  )
    validate_site_code!(site_code)
    validate_token!(token)
    @token = token
    @base_url = validated_base_url(site_code, base_url, allow_insecure_loopback)
    @sleeper = sleeper
    @monotonic_clock = monotonic_clock
  end

  def export_csv(timeout: 120)
    deadline = monotonic_time + timeout
    created = json_request(
      :post,
      "/api/v0/export",
      {"format" => "csv"},
      expected_status: 202,
      deadline: deadline
    )
    export_id = parse_export_id(created)

    loop do
      status = json_request(
        :get,
        "/api/v0/export/" + export_id.to_s,
        expected_status: 200,
        deadline: deadline
      )
      finished = completed_status?(status, export_id)
      if finished
        response = request(
          :get,
          "/api/v0/export/" + export_id.to_s + "/download",
          expected_statuses: [200, 202],
          deadline: deadline
        )
        return decompress(response.body, deadline) if response.code.to_i == 200
      end

      sleep_before_poll(deadline)
    end
  end

  def zero_pageviews?(start_at:, end_at:, timeout: 30)
    validate_stats_range!(start_at, end_at)
    deadline = monotonic_time + timeout
    query = URI.encode_www_form(
      "start" => start_at.iso8601,
      "end" => end_at.iso8601
    )
    totals = json_request(
      :get,
      "/api/v0/stats/total?" + query,
      expected_status: 200,
      deadline: deadline
    )

    total = totals["total"]
    validate_nonnegative_integer!(total, "total pageview count")
    total_events = totals["total_events"]
    validate_nonnegative_integer!(total_events, "total event count")
    unless total_events == 0
      raise ResponseError, "GoatCounter returned an invalid total event count"
    end
    total == 0
  end

  private

  def validate_stats_range!(start_at, end_at)
    unless start_at.is_a?(Time) && end_at.is_a?(Time)
      raise ArgumentError, "invalid GoatCounter stats range"
    end
    if start_at > end_at
      raise ArgumentError, "invalid GoatCounter stats range"
    end
  end

  def validate_nonnegative_integer!(value, label)
    unless value.is_a?(Integer) && value >= 0
      raise ResponseError, "GoatCounter returned an invalid " + label
    end
  end

  def validate_site_code!(site_code)
    unless site_code.is_a?(String) && SITE_CODE_PATTERN.match?(site_code)
      raise ArgumentError, "invalid GoatCounter site code"
    end
  end

  def validate_token!(token)
    unless token.is_a?(String) && !token.empty?
      raise ArgumentError, "invalid GoatCounter token"
    end
  end

  def validated_base_url(site_code, base_url, allow_insecure_loopback)
    production_url = "https://" + site_code + ".goatcounter.com"
    return production_url if base_url.nil?
    unless base_url.is_a?(String)
      raise ArgumentError, "invalid GoatCounter base URL"
    end
    return production_url if [production_url, production_url + "/"].include?(base_url)

    uri = URI.parse(base_url)
    if allow_insecure_loopback == true && valid_loopback_uri?(uri)
      return base_url.sub(%r{/\z}, "")
    end
    raise ArgumentError, "invalid GoatCounter base URL"
  rescue URI::InvalidURIError
    raise ArgumentError, "invalid GoatCounter base URL"
  end

  def valid_loopback_uri?(uri)
    uri.is_a?(URI::HTTP) &&
      uri.scheme == "http" &&
      LOOPBACK_HOSTS.include?(uri.hostname) &&
      ["", "/"].include?(uri.path) &&
      uri.userinfo.nil? &&
      uri.query.nil? &&
      uri.fragment.nil?
  end

  def parse_export_id(response)
    value = response["id"]
    export_id = if value.is_a?(Integer)
      value
    elsif value.is_a?(String) && value.match?(/\A[0-9]+\z/)
      value.to_i
    end

    unless export_id && export_id > 0
      raise ResponseError, "GoatCounter returned an invalid export id"
    end
    export_id
  end

  def json_request(method, path, body = nil, expected_status:, deadline:)
    response = request(
      method,
      path,
      body,
      expected_statuses: [expected_status],
      deadline: deadline
    )
    begin
      parsed = within_deadline(deadline) { JSON.parse(response.body) }
    rescue JSON::ParserError, TypeError
      raise ResponseError, "GoatCounter returned malformed JSON"
    end
    unless parsed.is_a?(Hash)
      raise ResponseError, "GoatCounter returned an invalid JSON response shape"
    end
    parsed
  end

  def completed_status?(status, expected_id)
    status_id = parse_export_id(status)
    unless status_id == expected_id
      raise ResponseError, "GoatCounter returned a mismatched export id"
    end

    error = status["error"]
    unless error.nil? || error.is_a?(String)
      raise ResponseError, "GoatCounter returned an invalid export status error field"
    end
    unless error.nil? || error.empty?
      raise ResponseError, "GoatCounter export status reported an error"
    end

    finished_at = status["finished_at"]
    return false if finished_at.nil?
    unless finished_at.is_a?(String) && !finished_at.empty?
      raise ResponseError, "GoatCounter returned an invalid export status finished_at"
    end

    begin
      Time.iso8601(finished_at)
    rescue ArgumentError
      raise ResponseError, "GoatCounter returned an invalid export status finished_at"
    end
    true
  end

  def request(method, path, body = nil, expected_statuses:, deadline:)
    uri = URI.join(@base_url + "/", path.sub(/\A\//, ""))
    request_class = method == :post ? Net::HTTP::Post : Net::HTTP::Get
    http_request = request_class.new(uri)
    http_request["Authorization"] = "Bearer " + @token
    if body
      http_request["Content-Type"] = "application/json"
      http_request.body = JSON.generate(body)
    end

    response = within_deadline(deadline) do |remaining|
      http = Net::HTTP.new(uri.host, uri.port)
      http.use_ssl = uri.scheme == "https"
      http.open_timeout = [10, remaining].min
      http.read_timeout = [30, remaining].min
      http.start { |session| session.request(http_request) }
    end
    status = response.code.to_i
    if method == :post && path == "/api/v0/export" && status == 404
      raise ExportUnavailableError, "GoatCounter returned HTTP 404 for export creation"
    end
    unless expected_statuses.include?(status)
      raise ResponseError, "GoatCounter returned HTTP " + response.code
    end
    response
  end

  def decompress(compressed, deadline)
    within_deadline(deadline) { read_gzip(compressed) }
  end

  def read_gzip(compressed)
    reader = nil
    begin
      reader = Zlib::GzipReader.new(StringIO.new(compressed))
      contents = reader.read
      reader.close
      reader = nil
      contents
    rescue Zlib::Error, EOFError, IOError, TypeError
      raise ResponseError, "GoatCounter returned invalid gzip data"
    ensure
      close_gzip_reader(reader)
    end
  end

  def close_gzip_reader(reader)
    reader.close if reader
  rescue Zlib::Error, EOFError, IOError, TypeError
    nil
  end

  def sleep_before_poll(deadline)
    within_deadline(deadline) do |remaining|
      @sleeper.call([2, remaining].min)
    end
  end

  def within_deadline(deadline)
    now = ensure_before_deadline!(deadline)
    remaining = deadline - now
    result = Timeout.timeout(remaining) { yield remaining }
    ensure_before_deadline!(deadline)
    result
  rescue Timeout::Error, Errno::ETIMEDOUT
    raise TimeoutError, TIMEOUT_MESSAGE
  end

  def monotonic_time
    @monotonic_clock.call
  end

  def ensure_before_deadline!(deadline)
    now = monotonic_time
    if now >= deadline
      raise TimeoutError, TIMEOUT_MESSAGE
    end
    now
  end
end
