require "csv"
require "time"

module VisitorAnalytics
  PERIOD_KEYS = %w[7d 30d all].freeze
  SNAPSHOT_KEYS = %w[schema_version site timezone data_since generated_at periods].freeze
  PERIOD_VALUE_KEYS = %w[pageviews visitors countries].freeze
  COUNTRY_KEYS = %w[code visitors].freeze
  PAGEVIEW_EVENT_VALUES = %w[false 0].freeze
  EXPORT_HEADERS = [
    "2Path", "Title", "Event", "UserAgent", "Browser", "System", "Session",
    "Bot", "Referrer", "Referrer scheme", "Screen size", "Location",
    "FirstVisit", "Date"
  ].freeze
  Hit = Struct.new(:at, :session, :country)

  class InvalidExportError < StandardError; end

  class SnapshotBuilder
    def initialize(site:, data_since:, now: Time.now)
      @site = site
      @data_since = data_since
      @now = now
    end

    def build(csv_text)
      hits = parse_hits(csv_text)
      {
        "schema_version" => 1,
        "site" => @site,
        "timezone" => "Asia/Seoul",
        "data_since" => @data_since.iso8601,
        "generated_at" => @now.utc.iso8601,
        "periods" => {
          "7d" => summarize(hits, @now - (7 * 86_400)),
          "30d" => summarize(hits, @now - (30 * 86_400)),
          "all" => summarize(hits, @data_since)
        }
      }
    end

    private

    def parse_hits(csv_text)
      hits = []
      parse_export(csv_text).each do |row|
        next unless pageview?(row["Event"], row["Bot"])

        begin
          at = Time.iso8601(row["Date"].to_s)
        rescue ArgumentError
          next
        end
        next if at < @data_since || at > @now

        hits << Hit.new(at, row["Session"].to_s.strip, country(row["Location"]))
      end
      hits.sort_by(&:at)
    end

    def parse_export(csv_text)
      export = CSV.parse(csv_text, headers: true)
      unless export.headers == EXPORT_HEADERS
        raise InvalidExportError, "unsupported GoatCounter v2 CSV export headers"
      end
      export
    rescue CSV::MalformedCSVError => error
      raise InvalidExportError, "malformed GoatCounter CSV export: " + error.message
    end

    def summarize(hits, start_at)
      selected = hits.select { |hit| hit.at >= start_at }
      sessions = {}

      selected.each do |hit|
        next if hit.session.empty?
        sessions[hit.session] = hit.country unless sessions.key?(hit.session)
        if sessions[hit.session].nil? && hit.country
          sessions[hit.session] = hit.country
        end
      end

      country_counts = Hash.new(0)
      sessions.each_value { |code| country_counts[code] += 1 if code }
      countries = country_counts.map do |code, count|
        {"code" => code, "visitors" => count}
      end.sort_by { |entry| [-entry["visitors"], entry["code"]] }

      {
        "pageviews" => selected.length,
        "visitors" => sessions.length,
        "countries" => countries
      }
    end

    def pageview?(event, bot)
      PAGEVIEW_EVENT_VALUES.include?(event.to_s.strip.downcase) && bot.to_s == "0"
    end

    def country(value)
      match = value.to_s.upcase.match(/\A([A-Z]{2})(?:-[A-Z0-9]{1,3})?\z/)
      match && match[1]
    end
  end

  def self.valid_snapshot?(value)
    return false unless exact_keys?(value, SNAPSHOT_KEYS)
    return false unless value["schema_version"] == 1
    return false unless value["site"].is_a?(String)
    return false unless value["timezone"] == "Asia/Seoul"

    data_since = parse_time(value["data_since"])
    generated_at = parse_time(value["generated_at"])
    return false unless data_since && generated_at && data_since <= generated_at

    periods = value["periods"]
    return false unless exact_keys?(periods, PERIOD_KEYS)
    return false unless PERIOD_KEYS.all? { |key| valid_period?(periods[key]) }

    nondecreasing?(PERIOD_KEYS.map { |key| periods[key]["pageviews"] }) &&
      nondecreasing?(PERIOD_KEYS.map { |key| periods[key]["visitors"] })
  end

  def self.exact_keys?(value, keys)
    value.is_a?(Hash) &&
      value.length == keys.length &&
      keys.all? { |key| value.key?(key) }
  end
  private_class_method :exact_keys?

  def self.valid_period?(period)
    return false unless exact_keys?(period, PERIOD_VALUE_KEYS)

    pageviews = period["pageviews"]
    visitors = period["visitors"]
    return false unless nonnegative_integer?(pageviews)
    return false unless nonnegative_integer?(visitors) && visitors <= pageviews

    countries = period["countries"]
    return false unless countries.is_a?(Array) && countries.all? { |entry| valid_country?(entry) }

    codes = countries.map { |entry| entry["code"] }
    return false unless codes.uniq.length == codes.length

    sorted_countries = countries.sort_by do |entry|
      [-entry["visitors"], entry["code"]]
    end
    return false unless countries == sorted_countries

    countries.inject(0) { |total, entry| total + entry["visitors"] } <= visitors
  end
  private_class_method :valid_period?

  def self.valid_country?(entry)
    return false unless exact_keys?(entry, COUNTRY_KEYS)

    code = entry["code"]
    visitors = entry["visitors"]
    code.is_a?(String) &&
      code.match?(/\A[A-Z]{2}\z/) &&
      nonnegative_integer?(visitors) &&
      visitors > 0
  end
  private_class_method :valid_country?

  def self.nondecreasing?(values)
    values.each_cons(2).all? { |left, right| left <= right }
  end
  private_class_method :nondecreasing?

  def self.parse_time(value)
    return unless value.is_a?(String)

    Time.iso8601(value)
  rescue ArgumentError
    nil
  end
  private_class_method :parse_time

  def self.nonnegative_integer?(value)
    value.is_a?(Integer) && value >= 0
  end
  private_class_method :nonnegative_integer?
end
