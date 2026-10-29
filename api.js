/* GATE Prep Studio: browser adapter for the published PUBLIC question catalogue (api.js)
 *
 * Read-only. It loads one document from a Google Apps Script web app (Code.gs) and hands it back UNVALIDATED:
 * app.js must pass it through prepareLocalBank(), which rejects private fields and copies only allowlisted ones.
 * There is no login, session, write, attempt or scoring call here, and none may be added through this transport.
 *
 * Transport: JSONP, because Apps Script web apps do not send CORS headers for ContentService output.
 *  - ONE fixed callback name is used (CALLBACK_NAME). The server refuses any other name, and this file never
 *    builds a callback from a request, a response or user input.
 *  - JSONP runs the response as JavaScript in this page, so the endpoint is TRUSTED CODE. Only deploy your own
 *    Code.gs and never point ENDPOINT_URL at a URL you do not control.
 *  - Only the read-only "catalogue", "metadata" and "diag" (status page diagnostics) operations can be requested (fixed OPERATIONS table).
 *
 * Not configured until the owner replaces ENDPOINT_URL with a real deployment URL. No live connection is claimed
 * before then.
 */
(function (root) {
  'use strict';

  /* OWNER ACTION: replace with the web app URL from Apps Script > Deploy > Manage deployments (ends in /exec). */
  var ENDPOINT_URL = 'https://script.google.com/macros/s/AKfycbx9xHLLFvzEjZvvQY46Pmw-xp79XaSH3AabUhZ433aiylDuOgITDVDy7J-QeHbhQUQcDw/exec';

  var CALLBACK_NAME = 'gatePublicCatalogueCallback';
  /* Fixed, internally allowed operations. A request can never name any other operation. */
  var OPERATIONS = Object.freeze({ catalogue: 'catalogue', metadata: 'metadata', diag: 'diag' });
  var TIMEOUT_MS = 20000;
  var ENDPOINT_RE = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_\-]{10,200}\/exec$/;
  var VERSION_RE = /^[a-f0-9]{64}$/;
  var PUBLISHED_AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
  var MAX_COUNT = 100000;
  var busy = false;

  function isConfigured() {
    return typeof ENDPOINT_URL === 'string' && ENDPOINT_RE.test(ENDPOINT_URL);
  }

  function failure(code, serverCode, issues) {
    var e = new Error(code); e.code = code; e.serverCode = serverCode || ''; e.issues = issues || [];
    return e;
  }

  /* Version metadata shared by both responses. Returns { catalogue_version, count, published_at } or null. */
  function readMeta(payload) {
    var v = payload.catalogue_version, n = payload.count, at = payload.published_at;
    if (typeof v !== 'string' || !VERSION_RE.test(v)) { return null; }
    if (typeof n !== 'number' || !isFinite(n) || Math.floor(n) !== n || n < 1 || n > MAX_COUNT) { return null; }
    if (at !== null && at !== undefined && !(typeof at === 'string' && PUBLISHED_AT_RE.test(at) && !isNaN(new Date(at).getTime()))) { return null; }
    return { catalogue_version: v, count: n, published_at: typeof at === 'string' ? at : null };
  }

  /* Shared JSONP transport. `shape(payload)` checks a successful response and returns the value to resolve with,
   * or null when the response is not acceptable. */
  function request(operation, shape, timeoutMs) {
    if (!isConfigured()) { return Promise.reject(failure('not_configured')); }
    if (busy) { return Promise.reject(failure('busy')); }
    if (typeof document === 'undefined' || !document.head) { return Promise.reject(failure('connection')); }
    busy = true;

    return new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      var timer = null, settled = false, hadCallback = Object.prototype.hasOwnProperty.call(root, CALLBACK_NAME);

      function cleanup() {
        busy = false;
        if (timer) { root.clearTimeout(timer); }
        if (script.parentNode) { script.parentNode.removeChild(script); }
        if (!hadCallback) { try { delete root[CALLBACK_NAME]; } catch (e) { root[CALLBACK_NAME] = undefined; } }
        else { root[CALLBACK_NAME] = function () {}; }
      }
      function done(err, value) {
        if (settled) { return; }
        settled = true; cleanup();
        if (err) { reject(err); } else { resolve(value); }
      }

      /* The one callback. It only inspects the shape of the data; it never evaluates anything. */
      root[CALLBACK_NAME] = function (payload) {
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) { return done(failure('bad_response')); }
        if (payload.ok === false) {
          var er = payload.error && typeof payload.error === 'object' ? payload.error : {};
          var issues = Array.isArray(er.issues) ? er.issues.filter(function (s) { return typeof s === 'string'; }).slice(0, 20).map(function (s) { return s.slice(0, 120); }) : [];
          return done(failure('server_error', typeof er.code === 'string' ? er.code.slice(0, 40) : '', issues));
        }
        if (payload.ok !== true || payload.schema_version !== 1) { return done(failure('bad_response')); }
        var value = shape(payload);
        if (!value) { return done(failure('bad_response')); }
        done(null, value);
      };

      script.async = true;
      script.referrerPolicy = 'no-referrer';
      script.onerror = function () { done(failure('connection')); };
      /* If the script ran but never called back (for example a sign-in or error page), the timeout reports it. */
      timer = root.setTimeout(function () { done(failure('timeout')); }, timeoutMs);
      script.src = ENDPOINT_URL + '?op=' + OPERATIONS[operation] + '&callback=' + CALLBACK_NAME + '&_=' + Date.now();
      document.head.appendChild(script);
    });
  }

  function timeoutOf(options) { return options && typeof options.timeoutMs === 'number' ? options.timeoutMs : TIMEOUT_MS; }

  /* The IndexedDB cache contains only public question content; it never stores identity, credentials or answer keys. */
  var CATALOGUE_CACHE_DB = 'gate-public-catalogue-cache-v1';
  var CATALOGUE_CACHE_STORE = 'catalogues';
  function openCatalogueCache() {
    if (!root.indexedDB || typeof root.indexedDB.open !== 'function') { return Promise.resolve(null); }
    return new Promise(function (resolve) {
      var req;
      try { req = root.indexedDB.open(CATALOGUE_CACHE_DB, 1); } catch (e) { resolve(null); return; }
      req.onupgradeneeded = function () {
        try { if (!req.result.objectStoreNames.contains(CATALOGUE_CACHE_STORE)) { req.result.createObjectStore(CATALOGUE_CACHE_STORE, { keyPath: 'key' }); } } catch (e2) {}
      };
      req.onsuccess = function () { resolve(req.result || null); };
      req.onerror = function () { resolve(null); };
      req.onblocked = function () { resolve(null); };
    });
  }
  function readCachedCatalogue(meta) {
    return openCatalogueCache().then(function (db) {
      if (!db) { return null; }
      return new Promise(function (resolve) {
        var req;
        try { req = db.transaction(CATALOGUE_CACHE_STORE, 'readonly').objectStore(CATALOGUE_CACHE_STORE).get('current'); }
        catch (e) { try { db.close(); } catch (e2) {} resolve(null); return; }
        req.onsuccess = function () {
          var rec = req.result, questions = rec && rec.questions;
          try { db.close(); } catch (e) {}
          resolve(rec && rec.version === meta.catalogue_version && rec.count === meta.count && Array.isArray(questions) && questions.length === meta.count ? questions : null);
        };
        req.onerror = function () { try { db.close(); } catch (e) {} resolve(null); };
      });
    }, function () { return null; });
  }
  function writeCachedCatalogue(value) {
    if (!value || !value.meta || !Array.isArray(value.questions)) { return Promise.resolve(); }
    return openCatalogueCache().then(function (db) {
      if (!db) { return; }
      return new Promise(function (resolve) {
        var tx;
        try {
          tx = db.transaction(CATALOGUE_CACHE_STORE, 'readwrite');
          tx.objectStore(CATALOGUE_CACHE_STORE).put({ key: 'current', version: value.meta.catalogue_version, count: value.meta.count, questions: value.questions });
        } catch (e) { try { db.close(); } catch (e2) {} resolve(); return; }
        tx.oncomplete = function () { try { db.close(); } catch (e) {} resolve(); };
        tx.onerror = function () { try { db.close(); } catch (e) {} resolve(); };
        tx.onabort = function () { try { db.close(); } catch (e) {} resolve(); };
      });
    }, function () {});
  }
  function fetchFullCatalogue(options) {
    return request('catalogue', function (payload) {
      if (!Array.isArray(payload.questions)) { return null; }
      var meta = readMeta(payload);
      if (meta && meta.count !== payload.questions.length) { meta = null; }   /* inconsistent: do not trust the version */
      return { schema_version: 1, questions: payload.questions, meta: meta };
    }, timeoutOf(options)).then(function (value) {
      if (!value.meta) { return value; }
      return writeCachedCatalogue(value).then(function () { return value; }, function () { return value; });
    });
  }
  /* Resolves with {schema_version:1, questions, meta}. Metadata is always checked first when IndexedDB is available, so a cached
   * bank is used only when its content version exactly matches the service's current validated metadata. The question bank still
   * passes through prepareLocalBank() in app.js every time it is read from cache. */
  function loadPublicCatalogue(options) {
    if (!root.indexedDB || typeof root.indexedDB.open !== 'function') { return fetchFullCatalogue(options); }
    return loadCatalogueMetadata(options).then(function (meta) {
      return readCachedCatalogue(meta).then(function (questions) {
        if (questions) { return { schema_version: 1, questions: questions, meta: meta }; }
        return fetchFullCatalogue(options);
      });
    }, function () {
      /* Preserve the original full-catalogue path if metadata is temporarily unavailable. */
      return fetchFullCatalogue(options);
    });
  }

  /* Resolves with { catalogue_version, count, published_at } only. No question content is requested or returned. */
  function loadCatalogueMetadata(options) {
    return request('metadata', readMeta, timeoutOf(options));
  }

  /* Deep diagnostics for status.html (read-only; the server answers only while its STATUS_DIAGNOSTICS property is true).
   * Resolves with { build, generated_at, checks: [{ group, id, label, state, detail, fix }] }. Text is returned as data and only ever shown with textContent. */
  var DIAG_STATES = { ok: 1, warn: 1, fail: 1, info: 1 };
  function str(v, max) { return typeof v === 'string' ? v.slice(0, max) : ''; }
  function readDiag(payload) {
    if (!Array.isArray(payload.checks) || payload.checks.length > 100) { return null; }
    var checks = [];
    for (var i = 0; i < payload.checks.length; i++) {
      var c = payload.checks[i];
      if (!c || typeof c !== 'object' || !Object.prototype.hasOwnProperty.call(DIAG_STATES, c.state)) { return null; }
      checks.push({ group: str(c.group, 60), id: str(c.id, 80), label: str(c.label, 120), state: c.state, detail: str(c.detail, 400), fix: str(c.fix, 400) });
    }
    return { build: str(payload.build, 60), generated_at: str(payload.generated_at, 40), checks: checks };
  }
  function loadDiagnostics(options) { return request('diag', readDiag, timeoutOf(options)); }
  function endpointUrl() { return ENDPOINT_URL; }

  var api = Object.freeze({ isConfigured: isConfigured, loadPublicCatalogue: loadPublicCatalogue, loadCatalogueMetadata: loadCatalogueMetadata, loadDiagnostics: loadDiagnostics, endpointUrl: endpointUrl, CALLBACK_NAME: CALLBACK_NAME });
  root.GatePublicApi = api;
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
})(typeof window !== 'undefined' ? window : this);
