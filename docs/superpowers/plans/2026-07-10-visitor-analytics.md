# Visitor Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Replace FeedPulse with a GoatCounter-backed, country-level visitor globe, reliable aggregate snapshots, and a private full analytics dashboard.

**Architecture:** GoatCounter collects production traffic and retains the owner dashboard. A scheduled GitHub Pages workflow exports individual pageviews, reduces them to privacy-safe 7-day, 30-day, and all-time aggregates, and places one same-origin JSON snapshot in the Pages artifact. The homepage lazily loads a repository-hosted globe and renders only aggregate metrics.

**Tech Stack:** Jekyll 3.8, Ruby 2.6 standard library, Minitest, vanilla JavaScript, Node built-in test runner, globe.gl 2.46.1, GitHub Actions Pages.

---

## Execution Preconditions

- Start implementation in a dedicated worktree created from commit a132593.
- Keep the user's current main worktree untouched while tasks 1-7 are developed.
- Use apply_patch for hand-written source changes. Mechanical extraction of the pinned vendor bundle and binary texture is allowed.
- Do not switch GitHub Pages or push production until Task 8.
- Task 7 needs the user to create a GoatCounter login and enter an API token directly into GitHub Secrets. Never request that token in chat or write it to disk.

## File Map

**Create**

- lib/visitor_analytics.rb: parse GoatCounter CSV and build/validate aggregate snapshots.
- lib/goatcounter_client.rb: authenticated export API client with bounded polling.
- scripts/build_visitor_stats.rb: workflow CLI, fresh-export path, and validated live fallback.
- test/fixtures/goatcounter_pageviews.csv: representative pageviews, sessions, bot, event, and malformed date.
- test/fixtures/visitor-stats.json: valid browser and build fixture.
- test/visitor_analytics_test.rb: Ruby aggregation and validation tests.
- test/goatcounter_client_test.rb: local fake-server API tests.
- test/visitor_analytics_core_test.cjs: browser-model unit tests with Node's built-in runner.
- assets/js/visitor-analytics-core.js: pure snapshot, period, stale, marker, and shortcut logic.
- assets/js/visitor-analytics.js: DOM controller, caching, accessibility, and lazy globe rendering.
- assets/css/visitor-analytics.css: stable desktop/mobile panel layout.
- _includes/visitor-analytics.html: panel markup and production-only tracker.
- assets/vendor/globe.gl.min.js: pinned globe.gl 2.46.1 browser bundle.
- assets/vendor/LICENSE-globe.gl: upstream MIT license.
- assets/vendor/LICENSE-country-json: country centroid source MIT license.
- assets/img/earth-night.jpg: pinned same-origin earth texture.
- assets/data/country-centroids.json: compact ISO2/name/latitude/longitude lookup.
- .github/workflows/pages.yml: test, snapshot, Jekyll build, and Pages deploy workflow.

**Modify**

- .gitignore: ignore generated production snapshot.
- _config.yml: public GoatCounter code and fixed tracking start.
- _layouts/homepage.html: remove FeedPulse and inline panel code; include the new assets.
- test/visitor_map_test.rb: replace FeedPulse assertions with layout and privacy assertions.

## Task 1: Aggregate GoatCounter Pageviews

**Files:**

- Create: test/fixtures/goatcounter_pageviews.csv
- Create: test/visitor_analytics_test.rb
- Create: lib/visitor_analytics.rb

- [ ] **Step 1: Add the representative CSV fixture**

Use this exact fixture. It produces four accepted pageviews, two anonymous sessions, two countries, one excluded bot, one excluded event, one pageview without a session, and one invalid-date row.

~~~csv
2Path,Title,Event,UserAgent,Browser,System,Session,Bot,Referrer,Referrer scheme,Screen size,Location,FirstVisit,Date
/,Home,false,,Chrome,Mac OS,session-a,0,,,1440x900,KR-11,true,2026-07-09T01:00:00Z
/projects,Projects,false,,Chrome,Mac OS,session-a,0,Google,g,1440x900,KR-11,false,2026-07-09T01:05:00Z
/,Home,false,,Firefox,Linux,session-b,0,,,1920x1080,US-CA,true,2026-07-02T00:00:00Z
/,Home,false,,Chrome,Linux,session-c,1,,,1280x720,DE,true,2026-07-09T02:00:00Z
download-cv,Download CV,true,,Chrome,Mac OS,session-d,0,,,1440x900,KR-11,true,2026-07-09T03:00:00Z
/,Home,false,,Safari,iOS,,0,,,390x844,JP,true,2026-07-09T04:00:00Z
/,Home,false,,Safari,iOS,session-e,0,,,390x844,JP,true,not-a-date
~~~

- [ ] **Step 2: Write the failing aggregation tests**

~~~ruby
require "minitest/autorun"
require "time"
require_relative "../lib/visitor_analytics"

class VisitorAnalyticsTest < Minitest::Test
  NOW = Time.iso8601("2026-07-10T12:00:00+09:00")
  START = Time.iso8601("2026-07-01T00:00:00+09:00")

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
~~~

- [ ] **Step 3: Run the test and verify RED**

Run:

~~~bash
ruby -Itest test/visitor_analytics_test.rb
~~~

The first run will report LoadError because the boundary does not exist. Add
this compile-only scaffold, rerun, and require assertion failures before
implementing behavior:

~~~ruby
module VisitorAnalytics
  class SnapshotBuilder
    def initialize(**_options); end
    def build(_csv); {}; end
  end
  def self.valid_snapshot?(_value); false; end
end
~~~

- [ ] **Step 4: Implement the minimal CSV aggregator and validator**

Create lib/visitor_analytics.rb with these public interfaces and behavior:

~~~ruby
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
~~~

- [ ] **Step 5: Run the test and verify GREEN**

Run:

~~~bash
ruby -Itest test/visitor_analytics_test.rb
~~~

Expected: 4 runs, 12 assertions, 0 failures, 0 errors.

- [ ] **Step 6: Commit the aggregation boundary**

~~~bash
git add lib/visitor_analytics.rb test/fixtures/goatcounter_pageviews.csv test/visitor_analytics_test.rb
git commit -m "feat: aggregate visitor analytics snapshots"
~~~

## Task 2: Fetch Exports and Preserve the Last Healthy Snapshot

**Files:**

- Create: lib/goatcounter_client.rb
- Create: scripts/build_visitor_stats.rb
- Create: test/goatcounter_client_test.rb
- Create: test/fixtures/visitor-stats.json

- [ ] **Step 1: Add a valid aggregate fixture**

~~~json
{
  "schema_version": 1,
  "site": "ky-ji.github.io",
  "timezone": "Asia/Seoul",
  "data_since": "2026-07-01T00:00:00+09:00",
  "generated_at": "2026-07-10T03:00:00Z",
  "periods": {
    "7d": {
      "pageviews": 3,
      "visitors": 1,
      "countries": [{"code": "KR", "visitors": 1}]
    },
    "30d": {
      "pageviews": 4,
      "visitors": 2,
      "countries": [
        {"code": "KR", "visitors": 1},
        {"code": "US", "visitors": 1}
      ]
    },
    "all": {
      "pageviews": 4,
      "visitors": 2,
      "countries": [
        {"code": "KR", "visitors": 1},
        {"code": "US", "visitors": 1}
      ]
    }
  }
}
~~~

- [ ] **Step 2: Write failing fake-server API tests**

The tests must start a local WEBrick server, assert the Authorization header,
return an export id, return unfinished once and finished once, then serve a
gzip-compressed CSV download. Add a second test whose status endpoint remains
unfinished and assert GoatCounterClient::TimeoutError.

~~~ruby
require "minitest/autorun"
require "json"
require "stringio"
require "webrick"
require "zlib"
require_relative "../lib/goatcounter_client"

class GoatCounterClientTest < Minitest::Test
  def setup
    @polls = 0
    @pending_forever = false
    @download_status = 200
    @csv = File.read(File.expand_path("fixtures/goatcounter_pageviews.csv", __dir__))
    @server = WEBrick::HTTPServer.new(
      Port: 0,
      Logger: WEBrick::Log.new(File::NULL),
      AccessLog: []
    )
    @server.mount_proc("/api/v0/export") do |req, res|
      assert_equal "Bearer secret-token", req["Authorization"]
      res["Content-Type"] = "application/json"
      res.body = JSON.generate("id" => 42)
    end
    @server.mount_proc("/api/v0/export/42") do |_req, res|
      @polls += 1
      res["Content-Type"] = "application/json"
      res.body = JSON.generate(
        "id" => 42,
        "finished_at" => (!@pending_forever && @polls > 1 ? "2026-07-10T03:00:00Z" : nil)
      )
    end
    @server.mount_proc("/api/v0/export/42/download") do |_req, res|
      res.status = @download_status
      next if @download_status >= 400
      buffer = StringIO.new
      Zlib::GzipWriter.wrap(buffer) { |gzip| gzip.write(@csv) }
      res["Content-Type"] = "application/gzip"
      res.body = buffer.string
    end
    @thread = Thread.new { @server.start }
  end

  def teardown
    @server.shutdown
    @thread.join
  end

  def client
    port = @server.listeners.first.addr[1]
    GoatCounterClient.new(
      site_code: "ky-ji",
      token: "secret-token",
      base_url: "http://127.0.0.1:" + port.to_s,
      sleeper: proc { |_seconds| }
    )
  end

  def test_downloads_completed_csv_export
    assert_equal @csv, client.export_csv(timeout: 2)
    assert_equal 2, @polls
  end

  def test_times_out_when_export_never_finishes
    @pending_forever = true
    assert_raises(GoatCounterClient::TimeoutError) do
      client.export_csv(timeout: 0)
    end
  end

  def test_raises_on_non_success_response
    @download_status = 500
    @polls = 2
    assert_raises(GoatCounterClient::ResponseError) do
      client.export_csv(timeout: 2)
    end
  end
end
~~~

- [ ] **Step 3: Run the client test and verify RED**

Run:

~~~bash
ruby -Itest test/goatcounter_client_test.rb
~~~

The first run will report LoadError. Add this compile-only scaffold, rerun, and
require assertion failures before implementing network behavior:

~~~ruby
class GoatCounterClient
  class ResponseError < StandardError; end
  class TimeoutError < StandardError; end
  def initialize(**_options); end
  def export_csv(timeout:); ""; end
end
~~~

- [ ] **Step 4: Implement the API client**

lib/goatcounter_client.rb must expose GoatCounterClient#export_csv(timeout:),
send Bearer authentication, poll by completion state, reject non-2xx responses,
and decompress the returned gzip body.

~~~ruby
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
    @base_url = base_url || "https://" + site_code + ".goatcounter.com"
    @sleeper = sleeper
  end

  def export_csv(timeout: 120)
    created = json_request(:post, "/api/v0/export", "format" => "csv")
    export_id = Integer(created.fetch("id"))
    deadline = Process.clock_gettime(Process::CLOCK_MONOTONIC) + timeout

    loop do
      status = json_request(:get, "/api/v0/export/" + export_id.to_s)
      break if status["finished_at"]
      if Process.clock_gettime(Process::CLOCK_MONOTONIC) >= deadline
        raise TimeoutError, "GoatCounter export did not finish before timeout"
      end
      @sleeper.call(2)
    end

    compressed = request(:get, "/api/v0/export/" + export_id.to_s + "/download").body
    Zlib::GzipReader.new(StringIO.new(compressed)).read
  end

  private

  def json_request(method, path, body = nil)
    JSON.parse(request(method, path, body).body)
  rescue JSON::ParserError => error
    raise ResponseError, "invalid GoatCounter JSON: " + error.message
  end

  def request(method, path, body = nil)
    uri = URI.join(@base_url + "/", path.sub(/\A\//, ""))
    klass = method == :post ? Net::HTTP::Post : Net::HTTP::Get
    req = klass.new(uri)
    req["Authorization"] = "Bearer " + @token
    req["Content-Type"] = "application/json"
    req.body = JSON.generate(body) if body

    response = Net::HTTP.start(uri.host, uri.port, use_ssl: uri.scheme == "https") do |http|
      http.open_timeout = 10
      http.read_timeout = 30
      http.request(req)
    end
    unless response.code.to_i.between?(200, 299)
      raise ResponseError, "GoatCounter returned HTTP " + response.code
    end
    response
  end
end
~~~

- [ ] **Step 5: Run the API test and verify GREEN**

Run:

~~~bash
ruby -Itest test/goatcounter_client_test.rb
~~~

Expected: 3 runs with all assertions passing and no errors.

- [ ] **Step 6: Add the workflow CLI**

scripts/build_visitor_stats.rb must require GOATCOUNTER_SITE_CODE,
GOATCOUNTER_API_KEY, and VISITOR_ANALYTICS_START; accept output and fallback
URLs from arguments; write fresh data when export succeeds; otherwise download,
parse, and validate the existing live snapshot. It must abort before writing if
both sources are invalid.

~~~ruby
#!/usr/bin/env ruby
require "fileutils"
require "json"
require "net/http"
require "optparse"
require "time"
require "uri"
require_relative "../lib/goatcounter_client"
require_relative "../lib/visitor_analytics"

options = {
  output: "assets/data/visitor-stats.json",
  fallback: "https://ky-ji.github.io/assets/data/visitor-stats.json"
}
OptionParser.new do |parser|
  parser.on("--output PATH") { |value| options[:output] = value }
  parser.on("--fallback-url URL") { |value| options[:fallback] = value }
end.parse!

site_code = ENV.fetch("GOATCOUNTER_SITE_CODE")
token = ENV.fetch("GOATCOUNTER_API_KEY")
data_since = Time.iso8601(ENV.fetch("VISITOR_ANALYTICS_START"))

begin
  csv = GoatCounterClient.new(site_code: site_code, token: token).export_csv
  snapshot = VisitorAnalytics::SnapshotBuilder.new(
    site: "ky-ji.github.io",
    data_since: data_since
  ).build(csv)
rescue StandardError => fresh_error
  warn "Fresh visitor snapshot unavailable: " + fresh_error.class.name
  uri = URI(options[:fallback])
  response = Net::HTTP.start(uri.host, uri.port, use_ssl: uri.scheme == "https") do |http|
    http.open_timeout = 10
    http.read_timeout = 30
    http.get(uri.request_uri)
  end
  raise "No valid visitor snapshot source" unless response.is_a?(Net::HTTPSuccess)
  snapshot = JSON.parse(response.body)
  raise "Live visitor snapshot failed validation" unless VisitorAnalytics.valid_snapshot?(snapshot)
end

raise "Generated visitor snapshot failed validation" unless VisitorAnalytics.valid_snapshot?(snapshot)
FileUtils.mkdir_p(File.dirname(options[:output]))
File.write(options[:output], JSON.pretty_generate(snapshot) + "\n")
~~~

- [ ] **Step 7: Verify fixture-mode aggregation and syntax**

Run:

~~~bash
ruby -c scripts/build_visitor_stats.rb
ruby -Itest -e 'Dir["test/*_test.rb"].sort.each { |file| require File.expand_path(file) }'
~~~

Expected: Syntax OK and all Ruby tests pass.

- [ ] **Step 8: Commit the export boundary**

~~~bash
git add lib/goatcounter_client.rb scripts/build_visitor_stats.rb test/goatcounter_client_test.rb test/fixtures/visitor-stats.json
git commit -m "feat: fetch reliable visitor snapshots"
~~~

## Task 3: Build the Testable Browser Model

**Files:**

- Create: test/visitor_analytics_core_test.cjs
- Create: assets/js/visitor-analytics-core.js

- [ ] **Step 1: Write failing Node tests**

~~~javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../assets/js/visitor-analytics-core.js');
const snapshot = require('./fixtures/visitor-stats.json');

test('validates and derives one period', () => {
  assert.equal(core.validateSnapshot(snapshot), true);
  assert.deepEqual(core.viewModel(snapshot, '7d'), {
    pageviews: 3,
    visitors: 1,
    viewsPerVisitor: 3,
    countryCount: 1,
    countries: [{ code: 'KR', visitors: 1 }]
  });
});

test('detects snapshots older than eighteen hours', () => {
  const now = Date.parse('2026-07-11T00:00:01Z');
  assert.equal(core.isStale(snapshot, now), true);
});

test('maps only countries that have centroids', () => {
  const model = core.viewModel(snapshot, '30d');
  const points = core.markers(model, {
    KR: { name: 'South Korea', lat: 36.5, lng: 127.8 }
  });
  assert.deepEqual(points, [
    { code: 'KR', name: 'South Korea', lat: 36.5, lng: 127.8, visitors: 1 }
  ]);
});

test('toggles after three human-paced K presses', () => {
  let toggles = 0;
  let now = 0;
  const handler = core.createShortcutHandler(() => { toggles += 1; }, () => now);
  handler({ key: 'k', target: {} });
  now = 1200;
  handler({ code: 'KeyK', target: {} });
  now = 2400;
  handler({ keyCode: 75, target: {} });
  assert.equal(toggles, 1);
});

test('ignores editable targets', () => {
  let toggles = 0;
  const handler = core.createShortcutHandler(() => { toggles += 1; }, () => 0);
  for (let i = 0; i < 3; i += 1) {
    handler({ key: 'k', target: { tagName: 'INPUT' } });
  }
  assert.equal(toggles, 0);
});
~~~

- [ ] **Step 2: Run the Node test and verify RED**

Run:

~~~bash
/Users/jky/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test test/visitor_analytics_core_test.cjs
~~~

The first run reports MODULE_NOT_FOUND. Add a compile-only CommonJS export with
each required function returning false or an empty value, rerun, and require
assertion failures before implementing behavior.

~~~javascript
module.exports = {
  validateSnapshot: function () { return false; },
  viewModel: function () { return {}; },
  isStale: function () { return false; },
  markers: function () { return []; },
  createShortcutHandler: function () {
    return function () { return false; };
  }
};
~~~

- [ ] **Step 3: Implement the UMD browser model**

Create assets/js/visitor-analytics-core.js as a UMD module that exports:

- validateSnapshot(snapshot)
- viewModel(snapshot, period)
- isStale(snapshot, nowMs, thresholdMs)
- markers(model, centroids)
- createShortcutHandler(toggle, clock)

Use an 18-hour default stale threshold, a four-second shortcut window, robust
K recognition through key/code/keyCode/which, and editable-target exclusion.
Return country rows sorted exactly as supplied by the validated snapshot.

~~~javascript
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VisitorAnalyticsCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var PERIODS = ['7d', '30d', 'all'];
  var STALE_MS = 18 * 60 * 60 * 1000;

  function validCount(value) {
    return Number.isInteger(value) && value >= 0;
  }

  function validTime(value) {
    return typeof value === 'string' && Number.isFinite(Date.parse(value));
  }

  function validateSnapshot(snapshot) {
    if (!snapshot || snapshot.schema_version !== 1) return false;
    if (snapshot.site !== 'ky-ji.github.io') return false;
    if (snapshot.timezone !== 'Asia/Seoul') return false;
    if (!validTime(snapshot.data_since) || !validTime(snapshot.generated_at)) return false;
    if (!snapshot.periods || typeof snapshot.periods !== 'object') return false;

    return PERIODS.every(function (key) {
      var period = snapshot.periods[key];
      if (!period || !validCount(period.pageviews) || !validCount(period.visitors)) return false;
      if (!Array.isArray(period.countries)) return false;
      return period.countries.every(function (entry) {
        return entry && /^[A-Z]{2}$/.test(entry.code) &&
          Number.isInteger(entry.visitors) && entry.visitors > 0;
      });
    });
  }

  function viewModel(snapshot, periodKey) {
    if (!validateSnapshot(snapshot) || PERIODS.indexOf(periodKey) === -1) {
      throw new TypeError('Invalid visitor analytics snapshot or period');
    }
    var period = snapshot.periods[periodKey];
    return {
      pageviews: period.pageviews,
      visitors: period.visitors,
      viewsPerVisitor: period.visitors ?
        Math.round((period.pageviews / period.visitors) * 10) / 10 : 0,
      countryCount: period.countries.length,
      countries: period.countries.slice()
    };
  }

  function isStale(snapshot, nowMs, thresholdMs) {
    if (!validateSnapshot(snapshot)) return true;
    var now = typeof nowMs === 'number' ? nowMs : Date.now();
    var threshold = typeof thresholdMs === 'number' ? thresholdMs : STALE_MS;
    return now - Date.parse(snapshot.generated_at) > threshold;
  }

  function markers(model, centroids) {
    return model.countries.reduce(function (points, country) {
      var centroid = centroids[country.code];
      if (!centroid || country.visitors <= 0) return points;
      points.push({
        code: country.code,
        name: centroid.name || country.code,
        lat: Number(centroid.lat),
        lng: Number(centroid.lng),
        visitors: country.visitors
      });
      return points;
    }, []);
  }

  function isEditable(target) {
    var tag = (target && target.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' ||
      Boolean(target && target.isContentEditable);
  }

  function isK(event) {
    var key = String(event.key || '').toLowerCase();
    return key === 'k' || event.code === 'KeyK' ||
      event.keyCode === 75 || event.which === 75;
  }

  function createShortcutHandler(toggle, clock) {
    var count = 0;
    var lastAt = null;
    var now = clock || Date.now;
    return function (event) {
      if (isEditable(event.target) || !isK(event)) return false;
      var at = now();
      count = lastAt !== null && at - lastAt <= 4000 ? count + 1 : 1;
      lastAt = at;
      if (count < 3) return false;
      count = 0;
      lastAt = null;
      toggle();
      return true;
    };
  }

  return {
    validateSnapshot: validateSnapshot,
    viewModel: viewModel,
    isStale: isStale,
    markers: markers,
    createShortcutHandler: createShortcutHandler
  };
});
~~~

- [ ] **Step 4: Run the Node test and verify GREEN**

Run:

~~~bash
/Users/jky/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test test/visitor_analytics_core_test.cjs
~~~

Expected: 5 tests pass, 0 fail.

- [ ] **Step 5: Commit the browser model**

~~~bash
git add assets/js/visitor-analytics-core.js test/visitor_analytics_core_test.cjs
git commit -m "feat: add visitor analytics browser model"
~~~

## Task 4: Replace the FeedPulse Layout and Add the Panel Shell

**Files:**

- Modify: _config.yml
- Modify: _layouts/homepage.html
- Modify: test/visitor_map_test.rb
- Create: _includes/visitor-analytics.html
- Create: assets/css/visitor-analytics.css

- [ ] **Step 1: Replace the old layout assertions with failing requirements**

test/visitor_map_test.rb must assert:

~~~ruby
require "minitest/autorun"

class VisitorMapTest < Minitest::Test
  ROOT = File.expand_path("..", __dir__)
  LAYOUT = File.read(File.join(ROOT, "_layouts/homepage.html"))
  INCLUDE_PATH = File.join(ROOT, "_includes/visitor-analytics.html")
  INCLUDE = File.exist?(INCLUDE_PATH) ? File.read(INCLUDE_PATH) : ""
  CONFIG = File.read(File.join(ROOT, "_config.yml"))

  def test_removes_failed_widget_providers
    refute_includes LAYOUT + INCLUDE, "feed-pulse.com"
    refute_includes LAYOUT + INCLUDE, "clustrmaps.com"
  end

  def test_loads_repository_owned_panel_assets
    assert_includes LAYOUT, "visitor-analytics.css"
    assert_includes LAYOUT, "{% include visitor-analytics.html %}"
    assert_includes INCLUDE, "visitor-analytics-core.js"
    assert_includes INCLUDE, "visitor-analytics.js"
    assert_includes INCLUDE, "assets/data/visitor-stats.json"
  end

  def test_configures_goatcounter_without_an_api_key
    assert_includes CONFIG, "goatcounter_code: ky-ji"
    assert_includes CONFIG, "visitor_analytics_start:"
    refute_includes CONFIG, "GOATCOUNTER_API_KEY"
    assert_includes INCLUDE, "gc.zgo.at/count.js"
    assert_includes INCLUDE, "ky-ji.github.io"
    assert_includes CONFIG, "  - test/"
    assert_includes CONFIG, "  - lib/"
    assert_includes CONFIG, "  - scripts/"
  end

  def test_retains_both_hidden_entry_methods
    assert_includes INCLUDE, 'id="statsPanel"'
    assert_includes INCLUDE, 'data-query-key="k"'
    assert_includes INCLUDE, 'data-query-value="1"'
  end
end
~~~

- [ ] **Step 2: Run the layout test and verify RED**

Run:

~~~bash
ruby test/visitor_map_test.rb
~~~

Expected: FAIL for the missing include and remaining FeedPulse URL.

- [ ] **Step 3: Add public configuration**

Add these exact values to _config.yml:

~~~yaml
# Visitor analytics
goatcounter_code: ky-ji
visitor_analytics_start: "2026-07-10T00:00:00+09:00"
~~~

Also add these directories to the existing exclude list so CSV fixtures,
implementation helpers, and internal design documents are never copied into
the public Pages artifact:

~~~yaml
  - docs/
  - lib/
  - scripts/
  - test/
~~~

If GoatCounter reports that ky-ji is unavailable in Task 7, replace only the
code value with ky-ji-github before deployment.

- [ ] **Step 4: Create semantic panel markup**

_includes/visitor-analytics.html must contain:

- a dialog-like aside with id statsPanel and aria-hidden state;
- an icon-only close button using the already loaded Font Awesome xmark icon;
- a three-button segmented period control;
- a four-item definition list for Visitors, Page Views, Views per Visitor, and Countries;
- a fixed-size globe host and a no-WebGL fallback;
- an ordered Top 5 Countries list;
- tracking-start and last-sync time elements;
- a GoatCounter dashboard link;
- data attributes for same-origin stats, local globe bundle, centroids, texture, and query activation;
- production-only GoatCounter tracking guarded by exact hostname;
- local core/controller script tags.

Do not include any inline API key, demo points, FeedPulse attribution, or raw
visitor data.

~~~liquid
<aside
  class="visitor-analytics"
  id="statsPanel"
  role="dialog"
  aria-labelledby="visitorAnalyticsTitle"
  aria-hidden="true"
  data-stats-url="{{ '/assets/data/visitor-stats.json' | relative_url }}"
  data-globe-script="{{ '/assets/vendor/globe.gl.min.js' | relative_url }}"
  data-centroids-url="{{ '/assets/data/country-centroids.json' | relative_url }}"
  data-texture-url="{{ '/assets/img/earth-night.jpg' | relative_url }}"
  data-dashboard-url="https://{{ site.goatcounter_code }}.goatcounter.com/"
  data-tracking-start="{{ site.visitor_analytics_start }}"
  data-query-key="k"
  data-query-value="1">
  <header class="visitor-analytics__header">
    <div>
      <p class="visitor-analytics__eyebrow">Private site summary</p>
      <h2 id="visitorAnalyticsTitle">Visitor Analytics</h2>
    </div>
    <button class="visitor-analytics__close" type="button" aria-label="Close visitor analytics">
      <i class="fa-solid fa-xmark" aria-hidden="true"></i>
    </button>
  </header>

  <div class="visitor-analytics__periods" role="tablist" aria-label="Analytics period">
    <button type="button" role="tab" data-period="7d" aria-selected="true">7 days</button>
    <button type="button" role="tab" data-period="30d" aria-selected="false">30 days</button>
    <button type="button" role="tab" data-period="all" aria-selected="false">All time</button>
  </div>

  <p class="visitor-analytics__status" data-status aria-live="polite">Loading analytics</p>
  <dl class="visitor-analytics__metrics" aria-label="Traffic summary">
    <div><dt>Visitors</dt><dd data-metric="visitors">-</dd></div>
    <div><dt>Page Views</dt><dd data-metric="pageviews">-</dd></div>
    <div><dt>Views / Visitor</dt><dd data-metric="viewsPerVisitor">-</dd></div>
    <div><dt>Countries</dt><dd data-metric="countryCount">-</dd></div>
  </dl>

  <div class="visitor-analytics__body">
    <div class="visitor-analytics__globe-wrap">
      <div class="visitor-analytics__globe" data-globe aria-label="Visitor country globe"></div>
      <p class="visitor-analytics__globe-fallback" data-globe-fallback hidden>
        Globe unavailable on this browser
      </p>
    </div>
    <section class="visitor-analytics__countries" aria-labelledby="topCountriesTitle">
      <h3 id="topCountriesTitle">Top Countries</h3>
      <ol data-country-list></ol>
    </section>
  </div>

  <footer class="visitor-analytics__footer">
    <p>
      Since <time data-tracking-start></time>
      <span aria-hidden="true">·</span>
      Updated <time data-updated-at></time>
    </p>
    <a href="https://{{ site.goatcounter_code }}.goatcounter.com/" target="_blank" rel="noopener">
      <i class="fa-solid fa-chart-line" aria-hidden="true"></i>
      Open full dashboard
    </a>
  </footer>
</aside>

<script src="{{ '/assets/js/visitor-analytics-core.js' | relative_url }}"></script>
<script src="{{ '/assets/js/visitor-analytics.js' | relative_url }}" defer></script>

{% if jekyll.environment == "production" and site.goatcounter_code %}
<script>
  if (window.location.hostname !== 'ky-ji.github.io') {
    window.goatcounter = { no_onload: true };
  }
</script>
<script
  data-goatcounter="https://{{ site.goatcounter_code }}.goatcounter.com/count"
  async
  src="https://gc.zgo.at/count.js"></script>
{% endif %}
~~~

- [ ] **Step 5: Move panel styling out of the layout**

Create assets/css/visitor-analytics.css with:

- a fixed panel no wider than 560px and 8px corner radius;
- stable metric, globe, and list grid tracks;
- 280px desktop and 220px mobile globe dimensions;
- an icon-sized 36px close button;
- segmented mode buttons with selected, hover, and focus-visible states;
- loading, empty, stale, unavailable, and WebGL fallback states;
- a single-column layout below 560px;
- no nested cards and no text overlap at 320px width.

Use this complete layout baseline, then adjust only colors or spacing when
browser screenshots demonstrate a concrete issue:

~~~css
.visitor-analytics {
  display: none;
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 9999;
  width: min(560px, calc(100vw - 40px));
  max-height: calc(100vh - 40px);
  overflow: auto;
  box-sizing: border-box;
  padding: 20px;
  color: #f8fafc;
  background: rgba(10, 15, 24, 0.96);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.42);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
.visitor-analytics.is-open { display: block; }
.visitor-analytics__header,
.visitor-analytics__footer,
.visitor-analytics__body {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.visitor-analytics__header h2,
.visitor-analytics__countries h3,
.visitor-analytics__footer p { margin: 0; }
.visitor-analytics__header h2 { font-size: 18px; line-height: 1.25; }
.visitor-analytics__eyebrow {
  margin: 0 0 3px;
  color: #94a3b8;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0;
}
.visitor-analytics__close {
  display: inline-flex;
  width: 36px;
  height: 36px;
  flex: 0 0 36px;
  align-items: center;
  justify-content: center;
  color: #cbd5e1;
  background: transparent;
  border: 0;
  border-radius: 4px;
  cursor: pointer;
}
.visitor-analytics__close:hover { color: #fff; background: rgba(255, 255, 255, 0.08); }
.visitor-analytics__periods {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin: 16px 0 12px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 6px;
  overflow: hidden;
}
.visitor-analytics__periods button {
  min-height: 34px;
  padding: 6px 10px;
  color: #94a3b8;
  background: transparent;
  border: 0;
  border-right: 1px solid rgba(255, 255, 255, 0.12);
  cursor: pointer;
}
.visitor-analytics__periods button:last-child { border-right: 0; }
.visitor-analytics__periods button[aria-selected="true"] { color: #fff; background: #155e75; }
.visitor-analytics button:focus-visible,
.visitor-analytics a:focus-visible { outline: 2px solid #67e8f9; outline-offset: 2px; }
.visitor-analytics__status {
  min-height: 18px;
  margin: 0 0 10px;
  color: #94a3b8;
  font-size: 12px;
}
.visitor-analytics.is-stale .visitor-analytics__status { color: #fbbf24; }
.visitor-analytics.is-unavailable .visitor-analytics__status { color: #fca5a5; }
.visitor-analytics__metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  margin: 0;
  padding: 12px 0;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}
.visitor-analytics__metrics div { min-width: 0; padding: 0 10px; }
.visitor-analytics__metrics div:first-child { padding-left: 0; }
.visitor-analytics__metrics dt {
  color: #94a3b8;
  font-size: 10px;
  line-height: 1.3;
  text-transform: uppercase;
}
.visitor-analytics__metrics dd {
  margin: 4px 0 0;
  overflow-wrap: anywhere;
  font-size: 21px;
  font-weight: 700;
  line-height: 1.1;
}
.visitor-analytics__body { align-items: stretch; margin-top: 14px; }
.visitor-analytics__globe-wrap {
  position: relative;
  width: 280px;
  height: 280px;
  flex: 0 0 280px;
}
.visitor-analytics__globe { width: 280px; height: 280px; }
.visitor-analytics__globe canvas { display: block; width: 100%; height: 100%; }
.visitor-analytics__globe-fallback {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  margin: 0;
  color: #94a3b8;
  text-align: center;
}
.visitor-analytics__globe-fallback[hidden] { display: none; }
.visitor-analytics__countries { min-width: 0; flex: 1; }
.visitor-analytics__countries h3 { font-size: 13px; }
.visitor-analytics__countries ol { margin: 10px 0 0; padding-left: 22px; }
.visitor-analytics__countries li { margin: 6px 0; color: #cbd5e1; }
.visitor-analytics__countries li span { float: right; color: #67e8f9; font-variant-numeric: tabular-nums; }
.visitor-analytics__footer {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  font-size: 11px;
}
.visitor-analytics__footer p { color: #94a3b8; }
.visitor-analytics__footer a { color: #67e8f9; text-decoration: none; }

@media (max-width: 560px) {
  .visitor-analytics {
    right: 12px;
    bottom: 12px;
    width: calc(100vw - 24px);
    max-height: calc(100vh - 24px);
    padding: 16px;
  }
  .visitor-analytics__metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); row-gap: 14px; }
  .visitor-analytics__metrics div { padding: 0; }
  .visitor-analytics__body { flex-direction: column; align-items: center; }
  .visitor-analytics__globe-wrap,
  .visitor-analytics__globe { width: 220px; height: 220px; }
  .visitor-analytics__globe-wrap { flex-basis: 220px; }
  .visitor-analytics__countries { width: 100%; }
  .visitor-analytics__footer { align-items: flex-start; flex-direction: column; }
}

@media (prefers-reduced-motion: reduce) {
  .visitor-analytics * { scroll-behavior: auto; }
}
~~~

- [ ] **Step 6: Reduce homepage.html to links and one include**

Remove the old inline panel CSS, FeedPulse script, panel HTML, and inline
shortcut JavaScript. Add the stylesheet in head and the visitor analytics
include immediately before scale.fix.js:

~~~liquid
<link rel="stylesheet" href="{{ '/assets/css/visitor-analytics.css' | relative_url }}">
...
{% include visitor-analytics.html %}
<script src="{{ '/assets/js/scale.fix.js' | relative_url }}"></script>
~~~

- [ ] **Step 7: Run layout and Jekyll checks**

Run:

~~~bash
ruby test/visitor_map_test.rb
bundle exec /Users/jky/.gem/ruby/2.6.0/bin/jekyll build
~~~

Expected: layout tests pass and Jekyll finishes without errors.

- [ ] **Step 8: Commit the panel shell**

~~~bash
git add _config.yml _layouts/homepage.html _includes/visitor-analytics.html assets/css/visitor-analytics.css test/visitor_map_test.rb
git commit -m "feat: replace visitor widget with analytics panel"
~~~

## Task 5: Vendor the Globe and Implement the Controller

**Files:**

- Create: assets/vendor/globe.gl.min.js
- Create: assets/vendor/LICENSE-globe.gl
- Create: assets/img/earth-night.jpg
- Create: assets/data/country-centroids.json
- Create: assets/vendor/LICENSE-country-json
- Create: assets/js/visitor-analytics.js
- Modify: test/visitor_analytics_core_test.cjs

- [ ] **Step 1: Extend marker tests for unknown and zero countries**

Add tests proving that unknown ISO codes and zero counts are omitted and that
marker ordering follows visitor count.

~~~javascript
test('markers omit unusable countries and sort by visitors', () => {
  const points = core.markers({
    countries: [
      { code: 'ZZ', visitors: 9 },
      { code: 'US', visitors: 1 },
      { code: 'JP', visitors: 0 },
      { code: 'KR', visitors: 3 }
    ]
  }, {
    KR: { name: 'South Korea', lat: 36.5, lng: 127.8 },
    US: { name: 'United States', lat: 38.0, lng: -97.0 },
    JP: { name: 'Japan', lat: 36.0, lng: 138.0 }
  });
  assert.deepEqual(points.map(point => point.code), ['KR', 'US']);
});
~~~

- [ ] **Step 2: Run the Node test and verify RED**

Run the Node command from Task 3. Expected: the new marker test fails.

- [ ] **Step 3: Update markers() minimally and verify GREEN**

Replace markers() with:

~~~javascript
function markers(model, centroids) {
  var points = model.countries.reduce(function (result, country) {
    var centroid = centroids[country.code];
    if (!centroid || country.visitors <= 0) return result;
    result.push({
      code: country.code,
      name: centroid.name || country.code,
      lat: Number(centroid.lat),
      lng: Number(centroid.lng),
      visitors: country.visitors
    });
    return result;
  }, []);
  points.sort(function (left, right) {
    return right.visitors - left.visitors || left.code.localeCompare(right.code);
  });
  return points;
}
~~~

Rerun the Node test. Expected: all tests pass.

- [ ] **Step 4: Vendor globe.gl 2.46.1 and its MIT license**

Use the npm package with integrity
sha512-h+OvX52EBIPLtM0/2JkM+JZ9gPAhPJ4y3+hxUwD5Ey/O0Zk2ockuTiJ71bZbnNBGmNiIZzA5Vr3TMT0b3d35IQ==.
Extract package/dist/globe.gl.min.js into assets/vendor and copy the upstream
LICENSE from commit 709eb149e6957aa8514051e27ad7b044ff5fff65.

Verify the browser bundle exists and contains no source-map URL that would
trigger an external request.

Run from the repository root:

~~~bash
PNPM=/Users/jky/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm
TMPDIR_GLOBE=$(mktemp -d)
(cd "$TMPDIR_GLOBE" && "$PNPM" pack globe.gl@2.46.1)
tar -xzf "$TMPDIR_GLOBE/globe.gl-2.46.1.tgz" -C "$TMPDIR_GLOBE"
mkdir -p assets/vendor
cp "$TMPDIR_GLOBE/package/dist/globe.gl.min.js" assets/vendor/globe.gl.min.js
curl -LsS -o assets/vendor/LICENSE-globe.gl https://raw.githubusercontent.com/vasturiano/globe.gl/709eb149e6957aa8514051e27ad7b044ff5fff65/LICENSE
test -s assets/vendor/globe.gl.min.js
! rg 'sourceMappingURL=https?://' assets/vendor/globe.gl.min.js
~~~

- [ ] **Step 5: Vendor the pinned earth texture**

Download:

https://raw.githubusercontent.com/vasturiano/three-globe/3514b8fbf72c5768f094453f3904c72140e2aa65/example/img/earth-night.jpg

Verify SHA-256:

~~~text
355ab23dd1323315b393d7b91dd2d7ee223a1cbaaba2b48dc72ba90d371ced24
~~~

~~~bash
mkdir -p assets/img
curl -LsS -o assets/img/earth-night.jpg https://raw.githubusercontent.com/vasturiano/three-globe/3514b8fbf72c5768f094453f3904c72140e2aa65/example/img/earth-night.jpg
test "$(shasum -a 256 assets/img/earth-night.jpg | awk '{print $1}')" = "355ab23dd1323315b393d7b91dd2d7ee223a1cbaaba2b48dc72ba90d371ced24"
~~~

- [ ] **Step 6: Generate compact country centroids**

Use country-json 2.3.0, MIT licensed, with npm integrity
sha512-T8QN3dVN6oQJRx+GapaQayNzVx4yh46R9Ka0bsOS8JclpdciciOB4MqbrneE6xYGuEz9zFT8csQYTJwohGNeIw==.
Join country-by-abbreviation.json to country-by-geo-coordinates.json by country
name. Compute each marker as the midpoint of north/south and east/west, copy
the package LICENSE to assets/vendor/LICENSE-country-json, and write only this
runtime shape:

~~~json
{
  "KR": {"name": "South Korea", "lat": 36.0, "lng": 128.0},
  "US": {"name": "United States", "lat": 38.0, "lng": -97.0}
}
~~~

The generated file must include every valid two-letter abbreviation and numeric
bounding box from the pinned source, sorted by ISO code. For a bounding box
that crosses the antimeridian, normalize the longitude midpoint back into
-180..180.

~~~bash
PNPM=/Users/jky/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm
TMPDIR_COUNTRIES=$(mktemp -d)
(cd "$TMPDIR_COUNTRIES" && "$PNPM" pack country-json@2.3.0)
tar -xzf "$TMPDIR_COUNTRIES/country-json-2.3.0.tgz" -C "$TMPDIR_COUNTRIES"
mkdir -p assets/data assets/vendor
cp "$TMPDIR_COUNTRIES/package/LICENSE" assets/vendor/LICENSE-country-json
ruby -rjson -e '
root = ARGV.fetch(0)
output = ARGV.fetch(1)
abbr = JSON.parse(File.read(File.join(root, "src/country-by-abbreviation.json")))
geo = JSON.parse(File.read(File.join(root, "src/country-by-geo-coordinates.json")))
codes = {}
abbr.each { |row| codes[row["country"]] = row["abbreviation"].to_s.upcase }
points = {}
geo.each do |row|
  code = codes[row["country"]]
  next unless code && code.match?(/\A[A-Z]{2}\z/)
  north, south, west, east = %w[north south west east].map { |key| Float(row[key]) rescue nil }
  next unless north && south && west && east
  lng = if west <= east
    (west + east) / 2.0
  else
    (((west + east + 360.0) / 2.0) + 540.0) % 360.0 - 180.0
  end
  points[code] = {
    "name" => row["country"],
    "lat" => ((north + south) / 2.0).round(4),
    "lng" => lng.round(4)
  }
end
File.write(output, JSON.pretty_generate(Hash[points.sort]) + "\n")
' "$TMPDIR_COUNTRIES/package" assets/data/country-centroids.json
ruby -rjson -e 'data=JSON.parse(File.read(ARGV[0])); abort "too few countries" unless data.length > 200' assets/data/country-centroids.json
~~~

- [ ] **Step 7: Implement the DOM controller**

assets/js/visitor-analytics.js must:

1. Bind the core shortcut handler in capture phase.
2. Open on three K presses or ?k=1, close on the icon button or Escape, and
   restore focus.
3. Fetch /assets/data/visitor-stats.json with cache set to no-store.
4. Validate before display and cache only valid snapshots in localStorage under
   visitor-analytics-v1.
5. Fall back to cached data, distinguish empty/stale/unavailable states, and
   never insert demo points.
6. Update all four metrics, timestamps, Top 5 list, selected period ARIA state,
   and country markers.
7. Lazy-load globe.gl, centroids, and texture on first open.
8. Create one transparent, auto-rotating globe; disable zoom; respect reduced
   motion; resize through ResizeObserver.
9. Catch script/WebGL failures and leave metrics plus Top 5 usable.
10. Use Intl.DisplayNames for country names when available and centroid names
    as the fallback.

Implement those requirements with this controller shape; keep all network URLs
from panel data attributes so the script remains reusable and testable:

~~~javascript
(function () {
  'use strict';

  var CACHE_KEY = 'visitor-analytics-v1';

  function init() {
    var panel = document.getElementById('statsPanel');
    var core = window.VisitorAnalyticsCore;
    if (!panel || !core) return;

    var closeButton = panel.querySelector('.visitor-analytics__close');
    var periodButtons = panel.querySelectorAll('[data-period]');
    var status = panel.querySelector('[data-status]');
    var globeHost = panel.querySelector('[data-globe]');
    var globeFallback = panel.querySelector('[data-globe-fallback]');
    var countryList = panel.querySelector('[data-country-list]');
    var updatedAt = panel.querySelector('[data-updated-at]');
    var trackingStart = panel.querySelector('[data-tracking-start]');
    var activePeriod = '7d';
    var snapshot = null;
    var centroids = null;
    var globe = null;
    var loadPromise = null;
    var globePromise = null;
    var lastFocus = null;

    function setOpen(open) {
      panel.classList.toggle('is-open', open);
      panel.setAttribute('aria-hidden', open ? 'false' : 'true');
      if (open) {
        lastFocus = document.activeElement;
        closeButton.focus();
        loadSnapshot();
        ensureGlobe();
      } else if (lastFocus && typeof lastFocus.focus === 'function') {
        lastFocus.focus();
      }
    }

    function loadSnapshot() {
      if (loadPromise) return loadPromise;
      status.textContent = 'Loading analytics';
      loadPromise = fetch(panel.dataset.statsUrl, { cache: 'no-store' })
        .then(function (response) {
          if (!response.ok) throw new Error('snapshot HTTP ' + response.status);
          return response.json();
        })
        .then(function (value) {
          if (!core.validateSnapshot(value)) throw new Error('invalid snapshot');
          try { localStorage.setItem(CACHE_KEY, JSON.stringify(value)); } catch (_error) {}
          snapshot = value;
          render();
        })
        .catch(function () {
          var cached = readCache();
          if (cached) {
            snapshot = cached;
            render('Showing last saved data');
          } else {
            panel.classList.add('is-unavailable');
            status.textContent = 'Statistics temporarily unavailable';
          }
        });
      return loadPromise;
    }

    function readCache() {
      try {
        var value = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
        return core.validateSnapshot(value) ? value : null;
      } catch (_error) {
        return null;
      }
    }

    function render(statusOverride) {
      if (!snapshot) return;
      var model = core.viewModel(snapshot, activePeriod);
      setMetric('visitors', model.visitors);
      setMetric('pageviews', model.pageviews);
      setMetric('viewsPerVisitor', model.viewsPerVisitor);
      setMetric('countryCount', model.countryCount);
      renderCountries(model.countries);
      trackingStart.textContent = formatDate(snapshot.data_since);
      trackingStart.dateTime = snapshot.data_since;
      updatedAt.textContent = formatDateTime(snapshot.generated_at);
      updatedAt.dateTime = snapshot.generated_at;

      var empty = model.pageviews === 0 && model.visitors === 0;
      var stale = core.isStale(snapshot);
      panel.classList.toggle('is-stale', stale);
      panel.classList.remove('is-unavailable');
      status.textContent = statusOverride ||
        (empty ? 'Collecting new visits' : stale ? 'Data update delayed' : 'Analytics up to date');
      updateGlobe(model);
    }

    function setMetric(name, value) {
      var element = panel.querySelector('[data-metric="' + name + '"]');
      element.textContent = Number(value).toLocaleString();
    }

    function displayName(code) {
      try {
        if (window.Intl && Intl.DisplayNames) {
          return new Intl.DisplayNames([document.documentElement.lang || 'en'], {
            type: 'region'
          }).of(code);
        }
      } catch (_error) {}
      return centroids && centroids[code] ? centroids[code].name : code;
    }

    function renderCountries(countries) {
      countryList.textContent = '';
      countries.slice(0, 5).forEach(function (entry) {
        var item = document.createElement('li');
        item.appendChild(document.createTextNode(displayName(entry.code)));
        var count = document.createElement('span');
        count.textContent = entry.visitors.toLocaleString();
        item.appendChild(count);
        countryList.appendChild(item);
      });
      if (!countries.length) {
        var empty = document.createElement('li');
        empty.textContent = 'No countries recorded yet';
        countryList.appendChild(empty);
      }
    }

    function ensureGlobe() {
      if (globePromise) return globePromise;
      globePromise = Promise.all([
        loadScript(panel.dataset.globeScript),
        fetch(panel.dataset.centroidsUrl, { cache: 'force-cache' }).then(function (response) {
          if (!response.ok) throw new Error('centroids unavailable');
          return response.json();
        })
      ]).then(function (values) {
        centroids = values[1];
        createGlobe();
        if (snapshot) render();
      }).catch(function () {
        globeHost.hidden = true;
        globeFallback.hidden = false;
      });
      return globePromise;
    }

    function loadScript(src) {
      if (window.Globe) return Promise.resolve();
      return new Promise(function (resolve, reject) {
        var script = document.createElement('script');
        script.src = src;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      });
    }

    function createGlobe() {
      var probe = document.createElement('canvas');
      if (!window.WebGLRenderingContext ||
          !(probe.getContext('webgl') || probe.getContext('experimental-webgl'))) {
        throw new Error('WebGL unavailable');
      }
      var size = globeHost.clientWidth || 280;
      globe = new window.Globe(globeHost, { animateIn: true })
        .width(size)
        .height(size)
        .backgroundColor('rgba(0,0,0,0)')
        .globeImageUrl(panel.dataset.textureUrl)
        .showAtmosphere(true)
        .atmosphereColor('#67e8f9')
        .atmosphereAltitude(0.12)
        .pointLat('lat')
        .pointLng('lng')
        .pointColor(function () { return '#fb923c'; })
        .pointAltitude(0.015)
        .pointRadius(function (point) {
          return 0.24 + Math.min(Math.sqrt(point.visitors) * 0.12, 0.7);
        })
        .pointLabel(function (point) {
          return escapeHtml(point.name) + ' · ' + point.visitors + ' visitors';
        })
        .ringLat('lat')
        .ringLng('lng')
        .ringColor(function () {
          return function (t) { return 'rgba(251,146,60,' + (1 - t) + ')'; };
        })
        .ringMaxRadius(2.4)
        .ringPropagationSpeed(1.7)
        .ringRepeatPeriod(1500);

      var controls = globe.controls();
      controls.enableZoom = false;
      controls.autoRotate = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      controls.autoRotateSpeed = 0.55;
      globe.pointOfView({ lat: 24, lng: 105, altitude: 2.2 });

      if (window.ResizeObserver) {
        new ResizeObserver(function () {
          var next = globeHost.clientWidth;
          if (next) globe.width(next).height(next);
        }).observe(globeHost);
      }
    }

    function updateGlobe(model) {
      if (!globe || !centroids) return;
      var points = core.markers(model, centroids);
      globe.pointsData(points).ringsData(points);
    }

    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, function (character) {
        return {
          '&': '&amp;', '<': '&lt;', '>': '&gt;',
          '"': '&quot;', "'": '&#39;'
        }[character];
      });
    }

    function formatDate(value) {
      return new Date(value).toLocaleDateString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric'
      });
    }

    function formatDateTime(value) {
      return new Date(value).toLocaleString(undefined, {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
      });
    }

    periodButtons.forEach(function (button) {
      button.addEventListener('click', function () {
        activePeriod = button.dataset.period;
        periodButtons.forEach(function (candidate) {
          candidate.setAttribute('aria-selected', candidate === button ? 'true' : 'false');
        });
        render();
      });
    });
    closeButton.addEventListener('click', function () { setOpen(false); });
    document.addEventListener('keydown', core.createShortcutHandler(function () {
      setOpen(!panel.classList.contains('is-open'));
    }), true);
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && panel.classList.contains('is-open')) setOpen(false);
    });

    var query = new URLSearchParams(window.location.search);
    if (query.get(panel.dataset.queryKey) === panel.dataset.queryValue) setOpen(true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
~~~

- [ ] **Step 8: Run the complete local test suite**

~~~bash
ruby -Itest -e 'Dir["test/*_test.rb"].sort.each { |file| require File.expand_path(file) }'
/Users/jky/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test test/visitor_analytics_core_test.cjs
bundle exec /Users/jky/.gem/ruby/2.6.0/bin/jekyll build
~~~

Expected: all Ruby and Node tests pass; Jekyll succeeds.

- [ ] **Step 9: Commit the complete local experience**

~~~bash
git add assets/vendor assets/img/earth-night.jpg assets/data/country-centroids.json assets/js/visitor-analytics.js assets/js/visitor-analytics-core.js test/visitor_analytics_core_test.cjs
git commit -m "feat: render self-hosted visitor globe"
~~~

## Task 6: Add the GitHub Pages Deployment Workflow

**Files:**

- Modify: .gitignore
- Create: .github/workflows/pages.yml
- Create: test/pages_workflow_test.rb

- [ ] **Step 1: Write failing workflow assertions**

test/pages_workflow_test.rb must assert the workflow contains:

- push to main, workflow_dispatch, and cron 17 */6 * * *;
- contents read, pages write, and id-token write permissions;
- Ruby tests, Node tests, snapshot generation, Jekyll build, artifact upload,
  and deploy-pages;
- GOATCOUNTER_API_KEY only through secrets;
- no command that prints environment variables or snapshot raw CSV.

~~~ruby
require "minitest/autorun"

class PagesWorkflowTest < Minitest::Test
  WORKFLOW = File.expand_path("../.github/workflows/pages.yml", __dir__)

  def setup
    @workflow = File.exist?(WORKFLOW) ? File.read(WORKFLOW) : ""
  end

  def test_has_all_triggers_and_permissions
    assert_includes @workflow, "branches: [main]"
    assert_includes @workflow, "pull_request:"
    assert_includes @workflow, "workflow_dispatch:"
    assert_includes @workflow, "cron: '17 */6 * * *'"
    assert_includes @workflow, "contents: read"
    assert_includes @workflow, "pages: write"
    assert_includes @workflow, "id-token: write"
  end

  def test_runs_tests_snapshot_build_and_deploy
    assert_includes @workflow, 'Dir["test/*_test.rb"]'
    assert_includes @workflow, "visitor_analytics_core_test.cjs"
    assert_includes @workflow, "scripts/build_visitor_stats.rb"
    assert_includes @workflow, "bundle exec jekyll build"
    assert_includes @workflow, "actions/upload-pages-artifact@v3"
    assert_includes @workflow, "actions/deploy-pages@v4"
  end

  def test_secret_is_scoped_and_never_printed
    assert_equal 1, @workflow.scan("secrets.GOATCOUNTER_API_KEY").length
    refute_match(/\benv\b\s*(\||$)/, @workflow)
    refute_includes @workflow, "set -x"
    refute_includes @workflow, "cat /tmp"
  end
end
~~~

- [ ] **Step 2: Run the workflow test and verify RED**

Run:

~~~bash
ruby test/pages_workflow_test.rb
~~~

Expected: FAIL because .github/workflows/pages.yml does not exist.

- [ ] **Step 3: Ignore the artifact-only snapshot**

Append this exact path to .gitignore:

~~~gitignore
assets/data/visitor-stats.json
~~~

- [ ] **Step 4: Create pages.yml**

Use official checkout, setup-ruby, setup-node, configure-pages,
upload-pages-artifact, and deploy-pages actions. Pin current major versions.
The build job must run tests before contacting GoatCounter. Set:

~~~yaml
env:
  GOATCOUNTER_SITE_CODE: ky-ji
  VISITOR_ANALYTICS_START: "2026-07-10T00:00:00+09:00"
~~~

Pass the token only at the snapshot step:

~~~yaml
env:
  GOATCOUNTER_API_KEY: ${{ secrets.GOATCOUNTER_API_KEY }}
~~~

Generate assets/data/visitor-stats.json, build with JEKYLL_ENV=production, then
upload _site. The deploy job must use the github-pages environment and the
deployment URL from actions/deploy-pages.

~~~yaml
name: Deploy GitHub Pages

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  workflow_dispatch:
    inputs:
      deploy:
        description: Deploy after build validation
        required: true
        default: true
        type: boolean
  schedule:
    - cron: '17 */6 * * *'

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

env:
  GOATCOUNTER_SITE_CODE: ky-ji
  VISITOR_ANALYTICS_START: "2026-07-10T00:00:00+09:00"

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ruby/setup-ruby@v1
        with:
          ruby-version: '2.6'
          bundler-cache: true
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - name: Run Ruby tests
        run: >-
          ruby -Itest -e
          'Dir["test/*_test.rb"].sort.each {
          |file| require File.expand_path(file) }'
      - name: Run browser-model tests
        run: node --test test/visitor_analytics_core_test.cjs
      - name: Build visitor snapshot
        env:
          GOATCOUNTER_API_KEY: ${{ secrets.GOATCOUNTER_API_KEY }}
        run: >-
          ruby scripts/build_visitor_stats.rb
          --output assets/data/visitor-stats.json
          --fallback-url https://ky-ji.github.io/assets/data/visitor-stats.json
      - uses: actions/configure-pages@v5
      - name: Build Jekyll
        env:
          JEKYLL_ENV: production
        run: bundle exec jekyll build
      - uses: actions/upload-pages-artifact@v3
        with:
          path: _site

  deploy:
    if: >-
      github.event_name != 'pull_request' &&
      (github.event_name != 'workflow_dispatch' || inputs.deploy)
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - name: Deploy
        id: deployment
        uses: actions/deploy-pages@v4
~~~

- [ ] **Step 5: Validate workflow syntax and behavior locally**

Run:

~~~bash
ruby test/pages_workflow_test.rb
ruby -e 'require "yaml"; YAML.load_file(".github/workflows/pages.yml"); puts "YAML OK"'
git diff --check
~~~

Expected: workflow tests pass, YAML OK, and no whitespace errors.

- [ ] **Step 6: Commit the deployment workflow**

~~~bash
git add .gitignore .github/workflows/pages.yml test/pages_workflow_test.rb
git commit -m "ci: deploy visitor analytics with GitHub Pages"
~~~

## Task 7: Provision GoatCounter and Verify Real Data

**Files:**

- Possibly modify: _config.yml
- Possibly modify: .github/workflows/pages.yml

- [ ] **Step 1: Create the GoatCounter site**

The user creates a hosted GoatCounter site with code ky-ji. If unavailable, use
ky-ji-github and update both configuration files before continuing.

- [ ] **Step 2: Apply required settings**

Set timezone Asia/Seoul, keep Sessions enabled, enable Individual pageviews,
and restrict Dashboard viewable by to logged-in users.

- [ ] **Step 3: Create the least-privilege API token**

Grant Statistics and Export permissions only.

- [ ] **Step 4: Store the token without exposing it**

Run:

~~~bash
gh secret set GOATCOUNTER_API_KEY --repo ky-ji/ky-ji.github.io
~~~

Expected: gh prompts for the value without echoing it, then confirms the secret
was set. Do not put the token in command arguments, chat, files, or logs.

- [ ] **Step 5: Verify the account endpoint and one local export**

Use a temporary environment variable entered privately, run the snapshot CLI
to a temporary path, validate it with VisitorAnalytics.valid_snapshot?, then
delete the temporary file. Expected: schema version 1 with valid zero or real
aggregates and no raw rows.

~~~bash
read -s GOATCOUNTER_API_KEY
export GOATCOUNTER_API_KEY
export GOATCOUNTER_SITE_CODE=ky-ji
export VISITOR_ANALYTICS_START=2026-07-10T00:00:00+09:00
ruby scripts/build_visitor_stats.rb --output /tmp/visitor-stats.json --fallback-url https://ky-ji.github.io/assets/data/visitor-stats.json
ruby -rjson -r./lib/visitor_analytics -e 'value=JSON.parse(File.read(ARGV[0])); abort "invalid snapshot" unless VisitorAnalytics.valid_snapshot?(value)' /tmp/visitor-stats.json
rm -f /tmp/visitor-stats.json
unset GOATCOUNTER_API_KEY
~~~

Use GOATCOUNTER_SITE_CODE=ky-ji-github in the two commands and configuration
files if the preferred code was unavailable.

- [ ] **Step 6: Commit only if the site code changed**

~~~bash
git add _config.yml .github/workflows/pages.yml
git commit -m "chore: configure GoatCounter site"
~~~

Skip this commit when ky-ji was available and no file changed.

## Task 8: Verify, Switch Pages, Push, and Observe Production

**Files:** No planned source changes; corrective changes follow the same
test-first cycle and receive their own commit.

- [ ] **Step 1: Run every local verification command**

~~~bash
ruby -Itest -e 'Dir["test/*_test.rb"].sort.each { |file| require File.expand_path(file) }'
/Users/jky/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test test/visitor_analytics_core_test.cjs
bundle exec /Users/jky/.gem/ruby/2.6.0/bin/jekyll build
git diff --check
git status -sb
~~~

Expected: all tests pass, Jekyll succeeds, no whitespace errors, and only
intentional commits remain.

- [ ] **Step 2: Run browser acceptance checks with fixture data**

Serve _site locally, place the validated fixture at
_site/assets/data/visitor-stats.json, and verify:

- ?k=1 opens the panel;
- three K presses with roughly one second gaps open and close it;
- 7d, 30d, and all update all metrics and markers;
- the canvas is nonblank and rotates unless reduced motion is active;
- canvas pixel samples contain nontransparent pixels and differ after two
  seconds when reduced motion is off;
- the texture request succeeds and the canvas bounds remain inside the panel;
- Top 5, loading, empty, stale, unavailable, and no-WebGL states remain legible;
- 1440x900, 768x1024, and 390x844 screenshots contain no overlap;
- localhost sends no GoatCounter count request.

- [ ] **Step 3: Push the implementation branch and open a draft PR**

If origin/main advanced, fetch, inspect, and rebase without discarding
unrelated changes. Then run:

~~~bash
git push -u origin visitor-analytics
gh pr create --draft --base main --head visitor-analytics --title "Fix visitor analytics" --body "Implements the approved GoatCounter-backed visitor analytics design."
~~~

Expected: a draft PR URL and a same-repository pull-request workflow run.

- [ ] **Step 4: Verify the workflow build before changing Pages**

~~~bash
gh pr checks --watch
~~~

Confirm Ruby tests, Node tests, real export, snapshot validation, Jekyll build,
and Pages artifact upload succeed. The deploy job must be skipped for the PR.

- [ ] **Step 5: Switch Pages and merge the verified PR**

~~~bash
gh api --method PUT repos/ky-ji/ky-ji.github.io/pages -f build_type=workflow
gh pr ready
gh pr merge --merge --delete-branch
~~~

Watch the push-to-main run to completion. Expected: build and deploy jobs both
succeed and report https://ky-ji.github.io/.

- [ ] **Step 6: Verify production end to end**

Check:

- live HTML contains GoatCounter and local visitor analytics assets;
- live HTML contains neither FeedPulse nor ClustrMaps;
- /assets/data/visitor-stats.json passes schema validation;
- opening with ?k=1 and three K presses works on desktop and mobile;
- the globe canvas is nonblank and the selected period changes markers;
- the GoatCounter dashboard receives the first production visit;
- #toggle-goatcounter opts the owner's current browser out;
- a second scheduled workflow refresh preserves or advances totals without a
  repository commit.

- [ ] **Step 7: Record final evidence**

Report the implementation commit range, test counts, workflow run URL,
deployment URL, snapshot generated_at value, and any unavoidable undercounting
from browser ad blockers.
