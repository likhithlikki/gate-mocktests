/* GATE Prep Studio: System status page (status.js), deep diagnostics edition.
 *
 * Runs READ-ONLY checks on everything the site depends on and shows, for each part, EVERY check that was made with a green / amber / red
 * state, what exactly is wrong and what to do about it.
 *
 *   1. Website settings and browser   the endpoint addresses in api.js / auth.js (placeholder, /dev, wrong host, same address twice),
 *                                     https, Web Crypto, browser storage, stale cached scripts
 *   2. Website files and data         every page and script exists on the deployed site; data/manifest.json and each shard are valid and
 *                                     match their SHA-256 digest
 *   3. Public catalogue service       reachable and publishing (op=metadata), then the backend's own deep report (op=diag)
 *   4. Private login/account service  reachable and which features are on (auth_status), then the backend's deep report (diag_status)
 *   5. Online exam service            only when the visitor is logged in
 *   6. Private backup service         cannot be checked from a browser (no web address by design)
 *
 * The deep reports come from the backends themselves and are OFF until the owner sets the Script Property STATUS_DIAGNOSTICS to true in that
 * Apps Script project. They contain property NAMES, tab and column names, counts, yes/no results and fixes. Never a secret, a property value,
 * a spreadsheet id, an email address or any account data. This page sends no password, code or token, and inserts text with textContent only.
 */
(function (root) {
  'use strict';

  var doc = root.document;
  /* The backend code versions this page was written for. A different value from a backend means that deployment runs other code. */
  var EXPECTED_BUILD = { 'public': 'public-2026-10-29-diag1', 'private': 'private-2026-10-29-diag1' };
  var SYMBOL = { ok: '\u2713', warn: '!', fail: '\u2715', info: 'i', skip: '\u2013', run: '\u2026' };
  var LABEL = { ok: 'Working', warn: 'Needs attention', fail: 'Problem', skip: 'Not checked', run: 'Checking' };
  var ITEM_LABEL = { ok: 'OK', warn: 'Attention', fail: 'Problem', info: 'Info', skip: 'Skipped' };
  var ENDPOINT_RE = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_\-]{10,200}\/exec$/;

  function it(state, label, detail, fix, group, link) { return { state: state, label: label, detail: detail || '', fix: fix || '', group: group || '', link: link || null }; }
  function worst(items) {
    var s = { fail: 0, warn: 0, ok: 0, skip: 0 };
    items.forEach(function (i) { if (s[i.state] !== undefined) { s[i.state]++; } });
    return s.fail ? 'fail' : s.warn ? 'warn' : s.ok ? 'ok' : s.skip ? 'skip' : 'ok';
  }
  function tally(items) {
    var n = { fail: 0, warn: 0, ok: 0, info: 0, skip: 0 };
    items.forEach(function (i) { if (n[i.state] !== undefined) { n[i.state]++; } });
    return n;
  }
  function result(summary, items, state) { return { state: state || worst(items), summary: summary, items: items }; }
  function summarise(items, what) {
    var n = tally(items), total = items.length, off = items.some(function (i) { return i.label === 'Deep checks are switched off'; });
    var s = summariseCore(n, total, what);
    return off ? s + ' Deep checks are off, so problems inside the backend\u2019s settings and sheets are not visible yet.' : s;
  }
  function summariseCore(n, total, what) {
    if (n.fail) { return n.fail + ' problem' + (n.fail === 1 ? '' : 's') + (n.warn ? ' and ' + n.warn + ' warning' + (n.warn === 1 ? '' : 's') : '') + ' found in ' + total + ' check' + (total === 1 ? '' : 's') + ' of the ' + what + '.'; }
    if (n.warn) { return n.warn + ' warning' + (n.warn === 1 ? '' : 's') + ' in ' + total + ' checks of the ' + what + '.'; }
    return 'All ' + total + ' check' + (total === 1 ? '' : 's') + ' of the ' + what + ' passed.';
  }
  function now() { return root.performance && root.performance.now ? root.performance.now() : Date.now(); }
  function secs(t0) { return ((now() - t0) / 1000).toFixed(1) + ' s'; }
  function maskId(url) {
    var m = /\/macros\/s\/([A-Za-z0-9_\-]+)\//.exec(String(url || ''));
    return m ? m[1].slice(0, 8) + '\u2026' + m[1].slice(-6) : '';
  }
  /* Backends return diagnostics as data; accept only the expected shape and cap every string. */
  function cleanChecks(list) {
    if (!Array.isArray(list) || list.length > 140) { return null; }
    var STATES = { ok: 1, warn: 1, fail: 1, info: 1 }, out = [];
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (!c || typeof c !== 'object' || !Object.prototype.hasOwnProperty.call(STATES, c.state)) { return null; }
      out.push(it(c.state, String(c.label || '').slice(0, 120), String(c.detail || '').slice(0, 400), String(c.fix || '').slice(0, 400), String(c.group || '').slice(0, 60)));
    }
    return out;
  }

  /* ================= 1. Website settings and browser ================= */

  function classifyEndpoint(url, label, file, which) {
    var G = 'Addresses in the website files', where = file + ' (' + (which === 'public' ? 'ENDPOINT_URL' : 'AUTH_ENDPOINT_URL') + ')';
    var fixCommon = ' Copy it from Apps Script > Deploy > Manage deployments > your Web app > Web app URL, paste it into ' + file + ', commit, and wait for GitHub Pages to redeploy.';
    if (typeof url !== 'string' || !url) { return it('fail', label, 'No address is set in ' + where + '.', 'Set it to the /exec Web app URL of the ' + (which === 'public' ? 'public catalogue' : 'private account') + ' project.' + fixCommon, G); }
    if (/REPLACE|PLACEHOLDER|YOUR[_-]|\.\.\./i.test(url)) { return it('fail', label, where + ' still contains placeholder text.', 'Replace it with the real /exec address.' + fixCommon, G); }
    if (url !== url.trim()) { return it('fail', label, 'The address in ' + where + ' has a space or line break at the start or end.', 'Remove the extra characters.', G); }
    if (!/^https:\/\//.test(url)) { return it('fail', label, 'The address in ' + where + ' does not start with https://', 'It must start with https://script.google.com/macros/s/', G); }
    if (!/^https:\/\/script\.google\.com\//.test(url)) { return it('fail', label, 'The address in ' + where + ' is not on script.google.com (for example a Google Sheet or Drive link was pasted).', 'Use the Web app URL of the deployment, not a sheet or project link.' + fixCommon, G); }
    if (/\/a\/macros\//.test(url)) { return it('fail', label, 'The address in ' + where + ' is a Google Workspace domain URL (/a/macros/...).', 'Use the standard URL that starts with https://script.google.com/macros/s/ and ends in /exec.', G); }
    if (/\/dev$/.test(url)) { return it('fail', label, 'The address in ' + where + ' ends in /dev. That is the owner-only test URL, so visitors cannot use it.', 'Use the deployment URL ending in /exec.' + fixCommon, G); }
    if (/[?#]/.test(url)) { return it('fail', label, 'The address in ' + where + ' has extra text after /exec (a ? or #).', 'Keep only https://script.google.com/macros/s/<id>/exec', G); }
    if (!ENDPOINT_RE.test(url)) { return it('fail', label, 'The address in ' + where + ' is not in the expected form https://script.google.com/macros/s/<id>/exec.', 'Check the whole URL was copied, with no missing characters.' + fixCommon, G); }
    return it('ok', label, 'Address in ' + where + ' has the right form (deployment ' + maskId(url) + '). Compare that start and end with your deployment in Apps Script.', '', G);
  }

  function checkSettings() {
    var items = [], B = 'Browser', loc = root.location || {};
    var secure = loc.protocol === 'https:' || loc.hostname === 'localhost' || loc.hostname === '127.0.0.1';
    items.push(it(secure ? 'ok' : 'fail', 'Page is served over https', secure ? 'Address starts with ' + loc.protocol + '//' : 'This page is on ' + loc.protocol + '. Login needs https.', secure ? '' : 'Open the site using its https:// address.', B));
    var subtle = !!(root.crypto && root.crypto.subtle);
    items.push(it(subtle ? 'ok' : 'fail', 'Web Crypto (password protection)', subtle ? 'Available.' : 'This browser or page cannot use Web Crypto, so passwords cannot be protected and login is blocked.', subtle ? '' : 'Use a current browser on an https:// page.', B));
    var storageProblems = [];
    ['sessionStorage', 'localStorage'].forEach(function (name) {
      try { var s = root[name]; s.setItem('gps.status.probe', '1'); s.removeItem('gps.status.probe'); } catch (e) { storageProblems.push(name); }
    });
    items.push(it(storageProblems.length ? 'warn' : 'ok', 'Browser storage (stays logged in)', storageProblems.length ? storageProblems.join(' and ') + ' is blocked, so login sessions cannot be kept.' : 'sessionStorage and localStorage work.',
      storageProblems.length ? 'Leave private/incognito mode or allow site data for this site (Brave: lower Shields for this site).' : '', B));
    if (root.navigator && root.navigator.onLine === false) { items.push(it('fail', 'Internet connection', 'The browser reports it is offline.', 'Reconnect and press Check again.', B)); }

    var pub = root.GatePublicApi, auth = root.GateAuth, G = 'Scripts loaded on this page', pubUrl = null, authUrl = null;
    items.push(it(pub ? 'ok' : 'fail', 'api.js (public catalogue adapter)', pub ? 'Loaded.' : 'api.js did not load.', pub ? '' : 'The file is missing or has a syntax error. See Website files and data; open the browser console (F12) for the error.', G));
    items.push(it(auth ? 'ok' : 'fail', 'auth.js (login adapter)', auth ? 'Loaded.' : 'auth.js did not load.', auth ? '' : 'The file is missing or has a syntax error. See Website files and data; open the browser console (F12) for the error.', G));
    if (pub && typeof pub.endpointUrl !== 'function') { items.push(it('warn', 'api.js is an old cached copy', 'The browser kept an older api.js that lacks the newest features.', 'Press Ctrl+F5 (Cmd+Shift+R on Mac) to reload everything, then check again.', G)); }
    if (auth && typeof auth.endpointUrl !== 'function') { items.push(it('warn', 'auth.js is an old cached copy', 'The browser kept an older auth.js that lacks the newest features.', 'Press Ctrl+F5 (Cmd+Shift+R on Mac) to reload everything, then check again.', G)); }
    if (pub && typeof pub.endpointUrl === 'function') { pubUrl = pub.endpointUrl(); items.push(classifyEndpoint(pubUrl, 'Public catalogue address', 'api.js', 'public')); }
    if (auth && typeof auth.endpointUrl === 'function') { authUrl = auth.endpointUrl(); items.push(classifyEndpoint(authUrl, 'Private account address', 'auth.js', 'private')); }
    if (pubUrl && authUrl) {
      var same = pubUrl === authUrl;
      items.push(it(same ? 'fail' : 'ok', 'Two different Apps Script projects', same ? 'api.js and auth.js point at the SAME address. The public and private services must be separate deployments.' : 'The public and private addresses are different, as they must be.',
        same ? 'Put the public project\u2019s /exec URL in api.js and the private project\u2019s /exec URL in auth.js.' : '', 'Addresses in the website files'));
    }
    return Promise.resolve(result(summarise(items, 'website settings and browser'), items));
  }

  /* ================= 2. Website files and data ================= */

  var PAGES = ['index.html', 'practice.html', 'exam.html', 'login.html', 'register.html', 'forgot-password.html', 'dashboard.html', 'history.html', 'bookmarks.html',
    'profile.html', 'help.html', 'contact.html', 'security.html', 'privacy.html', 'terms.html', 'status.html'];
  var ASSETS = ['style.css', 'app.js', 'api.js', 'auth.js', 'exam-api.js', 'online-exam.js', 'student.js', 'status.js', 'theme.js'];

  function probe(path) {
    return root.fetch(path, { method: 'HEAD', cache: 'no-store' }).then(function (r) { return { path: path, status: r.status }; }, function () { return { path: path, status: 0 }; });
  }
  function hexSha256(buf) {
    return root.crypto.subtle.digest('SHA-256', buf).then(function (d) { return Array.prototype.map.call(new Uint8Array(d), function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); });
  }

  function checkShards(manifest, items) {
    var G = 'Question data', subtle = !!(root.crypto && root.crypto.subtle);
    return Promise.all(manifest.shards.map(function (s) {
      var path = 'data/' + String(s && s.path || '');
      var name = String(s && s.id || s && s.path || 'shard').slice(0, 40);
      if (!s || typeof s.path !== 'string' || /\.\.|^\/|:/.test(s.path)) { items.push(it('fail', 'Shard ' + name, 'The manifest lists an unsafe or missing file path.', 'Rebuild with tools/build_release.py and re-export.', G)); return null; }
      return root.fetch(path, { cache: 'no-store' }).then(function (r) {
        if (!r.ok) { items.push(it('fail', 'Shard ' + name, path + ' returned HTTP ' + r.status + '. The manifest lists it but the file is not on the site.', 'Upload the data/papers folder (the file name and folder must match the manifest exactly, including capitals).', G)); return null; }
        return r.arrayBuffer().then(function (buf) {
          var json = null;
          try { json = JSON.parse(new TextDecoder('utf-8').decode(buf)); } catch (e) { items.push(it('fail', 'Shard ' + name, path + ' is not valid JSON.', 'Re-export the data files and upload again.', G)); return null; }
          var n = Array.isArray(json) ? json.length : (json && Array.isArray(json.questions) ? json.questions.length : null);
          var problems = [];
          if (n === null) { problems.push('it has no question list'); }
          else if (typeof s.question_count === 'number' && s.question_count !== n) { problems.push('it holds ' + n + ' questions but the manifest says ' + s.question_count); }
          if (!subtle) {
            items.push(problems.length ? it('fail', 'Shard ' + name, path + ': ' + problems.join('; ') + '.', 'Rebuild with tools/build_release.py and re-export.', G) : it('warn', 'Shard ' + name, 'Valid, but its SHA-256 could not be checked (Web Crypto unavailable).', '', G));
            return null;
          }
          return hexSha256(buf).then(function (h) {
            if (typeof s.sha256 === 'string' && h !== s.sha256.toLowerCase()) { problems.push('its content does not match the SHA-256 in the manifest (the file was edited, or only one of the two was uploaded)'); }
            if (problems.length) { items.push(it('fail', 'Shard ' + name, path + ': ' + problems.join('; ') + '.', 'Upload the manifest and the shard files from the same export, or rebuild with tools/build_release.py then tools/export_public_site.py.', G)); }
            else { items.push(it('ok', 'Shard ' + name, path + ' is valid: ' + n + ' question' + (n === 1 ? '' : 's') + ', digest matches the manifest.', '', G)); }
            return null;
          });
        });
      }, function () { items.push(it('fail', 'Shard ' + name, 'Could not download ' + path + '.', 'Check the file exists on the deployed site and your connection.', G)); return null; });
    }));
  }

  function checkFiles() {
    if (typeof root.fetch !== 'function') { return Promise.resolve(result('This browser cannot run the check.', [it('skip', 'File check', 'fetch is not available.', '', '')], 'skip')); }
    var items = [], G1 = 'Pages', G2 = 'Scripts and styles', G3 = 'Question data';
    var all = PAGES.map(function (p) { return { p: p, g: G1 }; }).concat(ASSETS.map(function (p) { return { p: p, g: G2 }; }));
    return Promise.all(all.map(function (f) { return probe(f.p); })).then(function (rs) {
      [G1, G2].forEach(function (g) {
        var list = rs.filter(function (r, i) { return all[i].g === g; }), bad = list.filter(function (r) { return r.status !== 200; });
        if (!bad.length) { items.push(it('ok', g + ' present', 'All ' + list.length + ' files were found on the deployed site.', '', 'Site files')); }
        else {
          var net = bad.filter(function (b) { return b.status === 0; }).length === bad.length;
          items.push(it('fail', g + ' missing', bad.length + ' of ' + list.length + ' not found: ' + bad.slice(0, 10).map(function (b) { return b.p + (b.status ? ' (HTTP ' + b.status + ')' : ''); }).join(', ') + (bad.length > 10 ? ', \u2026' : '') + '.',
            net ? 'The browser could not reach the site. Check your connection.' : 'These files are not in the GitHub repository root (index.html must sit next to app.js and style.css, not inside a folder), or the Pages deployment has not finished. Upload them and wait for the Pages build to finish.', 'Site files'));
        }
      });
      return root.fetch('data/manifest.json', { cache: 'no-store' }).then(function (r) {
        if (!r.ok) { items.push(it('fail', 'data/manifest.json', 'HTTP ' + r.status + '. The question index is missing, so Official papers cannot load.', 'Upload the data folder (data/manifest.json and data/papers/...).', G3)); return null; }
        return r.json().then(function (m) {
          if (!m || m.schema_version !== 1 || !Array.isArray(m.shards) || !m.shards.length) { items.push(it('fail', 'data/manifest.json', 'The manifest is not valid (no shards listed).', 'Rebuild with tools/build_release.py and re-export.', G3)); return null; }
          var count = m.shards.reduce(function (n, s) { return n + (s && typeof s.question_count === 'number' ? s.question_count : 0); }, 0);
          if (m.placeholder === true) { items.push(it('warn', 'Published questions', 'Only synthetic placeholder data is published (' + count + ' sample question' + (count === 1 ? '' : 's') + ', ' + m.shards.length + ' file' + (m.shards.length === 1 ? '' : 's') + ').', 'Expected until the owner approves real publication. Nothing to fix if this is intentional.', G3)); }
          else { items.push(it('ok', 'Published questions', count + ' questions in ' + m.shards.length + ' shard files.', '', G3)); }
          return checkShards(m, items);
        }, function () { items.push(it('fail', 'data/manifest.json', 'The file is not valid JSON.', 'Rebuild with tools/build_release.py and re-export.', G3)); return null; });
      }, function () { items.push(it('fail', 'data/manifest.json', 'Could not download the manifest.', 'Check the file exists on the deployed site.', G3)); return null; });
    }).then(function () {
      return root.fetch('data/questions.json', { cache: 'no-store' }).then(function (r) {
        if (!r.ok) { items.push(it('warn', 'data/questions.json', 'HTTP ' + r.status + '. The built-in sample bank is missing.', 'Upload data/questions.json (the site falls back to it for practice).', G3)); return null; }
        return r.json().then(function (j) {
          var n = Array.isArray(j) ? j.length : (j && Array.isArray(j.questions) ? j.questions.length : null);
          items.push(n === null ? it('warn', 'data/questions.json', 'The file has no question list.', 'Re-export the data files.', G3) : it('ok', 'data/questions.json', 'Valid (' + n + ' question' + (n === 1 ? '' : 's') + ').', '', G3));
          return null;
        }, function () { items.push(it('warn', 'data/questions.json', 'The file is not valid JSON.', 'Re-export the data files.', G3)); return null; });
      }, function () { return null; /* a network error is already reported above */ });
    }).then(function () {
      var n = tally(items), r = result(summarise(items, 'website files and data'), items);
      /* Only the deliberate placeholder warning: say so plainly instead of "1 warning". */
      if (!n.fail && n.warn === 1 && items.some(function (i) { return i.label === 'Published questions' && i.state === 'warn'; })) { r.summary = 'All files are in place. Only synthetic placeholder questions are published (expected until real publication is approved).'; }
      return r;
    });
  }

  /* ================= 3. Public catalogue ================= */

  var PUBLIC_SERVER = {
    not_configured: ['The catalogue service has no spreadsheet configured.', 'In the public Apps Script project run setupPublicCatalogue(), or set Script Property PUBLIC_DB_ID to the sheet ID.'],
    source_unavailable: ['The catalogue spreadsheet could not be opened.', 'Check PUBLIC_DB_ID in Script Properties holds only the sheet ID and that the script owner can open that sheet.'],
    sheet_missing: ['The Questions_Public tab was not found.', 'Rename the tab to exactly Questions_Public, or run setupPublicCatalogue().'],
    forbidden_columns: ['The sheet contains answer-key or scoring columns, so nothing is published.', 'Remove those columns from the public sheet. They belong only in the private projects.'],
    bad_columns: ['The sheet columns do not match the public schema.', 'Row 1 must contain exactly: id, branch, year, subject, topic, type, marks, text, options_json, source_name.'],
    empty_catalogue: ['The catalogue sheet has no questions.', 'Add rows, or run addPublicCatalogueSampleRow() for a synthetic test row.'],
    too_large: ['The catalogue is larger than the service can publish.', 'Split the catalogue or reduce the rows.'],
    malformed_data: ['Some catalogue rows are invalid, so nothing was published.', 'Fix the rows listed in the details; one bad row blocks everything.'],
    internal_error: ['The catalogue service hit an unexpected error.', 'Open Apps Script > Executions and read the latest error.']
  };

  function urlTestLink(url, which) {
    if (typeof url !== 'string' || !ENDPOINT_RE.test(url)) { return null; }
    return which === 'public'
      ? { href: url + '?op=health', text: 'Open the public address in a new tab (expect JSON containing "ok":true)' }
      : { href: url, text: 'Open the private address in a new tab (expect {"ok":false,"code":"unsupported_method"})' };
  }
  function transportFix(which) {
    var file = which === 'public' ? 'api.js' : 'auth.js';
    return 'Try in order: (1) open the link below in a new tab. A Google sign-in page, "page not found" or an error means the deployment is wrong. (2) In Apps Script > Deploy > Manage deployments the deployment must be a Web app with "Execute as: Me" and "Who has access: Anyone". (3) Copy its Web app URL (ending /exec) into ' + file + ' and commit. (4) Turn off Brave Shields / ad blockers for this site and script.google.com.';
  }

  function publicTransportItem(e, url) {
    var G = 'Connection', code = e && e.code ? e.code : 'connection', link = urlTestLink(url, 'public');
    if (code === 'server_error') {
      var known = PUBLIC_SERVER[e.serverCode];
      return it('fail', 'Public catalogue answered with an error', (known ? known[0] : 'The service reported an error' + (e.serverCode ? ' (' + e.serverCode + ')' : '') + '.') + (e.issues && e.issues.length ? ' Details: ' + e.issues.slice(0, 6).join('; ') + '.' : ''), known ? known[1] : 'Open Apps Script > Executions for details.', G);
    }
    if (code === 'bad_response') { return it('fail', 'Public catalogue reply not understood', 'The service answered, but not in the expected format.', 'Most common causes: (1) an older PublicCatalogue.gs is still deployed: paste the latest file, then Deploy > Manage deployments > Edit > Version: New version. (2) The Script Property PUBLIC_CATALOGUE_PUBLISHED_AT is set while the deployed code uses the old date format; delete that property or update the code.', G, link); }
    if (code === 'timeout') { return it('fail', 'Public catalogue did not answer', 'The script loaded but never answered within 20 seconds. This usually means Google returned a sign-in page, so the deployment is not set to "Who has access: Anyone".', 'Redeploy as Web app, Execute as: Me, access: Anyone. Then press Check again (the first call after a pause can be slow).', G, link); }
    if (code === 'not_configured') { return it('fail', 'Public catalogue not connected', 'The address in api.js is missing or still a placeholder.', 'See the check "Public catalogue address" under Website settings and browser.', G); }
    return it('fail', 'Public catalogue unreachable', 'The browser could not load the service address.', transportFix('public'), G, link);
  }

  function checkPublic() {
    var api = root.GatePublicApi;
    if (!api) {
      return Promise.resolve(result('The public catalogue adapter did not load.', [
        it('fail', 'Public catalogue adapter', 'api.js is unavailable on this page.', 'Check the local api.js asset and reload the page.', 'Connection')
      ]));
    }
    if (!api.isConfigured()) {
      return Promise.resolve(result('The public catalogue endpoint is not configured.', [
        it('fail', 'Public catalogue endpoint', 'The address in api.js is missing or still a placeholder.', 'Set the deployed public catalogue /exec URL in api.js.', 'Connection')
      ]));
    }
    return Promise.resolve(result('Not testable on this page (strict CSP). Check practice.html.', [
      it('skip', 'Public Catalogue', "This page uses script-src 'self'; its policy intentionally blocks the JSONP probe required by Apps Script.", "Open practice.html to perform the public catalogue health check. Do not weaken this page's CSP.", 'Connection')
    ], 'skip'));
  }

  /* ================= 4. Private account service ================= */

  var FEATURES = [['login', 'Login'], ['remember', 'Keep me logged in'], ['register', 'Registration'], ['reset', 'Password reset']];

  function privateTransportItem(e, url) {
    var G = 'Connection', kind = e && e.kind ? e.kind : 'connection', link = urlTestLink(url, 'private');
    if (kind === 'server') {
      if (e.code === 'not_initialized') { return it('fail', 'Private service not initialised', 'Reachable, but its databases are not set up.', 'In the private project run setupPrivateDatabases(), then checkPrivateDatabases().', G); }
      return it('fail', 'Private service returned an error', 'The service answered with the code "' + (e.code || 'unknown') + '"' + (e.reason ? ' (' + e.reason + ')' : '') + '.', 'Open Apps Script > Executions and read the latest error.', G);
    }
    if (kind === 'not_configured') { return it('fail', 'Private service not connected', 'The address in auth.js is missing or still a placeholder.', 'See the check "Private account address" under Website settings and browser.', G); }
    if (kind === 'timeout') { return it('fail', 'Private service did not answer', 'No answer within 25 seconds. Apps Script may be waking up, or the deployment is missing or not set to "Anyone".', 'Press Check again. If it repeats: ' + transportFix('private'), G, link); }
    if (kind === 'bad_response') { return it('fail', 'Private service reply not understood', 'The service answered with something this page does not recognise (for example an HTML error page or the wrong project).', 'Check auth.js points at the PRIVATE project\u2019s /exec URL (not the public one), and that the latest PrivateAuthExam.gs is deployed as a New version.', G, link); }
    return it('fail', 'Private service unreachable', 'The browser could not complete the request.', transportFix('private'), G, link);
  }

  function checkPrivate() {
    var auth = root.GateAuth, items = [];
    if (!auth) { return Promise.resolve(result('auth.js did not load.', [it('fail', 'auth.js', 'The script did not run.', 'Check that status.html includes auth.js and that the file exists (see Website files and data).', 'Connection')])); }
    if (!auth.isConfigured()) { return Promise.resolve(result('Not connected: the address in auth.js is not valid.', [privateTransportItem({ kind: 'not_configured' })])); }
    var url = typeof auth.endpointUrl === 'function' ? auth.endpointUrl() : '', t0 = now(), reached = true;
    return auth.call('auth_status', {}).then(function (r) {
      var s = r.data || {}, G = 'Connection';
      if (s.initialized !== true) { items.push(it('fail', 'Reachable, databases not ready', 'The service answered in ' + secs(t0) + ' but cannot open its databases.', 'See Databases and Script properties below. Usually run setupPrivateDatabases() or correct AUTH_DB_ID.', G)); }
      else { items.push(it('ok', 'Reachable and databases open', 'Answered in ' + secs(t0) + '.', '', G)); }
      FEATURES.forEach(function (f) {
        items.push(it(s[f[0]] === true ? 'ok' : 'warn', f[1], s[f[0]] === true ? 'Enabled.' : 'Switched off. The Approval gates section below names the exact property that is missing.', s[f[0]] === true ? '' : 'Add the missing AUTH_POLICY_* properties and secrets listed under Approval gates and Secrets and settings.', 'Features'));
      });
      items.push(it('info', 'Google sign-in', 'Off by design (owner decision D-14).', '', 'Features'));
    }, function (e) { items.push(privateTransportItem(e, url)); reached = !(e && e.kind && e.kind !== 'server'); })
      .then(function () {
        if (!reached) { return null; }
        return auth.call('diag_status', {}).then(function (r) {
          var d = r.data || {}, checks = cleanChecks(d.checks);
          if (!checks) { items.push(it('warn', 'Deep checks reply not understood', 'The service answered the diagnostics request in an unexpected format.', 'Paste the latest PrivateAuthExam.gs and deploy a New version.', 'Deep checks')); return; }
          var exp = EXPECTED_BUILD['private'], b = String(d.build || '').slice(0, 60);
          items.push(it(b === exp ? 'ok' : 'warn', 'Backend code version', 'The service reports build ' + (b || '(none)') + '; this page expects ' + exp + '.', b === exp ? '' : 'A different build is running. If it is older, paste the latest PrivateAuthExam.gs and Deploy > Manage deployments > Edit > Version: New version.', 'Deep checks'));
          checks.forEach(function (c) { if (!c.group) { c.group = 'Deep checks'; } items.push(c); });
        }, function (e) {
          if (e && e.kind === 'server' && e.code === 'feature_disabled' && e.reason === 'diagnostics_off') { items.push(it('info', 'Deep checks are switched off', 'The service can check every Script Property, secret, sheet ID, tab header and stored account, and report exactly what is wrong. That is off.', 'In the PRIVATE Apps Script project add Script Property STATUS_DIAGNOSTICS = true, then press Check again. Delete the property when finished.', 'Deep checks')); }
          else if (e && e.kind === 'server' && e.code === 'unknown_op') { items.push(it('warn', 'Deployed backend has no deep checks', 'The service does not know the diagnostics request, so an older PrivateAuthExam.gs is deployed.', 'Paste the latest PrivateAuthExam.gs, then Deploy > Manage deployments > Edit > Version: New version.', 'Deep checks')); }
          else { items.push(it('warn', 'Deep checks failed', 'The diagnostics request ended with ' + (e && (e.code || e.kind) || 'an error') + '.', 'Press Check again; if it repeats, open Apps Script > Executions.', 'Deep checks')); }
        });
      }).then(function () { return result(summarise(items, 'private account service'), items); });
  }

  /* ================= 5. Exam service, 6. Backup ================= */

  var EXAM_REASON = {
    question_publication_unapproved: 'Question publication is not approved yet (D-07).',
    mock_composition_unresolved_d12: 'Mock exam composition is not decided yet (D-12).',
    duration_policy_unresolved_d11: 'Duration policy is not decided yet (D-11).'
  };
  function checkExam() {
    return Promise.resolve(result('Private exam/scoring is not checked on this page.', [
      it('skip', 'Private Exam/Scoring', 'Not checked here. Authentication status does not prove EXAM_DB availability or scoring readiness.', 'Use the owner-only backend readiness diagnostics and verify EXAM_DB, key integrity and scoring approval separately.', 'Connection')
    ], 'skip'));
  }

  function checkBackup() {
    return Promise.resolve(result('Cannot be checked from a website: it has no web address by design.', [it('skip', 'Private backup service', 'It is run by the owner only and has no web app.', 'In that project\u2019s editor run checkPrivateBackupSetup() and read the log.', 'Connection')], 'skip'));
  }

  var CHECKS = [
    { id: 'settings', name: 'Website settings and browser', where: 'api.js, auth.js, this browser', run: checkSettings },
    { id: 'data', name: 'Website files and data', where: 'GitHub Pages: pages, scripts, data/manifest.json', run: checkFiles },
    { id: 'public', name: 'Public catalogue service', where: 'Apps Script project 1 (PublicCatalogue.gs)', run: checkPublic },
    { id: 'auth', name: 'Private login / account service', where: 'Apps Script project 2 (PrivateAuthExam.gs)', run: checkPrivate },
    { id: 'exam', name: 'Online exam service', where: 'Apps Script project 2, session operations', run: checkExam },
    { id: 'backup', name: 'Private backup service', where: 'Apps Script project 3 (owner-run, no web app)', run: checkBackup }
  ];

  /* ================= rendering ================= */

  function el(tag, cls, text) { var n = doc.createElement(tag); if (cls) { n.className = cls; } if (text !== undefined) { n.textContent = text; } return n; }
  function clear(n) { while (n.firstChild) { n.removeChild(n.firstChild); } }

  function renderItem(i) {
    var li = el('li', 'check-row'); li.setAttribute('data-state', i.state);
    li.appendChild(el('span', 'check-sym', SYMBOL[i.state] || SYMBOL.info));
    var box = el('div', 'check-box'), head = el('p', 'check-label');
    head.appendChild(el('strong', '', i.label)); head.appendChild(doc.createTextNode(' ')); head.appendChild(el('span', 'check-state', ITEM_LABEL[i.state] || ''));
    box.appendChild(head);
    if (i.detail) { box.appendChild(el('p', 'check-detail', i.detail)); }
    if (i.fix && i.state !== 'ok') {
      var f = el('p', 'status-fix'); f.appendChild(el('strong', '', i.state === 'skip' || i.state === 'info' ? 'To check: ' : 'Fix: ')); f.appendChild(doc.createTextNode(i.fix)); box.appendChild(f);
    }
    if (i.link && /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_\-]+\/exec(\?op=health)?$/.test(i.link.href)) {
      var p = el('p', 'check-link'), a = el('a', '', i.link.text); a.href = i.link.href; a.target = '_blank'; a.rel = 'noopener noreferrer'; p.appendChild(a); box.appendChild(p);
    }
    li.appendChild(box);
    return li;
  }

  function paint(card, r) {
    card.setAttribute('data-state', r.state);
    card.querySelector('.status-badge').textContent = SYMBOL[r.state] + ' ' + LABEL[r.state];
    card.querySelector('.status-dot').textContent = SYMBOL[r.state];
    var body = card.querySelector('.status-body'); clear(body);
    body.appendChild(el('p', 'status-summary', r.summary));
    var problems = r.items.filter(function (i) { return i.state === 'fail'; }), warns = r.items.filter(function (i) { return i.state === 'warn'; });
    if (problems.length || warns.length) {
      var first = problems.concat(warns).slice(0, 4), box = el('div', 'status-first');
      box.appendChild(el('p', 'status-first-title', problems.length ? 'Fix these first' : 'Needs attention'));
      var ol = el('ol', 'status-first-list');
      first.forEach(function (i) { var li = el('li'); li.appendChild(el('strong', '', i.label + ': ')); li.appendChild(doc.createTextNode(i.detail + (i.fix ? ' \u2192 ' + i.fix : ''))); ol.appendChild(li); });
      box.appendChild(ol);
      if (problems.length + warns.length > first.length) { box.appendChild(el('p', 'fine', '+ ' + (problems.length + warns.length - first.length) + ' more in the full list below.')); }
      body.appendChild(box);
    }
    var det = el('details', 'status-checks'); det.open = false;
    det.appendChild(el('summary', '', 'All checks (' + r.items.length + ')'));
    var order = [], groups = {};
    r.items.forEach(function (i) { var g = i.group || 'Checks'; if (!groups[g]) { groups[g] = []; order.push(g); } groups[g].push(i); });
    order.forEach(function (g) {
      det.appendChild(el('h3', 'check-group', g));
      var ul = el('ul', 'check-list'); groups[g].forEach(function (i) { ul.appendChild(renderItem(i)); }); det.appendChild(ul);
    });
    body.appendChild(det);
  }

  function buildCards(list) {
    clear(list);
    CHECKS.forEach(function (c) {
      var li = el('li', 'status-card'); li.id = 'status-' + c.id; li.setAttribute('data-state', 'run');
      var head = el('div', 'status-head'); head.appendChild(el('span', 'status-dot', SYMBOL.run));
      var titles = el('div', 'status-titles'); titles.appendChild(el('h2', 'status-name', c.name)); titles.appendChild(el('p', 'status-where', c.where)); head.appendChild(titles);
      head.appendChild(el('span', 'status-badge', SYMBOL.run + ' ' + LABEL.run)); li.appendChild(head); li.appendChild(el('div', 'status-body')); list.appendChild(li);
    });
  }

  function overall(results) {
    var fail = 0, warn = 0;
    Object.keys(results).forEach(function (k) { var s = results[k].state; if (s === 'fail') { fail++; } else if (s === 'warn') { warn++; } });
    if (fail) { return { state: 'fail', text: fail + ' part' + (fail === 1 ? '' : 's') + ' not working' + (warn ? ', ' + warn + ' need attention' : '') + '. Each red card lists exactly what to fix.' }; }
    if (warn) { return { state: 'warn', text: 'All reachable, but ' + warn + ' need' + (warn === 1 ? 's' : '') + ' attention.' }; }
    return { state: 'ok', text: 'Everything that can be checked is working.' };
  }

  function istStamp(d) { var p = new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(d||new Date()), m={}; p.forEach(function(x){m[x.type]=x.value;}); return m.day+'-'+m.month+'-'+m.year+' '+m.hour+':'+m.minute+':'+m.second+' IST'; }
  function reportText(results) {
    var lines = ['GATE Prep Studio status report', 'Time: ' + istStamp(), 'Page: ' + (root.location ? root.location.href.split('#')[0] : ''), 'Browser: ' + String(root.navigator && root.navigator.userAgent || '').slice(0, 120), ''];
    CHECKS.forEach(function (c) {
      var r = results[c.id]; if (!r) { return; }
      lines.push('## ' + c.name + ' [' + r.state.toUpperCase() + '] ' + r.summary);
      r.items.forEach(function (i) { if (i.state === 'ok') { return; } lines.push('  - [' + i.state + '] ' + (i.group ? i.group + ' / ' : '') + i.label + ': ' + i.detail + (i.fix ? ' FIX: ' + i.fix : '')); });
      lines.push('');
    });
    lines.push('(Only non-OK checks are listed. This report contains no secrets, property values, sheet ids or account data.)');
    return lines.join('\n');
  }

  var running = false;
  function runAll() {
    if (running) { return; }
    running = true;
    var list = doc.getElementById('status-list'), banner = doc.getElementById('status-overall'), btn = doc.getElementById('status-recheck'), when = doc.getElementById('status-time'), rep = doc.getElementById('status-report');
    buildCards(list);
    banner.setAttribute('data-state', 'run'); banner.textContent = SYMBOL.run + ' Running checks\u2026';
    if (btn) { btn.disabled = true; }
    var results = {};
    Promise.all(CHECKS.map(function (c) {
      return c.run().catch(function () { return result('The check itself failed unexpectedly.', [it('fail', c.name, 'The check crashed in the browser.', 'Press Ctrl+F5 and check again; open the console (F12) for details.', '')]); })
        .then(function (r) { results[c.id] = r; paint(doc.getElementById('status-' + c.id), r); });
    })).then(function () {
      var o = overall(results);
      banner.setAttribute('data-state', o.state); banner.textContent = SYMBOL[o.state] + ' ' + o.text;
      if (when) { when.textContent = 'Last checked ' + istStamp(); }
      if (rep) { rep.value = reportText(results); }
      running = false; if (btn) { btn.disabled = false; }
    });
  }

  function copyReport() {
    var rep = doc.getElementById('status-report'), msg = doc.getElementById('status-copied');
    if (!rep || !rep.value) { return; }
    function done(ok) { if (msg) { msg.textContent = ok ? 'Report copied.' : 'Select the text in the box and copy it.'; } }
    if (root.navigator && root.navigator.clipboard && root.navigator.clipboard.writeText) { root.navigator.clipboard.writeText(rep.value).then(function () { done(true); }, function () { rep.select(); done(false); }); }
    else { rep.select(); try { done(doc.execCommand('copy')); } catch (e) { done(false); } }
  }

  function init() {
    var btn = doc.getElementById('status-recheck'), cp = doc.getElementById('status-copy');
    if (btn) { btn.addEventListener('click', runAll); }
    if (cp) { cp.addEventListener('click', copyReport); }
    runAll();
  }

  if (typeof module !== 'undefined' && module.exports) { module.exports = { classifyEndpoint: classifyEndpoint, cleanChecks: cleanChecks, maskId: maskId }; }
  function updateServiceSummaryTime() {
    var node = doc && doc.getElementById('svc-checked');
    if (node) { node.textContent = 'Checked at ' + istStamp() + '.'; }
  }
  if (doc) {
    updateServiceSummaryTime();
    if (doc.readyState === 'loading') {
      doc.addEventListener('DOMContentLoaded', function () { updateServiceSummaryTime(); init(); });
    } else {
      init();
    }
  }
})(typeof window !== 'undefined' ? window : this);
