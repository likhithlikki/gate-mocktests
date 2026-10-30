/* admin-tab-keys.js - answer-key source, upload, validation, staging and approval flow. */
(function (root) {
  'use strict';
  var consoleApi = root.GateAdminConsole;
  if (!consoleApi) { return; }
  var H = consoleApi.helpers, gridEnhancer = null;
  var tabApi = {
    setEnhancer: function (fn) {
      if (fn && typeof fn === 'object' || typeof fn === 'function') { gridEnhancer = fn; }
      /* The grid script may finish loading after the tab was mounted: attach it now instead of failing silently. */
      if (tabApi._active && typeof tabApi._active.attachGrid === 'function') { tabApi._active.attachGrid(); }
    }
  };
  root.GateAdminKeysTab = tabApi;

  function responseOk(ctx, r) { return !!r && ctx.responseCode(r) === 'ok'; }
  function randomBatchId() {
    var cryptoApi = root.crypto;
    if (!cryptoApi || typeof cryptoApi.getRandomValues !== 'function') { throw Object.assign(new Error('Secure random generation is unavailable.'), { code: 'crypto_unavailable' }); }
    var bytes = new Uint8Array(16); cryptoApi.getRandomValues(bytes);
    return Array.prototype.map.call(bytes, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }
  function toClientQuestions(items) {
    return items.map(function (q) {
      var ids = Array.isArray(q.option_ids) ? q.option_ids : (Array.isArray(q.options) ? q.options.map(function (o) { return o.id; }) : []);
      return { id: q.question_id, type: q.type, marks: q.marks, options: ids.map(function (id) { return { id: id, text: '' }; }) };
    });
  }
  function mountKeys(panel, ctx) {
    var papers = [], paperQuestions = [], keyRows = [], parseProblems = [], localProblems = [], selectedPaper = null;
    var stagedBatch = '', localValid = false, serverValidated = false, busy = false, sourceHash = '';
    var status, paperSelect, paperSummary, uploadHost, gridHost, modeRow, modeUploadButton, modeGridButton;
    var nameInput, urlInput, retrievedInput, publishedInput, pdfInput, hashLine, stageSelect, sectionInput, verifierInput;
    var keyInput, validationLine, issuesBox, coverageLine, stageButton, validateButton, approveButton, batchLine, templateButton;
    var pdfProgressHost, pdfProgressBar, pdfProgressPercent, pdfProgressPhase, pdfProgressDetail, pdfProgressLive;
    var pdfHashRun = 0;
    var keyCard = null, keyRun = 0, actionLine, stageHint, gridMounted = false, currentMode = 'upload', savedRows = { upload: null, grid: null };
    var DEFAULT_RESULT = 'Choose a key file or type keys, then validate.';

    function say(text, state) {
      ctx.clear(status); ctx.message(status, text, state);
      /* Mirror results next to the action buttons, where the person is looking after clicking. */
      if (actionLine && state) {
        actionLine.hidden = false; actionLine.textContent = text; actionLine.className = 'admin-message is-' + state;
        actionLine.setAttribute('role', state === 'error' ? 'alert' : 'status');
        if (state === 'error') { bringIntoView(actionLine); }
      }
    }
    function bringIntoView(node) {
      try { if (node && typeof node.scrollIntoView === 'function') { node.scrollIntoView({ block: 'center', behavior: 'smooth' }); } } catch (e) { /* cosmetic only */ }
    }
    function showResult(text, state, scroll) {
      validationLine.textContent = text; validationLine.className = 'admin-message' + (state ? ' is-' + state : '');
      validationLine.setAttribute('role', state === 'error' ? 'alert' : 'status');
      if (scroll) { bringIntoView(validationLine); }
    }
    function buildProgressCard(label, firstText) {
      var host = ctx.el('section', 'admin-pdf-progress'); host.hidden = true; host.setAttribute('aria-label', label);
      var head = ctx.el('div', 'admin-pdf-progress-head'), phase = ctx.el('strong', 'admin-pdf-progress-phase', firstText), pct = ctx.el('strong', 'admin-pdf-progress-percent', '0%');
      head.appendChild(phase); head.appendChild(pct); host.appendChild(head);
      var bar = ctx.el('progress', 'admin-pdf-progress-bar'); bar.max = 100; bar.value = 0; bar.setAttribute('aria-label', label); host.appendChild(bar);
      var detail = ctx.el('p', 'admin-pdf-progress-detail'); host.appendChild(detail);
      var live = ctx.el('p', 'admin-pdf-progress-live'); live.setAttribute('role', 'status'); live.setAttribute('aria-live', 'polite'); live.setAttribute('aria-atomic', 'true'); host.appendChild(live);
      return {
        host: host,
        show: function (state, phaseText, pctText, value, detailText) {
          host.hidden = false; host.className = 'admin-pdf-progress' + (state ? ' is-' + state : '');
          phase.textContent = phaseText; pct.textContent = pctText;
          if (value === null || value === undefined) { bar.removeAttribute('value'); } else { bar.value = value; }
          detail.textContent = detailText; live.textContent = phaseText + '. ' + detailText;
        },
        hide: function () { host.hidden = true; }
      };
    }
    function currentUserIds() {
      var out = [];
      try {
        var s = root.GateAuth && typeof root.GateAuth.readSession === 'function' ? root.GateAuth.readSession() : null;
        if (s && typeof s === 'object') {
          ['email', 'username', 'user', 'name', 'login'].forEach(function (k) { if (typeof s[k] === 'string' && s[k]) { out.push(s[k].trim().toLowerCase()); } });
          if (s.user && typeof s.user === 'object') { ['email', 'username', 'name'].forEach(function (k) { if (typeof s.user[k] === 'string' && s.user[k]) { out.push(s.user[k].trim().toLowerCase()); } }); }
        }
      } catch (e) { /* session shape is optional */ }
      return out;
    }
    function stageBlockers() {
      var m = [];
      if (!selectedPaper) { m.push('choose a registered paper'); }
      if (!localValid) {
        if (!keyRows.length) { m.push('load key rows (upload a file, or type keys and press “Use these keys”)'); }
        else if (localProblems.length) { m.push('fix ' + localProblems.length + ' key problem(s)'); }
        else { m.push('key every question (' + keyRows.length + ' of ' + paperQuestions.length + ' keyed)'); }
      }
      if (!(nameInput && nameInput.value.trim())) { m.push('enter the source name'); }
      if (!(urlInput && /^https:\/\//i.test(urlInput.value.trim()))) { m.push('enter an https:// source URL'); }
      if (!(retrievedInput && retrievedInput.value)) { m.push('pick the retrieved date'); }
      if (!(sectionInput && sectionInput.value.trim())) { m.push('enter the section'); }
      if (!/^[A-Fa-f0-9]{64}$/.test(sourceHash)) { m.push('choose the source PDF to create its fingerprint'); }
      if (!(verifierInput && verifierInput.value.trim())) { m.push('enter the independent verifier'); }
      return m;
    }
    function hintText() {
      if (busy) { return 'Working… please wait.'; }
      if (stagedBatch) { return 'A batch is staged. Next: Validate staged batch, then Approve batch.'; }
      var m = stageBlockers();
      if (m.length) { return 'Stage keys is disabled until you: ' + m.join('; ') + '.'; }
      var v = verifierInput.value.trim().toLowerCase();
      if (v && currentUserIds().indexOf(v) !== -1) { return 'Ready to stage, but the verifier looks like your own account. The server will refuse this; use a different authorised verifier.'; }
      return 'Ready to stage.';
    }
    function safeIssues(list) {
      return list.slice(0, 20).map(function (p) { return { row: Number(p.row || (p.index !== undefined ? p.index + 1 : 0)) || 0, field: String(p.field || ''), code: String(p.code || 'invalid') }; });
    }
    function drawIssues(problems) {
      ctx.clear(issuesBox);
      if (!problems.length) { ctx.message(issuesBox, 'No key-file or answer-rule problems found.', 'success'); return; }
      ctx.message(issuesBox, problems.length + ' problem(s). Answers are not shown; only row, field and code are displayed.', 'error');
      var table = ctx.el('table', 'admin-table'), thead = ctx.el('thead'), header = ctx.el('tr');
      ['Row', 'Field', 'Code'].forEach(function (x) { header.appendChild(ctx.el('th', '', x)); }); thead.appendChild(header); table.appendChild(thead);
      var tbody = ctx.el('tbody'); safeIssues(problems).forEach(function (p) {
        var tr = ctx.el('tr'); [p.row || '—', p.field || '—', p.code].forEach(function (v) { tr.appendChild(ctx.el('td', '', v)); }); tbody.appendChild(tr);
      }); table.appendChild(tbody); issuesBox.appendChild(table);
    }
    function clearRows(clearFile, reason) {
      keyRows = []; parseProblems = []; localProblems = []; localValid = false;
      if (clearFile && keyInput) { keyInput.value = ''; }
      if (stageButton) { stageButton.disabled = true; }
      if (validationLine) { showResult(reason || DEFAULT_RESULT, ''); }
      if (coverageLine) { coverageLine.textContent = ''; }
      if (issuesBox) { ctx.clear(issuesBox); }
      if (gridEnhancer && typeof gridEnhancer.clear === 'function') { gridEnhancer.clear(); }
    }
    function resetBatch() {
      stagedBatch = ''; serverValidated = false;
      validateButton.disabled = true; approveButton.disabled = true; batchLine.textContent = '';
    }
    function setRows(rows, structural) {
      keyRows = Array.isArray(rows) ? rows : [];
      parseProblems = Array.isArray(structural) ? structural.slice() : [];
      runLocalValidation();
    }
    function runLocalValidation() {
      if (!selectedPaper || !paperQuestions.length) { localValid = false; showResult('Choose a registered paper first.', 'error', true); updateActionState(); return; }
      var result = ctx.validator.validateKeys(keyRows, toClientQuestions(paperQuestions));
      localProblems = parseProblems.map(function (p) { return { row: p.row, field: p.field, code: p.code }; }).concat(result.problems || []);
      var coverage = result.coverage || { total: paperQuestions.length, keyed: 0, missing: [] };
      coverageLine.textContent = coverage.keyed + ' of ' + coverage.total + ' keyed. Missing question IDs: ' + (coverage.missing.length ? coverage.missing.join(', ') : 'none') + '.';
      drawIssues(localProblems);
      localValid = localProblems.length === 0 && keyRows.length === paperQuestions.length && !!keyRows.length;
      if (localProblems.length) { showResult('Client validation found ' + localProblems.length + ' problem(s). See the table below; only row, field and code are shown.', 'error', true); }
      else if (!keyRows.length) { showResult('No key rows are loaded yet.', '', false); }
      else if (!localValid) { showResult('Only ' + keyRows.length + ' of ' + paperQuestions.length + ' questions are keyed. Key every question before staging.', 'error', true); }
      else { showResult('Client validation passed: ' + keyRows.length + ' of ' + paperQuestions.length + ' keyed, no problems. Stage is ready when the source form is complete.', 'success', true); }
      updateActionState();
    }
    function sourceComplete() {
      return !!(nameInput && nameInput.value.trim() && urlInput && /^https:\/\//i.test(urlInput.value.trim()) &&
        retrievedInput && retrievedInput.value && stageSelect && /^(provisional|final|unknown)$/.test(stageSelect.value) &&
        sectionInput && sectionInput.value.trim() && /^[A-Fa-f0-9]{64}$/.test(sourceHash) && verifierInput && verifierInput.value.trim());
    }
    function updateActionState() {
      stageButton.disabled = !localValid || !sourceComplete() || busy || !!stagedBatch;
      validateButton.disabled = !stagedBatch || busy || serverValidated;
      approveButton.disabled = !stagedBatch || !serverValidated || busy;
      if (stageHint) { stageHint.textContent = hintText(); }
    }
    function renderPaperOptions() {
      ctx.clear(paperSelect);
      var opt = ctx.el('option', '', 'Choose a registered paper'); opt.value = ''; paperSelect.appendChild(opt);
      papers.forEach(function (p) {
        var o = ctx.el('option', '', p.title + ' — ' + p.paper_id + ' (' + p.question_count + ' questions)'); o.value = p.paper_id; paperSelect.appendChild(o);
      });
    }
    function loadPapers() {
      say('Loading registered papers…', '');
      return ctx.api.papersList().then(function (r) {
        if (!responseOk(ctx, r)) { throw Object.assign(new Error('Could not load papers.'), { code: ctx.responseCode(r) }); }
        var d = ctx.responseData(r); papers = Array.isArray(d.papers) ? d.papers : []; renderPaperOptions();
        say(papers.length ? 'Choose the registered paper whose keys will be entered.' : 'No registered papers are available. Register a paper in the Papers tab first.', papers.length ? '' : '');
      }).catch(function (e) { say(ctx.plainError(e), 'error'); });
    }
    function loadPaperQuestions() {
      var hadRows = keyRows.length > 0;
      selectedPaper = null; paperQuestions = []; savedRows = { upload: null, grid: null }; keyCard.hide();
      clearRows(true, hadRows ? 'Paper changed, so the key rows were cleared. Choose a key file or type keys.' : DEFAULT_RESULT); resetBatch();
      selectedPaper = papers.filter(function (p) { return p.paper_id === paperSelect.value; })[0] || null;
      paperSummary.textContent = selectedPaper ? 'Loading active question metadata for ' + selectedPaper.paper_id + '…' : 'Select a paper.';
      if (!selectedPaper) { renderGrid(); updateActionState(); return; }
      ctx.api.questionsIndex({ paper_id: selectedPaper.paper_id }).then(function (r) {
        if (!responseOk(ctx, r)) { throw Object.assign(new Error('Could not load paper question metadata.'), { code: ctx.responseCode(r) }); }
        var d = ctx.responseData(r); paperQuestions = Array.isArray(d.questions) ? d.questions : [];
        paperSummary.textContent = paperQuestions.length + ' active question(s) in this paper. Question text is intentionally not shown here.';
        renderGrid();
        updateActionState();
      }).catch(function (e) { paperQuestions = []; paperSummary.textContent = ctx.plainError(e); say(ctx.plainError(e), 'error'); });
    }
    function parseKeyFile(file) {
      var run = ++keyRun;
      clearRows(false); resetBatch(); savedRows.upload = null;
      if (!file) { keyCard.hide(); return; }
      if (!selectedPaper || !paperQuestions.length) {
        keyInput.value = ''; keyCard.show('error', 'Key file not read', 'Stopped', null, 'Choose a registered paper first, then select the key file again.');
        showResult('Choose a registered paper first, then select the key file again.', 'error', true); say('Choose a registered paper first.', 'error'); return;
      }
      var name = String(file.name || 'key file'), ext = name.toLowerCase(), size = formatPdfBytes(file.size), prom;
      function stale() { return run !== keyRun; }
      keyCard.show('active', 'Reading key file', '…', null, name + ' · ' + size);
      showResult('Reading key file…', '', false);
      if (/\.xlsx$/.test(ext)) {
        keyCard.show('active', 'Reading Excel workbook', '…', null, name + ' · ' + size + '. Workbook reading has no byte-level progress, so no percentage is shown.');
        prom = ctx.xlsx.readXlsx(file, 'keys').then(function (r) { return r.parsed; });
      } else if (/\.(xlsm|xlsb)$/.test(ext)) { prom = Promise.reject(Object.assign(new Error('Only .xlsx workbooks are accepted.'), { code: 'unsupported_excel_type' })); }
      else {
        prom = ctx.parser.readFile(file, function (p) {
          if (stale() || !p || !(Number(p.total) > 0)) { return; }
          var pct = Math.max(0, Math.min(100, Math.floor((Number(p.loaded) / Number(p.total)) * 100)));
          keyCard.show('active', 'Reading key file', pct + '%', pct, formatPdfBytes(p.loaded) + ' of ' + formatPdfBytes(p.total) + ' read');
        }).then(function (text) {
          if (stale()) { return null; }
          keyCard.show('active', 'Parsing key rows', '…', null, name + ' · checking columns and answer syntax');
          return ctx.parser.parseKeys(text, file.name);
        });
      }
      prom.then(function (parsed) {
        if (stale() || !parsed) { return; }
        var rows = Array.isArray(parsed.records) ? parsed.records : [];
        keyCard.show('active', 'Validating against the paper', '…', null, rows.length + ' row(s) parsed');
        setRows(rows, parsed.problems || []);
        var bad = localProblems.length;
        if (!rows.length) { keyCard.show('error', 'No key rows found', 'Stopped', null, name + ' had no usable rows. Check the question_id and answer columns.'); }
        else if (bad) { keyCard.show('error', 'Key file has problems', bad + ' issue(s)', 100, name + ' · ' + rows.length + ' row(s) parsed · fix the listed problems and select the file again.'); }
        else { keyCard.show('success', 'Key file ready', '100%', 100, name + ' · ' + rows.length + ' of ' + paperQuestions.length + ' keyed · answer values are not displayed.'); }
        say('Parsed ' + rows.length + ' answer-key row(s). Answer values are not displayed.', (parsed.problems && parsed.problems.length) || bad ? 'error' : 'success');
        savedRows.upload = { rows: keyRows, problems: parseProblems };
      }).catch(function (e) {
        if (stale()) { return; }
        var msg = e && typeof e.message === 'string' && e.message ? e.message : ctx.plainError(e);
        clearRows(false); showResult(msg, 'error', true); say(msg, 'error');
        keyCard.show('error', 'Key file could not be read', 'Stopped', null, msg);
      }).then(function () {
        /* Always reset the picker so choosing the same file again fires a change event. */
        if (!stale() && keyInput) { keyInput.value = ''; }
      });
    }
    function formatPdfBytes(value) {
      value = Math.max(0, Number(value) || 0);
      if (value < 1024) { return Math.round(value) + ' B'; }
      if (value < 1024 * 1024) { return (value / 1024).toFixed(1) + ' KB'; }
      return (value / (1024 * 1024)).toFixed(1) + ' MB';
    }
    function updatePdfProgress(snapshot, file, runId) {
      if (runId !== pdfHashRun || !pdfProgressHost) { return; }
      snapshot = snapshot || {};
      pdfProgressHost.hidden = false;
      pdfProgressHost.className = 'admin-pdf-progress';
      var phase = String(snapshot.phase || 'reading');
      if (phase === 'reading') {
        pdfProgressHost.classList.add('is-active');
        pdfProgressPhase.textContent = 'Reading PDF locally';
        if (snapshot.indeterminate || !(Number(snapshot.total) > 0)) {
          pdfProgressPercent.textContent = '…'; pdfProgressBar.removeAttribute('value');
          pdfProgressDetail.textContent = 'Reading the selected PDF in this browser. Waiting for file-read progress.';
        } else {
          var loaded = Math.max(0, Number(snapshot.loaded) || 0), total = Math.max(1, Number(snapshot.total) || 1);
          var pct = Math.max(0, Math.min(100, Math.floor((loaded / total) * 100)));
          pdfProgressPercent.textContent = pct + '%'; pdfProgressBar.value = pct;
          pdfProgressDetail.textContent = formatPdfBytes(loaded) + ' of ' + formatPdfBytes(total) + ' read';
        }
      } else if (phase === 'hashing') {
        pdfProgressHost.classList.add('is-active');
        pdfProgressPhase.textContent = 'Calculating SHA-256 fingerprint';
        pdfProgressPercent.textContent = '…'; pdfProgressBar.removeAttribute('value');
        pdfProgressDetail.textContent = 'The browser is calculating the fingerprint. Web Crypto does not expose byte-level hash progress, so no percentage is invented.';
      } else if (phase === 'done') {
        pdfProgressHost.classList.add('is-success');
        pdfProgressPhase.textContent = 'PDF fingerprint created successfully';
        pdfProgressPercent.textContent = '100%'; pdfProgressBar.value = 100;
        pdfProgressDetail.textContent = String(file && file.name || 'Selected PDF') + ' · ' + formatPdfBytes(snapshot.total || snapshot.loaded) + ' · PDF remains on your device; only its SHA-256 fingerprint is recorded.';
      } else if (phase === 'error') {
        pdfProgressHost.classList.add('is-error');
        pdfProgressPhase.textContent = 'PDF fingerprinting stopped';
        pdfProgressPercent.textContent = 'Stopped'; pdfProgressBar.removeAttribute('value');
        pdfProgressDetail.textContent = 'The PDF fingerprint was not created. Correct the issue and select the PDF again.';
      }
      pdfProgressLive.textContent = pdfProgressPhase.textContent + '. ' + pdfProgressDetail.textContent;
    }
    function hashPdf(file) {
      var runId = ++pdfHashRun;
      sourceHash = ''; hashLine.textContent = 'No PDF fingerprint calculated.'; updateActionState();
      if (!file) { if (pdfProgressHost) { pdfProgressHost.hidden = true; } return; }
      if (!root.GateAdminPdfFingerprint || typeof root.GateAdminPdfFingerprint.compute !== 'function') {
        pdfInput.value = ''; say('The local PDF fingerprint module did not load. Refresh the page and try again.', 'error'); return;
      }
      if (pdfProgressHost) {
        pdfProgressHost.hidden = false;
        updatePdfProgress({ phase: 'reading', loaded: 0, total: Number(file.size) || 0, indeterminate: !(Number(file.size) > 0) }, file, runId);
      }
      say('Reading the PDF locally and preparing its SHA-256 fingerprint…', '');
      root.GateAdminPdfFingerprint.compute(file, root.crypto, root.FileReader, function (snapshot) {
        updatePdfProgress(snapshot, file, runId);
      }).then(function (result) {
        if (runId !== pdfHashRun) { return; }
        sourceHash = result.sha256;
        hashLine.textContent = 'SHA-256 fingerprint: ' + sourceHash.slice(0, 12) + '… (the PDF is not uploaded)';
        pdfInput.value = ''; updateActionState();
        say('PDF fingerprint created successfully for ' + result.name + '. The PDF was read locally and was not uploaded.', 'success');
      }).catch(function (error) {
        if (runId !== pdfHashRun) { return; }
        sourceHash = ''; pdfInput.value = ''; hashLine.textContent = 'The PDF fingerprint could not be calculated.'; updateActionState();
        var message = error && typeof error.message === 'string' && error.message ? error.message : 'The PDF fingerprint could not be calculated.';
        updatePdfProgress({ phase: 'error' }, file, runId);
        say(message, 'error');
      });
    }
    function stage() {
      if (!localValid || !sourceComplete() || busy) { return; }
      var batch;
      try { batch = randomBatchId(); } catch (e) { say(ctx.plainError(e), 'error'); return; }
      var rowsToSend = keyRows.map(function (r) { return { question_id: r.question_id, answer: r.answer }; });
      var context = { paper_id: selectedPaper.paper_id, verified_by: verifierInput.value.trim(), source: {
        name: nameInput.value.trim(), url: urlInput.value.trim(), sha256: sourceHash,
        retrieved_at: retrievedInput.value, published_at: publishedInput.value || '', stage: stageSelect.value,
        section: sectionInput.value.trim()
      } };
      var outcome = { text: '', state: '' };
      busy = true; updateActionState(); say('Staging answer keys. The answers will be cleared from this page when the request returns…', '');
      showResult('Staging answer keys…', '', false);
      ctx.api.stageKeys(batch, rowsToSend, context).then(function (r) {
        var d = ctx.responseData(r), code = ctx.responseCode(r);
        if (code !== 'ok' || (d.errors && d.errors.length)) {
          var err = Object.assign(new Error('Staging did not complete.'), { code: code, data: d, reason: r.reason });
          if (code === 'same_person_blocked') { outcome.text = 'The person entering keys must differ from the independent verifier. Enter another authorised verifier and stage again.'; }
          else { outcome.text = ctx.plainError(err); }
          outcome.state = 'error'; say(outcome.text, 'error');
          drawIssues(d.errors || []); return;
        }
        outcome.state = 'success'; stagedBatch = batch; serverValidated = false; batchLine.textContent = 'Staged batch ID: ' + stagedBatch + '. Keep this ID for the approval step.';
        say('Staging succeeded. Validate the saved batch on the server before approval.', 'success');
      }).catch(function (e) {
        if (e && e.code === 'same_person_blocked') { outcome.text = 'The person entering keys must differ from the independent verifier. Enter another authorised verifier and stage again.'; }
        else { outcome.text = ctx.plainError(e); }
        outcome.state = 'error'; say(outcome.text, 'error');
      }).then(function () {
        /* Never retain answer values after a stage request has returned. */
        rowsToSend = []; keyRows = []; localProblems = []; parseProblems = []; localValid = false;
        if (keyInput) { keyInput.value = ''; }
        if (gridEnhancer && gridEnhancer.clear) { gridEnhancer.clear(); }
        savedRows = { upload: null, grid: null }; keyCard.hide();
        busy = false; renderGrid(); updateActionState();
        if (outcome.state === 'success') { showResult('Staged. Answer values were cleared from this page. Next: Validate staged batch.', 'success', true); }
        else { showResult((outcome.text || 'Staging did not complete.') + ' Answer values were cleared for safety, so select the key file again (or re-enter the keys) before staging.', 'error', true); }
      });
    }
    function validateServerBatch() {
      if (!stagedBatch || busy) { return; }
      busy = true; updateActionState(); say('Validating the staged batch against server rules…', '');
      ctx.api.validateKeys(stagedBatch).then(function (r) {
        var d = ctx.responseData(r), code = ctx.responseCode(r);
        if (code !== 'ok' || (d.errors && d.errors.length)) {
          serverValidated = false; drawIssues(d.errors || []); say(ctx.plainError({ code: code, reason: r.reason }), 'error'); return;
        }
        serverValidated = true; say('Server validation passed. A different authorised owner must approve this batch.', 'success');
      }).catch(function (e) { serverValidated = false; say(ctx.plainError(e), 'error'); }).then(function () { busy = false; updateActionState(); });
    }
    function approve() {
      if (!stagedBatch || !serverValidated || busy) { return; }
      var typed = typeof root.prompt === 'function' ? root.prompt('Type the batch ID to confirm approval: ' + stagedBatch) : '';
      if (typed !== stagedBatch) { say('Approval cancelled. The batch ID did not match.', ''); return; }
      busy = true; updateActionState(); say('Requesting approval…', '');
      ctx.api.approveKeys(stagedBatch).then(function (r) {
        var d = ctx.responseData(r), code = ctx.responseCode(r);
        if (code !== 'ok' || (d.errors && d.errors.length)) {
          var err = { code: code, reason: r.reason };
          if (code === 'same_person_blocked') { say('A different authorised owner must approve the batch. The enterer cannot approve their own keys.', 'error'); }
          else { say(ctx.plainError(err), 'error'); }
          drawIssues(d.errors || []); return;
        }
        say('Answer-key batch approved. The key set is now available to the scoring service when its policy gates are enabled.', 'success');
        serverValidated = false; stagedBatch = ''; batchLine.textContent = 'Approved batch. Start a new key set to enter another paper.'; loadPapers();
      }).catch(function (e) { say(ctx.plainError(e), 'error'); }).then(function () { busy = false; updateActionState(); });
    }

    ctx.clear(panel);
    panel.appendChild(ctx.el('h3', '', 'Answer keys: stage, validate, approve'));
    panel.appendChild(ctx.el('p', 'fine', 'Answer values are never printed in reports and are cleared from browser memory after a staging request. The official PDF is fingerprinted locally and is not uploaded.'));
    status = ctx.el('div', 'admin-status-area'); panel.appendChild(status);
    var steps = ctx.el('ol', 'admin-key-flow');
    ['Choose a registered paper', 'Record the official source and independent verifier', 'Choose a key file or type the keys', 'Run client-side validation', 'Stage, validate on the server, then approve'].forEach(function (step) { steps.appendChild(ctx.el('li', '', step)); });
    panel.appendChild(steps);
    var paperLabel = ctx.el('label', 'admin-field'); paperLabel.appendChild(ctx.el('span', '', 'Registered paper'));
    paperSelect = ctx.el('select'); paperSelect.setAttribute('aria-label', 'Registered paper'); paperLabel.appendChild(paperSelect); panel.appendChild(paperLabel);
    paperSummary = ctx.el('p', 'admin-countline', 'Select a paper.'); panel.appendChild(paperSummary);

    panel.appendChild(ctx.el('h4', '', 'Source details and independent verification'));
    var sourceGrid = ctx.el('div', 'admin-form-grid');
    function textField(label, type, max) {
      var wrap = ctx.el('label', 'admin-field'); wrap.appendChild(ctx.el('span', '', label)); var input = ctx.el('input'); input.type = type || 'text'; if (max) { input.maxLength = max; } wrap.appendChild(input); sourceGrid.appendChild(wrap); return input;
    }
    nameInput = textField('Source name', 'text', 200); urlInput = textField('Source document URL (HTTPS)', 'url', 500);
    retrievedInput = textField('Retrieved date', 'date'); publishedInput = textField('Published date (if known)', 'date');
    stageSelect = ctx.el('select'); [['final','Final'],['provisional','Provisional'],['unknown','Unknown']].forEach(function (p) { var o = ctx.el('option', '', p[1]); o.value = p[0]; stageSelect.appendChild(o); });
    var stageLabel = ctx.el('label', 'admin-field'); stageLabel.appendChild(ctx.el('span', '', 'Source stage')); stageLabel.appendChild(stageSelect); sourceGrid.appendChild(stageLabel);
    sectionInput = textField('Section (default main)', 'text', 64); sectionInput.value = 'main';
    verifierInput = textField('Independent verifier username or email', 'text', 256);
    var pdfLabel = ctx.el('label', 'admin-field admin-field-wide'); pdfLabel.appendChild(ctx.el('span', '', 'Choose the source PDF (local SHA-256 fingerprint only)'));
    pdfInput = ctx.el('input'); pdfInput.type = 'file'; pdfInput.accept = '.pdf,application/pdf'; pdfLabel.appendChild(pdfInput); sourceGrid.appendChild(pdfLabel);
    pdfProgressHost = ctx.el('section', 'admin-pdf-progress'); pdfProgressHost.hidden = true; pdfProgressHost.setAttribute('aria-label', 'PDF fingerprint progress');
    var pdfProgressHead = ctx.el('div', 'admin-pdf-progress-head');
    pdfProgressPhase = ctx.el('strong', 'admin-pdf-progress-phase', 'Reading PDF locally');
    pdfProgressPercent = ctx.el('strong', 'admin-pdf-progress-percent', '0%');
    pdfProgressHead.appendChild(pdfProgressPhase); pdfProgressHead.appendChild(pdfProgressPercent); pdfProgressHost.appendChild(pdfProgressHead);
    pdfProgressBar = ctx.el('progress', 'admin-pdf-progress-bar'); pdfProgressBar.max = 100; pdfProgressBar.value = 0; pdfProgressBar.setAttribute('aria-label', 'PDF fingerprint progress'); pdfProgressHost.appendChild(pdfProgressBar);
    pdfProgressDetail = ctx.el('p', 'admin-pdf-progress-detail', 'The PDF is read locally and is not uploaded.'); pdfProgressHost.appendChild(pdfProgressDetail);
    pdfProgressLive = ctx.el('p', 'admin-pdf-progress-live'); pdfProgressLive.setAttribute('role', 'status'); pdfProgressLive.setAttribute('aria-live', 'polite'); pdfProgressLive.setAttribute('aria-atomic', 'true'); pdfProgressHost.appendChild(pdfProgressLive);
    sourceGrid.appendChild(pdfProgressHost);
    hashLine = ctx.el('p', 'fine admin-field-wide', 'No PDF fingerprint calculated.'); sourceGrid.appendChild(hashLine);
    panel.appendChild(sourceGrid);

    panel.appendChild(ctx.el('h4', '', 'Key rows'));
    modeRow = ctx.el('div', 'admin-mode-toggle'); modeUploadButton = ctx.button('Upload a file', null, 'btn-primary'); modeGridButton = ctx.button('Type the keys', null, 'btn-quiet');
    modeUploadButton.setAttribute('aria-pressed', 'true'); modeGridButton.setAttribute('aria-pressed', 'false'); modeRow.appendChild(modeUploadButton); modeRow.appendChild(modeGridButton); panel.appendChild(modeRow);
    uploadHost = ctx.el('div', 'admin-key-upload'); gridHost = ctx.el('div', 'admin-key-grid-host');
    var fileRow = ctx.el('div', 'admin-form-row'); keyInput = ctx.el('input'); keyInput.type = 'file'; keyInput.accept = '.csv,.json,.xlsx'; keyInput.setAttribute('aria-label', 'Choose answer-key CSV, JSON, or XLSX file'); fileRow.appendChild(keyInput); templateButton = ctx.button('Download template for this paper', function () {
      var ids = paperQuestions.map(function (q) { return q.question_id; });
      try { ctx.downloadText('answer-keys-' + (selectedPaper ? selectedPaper.paper_id : 'template') + '.csv', ctx.spec.keyTemplateCsv(ids), 'text/csv;charset=utf-8'); } catch (e) { say('The browser could not start the template download.', 'error'); }
    }, 'btn-quiet'); fileRow.appendChild(templateButton); uploadHost.appendChild(fileRow);
    keyCard = buildProgressCard('Answer-key file progress', 'Reading key file'); uploadHost.appendChild(keyCard.host); panel.appendChild(uploadHost); panel.appendChild(gridHost); gridHost.hidden = true;
    validationLine = ctx.el('p', 'admin-message', DEFAULT_RESULT); validationLine.setAttribute('role', 'status'); validationLine.setAttribute('aria-live', 'polite'); panel.appendChild(validationLine);
    coverageLine = ctx.el('p', 'admin-countline'); panel.appendChild(coverageLine);
    issuesBox = ctx.el('div', 'admin-problems'); panel.appendChild(issuesBox);
    var stageActions = ctx.el('div', 'admin-action-row');
    stageButton = ctx.button('Stage keys', stage, 'btn-primary'); stageButton.disabled = true;
    validateButton = ctx.button('Validate staged batch', validateServerBatch, 'btn-quiet'); validateButton.disabled = true;
    approveButton = ctx.button('Approve batch', approve, 'btn-primary'); approveButton.disabled = true;
    stageActions.appendChild(stageButton); stageActions.appendChild(validateButton); stageActions.appendChild(approveButton); panel.appendChild(stageActions);
    stageHint = ctx.el('p', 'fine admin-stage-hint', 'Stage keys is disabled until you choose a paper, load key rows and complete the source form.'); stageHint.setAttribute('role', 'status'); stageHint.setAttribute('aria-live', 'polite'); panel.appendChild(stageHint);
    actionLine = ctx.el('p', 'admin-message'); actionLine.setAttribute('role', 'status'); actionLine.setAttribute('aria-live', 'polite'); actionLine.hidden = true; panel.appendChild(actionLine);
    batchLine = ctx.el('p', 'admin-countline'); batchLine.setAttribute('aria-live', 'polite'); panel.appendChild(batchLine);

    keyInput.addEventListener('change', function () { parseKeyFile(keyInput.files && keyInput.files[0]); });
    pdfInput.addEventListener('change', function () { hashPdf(pdfInput.files && pdfInput.files[0]); });
    paperSelect.addEventListener('change', loadPaperQuestions);
    [nameInput, urlInput, retrievedInput, publishedInput, stageSelect, sectionInput, verifierInput].forEach(function (input) {
      input.addEventListener('input', updateActionState); input.addEventListener('change', updateActionState);
    });
    /* ---- manual grid wiring: never fail silently ---- */
    function gridReady() { return !!(gridEnhancer && typeof gridEnhancer.mount === 'function' && typeof gridEnhancer.render === 'function'); }
    function showGridUnavailable() {
      ctx.clear(gridHost);
      ctx.message(gridHost, 'The manual key grid did not load (admin-tab-keygrid.js is missing or outdated). Refresh the page with Ctrl+F5, or use “Upload a file” instead.', 'error');
    }
    function attachGrid() {
      if (gridMounted || !gridReady() || !gridHost) { return gridMounted; }
      gridEnhancer.mount(gridHost, ctx, function () { return paperQuestions; }, function (rows) { setRows(rows, []); savedRows.grid = { rows: keyRows, problems: parseProblems }; },
        function (text, state) { showResult(text, state, true); });
      gridMounted = true; gridEnhancer.render(paperQuestions);
      return true;
    }
    function renderGrid() {
      if (!gridMounted) { attachGrid(); return; }
      if (gridEnhancer && typeof gridEnhancer.render === 'function') { gridEnhancer.render(paperQuestions); }
    }
    function switchMode(mode) {
      if (mode === currentMode) { return; }
      savedRows[currentMode] = { rows: keyRows, problems: parseProblems };
      currentMode = mode;
      uploadHost.hidden = mode !== 'upload'; gridHost.hidden = mode !== 'grid';
      modeUploadButton.setAttribute('aria-pressed', mode === 'upload' ? 'true' : 'false');
      modeGridButton.setAttribute('aria-pressed', mode === 'grid' ? 'true' : 'false');
      modeUploadButton.className = 'btn ' + (mode === 'upload' ? 'btn-primary' : 'btn-quiet');
      modeGridButton.className = 'btn ' + (mode === 'grid' ? 'btn-primary' : 'btn-quiet');
      if (mode === 'grid') {
        if (!attachGrid() && !gridMounted) { showGridUnavailable(); say('The manual key grid did not load. Refresh the page or upload a file.', 'error'); }
        else if (gridMounted && !gridHost.firstChild) { renderGrid(); }
      }
      /* Each mode keeps its own rows, so switching never destroys work. */
      var kept = savedRows[mode];
      keyRows = kept ? kept.rows : []; parseProblems = kept ? kept.problems : []; localProblems = []; localValid = false;
      if (coverageLine) { coverageLine.textContent = ''; }
      if (issuesBox) { ctx.clear(issuesBox); }
      if (keyRows.length) { runLocalValidation(); }
      else {
        showResult(mode === 'grid' ? 'Select the answers below, then press “Use these keys”.' : DEFAULT_RESULT, '', false);
        updateActionState();
      }
    }
    modeUploadButton.addEventListener('click', function () { switchMode('upload'); });
    modeGridButton.addEventListener('click', function () { switchMode('grid'); });
    attachGrid();
    updateActionState();
    loadPapers();
    /* Expose this callback before user interaction while preserving the single tab registration. */
    tabApi._active = { paperQuestions: function () { return paperQuestions; }, refreshPapers: loadPapers, attachGrid: function () { attachGrid(); renderGrid(); } };
  }
  consoleApi.registerTab({ id: 'keys', label: 'Answer keys', mount: mountKeys });
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
