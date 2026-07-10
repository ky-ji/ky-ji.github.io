'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const corePath = path.join(__dirname, '..', 'assets', 'js', 'visitor-analytics-core.js');
const centroidsPath = path.join(__dirname, '..', 'assets', 'data', 'country-centroids.json');
const core = require(corePath);
const snapshot = require('./fixtures/visitor-stats.json');

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

function changed(change) {
  const candidate = copy(snapshot);
  change(candidate);
  return candidate;
}

function assertInvalid(change, message) {
  assert.equal(core.validateSnapshot(changed(change)), false, message);
}

function accessorBacked(select, key) {
  const candidate = copy(snapshot);
  const target = select(candidate);
  const original = target[key];
  let reads = 0;

  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    get: function () {
      reads += 1;
      return original;
    }
  });

  return {
    candidate: candidate,
    reads: function () { return reads; }
  };
}

function shortcutHarness(initialTime) {
  let currentTime = initialTime;
  let toggleCount = 0;
  const handler = core.createShortcutHandler(function () {
    toggleCount += 1;
  }, function () {
    return currentTime;
  });

  return {
    handler: handler,
    setTime: function (value) {
      currentTime = value;
    },
    toggles: function () {
      return toggleCount;
    }
  };
}

test('exports the complete CommonJS API', function () {
  assert.deepEqual(Object.keys(core).sort(), [
    'createShortcutHandler',
    'isStale',
    'markers',
    'validateSnapshot',
    'viewModel'
  ]);
  Object.keys(core).forEach(function (name) {
    assert.equal(typeof core[name], 'function');
  });
});

test('exposes the complete API on window in browsers', function () {
  const context = { window: {} };
  const source = fs.readFileSync(corePath, 'utf8');

  assert.doesNotThrow(function () {
    vm.runInNewContext(source, context, { filename: corePath });
  });
  assert.deepEqual(Object.keys(context.window.VisitorAnalyticsCore).sort(),
    Object.keys(core).sort());
});

test('country centroids are compact, sorted, and valid', function () {
  const centroids = JSON.parse(fs.readFileSync(centroidsPath, 'utf8'));
  const codes = Object.keys(centroids);

  assert.ok(codes.length > 200);
  assert.deepEqual(codes, codes.slice().sort());
  codes.forEach(function (code) {
    const entry = centroids[code];
    assert.match(code, /^[A-Z]{2}$/);
    assert.deepEqual(Object.keys(entry), ['name', 'lat', 'lng']);
    assert.equal(typeof entry.name, 'string');
    assert.ok(entry.name.length > 0);
    assert.equal(typeof entry.lat, 'number');
    assert.equal(typeof entry.lng, 'number');
    assert.ok(Number.isFinite(entry.lat) && entry.lat >= -90 && entry.lat <= 90);
    assert.ok(Number.isFinite(entry.lng) && entry.lng >= -180 && entry.lng <= 180);
    assert.equal(Number(entry.lat.toFixed(4)), entry.lat);
    assert.equal(Number(entry.lng.toFixed(4)), entry.lng);
  });
  assert.deepEqual(centroids.KR, {
    name: 'South Korea', lat: 35.9017, lng: 127.736
  });
  assert.deepEqual(centroids.US, {
    name: 'United States', lat: 36.9664, lng: -95.8439
  });
});

test('validates the fixture and derives its 7d model', function () {
  assert.equal(core.validateSnapshot(snapshot), true);
  assert.deepEqual(core.viewModel(snapshot, '7d'), {
    pageviews: 3,
    visitors: 1,
    viewsPerVisitor: 3,
    countryCount: 1,
    countries: [{ code: 'KR', visitors: 1 }]
  });
});

test('rounds views per visitor to one decimal place', function () {
  const candidate = changed(function (value) {
    value.periods.all.pageviews = 10;
    value.periods.all.visitors = 3;
  });

  assert.equal(core.validateSnapshot(candidate), true);
  assert.equal(core.viewModel(candidate, 'all').viewsPerVisitor, 3.3);
});

test('rounds views per visitor without overflowing safe integers', function () {
  const maximum = 9007199254740991;
  const candidate = changed(function (value) {
    ['7d', '30d', 'all'].forEach(function (periodKey) {
      value.periods[periodKey] = {
        pageviews: maximum,
        visitors: 1,
        countries: [{ code: 'KR', visitors: 1 }]
      };
    });
  });

  assert.equal(core.validateSnapshot(candidate), true);
  assert.equal(core.viewModel(candidate, 'all').viewsPerVisitor, maximum);
});

test('uses a zero ratio when there are no visitors', function () {
  const candidate = changed(function (value) {
    value.periods['7d'] = { pageviews: 0, visitors: 0, countries: [] };
  });

  assert.equal(core.validateSnapshot(candidate), true);
  assert.equal(core.viewModel(candidate, '7d').viewsPerVisitor, 0);
});

test('returns a defensive copy of countries in supplied order', function () {
  const candidate = copy(snapshot);
  const model = core.viewModel(candidate, '30d');

  assert.notEqual(model.countries, candidate.periods['30d'].countries);
  assert.notEqual(model.countries[0], candidate.periods['30d'].countries[0]);
  assert.deepEqual(model.countries.map(function (entry) { return entry.code; }), ['KR', 'US']);

  model.countries[0].visitors = 99;
  model.countries.push({ code: 'ZZ', visitors: 1 });
  assert.deepEqual(candidate.periods['30d'].countries, [
    { code: 'KR', visitors: 1 },
    { code: 'US', visitors: 1 }
  ]);
});

test('viewModel rejects invalid snapshots and unknown periods with TypeError', function () {
  const invalid = changed(function (value) {
    value.site = 'example.com';
  });

  assert.throws(function () { core.viewModel(invalid, '7d'); }, TypeError);
  assert.throws(function () { core.viewModel(snapshot, '24h'); }, TypeError);
});

test('requires the exact own top-level snapshot keys', function () {
  assert.equal(core.validateSnapshot(null), false);
  assert.equal(core.validateSnapshot([]), false);
  assert.equal(core.validateSnapshot({ schema_version: 1 }), false);

  const inheritedSite = changed(function (value) {
    delete value.site;
  });
  Object.setPrototypeOf(inheritedSite, { site: 'ky-ji.github.io' });
  assert.equal(core.validateSnapshot(inheritedSite), false);
});

test('rejects a top-level accessor without invoking its getter', function () {
  const wrapped = accessorBacked(function (value) { return value; }, 'periods');

  assert.throws(function () { core.viewModel(wrapped.candidate, '7d'); }, TypeError);
  assert.equal(wrapped.reads(), 0);
});

test('rejects nested object accessors without invoking their getters', function () {
  const cases = [
    [function (value) { return value.periods; }, '7d'],
    [function (value) { return value.periods['7d']; }, 'pageviews']
  ];

  cases.forEach(function (entry) {
    const wrapped = accessorBacked(entry[0], entry[1]);
    assert.equal(core.validateSnapshot(wrapped.candidate), false, entry[1]);
    assert.equal(wrapped.reads(), 0, entry[1] + ' getter reads');
  });
});

test('rejects country accessors without invoking their getters', function () {
  const wrapped = accessorBacked(function (value) {
    return value.periods['7d'].countries[0];
  }, 'visitors');

  assert.equal(core.validateSnapshot(wrapped.candidate), false);
  assert.equal(wrapped.reads(), 0);
});

test('rejects accessor-backed array indices without invoking their getters', function () {
  const wrapped = accessorBacked(function (value) {
    return value.periods['7d'].countries;
  }, '0');

  assert.equal(core.validateSnapshot(wrapped.candidate), false);
  assert.equal(wrapped.reads(), 0);
});

test('requires expected properties to be enumerable at every schema level', function () {
  const cases = [
    [function (value) { return value; }, 'site'],
    [function (value) { return value.periods; }, '7d'],
    [function (value) { return value.periods['7d']; }, 'pageviews'],
    [function (value) { return value.periods['7d'].countries[0]; }, 'code'],
    [function (value) { return value.periods['7d'].countries; }, '0']
  ];

  cases.forEach(function (entry) {
    assertInvalid(function (value) {
      const target = entry[0](value);
      const descriptor = Object.getOwnPropertyDescriptor(target, entry[1]);
      descriptor.enumerable = false;
      Object.defineProperty(target, entry[1], descriptor);
    }, entry[1]);
  });
});

test('rejects extra non-enumerable properties at every structured level', function () {
  const selectors = [
    function (value) { return value; },
    function (value) { return value.periods; },
    function (value) { return value.periods['7d']; },
    function (value) { return value.periods['7d'].countries[0]; },
    function (value) { return value.periods['7d'].countries; }
  ];

  selectors.forEach(function (select, index) {
    assertInvalid(function (value) {
      Object.defineProperty(select(value), 'private_data', {
        configurable: true,
        enumerable: false,
        value: index
      });
    }, 'level ' + index);
  });
});

test('rejects symbol properties at every structured level', function () {
  const selectors = [
    function (value) { return value; },
    function (value) { return value.periods; },
    function (value) { return value.periods['7d']; },
    function (value) { return value.periods['7d'].countries[0]; },
    function (value) { return value.periods['7d'].countries; }
  ];

  selectors.forEach(function (select, index) {
    assertInvalid(function (value) {
      select(value)[Symbol('private-' + index)] = true;
    }, 'level ' + index);
  });
});

test('rejects non-plain record prototypes at every object level', function () {
  const selectors = [
    function (value) { return value; },
    function (value) { return value.periods; },
    function (value) { return value.periods['7d']; },
    function (value) { return value.periods['7d'].countries[0]; }
  ];

  selectors.forEach(function (select, index) {
    assertInvalid(function (value) {
      Object.setPrototypeOf(select(value), { private_data: index });
    }, 'level ' + index);
  });
});

test('requires countries to be dense ordinary arrays with only own indices', function () {
  assertInvalid(function (value) {
    value.periods['7d'].countries.private_data = true;
  }, 'extra named property');
  assertInvalid(function (value) {
    Object.setPrototypeOf(
      value.periods['7d'].countries,
      Object.create(Array.prototype)
    );
  }, 'custom array prototype');
  assertInvalid(function (value) {
    const countries = value.periods['7d'].countries;
    const inheritedEntry = countries[0];
    const prototype = Object.create(Array.prototype);
    delete countries[0];
    Object.defineProperty(prototype, '0', {
      configurable: true,
      enumerable: true,
      value: inheritedEntry
    });
    Object.setPrototypeOf(countries, prototype);
  }, 'inherited array index');
  assertInvalid(function (value) {
    delete value.periods['7d'].countries[0];
  }, 'sparse array');
});

test('rejects extra public-data keys at every nesting level', function () {
  assertInvalid(function (value) {
    value.raw_hits = [];
  }, 'top-level raw data');
  assertInvalid(function (value) {
    value.periods.sessions = [];
  }, 'period collection sessions');
  assertInvalid(function (value) {
    value.periods.all.private = true;
  }, 'period private field');
  assertInvalid(function (value) {
    value.periods.all.countries[0].raw = {};
  }, 'country raw field');
});

test('rejects the wrong schema, site, or timezone identity', function () {
  assertInvalid(function (value) { value.schema_version = 2; }, 'schema version');
  assertInvalid(function (value) { value.site = 'www.ky-ji.github.io'; }, 'site');
  assertInvalid(function (value) { value.timezone = 'UTC'; }, 'timezone');
});

test('requires finite ISO-8601 timestamps with a time and offset in chronological order', function () {
  const cases = [
    ['data_since', null],
    ['data_since', '2026-07-01'],
    ['generated_at', '2026-07-10T03:00:00'],
    ['generated_at', 'not-a-date'],
    ['generated_at', '2026-02-30T03:00:00Z'],
    ['generated_at', '2026-07-10T03:00:00+99:00']
  ];

  cases.forEach(function (entry) {
    assertInvalid(function (value) {
      value[entry[0]] = entry[1];
    }, String(entry[1]));
  });
  assertInvalid(function (value) {
    value.data_since = '2026-07-11T00:00:00Z';
  }, 'data_since after generated_at');
});

test('requires exactly the 7d, 30d, and all periods', function () {
  assertInvalid(function (value) { value.periods = null; }, 'periods object');
  assertInvalid(function (value) { delete value.periods['30d']; }, 'missing 30d');
  assertInvalid(function (value) {
    value.periods['24h'] = copy(value.periods['7d']);
  }, 'extra period');
  assertInvalid(function (value) { delete value.periods.all.countries; }, 'period keys');
});

test('requires nonnegative safe integer counts and visitors no greater than pageviews', function () {
  const invalidCounts = [-1, 1.5, '4', NaN, Infinity, 9007199254740992];

  invalidCounts.forEach(function (count) {
    assertInvalid(function (value) {
      value.periods.all.pageviews = count;
    }, 'pageviews ' + String(count));
  });
  assertInvalid(function (value) {
    value.periods.all.visitors = 5;
  }, 'visitors above pageviews');

  const maximum = changed(function (value) {
    value.periods.all.pageviews = 9007199254740991;
  });
  assert.equal(core.validateSnapshot(maximum), true);
});

test('requires each period countries value to be an array', function () {
  assertInvalid(function (value) {
    value.periods.all.countries = { KR: 1 };
  });
});

test('requires exact country keys, uppercase codes, and positive safe visitor counts', function () {
  assertInvalid(function (value) {
    delete value.periods.all.countries[0].visitors;
  }, 'missing country count');
  assertInvalid(function (value) {
    value.periods['7d'].countries[0].code = 'kr';
  }, 'lowercase code');
  assertInvalid(function (value) {
    value.periods['7d'].countries[0].code = 'KOR';
  }, 'three-letter code');

  [0, -1, 1.5, 9007199254740992].forEach(function (count) {
    assertInvalid(function (value) {
      value.periods['7d'].countries[0].visitors = count;
    }, 'country visitors ' + String(count));
  });
});

test('rejects duplicate country codes', function () {
  assertInvalid(function (value) {
    value.periods.all.countries = [
      { code: 'KR', visitors: 1 },
      { code: 'KR', visitors: 1 }
    ];
  });
});

test('requires countries sorted by descending visitors then ascending ASCII code', function () {
  assertInvalid(function (value) {
    value.periods.all.visitors = 3;
    value.periods.all.countries = [
      { code: 'KR', visitors: 1 },
      { code: 'US', visitors: 2 }
    ];
  }, 'descending count');
  assertInvalid(function (value) {
    value.periods.all.countries.reverse();
  }, 'ASCII tie order');
});

test('rejects country visitor totals above the period visitor count', function () {
  assertInvalid(function (value) {
    value.periods.all.countries = [
      { code: 'JP', visitors: 1 },
      { code: 'KR', visitors: 1 },
      { code: 'US', visitors: 1 }
    ];
  });
});

test('requires pageviews and visitors to be nondecreasing across periods', function () {
  assertInvalid(function (value) {
    value.periods['7d'].pageviews = 5;
  }, 'decreasing pageviews');
  assertInvalid(function (value) {
    value.periods['7d'].visitors = 3;
  }, 'decreasing visitors');
});

test('uses an inclusive eighteen-hour freshness boundary', function () {
  const generatedAt = Date.parse(snapshot.generated_at);
  const threshold = 18 * 60 * 60 * 1000;

  assert.equal(core.isStale(snapshot, generatedAt + threshold - 1), false);
  assert.equal(core.isStale(snapshot, generatedAt + threshold), false);
  assert.equal(core.isStale(snapshot, generatedAt + threshold + 1), true);
});

test('treats invalid snapshots and unsafe explicit stale arguments as stale', function () {
  const invalid = changed(function (value) { value.site = 'example.com'; });
  const generatedAt = Date.parse(snapshot.generated_at);

  assert.equal(core.isStale(invalid, generatedAt), true);
  assert.equal(core.isStale(snapshot, NaN), true);
  assert.equal(core.isStale(snapshot, generatedAt, Infinity), true);
  assert.equal(core.isStale(snapshot, generatedAt, -1), true);
  assert.equal(core.isStale(snapshot, 0), false, 'explicit zero now is honored');
  assert.equal(core.isStale(snapshot, generatedAt, 0), false);
  assert.equal(core.isStale(snapshot, generatedAt + 1, 0), true);
});

test('maps known positive countries with finite numeric centroids', function () {
  const model = {
    countries: [
      { code: 'KR', visitors: 3 },
      { code: 'ZZ', visitors: 9 },
      { code: 'JP', visitors: 0 },
      { code: 'DE', visitors: 2 },
      { code: 'FR', visitors: 2 },
      { code: 'US', visitors: 1 }
    ]
  };
  const points = core.markers(model, {
    KR: { name: 'South Korea', lat: 36.5, lng: 127.8 },
    JP: { name: 'Japan', lat: 36.2, lng: 138.3 },
    DE: { name: 'Germany', lat: Infinity, lng: 10.4 },
    FR: { name: 'France', lat: '46.2', lng: 2.2 },
    US: { name: 'United States', lat: 39.8, lng: -98.6 }
  });

  assert.deepEqual(points, [
    { code: 'KR', name: 'South Korea', lat: 36.5, lng: 127.8, visitors: 3 },
    { code: 'US', name: 'United States', lat: 39.8, lng: -98.6, visitors: 1 }
  ]);
});

test('markers omit coordinates outside geographic ranges', function () {
  const points = core.markers({
    countries: [
      { code: 'CA', visitors: 3 },
      { code: 'MX', visitors: 2 },
      { code: 'KR', visitors: 1 }
    ]
  }, {
    CA: { name: 'Canada', lat: 90.0001, lng: -106.3 },
    MX: { name: 'Mexico', lat: 23.6, lng: -180.0001 },
    KR: { name: 'South Korea', lat: 35.9, lng: 127.7 }
  });

  assert.deepEqual(points.map(function (point) { return point.code; }), ['KR']);
});

test('markers omit unusable countries and sort by visitors', function () {
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

  assert.deepEqual(points.map(function (point) { return point.code; }), ['KR', 'US']);
});

test('requires own centroid entries and falls back from a missing name to the code', function () {
  const centroids = Object.create({
    KR: { name: 'Inherited Korea', lat: 36.5, lng: 127.8 }
  });
  centroids.US = { name: '', lat: 39.8, lng: -98.6 };

  assert.deepEqual(core.markers({
    countries: [
      { code: 'KR', visitors: 2 },
      { code: 'US', visitors: 1 }
    ]
  }, centroids), [
    { code: 'US', name: 'US', lat: 39.8, lng: -98.6, visitors: 1 }
  ]);
  assert.deepEqual(core.markers(null, centroids), []);
});

test('toggles for a human-paced key, keyCode, and code sequence', function () {
  const shortcut = shortcutHarness(0);

  assert.equal(shortcut.handler({ key: 'k', target: {} }), false);
  shortcut.setTime(1200);
  assert.equal(shortcut.handler({ keyCode: 75, target: {} }), false);
  shortcut.setTime(2400);
  assert.equal(shortcut.handler({ code: 'KeyK', target: {} }), true);
  assert.equal(shortcut.toggles(), 1);
});

test('recognizes which and uppercase key routes', function () {
  const shortcut = shortcutHarness(0);

  shortcut.handler({ which: 75, target: {} });
  shortcut.setTime(1000);
  shortcut.handler({ key: 'K', target: {} });
  shortcut.setTime(2000);
  assert.equal(shortcut.handler({ which: 75, target: {} }), true);
  assert.equal(shortcut.toggles(), 1);
});

test('does not use a per-gap shortcut window', function () {
  const shortcut = shortcutHarness(0);

  shortcut.handler({ key: 'k', target: {} });
  shortcut.setTime(3500);
  shortcut.handler({ key: 'k', target: {} });
  shortcut.setTime(7000);
  assert.equal(shortcut.handler({ key: 'k', target: {} }), false);
  assert.equal(shortcut.toggles(), 0);
});

test('toggles at exactly four seconds and resets after toggling', function () {
  const shortcut = shortcutHarness(0);

  shortcut.handler({ key: 'k', target: {} });
  shortcut.setTime(2000);
  shortcut.handler({ key: 'k', target: {} });
  shortcut.setTime(4000);
  assert.equal(shortcut.handler({ key: 'k', target: {} }), true);
  assert.equal(shortcut.toggles(), 1);

  assert.equal(shortcut.handler({ key: 'k', target: {} }), false);
  assert.equal(shortcut.toggles(), 1);
});

test('ignores form controls and contenteditable targets', function () {
  const targets = [
    { tagName: 'INPUT' },
    { tagName: 'textarea' },
    { tagName: 'SELECT' },
    { isContentEditable: true },
    { contentEditable: 'true' },
    { contentEditable: 'plaintext-only' }
  ];

  targets.forEach(function (target) {
    const shortcut = shortcutHarness(0);
    shortcut.handler({ key: 'k', target: target });
    shortcut.handler({ key: 'k', target: target });
    shortcut.handler({ key: 'k', target: target });
    assert.equal(shortcut.toggles(), 0);
  });
});

test('ignores repeat, Ctrl, Meta, Alt, and non-K events while allowing Shift+K', function () {
  const shortcut = shortcutHarness(0);
  const ignored = [
    { key: 'x' },
    { key: 'k', repeat: true },
    { key: 'k', ctrlKey: true },
    { key: 'k', metaKey: true },
    { key: 'k', altKey: true }
  ];

  ignored.forEach(function (event) {
    event.target = {};
    assert.equal(shortcut.handler(event), false);
  });
  assert.equal(shortcut.toggles(), 0);

  assert.equal(shortcut.handler({ key: 'K', shiftKey: true, target: {} }), false);
  shortcut.setTime(1000);
  assert.equal(shortcut.handler({ key: 'K', shiftKey: true, target: {} }), false);
  shortcut.setTime(2000);
  assert.equal(shortcut.handler({ key: 'K', shiftKey: true, target: {} }), true);
  assert.equal(shortcut.toggles(), 1);
});

test('resets the shortcut sequence when the clock moves backwards', function () {
  const shortcut = shortcutHarness(1000);

  shortcut.handler({ key: 'k', target: {} });
  shortcut.setTime(2000);
  shortcut.handler({ key: 'k', target: {} });
  shortcut.setTime(1500);
  assert.equal(shortcut.handler({ key: 'k', target: {} }), false);
  assert.equal(shortcut.toggles(), 0);

  shortcut.setTime(2500);
  shortcut.handler({ key: 'k', target: {} });
  shortcut.setTime(3500);
  assert.equal(shortcut.handler({ key: 'k', target: {} }), true);
  assert.equal(shortcut.toggles(), 1);
});
