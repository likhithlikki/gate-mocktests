/* admin-tab-health.js - fixed safe readiness report and format-guide helper. */
(function (root) {
  'use strict';
  var consoleApi = root.GateAdminConsole;
  if (!consoleApi) { return; }
  function symbol(state) { return ({ ok: '✓', warn: '!', fail: '✕', off: '○' })[state] || '?'; }
  function word(state) { return ({ ok: 'OK', warn: 'Warning', fail: 'Failed', off: 'Off' })[state] || 'Unknown'; }
  function mountHealth(panel, ctx) {
    var status, cards, lastSections = [];
    function setMessage(text, state) { ctx.clear(status); ctx.message(status, text, state); }
    function statusBadge(state) { return ctx.el('span', 'admin-health-badge state-' + state, symbol(state) + ' ' + word(state)); }
    function renderSections(sections) {
      ctx.clear(cards); lastSections = Array.isArray(sections) ? sections.slice() : [];
      if (!lastSections.length) { cards.appendChild(ctx.el('p', 'fine', 'The server returned no health sections.')); return; }
      lastSections.forEach(function (section) {
        var card = ctx.el('article', 'admin-health-card state-' + String(section.status || 'fail'));
        var head = ctx.el('div', 'admin-health-head'), title = ctx.el('h4', '', section.name || section.id || 'Health section');
        head.appendChild(title); head.appendChild(statusBadge(section.status || 'fail')); card.appendChild(head);
        card.appendChild(ctx.el('p', '', section.detail || 'No detail was returned.'));
        if (section.fix) { var fix = ctx.el('p', 'admin-health-fix'); fix.appendChild(ctx.el('strong', '', 'Fix: ')); fix.appendChild(root.document.createTextNode(String(section.fix))); card.appendChild(fix); }
        if (Array.isArray(section.items) && section.items.length) {
          var items = ctx.el('ul', 'admin-health-items');
          section.items.forEach(function (item) { var li = ctx.el('li'); li.appendChild(ctx.el('span', 'admin-health-badge state-' + String(item.status || 'fail'), symbol(item.status) + ' ' + word(item.status))); li.appendChild(root.document.createTextNode(' ' + String(item.id || 'Check'))); items.appendChild(li); }); card.appendChild(items);
        }
        if (Array.isArray(section.gates) && section.gates.length) {
          var gates = ctx.el('ul', 'admin-health-items');
          section.gates.forEach(function (gate) { var state = gate.state === 'on' ? 'ok' : 'off'; var li = ctx.el('li'); li.appendChild(ctx.el('span', 'admin-health-badge state-' + state, symbol(state) + ' ' + (gate.state === 'on' ? 'On' : 'Off'))); li.appendChild(root.document.createTextNode(' ' + String(gate.name || 'Policy gate'))); gates.appendChild(li); }); card.appendChild(gates);
        }
        cards.appendChild(card);
      });
    }
    function reportText() {
      var lines = ['GATE Prep Studio Admin health report'];
      lastSections.forEach(function (s) {
        lines.push('', (s.name || s.id) + ' [' + word(s.status) + ']');
        if (s.detail) { lines.push('Detail: ' + s.detail); }
        if (s.fix) { lines.push('Fix: ' + s.fix); }
        (Array.isArray(s.items) ? s.items : []).forEach(function (it) { lines.push('- ' + it.id + ': ' + word(it.status)); });
        (Array.isArray(s.gates) ? s.gates : []).forEach(function (g) { lines.push('- ' + g.name + ': ' + (g.state === 'on' ? 'On' : 'Off')); });
      });
      lines.push('', '(Report contains only the health details shown on this page; no account data or property values.)');
      return lines.join('\n');
    }
    function copyText(text, target) {
      function fallback() {
        var area = ctx.el('textarea', 'admin-copy-fallback'); area.value = text; area.rows = 6; area.readOnly = true; area.setAttribute('aria-label', 'Text to copy'); target.appendChild(area); area.focus(); area.select();
        var ok = false; try { ok = !!root.document.execCommand('copy'); } catch (e) { ok = false; }
        if (ok) { area.remove(); ctx.message(target, 'Copied.', 'success'); }
        else { ctx.message(target, 'Select the text above and copy it.', ''); }
      }
      if (root.navigator && root.navigator.clipboard && typeof root.navigator.clipboard.writeText === 'function') {
        root.navigator.clipboard.writeText(text).then(function () { ctx.message(target, 'Copied.', 'success'); }, fallback);
      } else { fallback(); }
    }
    function check() {
      checkButton.disabled = true; setMessage('Checking owner-only backend readiness…', '');
      ctx.api.checks().then(function (r) {
        if (ctx.responseCode(r) !== 'ok') { throw Object.assign(new Error('Health check failed.'), { code: ctx.responseCode(r) }); }
        var d = ctx.responseData(r); renderSections(d.sections || []);
        var fail = lastSections.filter(function (s) { return s.status === 'fail'; }).length;
        var warn = lastSections.filter(function (s) { return s.status === 'warn'; }).length;
        var off = lastSections.filter(function (s) { return s.status === 'off'; }).length;
        setMessage('Checked ' + lastSections.length + ' section(s): ' + fail + ' failed, ' + warn + ' warning(s), ' + off + ' off.', fail ? 'error' : (warn || off ? '' : 'success'));
      }).catch(function (e) { setMessage(ctx.plainError(e), 'error'); renderSections([]); }).then(function () { checkButton.disabled = false; });
    }

    ctx.clear(panel);
    panel.appendChild(ctx.el('h3', '', 'Backend health checks'));
    panel.appendChild(ctx.el('p', 'fine', 'This report is read-only. Detail and fix text are fixed in the code and do not contain Script Property values, sheet IDs, email addresses, or account records.'));
    var controls = ctx.el('div', 'admin-action-row');
    var checkButton = ctx.button('Check now', check, 'btn-primary');
    var copyButton = ctx.button('Copy report', function () { if (!lastSections.length) { setMessage('Run a check before copying a report.', ''); return; } copyText(reportText(), reportCopyStatus); }, 'btn-quiet');
    controls.appendChild(checkButton); controls.appendChild(copyButton); panel.appendChild(controls);
    status = ctx.el('div', 'admin-status-area'); status.setAttribute('aria-live', 'polite'); panel.appendChild(status);
    cards = ctx.el('div', 'admin-health-grid'); panel.appendChild(cards);
    reportCopyStatus = ctx.el('div', 'admin-status-area'); panel.appendChild(reportCopyStatus);

    panel.appendChild(ctx.el('h3', '', 'Still done in Apps Script (by design)'));
    var manual = ctx.el('div', 'admin-manual-list');
    [
      ['Run setupPrivateDatabases() and, when needed, migratePrivateDatabaseHeaders().', 'Creates or reconciles the private authentication, exam and answer-key database tabs without deleting data.'],
      ['Manually set the intended account row users.role to the lowercase word owner.', 'Grants the account access to the owner-only Admin console; the backend checks the role on every protected operation.'],
      ['Set QUESTION_LICENSE_REF to the approved licence/provenance reference.', 'Unlocks question-catalogue import after the owner has configured the licence reference.'],
      ['Set KEY_ROW_MAC_SECRET_V1 to a strong, unique 64-character hexadecimal secret.', 'Enables authenticated integrity protection for approved answer-key rows and key-set digests.'],
      ['Configure KEY_APPROVED_SOURCE_HOSTS and the verified marking profiles in the private project.', 'Allows official answer-key sources and matching year-specific marking profiles to pass server validation.'],
      ['Keep KEY_ALLOW_SAME_ENTERER_VERIFIER unset or false unless an explicit policy exception is approved.', 'Preserves the independent two-person check so the person who enters an answer key cannot approve it.'],
      ['Review policy gates and enable only the features whose policy decision is approved.', 'Unlocks the relevant authentication, question publication, answer review and scoring functions.'],
      ['Deploy a new Apps Script version after replacing PrivateAuthExam.gs and adding AdminOps.gs.', 'Makes the owner-only AdminOps router endpoints available at the existing deployment URL.'],
      ['After setup checks are complete, remove STATUS_DIAGNOSTICS from Script Properties in both projects.', 'Turns off the temporary deep diagnostics report after troubleshooting is finished.'],
      ['Supply SheetJS Community Edition 0.20.x and its real SHA-384 SRI value in admin-xlsx.js.', 'Unlocks optional XLSX reading; without the vendor file the browser fails closed and still supports JSON/CSV.']
    ].forEach(function (item) {
      var row = ctx.el('article', 'admin-manual-item'); row.appendChild(ctx.el('strong', '', item[0])); row.appendChild(ctx.el('p', '', item[1])); manual.appendChild(row);
    });
    panel.appendChild(manual);

    panel.appendChild(ctx.el('h3', '', 'Format guide'));
    var formatDetails = ctx.el('details', 'admin-guide admin-format-guide'); formatDetails.appendChild(ctx.el('summary', '', 'Show accepted files and examples'));
    ctx.spec.FORMAT_GUIDE.forEach(function (entry) {
      var article = ctx.el('article', 'admin-format-entry'); article.appendChild(ctx.el('h4', '', entry.title));
      var list = ctx.el('ul'); entry.lines.forEach(function (line) { list.appendChild(ctx.el('li', '', line)); }); article.appendChild(list);
      var pre = ctx.el('pre', 'admin-example'); pre.textContent = entry.example; article.appendChild(pre);
      article.appendChild(ctx.button('Copy example', function () { copyText(entry.example, formatCopyStatus); }, 'btn-quiet'));
      formatDetails.appendChild(article);
    });
    panel.appendChild(formatDetails);
    formatCopyStatus = ctx.el('div', 'admin-status-area'); panel.appendChild(formatCopyStatus);
  }
  var reportCopyStatus, formatCopyStatus;
  consoleApi.registerTab({ id: 'health', label: 'Health', mount: mountHealth });
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
