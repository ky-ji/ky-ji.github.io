#!/usr/bin/env ruby

require "csv"
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
  MAX_FUTURE_SECONDS = 5 * 60

  class InvalidSnapshotError < StandardError; end
  class FallbackError < StandardError; end

  def self.run(arguments, environment, export_timeout: 120)
    options = parse_options(arguments)
    site_code = environment.fetch("GOATCOUNTER_SITE_CODE")
    token = environment.fetch("GOATCOUNTER_API_KEY")
    data_since = Time.iso8601(environment.fetch("VISITOR_ANALYTICS_START"))

    snapshot = begin
      fresh_snapshot(
        site_code: site_code,
        token: token,
        base_url: environment["GOATCOUNTER_BASE_URL"],
        allow_insecure_loopback:
          environment["GOATCOUNTER_ALLOW_INSECURE_LOOPBACK"] == "1",
        data_since: data_since,
        export_timeout: export_timeout
      )
    rescue StandardError => error
      warn "Fresh visitor snapshot unavailable: " + error.class.name
      begin
        fallback_snapshot(options[:fallback_url], data_since: data_since)
      rescue StandardError
        warn "No valid visitor snapshot source"
        return 1
      end
    end

    atomic_write(options[:output], snapshot, data_since: data_since)
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

  def self.fresh_snapshot(
    site_code:,
    token:,
    base_url:,
    allow_insecure_loopback:,
    data_since:,
    export_timeout:
  )
    client = GoatCounterClient.new(
      site_code: site_code,
      token: token,
      base_url: base_url,
      allow_insecure_loopback: allow_insecure_loopback
    )
    snapshot_now = nil
    zero_confirmed = false
    csv = begin
      client.export_csv(timeout: export_timeout)
    rescue GoatCounterClient::ExportUnavailableError => export_error
      snapshot_now = Time.now
      confirmed = confirmed_zero_csv(
        client: client,
        data_since: data_since,
        now: snapshot_now,
        failure: export_error
      )
      zero_confirmed = true
      confirmed
    end
    if csv == ""
      snapshot_now = Time.now
      csv = confirmed_zero_csv(
        client: client,
        data_since: data_since,
        now: snapshot_now,
        failure: VisitorAnalytics::InvalidExportError.new(
          "empty GoatCounter CSV export"
        )
      )
      zero_confirmed = true
    end
    snapshot_now ||= Time.now
    snapshot = VisitorAnalytics::SnapshotBuilder.new(
      site: SITE,
      data_since: data_since,
      now: snapshot_now
    ).build(csv)
    snapshot = validate_snapshot(snapshot, data_since: data_since)
    if snapshot.dig("periods", "all", "pageviews") == 0 && !zero_confirmed
      confirm_zero!(
        client: client,
        data_since: data_since,
        now: snapshot_now,
        failure: InvalidSnapshotError.new(
          "zero visitor snapshot was not confirmed"
        )
      )
    end
    snapshot
  end
  private_class_method :fresh_snapshot

  def self.confirmed_zero_csv(client:, data_since:, now:, failure:)
    confirm_zero!(
      client: client,
      data_since: data_since,
      now: now,
      failure: failure
    )
    CSV.generate_line(VisitorAnalytics::EXPORT_HEADERS)
  end
  private_class_method :confirmed_zero_csv

  def self.confirm_zero!(client:, data_since:, now:, failure:)
    zero_pageviews = begin
      client.zero_pageviews?(start_at: data_since, end_at: now)
    rescue StandardError
      raise failure
    end
    raise failure unless zero_pageviews
  end
  private_class_method :confirm_zero!

  def self.fallback_snapshot(url, data_since:)
    uri = URI(url)
    response = Net::HTTP.start(uri.host, uri.port, use_ssl: uri.scheme == "https") do |http|
      http.open_timeout = 10
      http.read_timeout = 30
      http.get(uri.request_uri)
    end
    unless response.is_a?(Net::HTTPSuccess)
      raise FallbackError, "fallback request was unsuccessful"
    end

    validate_snapshot(JSON.parse(response.body), data_since: data_since)
  end
  private_class_method :fallback_snapshot

  def self.validate_snapshot(snapshot, data_since:, now: Time.now)
    unless VisitorAnalytics.valid_snapshot?(snapshot)
      raise InvalidSnapshotError, "visitor snapshot failed validation"
    end
    unless snapshot["site"] == SITE
      raise InvalidSnapshotError, "visitor snapshot failed identity validation"
    end

    snapshot_start = Time.iso8601(snapshot["data_since"])
    generated_at = Time.iso8601(snapshot["generated_at"])
    unless snapshot_start == data_since
      raise InvalidSnapshotError, "visitor snapshot failed identity validation"
    end
    if generated_at > now + MAX_FUTURE_SECONDS
      raise InvalidSnapshotError, "visitor snapshot failed time validation"
    end
    snapshot
  rescue ArgumentError
    raise InvalidSnapshotError, "visitor snapshot failed time validation"
  end
  private_class_method :validate_snapshot

  def self.atomic_write(path, snapshot, data_since:)
    validate_snapshot(snapshot, data_since: data_since)
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
