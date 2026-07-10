require "minitest/autorun"
require "csv"
require "time"
require_relative "../lib/visitor_analytics"

class VisitorAnalyticsTest < Minitest::Test
  NOW = Time.iso8601("2026-07-10T12:00:00+09:00")
  START = Time.iso8601("2026-07-01T00:00:00+09:00")
  GOATCOUNTER_HEADERS = [
    "2Path", "Title", "Event", "UserAgent", "Browser", "System", "Session",
    "Bot", "Referrer", "Referrer scheme", "Screen size", "Location",
    "FirstVisit", "Date"
  ].freeze

  def csv
    File.read(File.expand_path("fixtures/goatcounter_pageviews.csv", __dir__))
  end

  def snapshot
    VisitorAnalytics::SnapshotBuilder.new(
      site: "ky-ji.github.io",
      data_since: START,
      now: NOW
    ).build(csv)
  end

  def test_fixture_uses_goatcounter_export_headers
    assert_equal GOATCOUNTER_HEADERS, CSV.parse(csv, headers: true).headers
  end

  def test_counts_pageviews_and_distinct_sessions
    assert_equal 4, snapshot.dig("periods", "all", "pageviews")
    assert_equal 2, snapshot.dig("periods", "all", "visitors")
    assert_equal [
      {"code" => "KR", "visitors" => 1},
      {"code" => "US", "visitors" => 1}
    ], snapshot.dig("periods", "all", "countries")
  end

  def test_periods_are_independent
    assert_equal 3, snapshot.dig("periods", "7d", "pageviews")
    assert_equal 1, snapshot.dig("periods", "7d", "visitors")
    assert_equal 4, snapshot.dig("periods", "30d", "pageviews")
  end

  def test_emits_stable_metadata
    assert_equal 1, snapshot["schema_version"]
    assert_equal "Asia/Seoul", snapshot["timezone"]
    assert_equal START.iso8601, snapshot["data_since"]
    assert_equal NOW.utc.iso8601, snapshot["generated_at"]
    assert VisitorAnalytics.valid_snapshot?(snapshot)
  end

  def test_rejects_invalid_snapshot_shape
    refute VisitorAnalytics.valid_snapshot?({"schema_version" => 1})
  end
end
