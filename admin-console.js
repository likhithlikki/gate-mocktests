/* admin-console.js - owner-gated, accessible shell for the Admin Console. */
(function (root) {
  'use strict';
  var doc = root.document;
  var tabs = [], tabById = Object.create(null), initialized = false, activeId = '';
  var shellContext = null;

  function el(tag, className, text) {
    var n = doc.createElement(tag);
    if (className) { n.className = className; }
    if (text !== undefined && text !== null) { n.textContent = String(text); }
    return n;
  }
  function clear(node) { while (node && node.firstChild) { node.removeChild(node.firstChild); } }
  function button(text, onClick, className) {
    var b = el('button', 'btn ' + (className || 'btn-quiet'), text);
    b.type = 'button';
    if (typeof onClick === 'function') { b.addEventListener('click', onClick); }
    return b;
  }
  function message(node, text, state) {
    var p = el('p', 'admin-message' + (state ? ' is-' + state : ''), text);
    p.setAttribute('role', state === 'error' ? 'alert' : 'status');
    node.appendChild(p);
    return p;
  }
  function responseData(response) {
    return response && response.data && typeof response.data === 'object' ? response.data : (response && typeof response === 'object' ? response : {});
  }
  function responseCode(response) { return response && typeof response.code === 'string' ? response.code : ''; }
  function plainError(error) {
    var api = root.GateAdminApi;
    if (api && typeof api.plainError === 'function') { return api.plainError(error || {}); }
    if (error && error.reason === 'license_ref_unset') { return 'Set QUESTION_LICENSE_REF in Apps Script first.'; }
    return 'The operation could not be completed. Check the server configuration and try again.';
  }
  function csvCell(value) {
    var s = String(value == null ? '' : value);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function downloadText(filename, text, mime) {
    if (!root.Blob || !root.URL || typeof root.URL.createObjectURL !== 'function') { throw new Error('Downloads are not supported by this browser.'); }
    var blob = new root.Blob([String(text)], { type: mime || 'text/plain;charset=utf-8' });
    var url = root.URL.createObjectURL(blob), a = el('a');
    a.href = url; a.download = filename; a.hidden = true;
    doc.body.appendChild(a); a.click(); a.remove();
    root.setTimeout(function () { root.URL.revokeObjectURL(url); }, 0);
  }
  function registerTab(spec) {
    if (!spec || typeof spec.id !== 'string' || !/^[a-z0-9-]{1,48}$/.test(spec.id) ||
        typeof spec.label !== 'string' || typeof spec.mount !== 'function') { throw new TypeError('Invalid admin tab registration.'); }
    if (tabById[spec.id]) { return false; }
    var copy = { id: spec.id, label: spec.label, mount: spec.mount };
    tabs.push(copy); tabById[copy.id] = copy; return true;
  }
  function activateTab(id, focusButton) {
    var record = tabById[id];
    if (!record || !shellContext) { return; }
    activeId = id;
    tabs.forEach(function (tab) {
      var b = doc.getElementById('admin-tab-button-' + tab.id), panel = doc.getElementById('admin-tab-panel-' + tab.id);
      var selected = tab.id === id;
      if (b) { b.setAttribute('aria-selected', selected ? 'true' : 'false'); b.tabIndex = selected ? 0 : -1; }
      if (panel) { panel.hidden = !selected; }
    });
    if (focusButton) { var activeButton = doc.getElementById('admin-tab-button-' + id); if (activeButton) { activeButton.focus(); } }
    var state = record._state;
    if (!state) { state = record._state = { mounted: false, panel: doc.getElementById('admin-tab-panel-' + id) }; }
    if (!state.mounted) {
      state.mounted = true;
      try { record.mount(state.panel, shellContext); }
      catch (err) { clear(state.panel); message(state.panel, 'This tab could not be opened. Reload the page and check the deployed scripts.', 'error'); }
    }
  }
  function buildTabs(section, mount) {
    clear(mount);
    var bar = el('div', 'admin-tabbar'); bar.setAttribute('role', 'tablist'); bar.setAttribute('aria-label', 'Admin console sections');
    var panels = el('div', 'admin-tabpanels');
    tabs.forEach(function (tab) {
      var b = button(tab.label, function () { activateTab(tab.id, false); }, 'btn-quiet admin-tab');
      b.id = 'admin-tab-button-' + tab.id; b.setAttribute('role', 'tab'); b.setAttribute('aria-controls', 'admin-tab-panel-' + tab.id);
      b.setAttribute('aria-selected', 'false'); b.tabIndex = -1;
      b.addEventListener('keydown', function (event) {
        var index = tabs.findIndex(function (x) { return x.id === tab.id; }), next = index;
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') { next = (index + 1) % tabs.length; }
        else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') { next = (index - 1 + tabs.length) % tabs.length; }
        else if (event.key === 'Home') { next = 0; }
        else if (event.key === 'End') { next = tabs.length - 1; }
        else { return; }
        event.preventDefault(); activateTab(tabs[next].id, true);
      });
      bar.appendChild(b);
      var panel = el('section', 'admin-tab-panel'); panel.id = 'admin-tab-panel-' + tab.id;
      panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', b.id); panel.tabIndex = 0; panel.hidden = true;
      panels.appendChild(panel);
    });
    mount.appendChild(bar); mount.appendChild(panels);
    if (tabs.length) { activateTab(tabs[0].id, false); }
  }
  function init() {
    if (initialized || !doc) { return; }
    initialized = true;
    var section = doc.getElementById('admin-console'), mount = doc.getElementById('admin-console-mount');
    if (!section || !mount) { return; }
    section.hidden = true;
    var session = null;
    try { session = root.GateAuth && typeof root.GateAuth.readSession === 'function' ? root.GateAuth.readSession() : null; } catch (e) { session = null; }
    if (!session || typeof session.token !== 'string' || !session.token || !root.GateAdminApi || typeof root.GateAdminApi.whoami !== 'function') { return; }
    Promise.resolve(root.GateAdminApi.whoami()).then(function (response) {
      var data = responseData(response);
      if (responseCode(response) !== 'ok' || data.owner !== true) { section.hidden = true; return; }
      shellContext = {
        api: root.GateAdminApi, spec: root.GateAdminSpec, parser: root.GateAdminParse,
        xlsx: root.GateAdminXlsx, validator: root.GateAdminValidate,
        el: el, clear: clear, button: button, message: message,
        responseData: responseData, responseCode: responseCode, plainError: plainError,
        csvCell: csvCell, downloadText: downloadText
      };
      buildTabs(section, mount);
      section.hidden = false;
    }).catch(function () { section.hidden = true; });
  }
  var api = Object.freeze({ registerTab: registerTab, init: init, helpers: Object.freeze({ el: el, clear: clear, button: button,
    message: message, responseData: responseData, responseCode: responseCode, plainError: plainError,
    csvCell: csvCell, downloadText: downloadText }) });
  root.GateAdminConsole = api;
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  if (doc) { if (doc.readyState === 'loading') { doc.addEventListener('DOMContentLoaded', init); } else { init(); } }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
