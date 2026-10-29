/* GATE Prep Studio: glass theme behaviour.
 * 1. Signed-in state: the header shows ONE Log out button (no Log in / Register); guest-only calls to action are hidden.
 * 2. Stylesheet-driven press feedback, CSS hover glow on glass cards, and a glass loader while moving between pages.
 * Loaded in <head> (small, synchronous) so the signed-in state is applied before first paint. It never reads or stores the
 * session token anywhere except to check that one exists; the real logout is done by auth.js (GateAuth.logout). */
(function (root) {
  'use strict';
  var doc = root.document;
  var STORE_KEY = 'gps.session.v1';
  var TOKEN_RE = /^[0-9a-f]{32}\.[0-9a-f]{64}$/;

  function hasSession() {
    var found = false;
    [function () { return root.sessionStorage; }, function () { return root.localStorage; }].forEach(function (get) {
      try {
        var text = get().getItem(STORE_KEY);
        if (text) { var o = JSON.parse(text); if (o && typeof o.token === 'string' && TOKEN_RE.test(o.token)) { found = true; } }
      } catch (e) { /* storage blocked: treat as signed out */ }
    });
    return found;
  }
  function wipeSession() {
    [function () { return root.sessionStorage; }, function () { return root.localStorage; }].forEach(function (get) {
      try { get().removeItem(STORE_KEY); } catch (e) { /* nothing to clear */ }
    });
  }

  var authed = hasSession();
  if (authed) { doc.documentElement.classList.add('is-authed'); }

  /* ---------- glass loader (used when leaving a page) ---------- */
  var loader = null;
  function getLoader() {
    if (loader) { return loader; }
    loader = doc.createElement('div');
    loader.className = 'gl-loader'; loader.setAttribute('aria-hidden', 'true');
    var card = doc.createElement('div'); card.className = 'gl-loader-card';
    var spinner = doc.createElement('div'); spinner.className = 'gl-spinner';
    var dots = doc.createElement('span'); dots.className = 'gl-dots';
    for (var i = 0; i < 3; i++) { dots.appendChild(doc.createElement('i')); }
    card.appendChild(spinner); card.appendChild(dots); loader.appendChild(card);
    doc.body.appendChild(loader);
    return loader;
  }
  function showLoader() { var l = getLoader(); void l.offsetWidth; l.classList.add('on'); }
  function hideLoader() { if (loader) { loader.classList.remove('on'); } }
  root.addEventListener('pageshow', function (e) { if (e.persisted) { hideLoader(); } });   /* back button restores the page */

  /* ---------- header: one Log out button when signed in ---------- */
  function buildLogout() {
    var boxes = doc.querySelectorAll('.nav-actions');
    Array.prototype.forEach.call(boxes, function (box) {
      while (box.firstChild) { box.removeChild(box.firstChild); }
      var b = doc.createElement('button');
      b.type = 'button'; b.className = 'btn btn-primary'; b.id = 'nav-logout'; b.textContent = 'Log out';
      b.addEventListener('click', function () {
        if (b.disabled) { return; }
        b.disabled = true; b.setAttribute('aria-disabled', 'true');
        showLoader();
        function leave() { wipeSession(); root.location.href = 'login.html'; }
        try {
          if (root.GateAuth && typeof root.GateAuth.logout === 'function') { root.GateAuth.logout().then(leave, leave); }
          else { leave(); }
        } catch (e) { leave(); }
      });
      box.appendChild(b);
    });
  }

  /* ---------- stylesheet-driven press feedback (CSP-safe: no inline style writes) ---------- */
  var PRESS_SEL = '.btn, .pq, .mode-option label, .nav-toggle-label';
  function pressFeedback(e) {
    var el = e.target.closest ? e.target.closest(PRESS_SEL) : null;
    if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') { return; }
    if (el.classList.contains('btn')) {
      el.classList.remove('is-pressed'); void el.offsetWidth; el.classList.add('is-pressed');
      root.setTimeout(function () { el.classList.remove('is-pressed'); }, 480);
    }
  }

  /* Cursor-glow is intentionally CSS-only under the strict self-only style-src policy. */

  /* ---------- page-to-page navigation shows the glass loader ---------- */
  function onLinkClick(e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) { return; }
    var a = e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || a.target === '_blank' || a.hasAttribute('download') || a.getAttribute('aria-disabled') === 'true') { return; }
    var href = a.getAttribute('href') || '';
    if (!href || href.charAt(0) === '#' || /^(mailto:|tel:|javascript:)/i.test(href)) { return; }
    var url; try { url = new URL(a.href, root.location.href); } catch (err) { return; }
    if (url.origin !== root.location.origin) { return; }
    if (url.pathname === root.location.pathname && url.search === root.location.search) { return; }
    e.preventDefault();
    showLoader();
    setTimeout(function () { root.location.href = url.href; }, 260);
  }

  /* ---------- highlight the current page in the nav ---------- */
  function markCurrent() {
    var here = (root.location.pathname.split('/').pop() || 'index.html');
    Array.prototype.forEach.call(doc.querySelectorAll('.nav-links a'), function (a) {
      var u; try { u = new URL(a.href, root.location.href); } catch (err) { return; }
      var page = u.pathname.split('/').pop() || 'index.html';
      if (page === here && (u.search === '' || u.search === root.location.search)) { a.classList.add('is-current'); a.setAttribute('aria-current', 'page'); }
    });
  }

  function ready() {
    if (authed) { buildLogout(); }
    markCurrent();
    doc.addEventListener('pointerdown', pressFeedback, { passive: true });
    doc.addEventListener('click', onLinkClick);
  }
  if (doc.readyState === 'loading') { doc.addEventListener('DOMContentLoaded', ready); } else { ready(); }
})(window);
