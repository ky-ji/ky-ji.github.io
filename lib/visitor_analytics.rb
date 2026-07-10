require "csv"
require "time"

module VisitorAnalytics
  PERIOD_KEYS = %w[7d 30d all].freeze
  Hit = Struct.new(:at, :session, :country)

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
      CSV.parse(csv_text, headers: true).each do |row|
        next if truthy?(row["Event"]) || bot?(row["Bot"])

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

    def truthy?(value)
      %w[1 true yes].include?(value.to_s.downcase)
    end

    def bot?(value)
      text = value.to_s.strip
      !text.empty? && text != "0"
    end

    def country(value)
      code = value.to_s.upcase[/\A[A-Z]{2}/]
      code unless code.to_s.empty?
    end
  end

  def self.valid_snapshot?(value)
    return false unless value.is_a?(Hash)
    return false unless value["schema_version"] == 1
    return false unless value["site"].is_a?(String)
    return false unless value["timezone"] == "Asia/Seoul"
    return false unless time_string?(value["data_since"])
    return false unless time_string?(value["generated_at"])

    periods = value["periods"]
    return false unless periods.is_a?(Hash) && PERIOD_KEYS.all? { |key| periods.key?(key) }

    PERIOD_KEYS.all? do |key|
      period = periods[key]
      next false unless period.is_a?(Hash)
      next false unless nonnegative_integer?(period["pageviews"])
      next false unless nonnegative_integer?(period["visitors"])
      countries = period["countries"]
      countries.is_a?(Array) && countries.all? do |entry|
        entry.is_a?(Hash) &&
          entry["code"].to_s.match?(/\A[A-Z]{2}\z/) &&
          nonnegative_integer?(entry["visitors"]) &&
          entry["visitors"] > 0
      end
    end
  end

  def self.nonnegative_integer?(value)
    value.is_a?(Integer) && value >= 0
  end
  private_class_method :nonnegative_integer?

  def self.time_string?(value)
    Time.iso8601(value.to_s)
    true
  rescue ArgumentError
    false
  end
  private_class_method :time_string?
end
