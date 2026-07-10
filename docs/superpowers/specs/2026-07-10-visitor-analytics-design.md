# Visitor Analytics Design

Status: approved in conversation on 2026-07-10

## Objective

Replace the failed single-purpose visitor widget with a durable analytics
system that provides:

- a hidden, country-level visitor globe and concise traffic summary on the
  homepage;
- a private, full analytics dashboard for the site owner;
- page loads, anonymous visitor sessions, referrers, pages, devices, and
  country/region statistics;
- a clean data start when the new tracker is enabled, without attempting to
  reconstruct the unavailable ClustrMaps history;
- exportable data and a presentation layer that can survive a future analytics
  provider change.

## Decisions

- GoatCounter is the only analytics source.
- Tracking starts from the first successful production deployment after
  rollout.
- Location precision is country/region only.
- The public site receives aggregate data only.
- The hidden panel keeps the existing three-`K` shortcut and `?k=1` URL entry.
- GitHub Pages moves from branch-based Jekyll builds to a GitHub Actions Pages
  deployment after the new workflow has been verified.
- The globe renderer, textures, country centroids, and UI code are hosted in
  this repository. No remote map widget is embedded.

## Non-Goals

- Recovering ClustrMaps or FeedPulse history.
- City-level or precise visitor locations.
- Publishing raw pageview rows, session identifiers, IP addresses, or user
  agents.
- Building a second full analytics dashboard inside the homepage.
- Real-time updates; a six-hour refresh target is sufficient.

## Metric Definitions

- `pageviews`: every non-bot page load retained by GoatCounter's individual
  pageview export.
- `visitors`: distinct anonymous GoatCounter session IDs in the selected
  period. GoatCounter sessions last eight hours; the UI uses "Visitors" as a
  compact label and explains this definition in a tooltip.
- `views_per_visitor`: `pageviews / visitors`, displayed as `0` when there are
  no visitors.
- `countries`: the number of ISO 3166-1 alpha-2 countries with at least one
  visitor in the selected period.
- Country map values count distinct anonymous sessions per country, not page
  loads.

The three selectable periods are rolling 7 days, rolling 30 days, and all time
since production tracking began. Period boundaries use the `Asia/Seoul`
timezone, which must also be selected in GoatCounter settings.

## Architecture

### Collection and Owner Dashboard

The shared Jekyll layout loads GoatCounter's standard asynchronous tracking
script only on `ky-ji.github.io`. Localhost and preview builds do not send
events. GoatCounter remains responsible for bot filtering, session handling,
location lookup, and the authenticated owner dashboard.

The GoatCounter site must use these settings:

- timezone: `Asia/Seoul`;
- sessions: enabled;
- individual pageviews: enabled;
- dashboard visibility: logged-in users only.

The public site code is stored in `_config.yml`. The API token is stored only in
the repository secret `GOATCOUNTER_API_KEY` and requires Statistics and Export
permissions.

### Snapshot Generation

A GitHub Actions Pages workflow runs on pushes to `main`, manual dispatch, and
the schedule `17 */6 * * *`. Before building Jekyll it:

1. Requests a GoatCounter CSV export and polls its status until complete, with
   a bounded timeout.
2. Parses the CSV using a repository script and computes the 7-day, 30-day,
   and all-time aggregates.
3. Discards bots and event rows, deduplicates visitor sessions, and groups
   sessions by country.
4. Writes the normalized snapshot into the Pages build artifact at
   `/assets/data/visitor-stats.json`.
5. Deletes the temporary raw export before the job ends and never prints raw
   rows or the API token to logs.

The snapshot is part of the deployment artifact only. It is not committed to
`main`, so scheduled refreshes do not create repository commits.

### Snapshot Contract

```json
{
  "schema_version": 1,
  "site": "ky-ji.github.io",
  "timezone": "Asia/Seoul",
  "data_since": "2026-07-10T00:00:00+09:00",
  "generated_at": "2026-07-10T12:00:00Z",
  "periods": {
    "7d": {
      "pageviews": 0,
      "visitors": 0,
      "countries": []
    },
    "30d": {
      "pageviews": 0,
      "visitors": 0,
      "countries": []
    },
    "all": {
      "pageviews": 0,
      "visitors": 0,
      "countries": []
    }
  }
}
```

The example timestamps and zero values illustrate the schema only. At rollout,
`data_since` is fixed in site configuration to the first successful production
deployment time, not to this document date or the time of each refresh. Country
entries with zero visitors are omitted in generated snapshots.

### Pages Deployment and Fallback

The workflow first tries to produce a fresh snapshot. If GoatCounter or its
export API is unavailable, it downloads the currently deployed same-origin
snapshot and validates it against schema version 1. A valid previous snapshot
is reused so unrelated site changes can still deploy. If neither source is
valid, the workflow stops before deployment, leaving the existing production
site untouched.

The repository's current branch-based Pages configuration is changed to
GitHub Actions only after the workflow's build and snapshot validation succeed.

## Hidden Panel

The hidden panel retains both entry methods:

- press `K` three times within four seconds;
- open the homepage with `?k=1`.

The panel contains:

- a `7 days / 30 days / All time` segmented control;
- Visitors, Page Views, Views per Visitor, and Countries metrics;
- a lazily loaded rotating globe with markers at country centroids, sized by
  visitor count;
- country and visitor count tooltips;
- a Top 5 Countries list beside the globe on desktop and below it on mobile;
- the tracking start and last synchronization timestamps;
- a link to the private GoatCounter dashboard.

The globe library and media are loaded only when the panel is first opened.
The layout uses fixed responsive dimensions so loading, period changes, and
tooltips do not shift or overlap the surrounding page. If WebGL is unavailable,
the metrics and Top 5 Countries list remain usable and the globe area displays
a restrained unavailable state.

The owner can opt the current browser out of tracking once with
`#toggle-goatcounter`, using GoatCounter's built-in browser exclusion.

## Client Failure States

- While loading: show stable skeleton placeholders without changing panel
  dimensions.
- Valid empty snapshot: show zero metrics and "Collecting new visits"; never
  seed demo pins.
- Snapshot older than 18 hours: show "Data update delayed" while retaining the
  last valid values.
- Fetch or parse failure: use the last valid snapshot stored in local storage.
- Failure with no cache: show "Statistics temporarily unavailable" and keep the
  full-dashboard link available.

FeedPulse and ClustrMaps scripts, attribution, styles, and tests are removed.

## Privacy and Security

- No API token is emitted into HTML, JavaScript, build artifacts, logs, or the
  aggregate snapshot.
- The public snapshot contains only period totals and country-level counts.
- Raw CSV data exists only on the ephemeral Actions runner.
- The UI never exposes session IDs or any row-level record.
- No fake traffic is rendered under any error condition.

## Testing

Automated tests cover:

- CSV parsing, bot/event exclusion, session deduplication, period boundaries,
  country aggregation, empty exports, and malformed rows;
- snapshot schema validation and stale-data detection;
- period selection, derived metric calculations, and shortcut state;
- removal of FeedPulse and ClustrMaps references;
- successful Jekyll production builds.

Browser acceptance checks cover:

- opening and closing through three `K` presses and `?k=1`;
- nonblank globe rendering with fixture data;
- empty, stale, fallback, and WebGL-unavailable states;
- desktop and mobile layouts without overlap;
- the owner-dashboard link and owner opt-out flow.

After deployment, production verification confirms the GoatCounter request,
the first dashboard event, the same-origin snapshot schema, all three periods,
and live desktop/mobile rendering.

## Rollout

1. Create the GoatCounter site, preferring site code `ky-ji`; use
   `ky-ji-github` if that code is unavailable.
2. Apply the required timezone, session, individual-pageview, and dashboard
   visibility settings.
3. Generate a Statistics-and-Export API token and place it directly into the
   GitHub repository secret `GOATCOUNTER_API_KEY`; it is never pasted into the
   source tree.
4. Implement and test the tracker, exporter, snapshot validator, panel, and
   Pages workflow with fixtures.
5. Validate a fresh GoatCounter export and a complete Pages artifact.
6. Switch GitHub Pages to Actions deployment and run the workflow manually.
7. Verify the live site and first production event; the six-hour schedule then
   remains the normal refresh path.
