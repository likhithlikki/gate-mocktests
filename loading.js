/* GATE Prep Studio: global loading progress (loading.js)
 *
 * One small, dependency-free module that makes EVERY wait visible:
 *   1. A glowing progress bar at the top of the page whenever anything is loading
 *      (page load, any fetch to the private backend, any public-catalogue request).
 *   2. A spinner on whichever button was pressed, for as long as its request is running.
 *   3. A "still working" notice when a request is slow (Apps Script can take up to a minute on a cold start).
 *   4. GateActivity.inline(): a labelled progress bar with elapsed seconds and optional "step 3 of 7" progress,
 *      used by the admin Health and Journey tabs.
 *
 * Strict-CSP safe: it never writes a style attribute or inline style. All visuals are CSS classes in style.css.
 * It never reads, logs or stores request bodies, tokens, answers or any account data. It only counts requests. */
(function (root) {
  'use strict';
  var doc = root.document;
  var SLOW_AFTER_MS = 8000;      /* show the "still working" notice */
  var BUSY_DELAY_MS = 140;       /* a button only shows its spinner if a request really starts */
  var BUSY_MIN_MS = 350;         /* ...and keeps it long enough to be seen */
  var BUSY_RELEASE_MS = 300;     /* a chain of requests may pause briefly between steps */

  var active = 0, startedAt = 0, noteText = '', listeners = [], noteListeners = [], nextId = 1;
  var open = Object.create(null);

  function emit() {
    listeners.slice().forEach(function (fn) { try { fn({ active: active, startedAt: startedAt, note: noteText }); } catch (e) { /* a display must never break a request */ } });
  }
  /* begin() returns end(); calling end() twice is harmless. */
  function begin(label) {
    var id = nextId++; open[id] = true;
    if (active === 0) { startedAt = Date.now(); noteText = ''; }
    active++; emit();
    return function end() {
      if (!open[id]) { return; }
      delete open[id]; active = Math.max(0, active - 1);
      if (active === 0) { startedAt = 0; noteText = ''; }
      emit();
    };
  }
  function note(text) {
    noteText = typeof text === 'string' ? text.slice(0, 160) : '';
    noteListeners.slice().forEach(function (fn) { try { fn(noteText); } catch (e) { /* ignore */ } });
    emit();
  }
  function track(promise, label) {
    var end = begin(label);
    Promise.resolve(promise).then(end, end);
    return promise;
  }
  function subscribe(fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (x) { return x !== fn; }); }; }
  function onNote(fn) { noteListeners.push(fn); return function () { noteListeners = noteListeners.filter(function (x) { return x !== fn; }); }; }

  /* ---------- inline progress widget (works without a document in tests: returns a silent controller) ---------- */
  function percentClass(p) { return 'p' + (Math.max(0, Math.min(100, Math.round(p / 5) * 5))); }
  function inline(parent, label, totalSteps) {
    var silent = { go: function () {}, text: function () {}, done: function () {}, fail: function () {}, node: null };
    if (!doc || !parent) { return silent; }
    var total = typeof totalSteps === 'number' && totalSteps > 0 ? Math.floor(totalSteps) : 0;
    var wrap = doc.createElement('div'); wrap.className = 'gl-inline'; wrap.setAttribute('role', 'progressbar');
    wrap.setAttribute('aria-label', String(label || 'Loading'));
    wrap.setAttribute('aria-valuemin', '0'); wrap.setAttribute('aria-valuemax', total ? String(total) : '100');
    var head = doc.createElement('div'); head.className = 'gl-inline-head';
    var title = doc.createElement('strong'); title.textContent = String(label || 'Working');
    var timeEl = doc.createElement('span'); timeEl.className = 'gl-inline-time'; timeEl.textContent = '0s';
    head.appendChild(title); head.appendChild(timeEl);
    var lane = doc.createElement('div'); lane.className = 'gl-track';
    var fill = doc.createElement('div'); fill.className = total ? 'gl-fill p5' : 'gl-fill is-indeterminate'; lane.appendChild(fill);
    var detail = doc.createElement('p'); detail.className = 'gl-inline-detail'; detail.setAttribute('aria-live', 'polite');
    var hint = doc.createElement('p'); hint.className = 'gl-inline-hint'; hint.hidden = true;
    hint.textContent = 'Still working. The first request after a quiet period can take up to a minute while the server wakes up. Please keep this page open; nothing needs to be pressed again.';
    wrap.appendChild(head); wrap.appendChild(lane); wrap.appendChild(detail); wrap.appendChild(hint);
    parent.appendChild(wrap);
    var started = Date.now(), finished = false;
    var tick = root.setInterval(function () {
      var s = Math.floor((Date.now() - started) / 1000);
      timeEl.textContent = s + 's';
      if (Date.now() - started >= SLOW_AFTER_MS) { hint.hidden = false; }
    }, 1000);
    var stopNote = onNote(function (t) { if (t && !finished) { detail.textContent = t; } });
    function stop() { finished = true; root.clearInterval(tick); stopNote(); }
    /* go(n, text): n steps are finished and the next one, described by `text`, is starting. */
    function go(step, text) {
      if (finished) { return; }
      if (total) {
        var n = Math.max(0, Math.min(total, step));
        /* the bar always shows a little progress so a started task never looks stuck at zero */
        fill.className = 'gl-fill ' + percentClass(Math.max(5, ((n + 0.5) / total) * 100 > 100 ? 100 : ((n + 0.5) / total) * 100));
        wrap.setAttribute('aria-valuenow', String(n));
        detail.textContent = (n >= total ? '' : 'Step ' + (n + 1) + ' of ' + total + (text ? ': ' : '')) + (text || '');
      } else if (text) { detail.textContent = text; }
    }
    function text(t) { if (!finished && t) { detail.textContent = String(t).slice(0, 200); } }
    function remove() { if (wrap.parentNode) { wrap.parentNode.removeChild(wrap); } }
    function done() { if (finished) { return; } stop(); if (total) { fill.className = 'gl-fill p100'; } remove(); }
    function fail() { done(); }
    return { go: go, text: text, done: done, fail: fail, node: wrap };
  }

  var api = Object.freeze({ begin: begin, track: track, note: note, subscribe: subscribe, onNote: onNote, inline: inline,
    isActive: function () { return active > 0; } });
  root.GateActivity = api;
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  if (!doc) { return; }

  /* ---------- count every fetch (private backend calls, asset probes) ---------- */
  if (typeof root.fetch === 'function' && !root.fetch.__gateTracked) {
    var nativeFetch = root.fetch;
    var tracked = function () {
      var end = begin('fetch');
      var p;
      try { p = nativeFetch.apply(root, arguments); } catch (e) { end(); throw e; }
      if (p && typeof p.then === 'function') { p.then(end, end); } else { end(); }
      return p;
    };
    tracked.__gateTracked = true;
    root.fetch = tracked;
  }

  /* ---------- top progress bar + slow notice ---------- */
  var bar = null, fillEl = null, toast = null, toastText = null, slowTimer = null, hideTimer = null;
  function ensureBar() {
    if (bar || !doc.body) { return; }
    bar = doc.createElement('div'); bar.className = 'gl-topbar'; bar.setAttribute('aria-hidden', 'true');
    fillEl = doc.createElement('div'); fillEl.className = 'gl-topbar-fill'; bar.appendChild(fillEl);
    toast = doc.createElement('div'); toast.className = 'gl-toast'; toast.setAttribute('role', 'status'); toast.setAttribute('aria-live', 'polite'); toast.hidden = true;
    var spin = doc.createElement('span'); spin.className = 'gl-toast-spin'; spin.setAttribute('aria-hidden', 'true');
    toastText = doc.createElement('span'); toast.appendChild(spin); toast.appendChild(toastText);
    doc.body.appendChild(bar); doc.body.appendChild(toast);
  }
  function showToast(text) { ensureBar(); if (!toast) { return; } toastText.textContent = text; toast.hidden = false; }
  function hideToast() { if (toast) { toast.hidden = true; } }
  function render(state) {
    ensureBar(); if (!bar) { return; }
    if (state.active > 0) {
      if (hideTimer) { root.clearTimeout(hideTimer); hideTimer = null; }
      bar.classList.add('on');
      if (!slowTimer) {
        slowTimer = root.setTimeout(function () { slowTimer = null; if (active > 0) { showToast(noteText || 'Still working… the server can take up to a minute to respond.'); } }, SLOW_AFTER_MS);
      }
      if (state.note) { showToast(state.note); }
    } else {
      if (slowTimer) { root.clearTimeout(slowTimer); slowTimer = null; }
      hideTimer = root.setTimeout(function () { if (active === 0) { bar.classList.remove('on'); hideToast(); } }, 220);
    }
  }
  subscribe(render);

  /* ---------- page load counts as activity until the window finishes loading ---------- */
  if (doc.readyState !== 'complete') {
    var endPage = begin('page');
    root.addEventListener('load', function () { root.setTimeout(endPage, 150); });
    root.setTimeout(endPage, 20000);   /* never leave the bar running if a load event is missed */
  }
  root.addEventListener('pageshow', function (e) { if (e.persisted) { doc.documentElement.classList.remove('gl-leaving'); } });

  /* ---------- button busy state ----------
   * When a button is pressed and a request starts within a moment, the button shows a spinner (and is marked
   * aria-busy) until all requests have finished. Pressing a button that does no network work shows nothing. */
  var busyButtons = [], busyCheck = null;
  function setBusy(btn, on) {
    if (!btn) { return; }
    if (on) { btn.classList.add('is-busy'); btn.setAttribute('aria-busy', 'true'); }
    else { btn.classList.remove('is-busy'); btn.removeAttribute('aria-busy'); }
  }
  function releaseBusy() {
    var now = Date.now();
    busyButtons = busyButtons.filter(function (entry) {
      if (active === 0 && now - entry.since >= BUSY_MIN_MS && now - entry.idleSince >= BUSY_RELEASE_MS) { setBusy(entry.btn, false); return false; }
      if (active > 0) { entry.idleSince = now; }
      return true;
    });
    if (!busyButtons.length && busyCheck) { root.clearInterval(busyCheck); busyCheck = null; }
  }
  function startWatching() { if (!busyCheck) { busyCheck = root.setInterval(releaseBusy, 100); } }
  doc.addEventListener('click', function (e) {
    var btn = e.target && e.target.closest ? e.target.closest('button.btn, input.btn[type="button"], input.btn[type="submit"], .btn[role="button"]') : null;
    if (!btn || btn.disabled || btn.getAttribute('aria-disabled') === 'true') { return; }
    var before = active, pressedAt = Date.now();
    root.setTimeout(function () {
      if (btn.disabled && btn.getAttribute('aria-disabled') === 'true') { return; }   /* auth.js already shows its own spinner */
      if (active > before) {
        if (!busyButtons.some(function (x) { return x.btn === btn; })) { busyButtons.push({ btn: btn, since: pressedAt, idleSince: Date.now() }); }
        setBusy(btn, true); startWatching();
      }
    }, BUSY_DELAY_MS);
  }, true);

  if (doc.readyState === 'loading') { doc.addEventListener('DOMContentLoaded', ensureBar); } else { ensureBar(); }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
