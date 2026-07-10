(function (root, factory) {
  var api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.VisitorAnalyticsController = api;
    api.init({
      window: root,
      document: root.document,
      core: root.VisitorAnalyticsCore
    });
  }
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var CACHE_KEY = 'visitor-analytics-v1';
  var CONTROLLER_KEY = '__visitorAnalyticsControllerV1';
  var STATE_CLASSES = [
    'is-loading', 'is-empty', 'is-stale', 'is-unavailable'
  ];

  function own(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
  }

  function readWindowStorage(root) {
    try {
      return root && root.localStorage ? root.localStorage : null;
    } catch (_error) {
      return null;
    }
  }

  function queryMatches(search, key, expected) {
    var query = typeof search === 'string' ? search.replace(/^\?/, '').split('&') : [];
    var index;
    var parts;

    if (!key) return false;
    for (index = 0; index < query.length; index += 1) {
      parts = query[index].split('=');
      try {
        if (decodeURIComponent(parts[0].replace(/\+/g, ' ')) === key &&
            decodeURIComponent((parts.slice(1).join('=') || '').replace(/\+/g, ' ')) ===
              expected) {
          return true;
        }
      } catch (_error) {}
    }
    return false;
  }

  function defaultLoadScript(root, document, source) {
    if (root && root.Globe) return Promise.resolve();
    if (!document || !document.head || !source) {
      return Promise.reject(new Error('Globe script unavailable'));
    }
    return new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = source;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  function defaultLoadTexture(root, source) {
    if (!root || typeof root.Image !== 'function' || !source) {
      return Promise.reject(new Error('Globe texture unavailable'));
    }
    return new Promise(function (resolve, reject) {
      var texture = new root.Image();
      texture.onload = resolve;
      texture.onerror = reject;
      texture.src = source;
    });
  }

  function defaultGlobeFactory(root, document, host, options) {
    var probe;

    if (!root || typeof root.Globe !== 'function') {
      throw new Error('Globe constructor unavailable');
    }
    probe = document.createElement('canvas');
    if (!probe.getContext ||
        !(probe.getContext('webgl') || probe.getContext('experimental-webgl'))) {
      throw new Error('WebGL unavailable');
    }
    return new root.Globe(host, options);
  }

  function validCentroids(value) {
    var codes;
    var index;
    var entry;

    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    codes = Object.keys(value);
    if (!codes.length) return false;
    for (index = 0; index < codes.length; index += 1) {
      entry = value[codes[index]];
      if (!/^[A-Z]{2}$/.test(codes[index]) || !entry ||
          typeof entry.name !== 'string' || typeof entry.lat !== 'number' ||
          !isFinite(entry.lat) || entry.lat < -90 || entry.lat > 90 ||
          typeof entry.lng !== 'number' || !isFinite(entry.lng) ||
          entry.lng < -180 || entry.lng > 180) {
        return false;
      }
    }
    return true;
  }

  function createController(options) {
    var settings = options || {};
    var root = settings.window || (typeof window !== 'undefined' ? window : null);
    var document = settings.document || (root && root.document);
    var core = settings.core || (root && root.VisitorAnalyticsCore);
    var panel = settings.panel || (document && document.getElementById('statsPanel'));
    var fetchValue = settings.fetch || (root && typeof root.fetch === 'function' ?
      function (url, fetchOptions) { return root.fetch(url, fetchOptions); } : null);
    var storage = own(settings, 'storage') ? settings.storage : readWindowStorage(root);
    var now = typeof settings.now === 'function' ? settings.now : function () {
      return Date.now();
    };
    var loadScript = settings.loadScript || function (source) {
      return defaultLoadScript(root, document, source);
    };
    var loadTexture = settings.loadTexture || function (source) {
      return defaultLoadTexture(root, source);
    };
    var globeFactory = settings.globeFactory || function (host, globeOptions) {
      return defaultGlobeFactory(root, document, host, globeOptions);
    };
    var closeButton;
    var status;
    var countryList;
    var trackingStart;
    var updatedAt;
    var globeHost;
    var globeFallback;
    var periodButtons;
    var activePeriod = '7d';
    var snapshot = null;
    var snapshotStatus = null;
    var centroids = null;
    var globe = null;
    var loadPromise = null;
    var globePromise = null;
    var lastFocus = null;
    var resizeObserver = null;
    var api;

    if (!document || !panel || !core ||
        typeof core.createShortcutHandler !== 'function' ||
        typeof core.validateSnapshot !== 'function' ||
        typeof core.viewModel !== 'function' ||
        typeof core.isStale !== 'function' || typeof core.markers !== 'function') {
      return null;
    }
    if (panel[CONTROLLER_KEY]) return panel[CONTROLLER_KEY];

    closeButton = panel.querySelector('.visitor-analytics__close');
    status = panel.querySelector('[data-status]');
    countryList = panel.querySelector('[data-country-list]');
    trackingStart = panel.querySelector('[data-tracking-start]');
    updatedAt = panel.querySelector('[data-updated-at]');
    globeHost = panel.querySelector('[data-globe]');
    globeFallback = panel.querySelector('[data-globe-fallback]');
    periodButtons = Array.prototype.slice.call(panel.querySelectorAll('[data-period]') || []);

    function setState(state, message) {
      var index;

      for (index = 0; index < STATE_CLASSES.length; index += 1) {
        panel.classList.remove(STATE_CLASSES[index]);
      }
      if (state) panel.classList.add('is-' + state);
      if (status && typeof message === 'string') status.textContent = message;
    }

    function setMetric(name, value) {
      var element = panel.querySelector('[data-metric="' + name + '"]');
      if (element) element.textContent = Number(value).toLocaleString();
    }

    function displayName(code) {
      var intlName;

      try {
        if (root && root.Intl && typeof root.Intl.DisplayNames === 'function') {
          intlName = new root.Intl.DisplayNames([
            document.documentElement && document.documentElement.lang || 'en'
          ], { type: 'region' }).of(code);
          if (intlName && intlName !== code) return intlName;
        }
      } catch (_error) {}
      return centroids && centroids[code] && centroids[code].name || code;
    }

    function renderCountries(countries) {
      var index;
      var entry;
      var item;
      var count;

      if (!countryList) return;
      countryList.textContent = '';
      for (index = 0; index < countries.length && index < 5; index += 1) {
        entry = countries[index];
        item = document.createElement('li');
        item.appendChild(document.createTextNode(displayName(entry.code)));
        count = document.createElement('span');
        count.textContent = Number(entry.visitors).toLocaleString();
        item.appendChild(count);
        countryList.appendChild(item);
      }
      if (!countries.length) {
        item = document.createElement('li');
        item.textContent = 'No countries recorded yet';
        countryList.appendChild(item);
      }
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

    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, function (character) {
        return {
          '&': '&amp;', '<': '&lt;', '>': '&gt;',
          '"': '&quot;', "'": '&#39;'
        }[character];
      });
    }

    function updateGlobe(model) {
      var points;
      var index;

      if (!globe || !centroids) return;
      points = core.markers(model, centroids);
      for (index = 0; index < points.length; index += 1) {
        points[index].name = displayName(points[index].code);
      }
      try {
        globe.pointsData(points).ringsData(points);
      } catch (_error) {
        disableGlobe();
      }
    }

    function render(statusOverride) {
      var model;
      var empty;
      var stale;
      var state;
      var message;

      if (!snapshot) return;
      if (arguments.length) snapshotStatus = statusOverride || null;
      model = core.viewModel(snapshot, activePeriod);
      setMetric('visitors', model.visitors);
      setMetric('pageviews', model.pageviews);
      setMetric('viewsPerVisitor', model.viewsPerVisitor);
      setMetric('countryCount', model.countryCount);
      renderCountries(model.countries);

      if (trackingStart) {
        trackingStart.textContent = formatDate(snapshot.data_since);
        trackingStart.dateTime = snapshot.data_since;
      }
      if (updatedAt) {
        updatedAt.textContent = formatDateTime(snapshot.generated_at);
        updatedAt.dateTime = snapshot.generated_at;
      }

      empty = model.pageviews === 0 && model.visitors === 0;
      stale = core.isStale(snapshot, now());
      state = stale ? 'stale' : empty ? 'empty' : null;
      message = snapshotStatus || (stale ? 'Data update delayed' :
        empty ? 'Collecting new visits' : 'Analytics up to date');
      setState(state, message);
      updateGlobe(model);
    }

    function readCache() {
      var value;

      if (!storage || typeof storage.getItem !== 'function') return null;
      try {
        value = JSON.parse(storage.getItem(CACHE_KEY) || 'null');
        return core.validateSnapshot(value) ? value : null;
      } catch (_error) {
        return null;
      }
    }

    function storeSnapshot(value) {
      if (!storage || typeof storage.setItem !== 'function') return;
      try {
        storage.setItem(CACHE_KEY, JSON.stringify(value));
      } catch (_error) {}
    }

    function loadSnapshot() {
      var pending;

      if (snapshot) return Promise.resolve(snapshot);
      if (loadPromise) return loadPromise;
      setState('loading', 'Loading analytics');

      pending = fetchValue && panel.dataset.statsUrl ?
        Promise.resolve().then(function () {
          return fetchValue(panel.dataset.statsUrl, { cache: 'no-store' });
        }).then(function (response) {
          if (!response || !response.ok) {
            throw new Error('Visitor statistics unavailable');
          }
          return response.json();
        }).then(function (value) {
          if (!core.validateSnapshot(value)) throw new Error('Invalid visitor statistics');
          storeSnapshot(value);
          snapshot = value;
          render(null);
          return value;
        }) : Promise.reject(new Error('Fetch unavailable'));

      pending = pending.catch(function () {
        var cached = readCache();
        if (cached) {
          snapshot = cached;
          render('Showing last saved data');
          return cached;
        }
        setState('unavailable', 'Statistics temporarily unavailable');
        return null;
      });
      loadPromise = pending.then(function (value) {
        loadPromise = null;
        return value;
      });
      return loadPromise;
    }

    function showGlobeFallback() {
      if (globeHost) globeHost.hidden = true;
      if (globeFallback) globeFallback.hidden = false;
    }

    function disableGlobe() {
      var brokenGlobe = globe;

      globe = null;
      try {
        if (brokenGlobe && typeof brokenGlobe.pauseAnimation === 'function') {
          brokenGlobe.pauseAnimation();
        }
      } catch (_error) {}
      showGlobeFallback();
    }

    function configureGlobe() {
      var size = globeHost.clientWidth || 280;
      var controls;
      var reducedMotion = false;

      globe = globeFactory(globeHost, { rendererConfig: { alpha: true } });
      if (!globe) throw new Error('Globe creation failed');
      globe.width(size)
        .height(size)
        .backgroundColor('rgba(0,0,0,0)')
        .globeImageUrl(panel.dataset.textureUrl)
        .showAtmosphere(true)
        .atmosphereColor('#55c987')
        .atmosphereAltitude(0.12)
        .pointLat('lat')
        .pointLng('lng')
        .pointColor(function () { return '#f4b942'; })
        .pointAltitude(0.015)
        .pointRadius(function (point) {
          return 0.24 + Math.min(Math.sqrt(point.visitors) * 0.12, 0.7);
        })
        .pointLabel(function (point) {
          return escapeHtml(point.name) + ' &middot; ' + point.visitors + ' visitors';
        })
        .ringLat('lat')
        .ringLng('lng')
        .ringColor(function () {
          return function (time) { return 'rgba(244,185,66,' + (1 - time) + ')'; };
        })
        .ringMaxRadius(2.4)
        .ringPropagationSpeed(1.7)
        .ringRepeatPeriod(1500)
        .pointOfView({ lat: 24, lng: 105, altitude: 2.2 });

      controls = globe.controls();
      try {
        reducedMotion = root && typeof root.matchMedia === 'function' &&
          root.matchMedia('(prefers-reduced-motion: reduce)').matches;
      } catch (_error) {}
      if (controls) {
        controls.enableZoom = false;
        controls.autoRotate = !reducedMotion;
        controls.autoRotateSpeed = 0.55;
      }

      if (root && typeof root.ResizeObserver === 'function') {
        resizeObserver = new root.ResizeObserver(function () {
          var next = globeHost.clientWidth;
          if (next && globe) globe.width(next).height(next);
        });
        resizeObserver.observe(globeHost);
      }
      if (snapshot) render();
    }

    function ensureGlobe() {
      var centroidRequest;

      if (globePromise) return globePromise;
      if (!globeHost || !panel.dataset.globeScript ||
          !panel.dataset.centroidsUrl || !panel.dataset.textureUrl || !fetchValue) {
        showGlobeFallback();
        globePromise = Promise.resolve(null);
        return globePromise;
      }

      centroidRequest = Promise.resolve().then(function () {
        return fetchValue(panel.dataset.centroidsUrl, { cache: 'force-cache' });
      }).then(function (response) {
        if (!response || !response.ok) throw new Error('Centroids unavailable');
        return response.json();
      }).then(function (value) {
        if (!validCentroids(value)) throw new Error('Invalid centroids');
        return value;
      });

      globePromise = Promise.all([
        Promise.resolve().then(function () {
          return loadScript(panel.dataset.globeScript);
        }),
        centroidRequest,
        Promise.resolve().then(function () {
          return loadTexture(panel.dataset.textureUrl);
        })
      ]).then(function (values) {
        centroids = values[1];
        configureGlobe();
        return globe;
      }).catch(function () {
        globe = null;
        showGlobeFallback();
        return null;
      });
      return globePromise;
    }

    function isOpen() {
      return panel.classList.contains('is-open');
    }

    function open() {
      if (!isOpen()) {
        lastFocus = document.activeElement;
        panel.classList.add('is-open');
        panel.setAttribute('aria-hidden', 'false');
        if (closeButton && typeof closeButton.focus === 'function') closeButton.focus();
      }
      return Promise.all([loadSnapshot(), ensureGlobe()]);
    }

    function close() {
      if (!isOpen()) return;
      panel.classList.remove('is-open');
      panel.setAttribute('aria-hidden', 'true');
      if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
      lastFocus = null;
    }

    function toggle() {
      return isOpen() ? close() : open();
    }

    periodButtons.forEach(function (button) {
      button.addEventListener('click', function () {
        var period = button.dataset.period;
        if (['7d', '30d', 'all'].indexOf(period) === -1) return;
        activePeriod = period;
        periodButtons.forEach(function (candidate) {
          candidate.setAttribute('aria-pressed', candidate === button ? 'true' : 'false');
        });
        if (snapshot) render();
      });
    });
    if (closeButton) closeButton.addEventListener('click', close);
    document.addEventListener('keydown', core.createShortcutHandler(toggle, now), true);
    document.addEventListener('keydown', function (event) {
      if (event && event.key === 'Escape' && isOpen()) close();
    }, true);

    api = {
      open: open,
      close: close,
      isOpen: isOpen
    };
    panel[CONTROLLER_KEY] = api;

    if (queryMatches(root && root.location && root.location.search,
        panel.dataset.queryKey, panel.dataset.queryValue)) {
      open();
    }
    return api;
  }

  function init(options) {
    return createController(options);
  }

  return {
    createController: createController,
    init: init
  };
}));
