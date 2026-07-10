'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const controller = require(path.join(
  __dirname, '..', 'assets', 'js', 'visitor-analytics.js'
));
const core = require(path.join(
  __dirname, '..', 'assets', 'js', 'visitor-analytics-core.js'
));
const fixture = require('./fixtures/visitor-stats.json');

const CACHE_KEY = 'visitor-analytics-v1';

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

class FakeClassList {
  constructor(initial) {
    this.values = new Set(initial || []);
  }

  add() {
    Array.prototype.forEach.call(arguments, value => this.values.add(value));
  }

  remove() {
    Array.prototype.forEach.call(arguments, value => this.values.delete(value));
  }

  contains(value) {
    return this.values.has(value);
  }

  toggle(value, force) {
    const enabled = typeof force === 'boolean' ? force : !this.contains(value);
    if (enabled) this.add(value);
    else this.remove(value);
    return enabled;
  }
}

class FakeElement {
  constructor(document, options) {
    const settings = options || {};
    this.ownerDocument = document;
    this.dataset = settings.dataset || {};
    this.classList = new FakeClassList(settings.classes);
    this.attributes = {};
    this.listeners = {};
    this.children = [];
    this.hidden = Boolean(settings.hidden);
    this.clientWidth = settings.clientWidth || 280;
    this.selectorMap = {};
    this.selectorAllMap = {};
    this._textContent = '';
  }

  set textContent(value) {
    this._textContent = String(value);
    this.children = [];
  }

  get textContent() {
    if (this.children.length) {
      return this.children.map(child => child.textContent || '').join('');
    }
    return this._textContent;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name) ?
      this.attributes[name] : null;
  }

  addEventListener(type, listener, options) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push({ listener: listener, options: options });
  }

  dispatch(type, event) {
    (this.listeners[type] || []).forEach(entry => entry.listener(event || {
      target: this
    }));
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  querySelector(selector) {
    return this.selectorMap[selector] || null;
  }

  querySelectorAll(selector) {
    return this.selectorAllMap[selector] || [];
  }

  focus() {
    if (this.ownerDocument) this.ownerDocument.activeElement = this;
  }
}

class FakeDocument {
  constructor() {
    this.listeners = {};
    this.activeElement = null;
    this.documentElement = { lang: 'en' };
    this.readyState = 'complete';
    this.head = new FakeElement(this);
    this.panel = null;
  }

  getElementById(id) {
    return id === 'statsPanel' ? this.panel : null;
  }

  createElement() {
    return new FakeElement(this);
  }

  createTextNode(value) {
    return { nodeType: 3, textContent: String(value) };
  }

  addEventListener(type, listener, options) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push({ listener: listener, options: options });
  }

  dispatch(type, event) {
    (this.listeners[type] || []).forEach(entry => entry.listener(event));
  }
}

function response(value, ok) {
  return {
    ok: ok !== false,
    status: ok === false ? 500 : 200,
    json: function () { return Promise.resolve(copy(value)); }
  };
}

function storageHarness(initial) {
  const values = Object.assign({}, initial);
  const writes = [];

  return {
    writes: writes,
    getItem: function (key) {
      return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null;
    },
    setItem: function (key, value) {
      values[key] = value;
      writes.push({ key: key, value: value });
    }
  };
}

function globeHarness(settings) {
  const options = settings || {};
  const calls = {
    factory: [], points: [], rings: [], labels: [], pointAttempts: 0, pauses: 0
  };
  const globe = {};
  const chainMethods = [
    'width', 'height', 'backgroundColor', 'globeImageUrl', 'showAtmosphere',
    'atmosphereColor', 'atmosphereAltitude', 'pointLat', 'pointLng',
    'pointColor', 'pointAltitude', 'pointRadius', 'ringLat', 'ringLng',
    'ringColor', 'ringMaxRadius', 'ringPropagationSpeed', 'ringRepeatPeriod',
    'pointOfView'
  ];

  chainMethods.forEach(function (name) {
    globe[name] = function () { return globe; };
  });
  globe.pointLabel = function (formatter) {
    calls.labels.push(formatter);
    return globe;
  };
  globe.pointsData = function (points) {
    calls.pointAttempts += 1;
    if (calls.pointAttempts > (options.failPointsAfter || Infinity)) {
      throw new Error('late points failure');
    }
    calls.points.push(points);
    return globe;
  };
  globe.ringsData = function (points) {
    calls.rings.push(points);
    return globe;
  };
  globe.controls = function () {
    calls.controls = {};
    return calls.controls;
  };
  globe.pauseAnimation = function () {
    calls.pauses += 1;
    return globe;
  };

  return {
    calls: calls,
    factory: function (host, options) {
      calls.factory.push({ host: host, options: options });
      return globe;
    }
  };
}

function makeHarness(settings) {
  const options = settings || {};
  const document = new FakeDocument();
  const panel = new FakeElement(document, {
    classes: ['visitor-analytics'],
    dataset: {
      statsUrl: '/assets/data/visitor-stats.json',
      globeScript: '/assets/vendor/globe.gl.min.js',
      centroidsUrl: '/assets/data/country-centroids.json',
      textureUrl: '/assets/img/earth-night.jpg',
      trackingStart: '2026-07-01T00:00:00+09:00',
      queryKey: 'k',
      queryValue: '1'
    }
  });
  const close = new FakeElement(document);
  const status = new FakeElement(document);
  const list = new FakeElement(document);
  const trackingStart = new FakeElement(document);
  const updatedAt = new FakeElement(document);
  const globeHost = new FakeElement(document, { clientWidth: 280 });
  const globeFallback = new FakeElement(document, { hidden: true });
  const metrics = {};
  const periods = ['7d', '30d', 'all'].map(function (period, index) {
    const button = new FakeElement(document, { dataset: { period: period } });
    button.setAttribute('aria-pressed', index === 0 ? 'true' : 'false');
    return button;
  });
  const centroids = options.centroids || {
    KR: { name: options.countryName || 'South Korea', lat: 36.5, lng: 127.8 },
    US: { name: 'United States', lat: 38.0, lng: -97.0 }
  };
  const fetchCalls = [];
  const scriptCalls = [];
  const textureCalls = [];
  const globe = options.globe || globeHarness();
  const storage = options.storage === undefined ? storageHarness() : options.storage;
  const snapshots = options.snapshots ? options.snapshots.slice() : [copy(fixture)];

  ['visitors', 'pageviews', 'viewsPerVisitor', 'countryCount'].forEach(function (name) {
    metrics[name] = new FakeElement(document);
    panel.selectorMap['[data-metric="' + name + '"]'] = metrics[name];
  });
  panel.selectorMap['.visitor-analytics__close'] = close;
  panel.selectorMap['[data-status]'] = status;
  panel.selectorMap['[data-country-list]'] = list;
  panel.selectorMap['[data-tracking-start]'] = trackingStart;
  panel.selectorMap['[data-updated-at]'] = updatedAt;
  panel.selectorMap['[data-globe]'] = globeHost;
  panel.selectorMap['[data-globe-fallback]'] = globeFallback;
  panel.selectorAllMap['[data-period]'] = periods;
  panel.setAttribute('aria-hidden', 'true');
  document.panel = panel;

  const window = {
    document: document,
    location: { search: options.search || '' },
    matchMedia: options.matchMedia || function () { return { matches: false }; }
  };
  if (!options.noIntl) {
    window.Intl = {
      DisplayNames: function () {
        this.of = function (code) {
          if (Object.prototype.hasOwnProperty.call(options, 'displayNameResult')) {
            return options.displayNameResult;
          }
          return code === 'KR' ? 'South Korea' : code === 'US' ? 'United States' : code;
        };
      }
    };
  }

  function fakeFetch(url, fetchOptions) {
    fetchCalls.push({ url: url, options: fetchOptions });
    if (url === panel.dataset.centroidsUrl) return Promise.resolve(response(centroids));
    const next = snapshots.shift();
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve(response(next));
  }

  const controllerOptions = {
    window: window,
    document: document,
    core: core,
    fetch: options.fetch || fakeFetch,
    storage: storage,
    now: options.now || function () { return Date.parse(fixture.generated_at); },
    loadScript: function (url) {
      scriptCalls.push(url);
      return options.scriptError ? Promise.reject(options.scriptError) : Promise.resolve();
    },
    loadTexture: function (url) {
      textureCalls.push(url);
      return options.textureError ? Promise.reject(options.textureError) : Promise.resolve();
    },
    globeFactory: options.globeFactory || globe.factory
  };

  return {
    controllerOptions: controllerOptions,
    document: document,
    panel: panel,
    close: close,
    status: status,
    list: list,
    trackingStart: trackingStart,
    updatedAt: updatedAt,
    globeHost: globeHost,
    globeFallback: globeFallback,
    metrics: metrics,
    periods: periods,
    storage: storage,
    fetchCalls: fetchCalls,
    scriptCalls: scriptCalls,
    textureCalls: textureCalls,
    globe: globe
  };
}

function hasState(panel, name) {
  return panel.classList.contains('is-' + name);
}

test('exports a testable controller boundary and safely no-ops without panel or core', function () {
  assert.equal(typeof controller.createController, 'function');
  assert.equal(typeof controller.init, 'function');
  assert.equal(controller.init({ document: new FakeDocument(), core: core }), null);

  const harness = makeHarness();
  assert.equal(controller.init({ document: harness.document }), null);
});

test('query k=1 opens the panel', function () {
  const harness = makeHarness({ search: '?k=1' });
  const instance = controller.init(harness.controllerOptions);

  assert.equal(instance.isOpen(), true);
  assert.equal(harness.panel.getAttribute('aria-hidden'), 'false');
});

test('shortcut listener captures and opening focuses the close button', function () {
  const harness = makeHarness();
  const instance = controller.init(harness.controllerOptions);
  const keyListeners = harness.document.listeners.keydown;

  assert.ok(keyListeners.length >= 1);
  keyListeners.forEach(entry => assert.equal(entry.options, true));
  harness.document.dispatch('keydown', { key: 'k', target: {} });
  harness.document.dispatch('keydown', { key: 'k', target: {} });
  harness.document.dispatch('keydown', { key: 'k', target: {} });

  assert.equal(instance.isOpen(), true);
  assert.equal(harness.document.activeElement, harness.close);
});

test('close button and Escape restore the focus held before opening', async function () {
  const harness = makeHarness();
  const opener = new FakeElement(harness.document);
  harness.document.activeElement = opener;
  const instance = controller.init(harness.controllerOptions);

  await instance.open();
  harness.close.dispatch('click', { target: harness.close });
  assert.equal(instance.isOpen(), false);
  assert.equal(harness.document.activeElement, opener);

  harness.document.activeElement = opener;
  await instance.open();
  harness.document.dispatch('keydown', { key: 'Escape', target: {} });
  assert.equal(instance.isOpen(), false);
  assert.equal(harness.document.activeElement, opener);
});

test('valid fetch renders values, caches the snapshot, and clears state classes', async function () {
  const harness = makeHarness();
  const instance = controller.init(harness.controllerOptions);

  await instance.open();

  assert.equal(harness.fetchCalls[0].url, '/assets/data/visitor-stats.json');
  assert.deepEqual(harness.fetchCalls[0].options, { cache: 'no-store' });
  assert.equal(harness.metrics.visitors.textContent, '1');
  assert.equal(harness.metrics.pageviews.textContent, '3');
  assert.equal(harness.metrics.viewsPerVisitor.textContent, '3');
  assert.equal(harness.metrics.countryCount.textContent, '1');
  assert.equal(harness.trackingStart.dateTime, fixture.data_since);
  assert.equal(harness.updatedAt.dateTime, fixture.generated_at);
  assert.equal(harness.list.children.length, 1);
  assert.equal(harness.list.children[0].textContent, 'South Korea1');
  assert.equal(harness.storage.writes.length, 1);
  assert.equal(harness.storage.writes[0].key, CACHE_KEY);
  ['loading', 'empty', 'stale', 'unavailable'].forEach(function (state) {
    assert.equal(hasState(harness.panel, state), false, state);
  });
});

test('invalid network data is not cached and a valid cache is rendered', async function () {
  const cached = copy(fixture);
  const storage = storageHarness({ [CACHE_KEY]: JSON.stringify(cached) });
  const harness = makeHarness({
    storage: storage,
    snapshots: [{ schema_version: 99 }]
  });
  const instance = controller.init(harness.controllerOptions);

  await instance.open();

  assert.equal(storage.writes.length, 0);
  assert.equal(harness.metrics.visitors.textContent, '1');
  assert.equal(harness.status.textContent, 'Showing last saved data');
  assert.equal(hasState(harness.panel, 'unavailable'), false);
});

test('invalid cache becomes unavailable and a later open retries the network', async function () {
  const storage = storageHarness({ [CACHE_KEY]: '{"schema_version":99}' });
  const harness = makeHarness({
    storage: storage,
    snapshots: [new Error('offline'), copy(fixture)]
  });
  const instance = controller.init(harness.controllerOptions);

  await instance.open();
  assert.equal(hasState(harness.panel, 'unavailable'), true);
  assert.equal(harness.status.textContent, 'Statistics temporarily unavailable');

  instance.close();
  await instance.open();
  assert.equal(harness.fetchCalls.filter(call => call.url === harness.panel.dataset.statsUrl).length, 2);
  assert.equal(harness.metrics.visitors.textContent, '1');
  assert.equal(hasState(harness.panel, 'unavailable'), false);
});

test('period click uses aria-pressed and renders the selected period', async function () {
  const harness = makeHarness();
  const instance = controller.init(harness.controllerOptions);
  await instance.open();

  harness.periods[1].dispatch('click', { target: harness.periods[1] });

  assert.deepEqual(harness.periods.map(button => button.getAttribute('aria-pressed')),
    ['false', 'true', 'false']);
  harness.periods.forEach(button => assert.equal(button.getAttribute('aria-selected'), null));
  assert.equal(harness.metrics.visitors.textContent, '2');
  assert.equal(harness.metrics.pageviews.textContent, '4');
  assert.equal(harness.metrics.countryCount.textContent, '2');
});

test('empty and stale snapshots use distinct clean states', async function () {
  const empty = copy(fixture);
  empty.periods['7d'] = { pageviews: 0, visitors: 0, countries: [] };
  const emptyHarness = makeHarness({ snapshots: [empty] });
  await controller.init(emptyHarness.controllerOptions).open();
  assert.equal(hasState(emptyHarness.panel, 'empty'), true);
  assert.equal(emptyHarness.status.textContent, 'Collecting new visits');
  assert.equal(hasState(emptyHarness.panel, 'stale'), false);

  const staleHarness = makeHarness({
    now: function () {
      return Date.parse(fixture.generated_at) + (18 * 60 * 60 * 1000) + 1;
    }
  });
  await controller.init(staleHarness.controllerOptions).open();
  assert.equal(hasState(staleHarness.panel, 'stale'), true);
  assert.equal(staleHarness.status.textContent, 'Data update delayed');
  assert.equal(hasState(staleHarness.panel, 'empty'), false);
});

test('globe resources load lazily once and receive only marker-derived data', async function () {
  const harness = makeHarness({ noIntl: true, countryName: '<Korea & friends>' });
  const instance = controller.init(harness.controllerOptions);

  assert.equal(harness.scriptCalls.length, 0);
  assert.equal(harness.textureCalls.length, 0);
  assert.equal(harness.globe.calls.factory.length, 0);

  await instance.open();
  instance.close();
  await instance.open();

  assert.deepEqual(harness.scriptCalls, ['/assets/vendor/globe.gl.min.js']);
  assert.deepEqual(harness.textureCalls, ['/assets/img/earth-night.jpg']);
  assert.equal(harness.globe.calls.factory.length, 1);
  assert.deepEqual(harness.globe.calls.factory[0].options, {
    rendererConfig: { alpha: true }
  });
  const lastPoints = harness.globe.calls.points.at(-1);
  assert.deepEqual(lastPoints.map(point => point.code), ['KR']);
  assert.equal(lastPoints.some(point => point.code === 'ZZ'), false);
  assert.equal(harness.globe.calls.rings.at(-1), lastPoints);
  assert.equal(
    harness.globe.calls.labels[0]({ name: '<Korea & friends>', visitors: 1 }),
    '&lt;Korea &amp; friends&gt; &middot; 1 visitors'
  );
});

test('globe failure exposes fallback without erasing rendered metrics', async function () {
  const harness = makeHarness({ scriptError: new Error('blocked') });
  const instance = controller.init(harness.controllerOptions);

  await instance.open();

  assert.equal(harness.globeHost.hidden, true);
  assert.equal(harness.globeFallback.hidden, false);
  assert.equal(harness.metrics.visitors.textContent, '1');
  assert.equal(harness.list.children.length, 1);
});

test('partial globe creation failure stays isolated from later period renders', async function () {
  const harness = makeHarness({
    globeFactory: function () {
      return {
        width: function () { throw new Error('renderer failed'); }
      };
    }
  });
  const instance = controller.init(harness.controllerOptions);

  await instance.open();
  assert.equal(harness.globeFallback.hidden, false);
  assert.doesNotThrow(function () {
    harness.periods[1].dispatch('click', { target: harness.periods[1] });
  });
  assert.equal(harness.metrics.visitors.textContent, '2');
});

test('late globe update failure disables the renderer but preserves period data', async function () {
  const lateGlobe = globeHarness({ failPointsAfter: 1 });
  const harness = makeHarness({ globe: lateGlobe });
  const instance = controller.init(harness.controllerOptions);
  let escaped = null;

  await instance.open();
  try {
    harness.periods[1].dispatch('click', { target: harness.periods[1] });
  } catch (error) {
    escaped = error.message;
  }

  assert.deepEqual({
    escaped: escaped,
    fallbackHidden: harness.globeFallback.hidden
  }, {
    escaped: null,
    fallbackHidden: false
  });
  assert.equal(harness.globeHost.hidden, true);
  assert.equal(lateGlobe.calls.pauses, 1);
  assert.equal(harness.metrics.visitors.textContent, '2');
  assert.equal(harness.list.children.length, 2);

  assert.doesNotThrow(function () {
    harness.periods[2].dispatch('click', { target: harness.periods[2] });
  });
  assert.equal(lateGlobe.calls.pointAttempts, 2);
  assert.equal(harness.metrics.visitors.textContent, '2');
});

test('country naming falls back from Intl to centroid metadata', async function () {
  const harness = makeHarness({ displayNameResult: undefined });
  const instance = controller.init(harness.controllerOptions);

  await instance.open();

  assert.equal(harness.list.children[0].textContent, 'South Korea1');
  assert.equal(harness.globe.calls.points.at(-1)[0].name, 'South Korea');
});

test('init twice reuses the controller without duplicate bindings', function () {
  const harness = makeHarness();
  const first = controller.init(harness.controllerOptions);
  const keydownCount = harness.document.listeners.keydown.length;
  const closeCount = harness.close.listeners.click.length;
  const periodCounts = harness.periods.map(button => button.listeners.click.length);
  const second = controller.init(harness.controllerOptions);

  assert.equal(second, first);
  assert.equal(harness.document.listeners.keydown.length, keydownCount);
  assert.equal(harness.close.listeners.click.length, closeCount);
  assert.deepEqual(harness.periods.map(button => button.listeners.click.length), periodCounts);
});

test('missing optional browser APIs do not prevent metrics from loading', async function () {
  const harness = makeHarness({ noIntl: true, storage: null });
  delete harness.controllerOptions.window.matchMedia;

  const instance = controller.init(harness.controllerOptions);
  await assert.doesNotReject(instance.open());
  assert.equal(harness.metrics.visitors.textContent, '1');
});
