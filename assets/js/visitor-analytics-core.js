(function (root, factory) {
  var api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.VisitorAnalyticsCore = api;
  }
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var PERIOD_KEYS = ['7d', '30d', 'all'];
  var SNAPSHOT_KEYS = [
    'schema_version',
    'site',
    'timezone',
    'data_since',
    'generated_at',
    'periods'
  ];
  var PERIOD_VALUE_KEYS = ['pageviews', 'visitors', 'countries'];
  var COUNTRY_KEYS = ['code', 'visitors'];
  var MAX_SAFE_INTEGER = 9007199254740991;
  var STALE_MS = 18 * 60 * 60 * 1000;
  var SHORTCUT_MS = 4000;
  var ISO_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|([+-])(\d{2}):(\d{2}))$/;
  var hasOwn = Object.prototype.hasOwnProperty;

  function objectValue(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function noOwnSymbols(value) {
    return typeof Object.getOwnPropertySymbols !== 'function' ||
      Object.getOwnPropertySymbols(value).length === 0;
  }

  function dataDescriptor(value, key, enumerable) {
    var descriptor = Object.getOwnPropertyDescriptor(value, key);

    return descriptor && descriptor.enumerable === enumerable &&
      hasOwn.call(descriptor, 'value') &&
      !hasOwn.call(descriptor, 'get') && !hasOwn.call(descriptor, 'set');
  }

  function exactOwnDataProperties(value, expectedKeys) {
    var actualKeys;
    var index;

    if (!objectValue(value) || Object.getPrototypeOf(value) !== Object.prototype ||
        !noOwnSymbols(value)) {
      return false;
    }
    actualKeys = Object.getOwnPropertyNames(value);
    if (actualKeys.length !== expectedKeys.length) return false;

    for (index = 0; index < expectedKeys.length; index += 1) {
      if (!dataDescriptor(value, expectedKeys[index], true)) return false;
    }
    return true;
  }

  function denseOrdinaryArray(value) {
    var lengthDescriptor;
    var length;
    var actualKeys;
    var index;

    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
        !noOwnSymbols(value)) {
      return false;
    }

    lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
    if (!lengthDescriptor || lengthDescriptor.enumerable ||
        !hasOwn.call(lengthDescriptor, 'value') ||
        hasOwn.call(lengthDescriptor, 'get') || hasOwn.call(lengthDescriptor, 'set')) {
      return false;
    }

    length = lengthDescriptor.value;
    actualKeys = Object.getOwnPropertyNames(value);
    if (actualKeys.length !== length + 1) return false;

    for (index = 0; index < length; index += 1) {
      if (!dataDescriptor(value, String(index), true)) return false;
    }
    return true;
  }

  function finiteNumber(value) {
    return typeof value === 'number' && isFinite(value);
  }

  function safeInteger(value) {
    return finiteNumber(value) &&
      Math.floor(value) === value &&
      Math.abs(value) <= MAX_SAFE_INTEGER;
  }

  function nonnegativeCount(value) {
    return safeInteger(value) && value >= 0;
  }

  function daysInMonth(year, month) {
    if (month === 2) {
      return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
    }
    return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
  }

  function parseTimestamp(value) {
    var match;
    var year;
    var month;
    var day;
    var hour;
    var minute;
    var second;
    var offsetHour;
    var offsetMinute;
    var parsed;

    if (typeof value !== 'string') return null;
    match = ISO_TIMESTAMP.exec(value);
    if (!match) return null;

    year = Number(match[1]);
    month = Number(match[2]);
    day = Number(match[3]);
    hour = Number(match[4]);
    minute = Number(match[5]);
    second = Number(match[6]);
    if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
      return null;
    }
    if (hour > 23 || minute > 59 || second > 59) return null;

    if (match[8] !== 'Z') {
      offsetHour = Number(match[10]);
      offsetMinute = Number(match[11]);
      if (offsetHour > 23 || offsetMinute > 59) return null;
    }

    parsed = Date.parse(value);
    return finiteNumber(parsed) ? parsed : null;
  }

  function validCountry(entry) {
    return exactOwnDataProperties(entry, COUNTRY_KEYS) &&
      typeof entry.code === 'string' &&
      /^[A-Z]{2}$/.test(entry.code) &&
      safeInteger(entry.visitors) &&
      entry.visitors > 0;
  }

  function validPeriod(period) {
    var seenCodes = {};
    var previous = null;
    var countryTotal = 0;
    var index;
    var entry;

    if (!exactOwnDataProperties(period, PERIOD_VALUE_KEYS)) return false;
    if (!nonnegativeCount(period.pageviews) || !nonnegativeCount(period.visitors)) {
      return false;
    }
    if (period.visitors > period.pageviews || !denseOrdinaryArray(period.countries)) {
      return false;
    }

    for (index = 0; index < period.countries.length; index += 1) {
      entry = period.countries[index];
      if (!validCountry(entry) || hasOwn.call(seenCodes, entry.code)) return false;
      seenCodes[entry.code] = true;

      if (previous && (previous.visitors < entry.visitors ||
          (previous.visitors === entry.visitors && previous.code > entry.code))) {
        return false;
      }
      previous = entry;

      if (entry.visitors > period.visitors - countryTotal) return false;
      countryTotal += entry.visitors;
    }
    return true;
  }

  function validSnapshotValue(snapshot) {
    var dataSince;
    var generatedAt;
    var periods;
    var index;
    var previous;
    var current;

    if (!exactOwnDataProperties(snapshot, SNAPSHOT_KEYS)) return false;
    if (snapshot.schema_version !== 1 || snapshot.site !== 'ky-ji.github.io' ||
        snapshot.timezone !== 'Asia/Seoul') {
      return false;
    }

    dataSince = parseTimestamp(snapshot.data_since);
    generatedAt = parseTimestamp(snapshot.generated_at);
    if (dataSince === null || generatedAt === null || dataSince > generatedAt) {
      return false;
    }

    periods = snapshot.periods;
    if (!exactOwnDataProperties(periods, PERIOD_KEYS)) return false;
    for (index = 0; index < PERIOD_KEYS.length; index += 1) {
      if (!validPeriod(periods[PERIOD_KEYS[index]])) return false;
    }

    for (index = 1; index < PERIOD_KEYS.length; index += 1) {
      previous = periods[PERIOD_KEYS[index - 1]];
      current = periods[PERIOD_KEYS[index]];
      if (previous.pageviews > current.pageviews || previous.visitors > current.visitors) {
        return false;
      }
    }
    return true;
  }

  function validateSnapshot(snapshot) {
    try {
      return validSnapshotValue(snapshot);
    } catch (error) {
      return false;
    }
  }

  function viewModel(snapshot, periodKey) {
    var period;
    var countries = [];
    var index;

    if (!validateSnapshot(snapshot) || PERIOD_KEYS.indexOf(periodKey) === -1) {
      throw new TypeError('Invalid visitor analytics snapshot or period');
    }

    period = snapshot.periods[periodKey];
    for (index = 0; index < period.countries.length; index += 1) {
      countries.push({
        code: period.countries[index].code,
        visitors: period.countries[index].visitors
      });
    }

    return {
      pageviews: period.pageviews,
      visitors: period.visitors,
      viewsPerVisitor: period.visitors ?
        Number((period.pageviews / period.visitors).toFixed(1)) : 0,
      countryCount: countries.length,
      countries: countries
    };
  }

  function isStale(snapshot, nowMs, thresholdMs) {
    var now;
    var threshold;

    if (!validateSnapshot(snapshot)) return true;
    now = typeof nowMs === 'undefined' ? Date.now() : nowMs;
    threshold = typeof thresholdMs === 'undefined' ? STALE_MS : thresholdMs;
    if (!finiteNumber(now) || !finiteNumber(threshold) || threshold < 0) return true;

    return now - parseTimestamp(snapshot.generated_at) > threshold;
  }

  function markers(model, centroids) {
    var points = [];
    var index;
    var country;
    var centroid;

    if (!model || !Array.isArray(model.countries) || !objectValue(centroids)) {
      return points;
    }

    for (index = 0; index < model.countries.length; index += 1) {
      country = model.countries[index];
      if (!country || !finiteNumber(country.visitors) || country.visitors <= 0 ||
          typeof country.code !== 'string' || !hasOwn.call(centroids, country.code)) {
        continue;
      }

      centroid = centroids[country.code];
      if (!objectValue(centroid) || !finiteNumber(centroid.lat) ||
          !finiteNumber(centroid.lng)) {
        continue;
      }

      points.push({
        code: country.code,
        name: typeof centroid.name === 'string' && centroid.name ?
          centroid.name : country.code,
        lat: centroid.lat,
        lng: centroid.lng,
        visitors: country.visitors
      });
    }
    return points;
  }

  function isEditable(target) {
    var tagName;
    var contentEditable;

    if (!target) return false;
    tagName = typeof target.tagName === 'string' ? target.tagName.toLowerCase() : '';
    if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') {
      return true;
    }
    if (target.isContentEditable === true || target.contentEditable === true) return true;

    contentEditable = typeof target.contentEditable === 'string' ?
      target.contentEditable.toLowerCase() : null;
    return contentEditable === '' || contentEditable === 'true' ||
      contentEditable === 'plaintext-only';
  }

  function isK(event) {
    var key;

    if (!event) return false;
    key = typeof event.key === 'string' ? event.key.toLowerCase() : '';
    return key === 'k' || event.code === 'KeyK' ||
      event.keyCode === 75 || event.which === 75;
  }

  function createShortcutHandler(toggle, clock) {
    var count = 0;
    var firstAt = null;
    var lastAt = null;
    var readClock = typeof clock === 'function' ? clock : function () {
      return Date.now();
    };

    function reset() {
      count = 0;
      firstAt = null;
      lastAt = null;
    }

    return function (event) {
      var at;

      if (!event || event.repeat || event.ctrlKey || event.metaKey || event.altKey ||
          isEditable(event.target) || !isK(event)) {
        return false;
      }

      at = readClock();
      if (!finiteNumber(at)) {
        reset();
        return false;
      }
      if (lastAt !== null && at < lastAt) reset();

      if (firstAt === null || at - firstAt > SHORTCUT_MS) {
        count = 1;
        firstAt = at;
      } else {
        count += 1;
      }
      lastAt = at;

      if (count < 3) return false;
      reset();
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
}));
