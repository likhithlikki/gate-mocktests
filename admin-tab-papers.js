/* admin-tab-papers.js - paper registry browser for active catalogue questions. */
(function (root) {
  'use strict';
  var consoleApi = root.GateAdminConsole;
  if (!consoleApi) { return; }
  function slug(s) { return String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
  function responseOk(ctx, r) { return !!r && ctx.responseCode(r) === 'ok'; }
  function mountPapers(panel, ctx) {
    var indexQuestions = [], groups = [], selectedGroup = null, selectedIds = [], currentCount = 0, registeredPaperIds = Object.create(null), autoCode = true;
    var status, listBox, branchYear, countLine, registerButton, codeInput, sessionInput, titleInput, paperIdInput, paperCodeHint, paperIdInline, profileSelect, profileHint;
    function tell(text, state) { ctx.clear(status); ctx.message(status, text, state); }
    function renderPaperList(papers) {
      ctx.clear(listBox);
      if (!papers.length) { listBox.appendChild(ctx.el('p', 'fine', 'No active registered papers yet.')); return; }
      var table = ctx.el('table', 'admin-table'), thead = ctx.el('thead'), trh = ctx.el('tr');
      ['Paper ID', 'Title', 'Questions', 'Key state', 'Marking profile'].forEach(function (h) { trh.appendChild(ctx.el('th', '', h)); }); thead.appendChild(trh); table.appendChild(thead);
      var tbody = ctx.el('tbody');
      papers.forEach(function (paper) {
        var tr = ctx.el('tr');
        var profileText = paper.marking_profile_assigned && paper.marking_profile_id ? paper.marking_profile_id + '@' + String(paper.marking_profile_version || '1') : 'Unassigned — blocked';
        [paper.paper_id, paper.title || '—', String(paper.question_count), String(paper.key_state || 'none'), profileText].forEach(function (value, i) {
          var td = ctx.el('td');
          if (i === 3) { var badge = ctx.el('span', 'admin-state-badge state-' + String(value).toLowerCase(), value); td.appendChild(badge); }
          else { td.textContent = value; }
          tr.appendChild(td);
        }); tbody.appendChild(tr);
      });
      table.appendChild(tbody); listBox.appendChild(table);
    }
    function refreshList() {
      tell('Loading registered papers…', '');
      return ctx.api.papersList().then(function (r) {
        if (!responseOk(ctx, r)) { throw Object.assign(new Error('Could not load papers.'), { code: ctx.responseCode(r) }); }
        var d = ctx.responseData(r), paperRows = Array.isArray(d.papers) ? d.papers : [];
        registeredPaperIds = Object.create(null);
        paperRows.forEach(function (paper) { if (paper && typeof paper.paper_id === 'string') { registeredPaperIds[paper.paper_id] = true; } });
        renderPaperList(paperRows); evaluateRegister(); tell('Paper list refreshed.', 'success');
      }).catch(function (e) { tell(ctx.plainError(e), 'error'); });
    }
    function selectedGroupFromValue(value) {
      for (var i = 0; i < groups.length; i++) { if (groups[i].key === value) { return groups[i]; } }
      return null;
    }
    function updateId() {
      var y = selectedGroup ? selectedGroup.year : '';
      var code = slug(codeInput.value);
      paperIdInput.value = y && code ? 'gate-' + y + '-' + code : '';
      var valid = !!paperIdInput.value && ctx.spec.PAPER_ID_RE.test(paperIdInput.value);
      var duplicate = !!(valid && registeredPaperIds[paperIdInput.value]);
      paperIdInput.setAttribute('aria-invalid', valid && !duplicate ? 'false' : 'true');
      paperIdInline.textContent = duplicate ? 'This paper ID is already registered. Change the paper code or session.' : (valid ? 'Paper ID format is valid.' : 'Use lowercase letters and numbers in the paper code to match gate-YYYY-code.');
      paperIdInline.className = 'fine admin-field-wide' + (duplicate || !valid ? ' is-error' : '');
      evaluateRegister();
    }
    function evaluateRegister() {
      var validId = ctx.spec.PAPER_ID_RE.test(paperIdInput.value);
      var uniqueId = !registeredPaperIds[paperIdInput.value];
      var duplicateId = !!(validId && !uniqueId);
      if (paperIdInline) {
        paperIdInline.textContent = duplicateId ? 'This paper ID is already registered. Change the paper code or session.' : (validId ? 'Paper ID format is valid.' : 'Use lowercase letters and numbers in the paper code to match gate-YYYY-code.');
        paperIdInline.className = 'fine admin-field-wide' + (duplicateId || !validId ? ' is-error' : '');
      }
      var validCode = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(codeInput.value.trim());
      var validSession = /^[A-Za-z0-9][A-Za-z0-9._-]{0,15}$/.test(sessionInput.value);
      paperCodeHint.textContent = validCode
        ? 'Paper code is lowercase and hyphen-separated. It includes the session suffix so paper ID remains gate-YYYY-paper_code.'
        : 'Use lowercase letters and digits separated by single hyphens in the paper code (for example cs-1).';
      paperCodeHint.className = 'fine admin-field-wide' + (validCode ? '' : ' is-error');
      registerButton.disabled = !selectedGroup || !selectedIds.length || currentCount > ctx.spec.LIMITS.PAPER_MAX_QUESTIONS ||
        !validId || !uniqueId || !validCode || !validSession || !profileSelect.value || !titleInput.value.trim() || titleInput.value.length > 120;
      if (profileHint) {
        profileHint.textContent = profileSelect.value === 'GATE-2026@1'
          ? 'GATE-2026@1 is the exact existing verified rule set. For a non-2026 paper, selecting it is an explicit owner assignment; no custom rules are invented.'
          : 'Choose a marking profile explicitly. An unassigned profile blocks answer-key validation and exam start.';
      }
      paperIdInput.setAttribute('aria-invalid', validId && uniqueId ? 'false' : 'true');
    }
    function loadGroup() {
      selectedGroup = selectedGroupFromValue(branchYear.value);
      selectedIds = []; currentCount = 0;
      countLine.textContent = selectedGroup ? 'Loading active question IDs…' : 'Choose a branch and year.';
      if (!selectedGroup) { codeInput.value = ''; titleInput.value = ''; paperIdInput.value = ''; evaluateRegister(); return; }
      /* The paper_code embeds the default session suffix so paper_id remains gate-YYYY-paper_code,
       * the invariant used by the existing key-store validation. The branch remains the base code. */
      var codeBase = slug(selectedGroup.branch) || 'branch';
      codeInput.value = codeBase + '-' + sessionInput.value; autoCode = true;
      titleInput.value = 'GATE ' + selectedGroup.year + ' ' + selectedGroup.branch;
      profileSelect.value = selectedGroup.year === 2026 ? 'GATE-2026@1' : '';
      updateId();
      ctx.api.questionsIds({ branch: selectedGroup.branch, year: Number(selectedGroup.year) }).then(function (r) {
        if (!responseOk(ctx, r)) { throw Object.assign(new Error('Could not load question IDs.'), { code: ctx.responseCode(r) }); }
        var d = ctx.responseData(r); selectedIds = Array.isArray(d.ids) ? d.ids.slice() : []; currentCount = selectedIds.length;
        countLine.textContent = currentCount + ' active question(s) selected for this branch and year.' + (currentCount > ctx.spec.LIMITS.PAPER_MAX_QUESTIONS ? ' This exceeds the 200-question paper limit.' : '');
        countLine.className = 'admin-countline' + (currentCount > ctx.spec.LIMITS.PAPER_MAX_QUESTIONS ? ' is-error' : '');
        evaluateRegister();
      }).catch(function (e) { selectedIds = []; currentCount = 0; countLine.textContent = ctx.plainError(e); evaluateRegister(); });
    }

    ctx.clear(panel);
    panel.appendChild(ctx.el('h3', '', 'Registered papers'));
    panel.appendChild(ctx.el('p', 'fine', 'Only active papers are shown. Key-state badges are read-only summaries from the answer-key database.'));
    var refresh = ctx.button('Refresh papers', refreshList, 'btn-quiet'); panel.appendChild(refresh);
    listBox = ctx.el('div', 'admin-table-wrap'); panel.appendChild(listBox);
    status = ctx.el('div', 'admin-status-area'); panel.appendChild(status);
    panel.appendChild(ctx.el('h3', '', 'Create an exam paper'));
    panel.appendChild(ctx.el('p', 'fine', 'A paper includes active questions for one branch and year. Papers are limited to 200 questions.'));
    var form = ctx.el('div', 'admin-form-grid');
    var groupLabel = ctx.el('label', 'admin-field'); groupLabel.appendChild(ctx.el('span', '', 'Branch and year'));
    branchYear = ctx.el('select'); branchYear.setAttribute('aria-label', 'Branch and year');
    var firstOpt = ctx.el('option', '', 'Choose a group'); firstOpt.value = ''; branchYear.appendChild(firstOpt); groupLabel.appendChild(branchYear); form.appendChild(groupLabel);
    var codeLabel = ctx.el('label', 'admin-field'); codeLabel.appendChild(ctx.el('span', '', 'Paper code'));
    codeInput = ctx.el('input'); codeInput.type = 'text'; codeInput.maxLength = 64; codeLabel.appendChild(codeInput); form.appendChild(codeLabel);
    var sessionLabel = ctx.el('label', 'admin-field'); sessionLabel.appendChild(ctx.el('span', '', 'Session (default 1)'));
    sessionInput = ctx.el('input'); sessionInput.type = 'text'; sessionInput.value = '1'; sessionInput.maxLength = 16; sessionLabel.appendChild(sessionInput); form.appendChild(sessionLabel);
    var titleLabel = ctx.el('label', 'admin-field admin-field-wide'); titleLabel.appendChild(ctx.el('span', '', 'Paper title'));
    titleInput = ctx.el('input'); titleInput.type = 'text'; titleInput.maxLength = 120; titleLabel.appendChild(titleInput); form.appendChild(titleLabel);
    var profileLabel = ctx.el('label', 'admin-field admin-field-wide'); profileLabel.appendChild(ctx.el('span', '', 'Marking profile'));
    profileSelect = ctx.el('select'); profileSelect.setAttribute('aria-label', 'Explicit marking profile assignment');
    var profilePlaceholder = ctx.el('option', '', 'Choose a marking profile'); profilePlaceholder.value = ''; profileSelect.appendChild(profilePlaceholder);
    var profileOption = ctx.el('option', '', 'GATE-2026@1 — reuse the verified GATE 2026 rules'); profileOption.value = 'GATE-2026@1'; profileSelect.appendChild(profileOption);
    profileLabel.appendChild(profileSelect); form.appendChild(profileLabel);
    profileHint = ctx.el('p', 'fine admin-field-wide'); profileHint.setAttribute('role', 'status'); profileHint.setAttribute('aria-live', 'polite'); form.appendChild(profileHint);
    var idLabel = ctx.el('label', 'admin-field admin-field-wide'); idLabel.appendChild(ctx.el('span', '', 'Paper ID'));
    paperIdInput = ctx.el('input'); paperIdInput.type = 'text'; paperIdInput.readOnly = true; paperIdInput.maxLength = 64; idLabel.appendChild(paperIdInput); form.appendChild(idLabel);
    paperIdInline = ctx.el('p', 'fine admin-field-wide'); paperIdInline.setAttribute('role', 'status'); paperIdInline.setAttribute('aria-live', 'polite'); form.appendChild(paperIdInline);
    paperCodeHint = ctx.el('p', 'fine admin-field-wide'); form.appendChild(paperCodeHint);
    panel.appendChild(form);
    countLine = ctx.el('p', 'admin-countline', 'Choose a branch and year.'); panel.appendChild(countLine);
    registerButton = ctx.button('Register paper', function () {
      if (registerButton.disabled || !selectedGroup) { return; }
      registerButton.disabled = true; tell('Registering paper…', '');
      var profileParts = profileSelect.value ? profileSelect.value.split('@') : [];
      var request = { paper_id: paperIdInput.value, year: Number(selectedGroup.year), paper_code: codeInput.value.trim(),
        session: sessionInput.value.trim(), title: titleInput.value.trim(), question_ids: selectedIds.slice(),
        marking_profile_id: profileParts[0] || '', marking_profile_version: profileParts[1] || '' };
      ctx.api.registerPaper(request).then(function (r) {
        var d = ctx.responseData(r), code = ctx.responseCode(r);
        if (code !== 'ok' && code !== 'registered' && code !== 'unchanged' && code !== 'membership_completed') {
          var err = Object.assign(new Error('Registration did not complete.'), { code: code }); throw err;
        }
        tell('Paper ' + request.paper_id + ' registered with ' + (d.question_count || currentCount) + ' questions. Now enter answer keys.', 'success');
        return refreshList();
      }).catch(function (e) { tell(ctx.plainError(e), 'error'); }).then(function () { evaluateRegister(); });
    }, 'btn-primary'); registerButton.disabled = true; panel.appendChild(registerButton);
    indexQuestions = [];
    ctx.api.questionsIndex().then(function (r) {
      if (!responseOk(ctx, r)) { throw Object.assign(new Error('Could not load question index.'), { code: ctx.responseCode(r) }); }
      var d = ctx.responseData(r); indexQuestions = Array.isArray(d.questions) ? d.questions : [];
      var gMap = Object.create(null);
      indexQuestions.forEach(function (q) {
        var key = String(q.year) + '::' + String(q.branch || '');
        if (!gMap[key]) { gMap[key] = { key: key, year: Number(q.year), branch: String(q.branch || ''), count: 0 }; }
        gMap[key].count++;
      });
      groups = Object.keys(gMap).map(function (k) { return gMap[k]; }).sort(function (a, b) { return a.year - b.year || a.branch.localeCompare(b.branch); });
      groups.forEach(function (g) { var opt = ctx.el('option', '', g.year + ' · ' + g.branch + ' (' + g.count + ')'); opt.value = g.key; branchYear.appendChild(opt); });
      if (!groups.length) { countLine.textContent = 'No active questions are available for paper registration.'; }
    }).catch(function (e) { tell(ctx.plainError(e), 'error'); });
    branchYear.addEventListener('change', loadGroup);
    profileSelect.addEventListener('change', evaluateRegister);
    codeInput.addEventListener('input', function () { autoCode = false; updateId(); });
    sessionInput.addEventListener('input', function () {
      if (selectedGroup && autoCode) { codeInput.value = (slug(selectedGroup.branch) || 'branch') + '-' + sessionInput.value; }
      updateId(); evaluateRegister();
    });
    titleInput.addEventListener('input', evaluateRegister);
    refreshList();
  }
  consoleApi.registerTab({ id: 'papers', label: 'Papers', mount: mountPapers });
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
