#!/usr/bin/env ruby

require "fileutils"
require "json"
require "net/http"
require "optparse"
require "tempfile"
require "time"
require "uri"
require_relative "../lib/goatcounter_client"
require_relative "../lib/visitor_analytics"

module VisitorStatsBuild
  SITE = "ky-ji.github.io".freeze
  DEFAULT_OUTPUT = "assets/data/visitor-stats.json".freeze
  DEFAULT_FALLBACK_URL =
    "https://ky-ji.github.io/assets/data/visitor-stats.json".freeze

  class InvalidSnapshotError < StandardError; end
  class FallbackError < StandardError; end

  def self.run(arguments, environment)
    options = parse_options(arguments)
    site_code = environment.fetch("GOATCOUNTER_SITE_CODE")
    token = environment.fetch("GOATCOUNTER_API_KEY")
    data_since = Time.iso8601(environment.fetch("VISITOR_ANALYTICS_START"))

    snapshot = begin
      fresh_snapshot(
        site_code: site_code,
        token: token,
        base_url: environment["GOATCOUNTER_BASE_URL"],
        data_since: data_since
      )
    rescue StandardError => error
      warn "Fresh visitor snapshot unavailable: " + error.class.name
      begin
        fallback_snapshot(options[:fallback_url])
      rescue StandardError
        warn "No valid visitor snapshot source"
        return 1
      end
    end

    atomic_write(options[:output], snapshot)
    0
  end

  def self.parse_options(arguments)
    options = {
      output: DEFAULT_OUTPUT,
      fallback_url: DEFAULT_FALLBACK_URL
    }
    OptionParser.new do |parser|
      parser.on(
        "--output PATH",
        "Output path (default: " + DEFAULT_OUTPUT + ")"
      ) { |value| options[:output] = value }
      parser.on(
        "--fallback-url URL",
        "Fallback URL (default: " + DEFAULT_FALLBACK_URL + ")"
      ) { |value| options[:fallback_url] = value }
    end.parse!(arguments)
    options
  end
  private_class_method :parse_options

  def self.fresh_snapshot(site_code:, token:, base_url:, data_since:)
    csv = GoatCounterClient.new(
      site_code: site_code,
      token: token,
      base_url: base_url
    ).export_csv
    snapshot = VisitorAnalytics::SnapshotBuilder.new(
      site: SITE,
      data_since: data_since
    ).build(csv)
    validate_snapshot(snapshot)
  end
  private_class_method :fresh_snapshot

  def self.fallback_snapshot(url)
    uri = URI(url)
    response = Net::HTTP.start(uri.host, uri.port, use_ssl: uri.scheme == "https") do |http|
      http.open_timeout = 10
      http.read_timeout = 30
      http.get(uri.request_uri)
    end
    unless response.is_a?(Net::HTTPSuccess)
      raise FallbackError, "fallback request was unsuccessful"
    end

    validate_snapshot(JSON.parse(response.body))
  end
  private_class_method :fallback_snapshot

  def self.validate_snapshot(snapshot)
    unless VisitorAnalytics.valid_snapshot?(snapshot)
      raise InvalidSnapshotError, "visitor snapshot failed validation"
    end
    snapshot
  end
  private_class_method :validate_snapshot

  def self.atomic_write(path, snapshot)
    validate_snapshot(snapshot)
    directory = File.dirname(path)
    FileUtils.mkdir_p(directory)
    temporary = Tempfile.new(["visitor-stats-", ".json"], directory)
    begin
      temporary.write(JSON.pretty_generate(snapshot) + "\n")
      temporary.flush
      temporary.fsync
      temporary.close
      File.rename(temporary.path, path)
    ensure
      temporary.close unless temporary.closed?
      temporary.unlink
    end
  end
  private_class_method :atomic_write
end

exit VisitorStatsBuild.run(ARGV, ENV) if $PROGRAM_NAME == __FILE__
