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

  def builder
    VisitorAnalytics::SnapshotBuilder.new(
      site: "ky-ji.github.io",
      data_since: START,
      now: NOW
    )
  end

  def snapshot
    builder.build(csv)
  end

  def header_csv(headers)
    CSV.generate_line(headers)
  end

  def export_csv(rows)
    CSV.generate do |output|
      output << GOATCOUNTER_HEADERS
      rows.each do |row|
        output << GOATCOUNTER_HEADERS.map { |header| row.fetch(header, "") }
      end
    end
  end

  def pageview_row(session:, event: "false", bot: "0", location: "KR")
    {
      "2Path" => "/",
      "Title" => "Home",
      "Event" => event,
      "Session" => session,
      "Bot" => bot,
      "Location" => location,
      "Date" => "2026-07-09T01:00:00Z"
    }
  end

  def assert_invalid_export(csv_text)
    error = assert_raises(VisitorAnalytics::InvalidExportError) do
      builder.build(csv_text)
    end
    assert_match(/GoatCounter/i, error.message)
  end

  def deep_copy(value)
    Marshal.load(Marshal.dump(value))
  end

  def test_fixture_uses_goatcounter_export_headers
    assert_equal GOATCOUNTER_HEADERS, CSV.parse(csv, headers: true).headers
    assert_equal GOATCOUNTER_HEADERS, VisitorAnalytics::EXPORT_HEADERS
  end

  def test_accepts_header_only_export
    empty_snapshot = builder.build(header_csv(GOATCOUNTER_HEADERS))

    assert_equal 0, empty_snapshot.dig("periods", "all", "pageviews")
    assert_equal 0, empty_snapshot.dig("periods", "all", "visitors")
    assert VisitorAnalytics.valid_snapshot?(empty_snapshot)
  end

  def test_rejects_wrong_export_version
    headers = GOATCOUNTER_HEADERS.dup
    headers[0] = "1Path"

    assert_invalid_export(header_csv(headers))
  end

  def test_rejects_missing_export_column
    assert_invalid_export(header_csv(GOATCOUNTER_HEADERS - ["UserAgent"]))
  end

  def test_rejects_extra_export_column
    assert_invalid_export(header_csv(GOATCOUNTER_HEADERS + ["IP address"]))
  end

  def test_rejects_duplicate_export_column
    headers = GOATCOUNTER_HEADERS.dup
    headers[1] = "2Path"

    assert_invalid_export(header_csv(headers))
  end

  def test_rejects_reordered_export_columns
    headers = GOATCOUNTER_HEADERS.dup
    headers[0], headers[1] = headers[1], headers[0]

    assert_invalid_export(header_csv(headers))
  end

  def test_rejects_non_csv_export
    assert_invalid_export("<!doctype html><title>Sign in</title>")
  end

  def test_wraps_malformed_csv_as_invalid_export
    malformed = header_csv(GOATCOUNTER_HEADERS) + "\"unterminated"

    error = assert_raises(VisitorAnalytics::InvalidExportError) do
      builder.build(malformed)
    end
    assert_match(/malformed GoatCounter CSV/i, error.message)
  end

  def test_accepts_only_normalized_false_event_values
    rows = [
      pageview_row(session: "false", event: "false"),
      pageview_row(session: "trimmed-false", event: " FALSE "),
      pageview_row(session: "zero", event: "0"),
      pageview_row(session: "trimmed-zero", event: " 0 "),
      pageview_row(session: "blank", event: ""),
      pageview_row(session: "unknown", event: "unknown"),
      pageview_row(session: "true", event: "true"),
      pageview_row(session: "one", event: "1")
    ]

    result = builder.build(export_csv(rows))
    assert_equal 4, result.dig("periods", "all", "pageviews")
    assert_equal 4, result.dig("periods", "all", "visitors")
  end

  def test_accepts_only_exact_zero_bot_value
    rows = [
      pageview_row(session: "zero", bot: "0"),
      pageview_row(session: "blank", bot: ""),
      pageview_row(session: "whitespace", bot: " 0 "),
      pageview_row(session: "false", bot: "false"),
      pageview_row(session: "unknown", bot: "unknown"),
      pageview_row(session: "one", bot: "1")
    ]

    result = builder.build(export_csv(rows))
    assert_equal 1, result.dig("periods", "all", "pageviews")
    assert_equal 1, result.dig("periods", "all", "visitors")
  end

  def test_extracts_country_only_from_complete_location
    rows = [
      pageview_row(session: "country", location: "KR"),
      pageview_row(session: "subdivision", location: "US-CA"),
      pageview_row(session: "unknown", location: "UNKNOWN"),
      pageview_row(session: "long-country", location: "USA"),
      pageview_row(session: "empty-subdivision", location: "US-"),
      pageview_row(session: "invalid-country", location: "U1"),
      pageview_row(session: "long-subdivision", location: "US-CALIFORNIA")
    ]

    result = builder.build(export_csv(rows))
    assert_equal 7, result.dig("periods", "all", "visitors")
    assert_equal [
      {"code" => "KR", "visitors" => 1},
      {"code" => "US", "visitors" => 1}
    ], result.dig("periods", "all", "countries")
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

  def test_rejects_extra_top_level_snapshot_keys
    candidate = snapshot.merge("raw_hits" => [])

    refute VisitorAnalytics.valid_snapshot?(candidate)
  end

  def test_rejects_extra_period_collection_keys
    candidate = deep_copy(snapshot)
    candidate["periods"]["session_ids"] = []

    refute VisitorAnalytics.valid_snapshot?(candidate)
  end

  def test_rejects_extra_period_keys
    candidate = deep_copy(snapshot)
    candidate["periods"]["all"]["session_ids"] = []

    refute VisitorAnalytics.valid_snapshot?(candidate)
  end

  def test_rejects_extra_country_keys
    candidate = deep_copy(snapshot)
    candidate["periods"]["all"]["countries"][0]["raw_hits"] = []

    refute VisitorAnalytics.valid_snapshot?(candidate)
  end

  def test_rejects_duplicate_country_codes
    candidate = deep_copy(snapshot)
    candidate["periods"]["all"]["countries"] = [
      {"code" => "KR", "visitors" => 1},
      {"code" => "KR", "visitors" => 1}
    ]

    refute VisitorAnalytics.valid_snapshot?(candidate)
  end

  def test_rejects_country_counts_out_of_descending_order
    candidate = deep_copy(snapshot)
    candidate["periods"]["all"]["visitors"] = 3
    candidate["periods"]["all"]["countries"] = [
      {"code" => "KR", "visitors" => 1},
      {"code" => "US", "visitors" => 2}
    ]

    refute VisitorAnalytics.valid_snapshot?(candidate)
  end

  def test_rejects_country_codes_out_of_order_for_ties
    candidate = deep_copy(snapshot)
    candidate["periods"]["all"]["countries"].reverse!

    refute VisitorAnalytics.valid_snapshot?(candidate)
  end

  def test_rejects_more_visitors_than_pageviews
    candidate = deep_copy(snapshot)
    candidate["periods"]["all"]["visitors"] = 5

    refute VisitorAnalytics.valid_snapshot?(candidate)
  end

  def test_rejects_country_sum_above_period_visitors
    candidate = deep_copy(snapshot)
    candidate["periods"]["all"]["countries"] = [
      {"code" => "JP", "visitors" => 1},
      {"code" => "KR", "visitors" => 1},
      {"code" => "US", "visitors" => 1}
    ]

    refute VisitorAnalytics.valid_snapshot?(candidate)
  end

  def test_rejects_decreasing_period_pageviews
    candidate = deep_copy(snapshot)
    candidate["periods"]["7d"]["pageviews"] = 5

    refute VisitorAnalytics.valid_snapshot?(candidate)
  end

  def test_rejects_decreasing_period_visitors
    candidate = deep_copy(snapshot)
    candidate["periods"]["7d"]["visitors"] = 3

    refute VisitorAnalytics.valid_snapshot?(candidate)
  end

  def test_rejects_data_since_after_generated_at
    candidate = deep_copy(snapshot)
    candidate["data_since"] = "2026-07-11T00:00:00Z"

    refute VisitorAnalytics.valid_snapshot?(candidate)
  end
end
