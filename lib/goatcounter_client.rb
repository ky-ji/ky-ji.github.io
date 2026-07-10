require "json"
require "net/http"
require "stringio"
require "uri"
require "zlib"

class GoatCounterClient
  class ResponseError < StandardError; end
  class TimeoutError < StandardError; end

  def initialize(site_code:, token:, base_url: nil, sleeper: Kernel.method(:sleep))
    @token = token
    @base_url = (base_url || "https://" + site_code + ".goatcounter.com").sub(%r{/+\z}, "")
    @sleeper = sleeper
  end

  def export_csv(timeout: 120)
    created = json_request(:post, "/api/v0/export", "format" => "csv")
    export_id = parse_export_id(created)
    deadline = monotonic_time + timeout

    loop do
      status = json_request(:get, "/api/v0/export/" + export_id.to_s)
      if present?(status["error"])
        raise ResponseError, "GoatCounter export status reported an error"
      end
      break if present?(status["finished_at"])

      if monotonic_time >= deadline
        raise TimeoutError, "GoatCounter export polling reached its timeout"
      end
      @sleeper.call(2)
    end

    response = request(:get, "/api/v0/export/" + export_id.to_s + "/download")
    decompress(response.body)
  end

  private

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

  def json_request(method, path, body = nil)
    parsed = JSON.parse(request(method, path, body).body)
    unless parsed.is_a?(Hash)
      raise ResponseError, "GoatCounter returned an invalid JSON response shape"
    end
    parsed
  rescue JSON::ParserError, TypeError
    raise ResponseError, "GoatCounter returned malformed JSON"
  end

  def request(method, path, body = nil)
    uri = URI.join(@base_url + "/", path.sub(/\A\//, ""))
    request_class = method == :post ? Net::HTTP::Post : Net::HTTP::Get
    http_request = request_class.new(uri)
    http_request["Authorization"] = "Bearer " + @token
    if body
      http_request["Content-Type"] = "application/json"
      http_request.body = JSON.generate(body)
    end

    response = Net::HTTP.start(uri.host, uri.port, use_ssl: uri.scheme == "https") do |http|
      http.open_timeout = 10
      http.read_timeout = 30
      http.request(http_request)
    end
    unless response.code.to_i.between?(200, 299)
      raise ResponseError, "GoatCounter returned HTTP " + response.code
    end
    response
  end

  def decompress(compressed)
    reader = Zlib::GzipReader.new(StringIO.new(compressed))
    reader.read
  rescue Zlib::Error, EOFError
    raise ResponseError, "GoatCounter returned invalid gzip data"
  ensure
    reader.close if reader
  end

  def monotonic_time
    Process.clock_gettime(Process::CLOCK_MONOTONIC)
  end

  def present?(value)
    !value.nil? && !value.to_s.strip.empty?
  end
end
