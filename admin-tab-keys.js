/* admin-tab-keys.js - answer-key source, upload, validation, staging and approval flow. */
(function (root) {
  'use strict';
  var consoleApi = root.GateAdminConsole;
  if (!consoleApi) { return; }
  var H = consoleApi.helpers, gridEnhancer = null;
  var tabApi = {
    setEnhancer: function (fn) { if (typeof fn === 'function') { gridEnhancer = fn; } }
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

    function say(text, state) { ctx.clear(status); ctx.message(status, text, state); }
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
    function clearRows(clearFile) {
      keyRows = []; parseProblems = []; localProblems = []; localValid = false;
      if (clearFile && keyInput) { keyInput.value = ''; }
      if (stageButton) { stageButton.disabled = true; }
      if (validationLine) { validationLine.textContent = 'Choose a key file or type keys, then validate.'; }
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
      if (!selectedPaper || !paperQuestions.length) { localValid = false; validationLine.textContent = 'Choose a registered paper first.'; stageButton.disabled = true; return; }
      var result = ctx.validator.validateKeys(keyRows, toClientQuestions(paperQuestions));
      localProblems = parseProblems.map(function (p) { return { row: p.row, field: p.field, code: p.code }; }).concat(result.problems || []);
      var coverage = result.coverage || { total: paperQuestions.length, keyed: 0, missing: [] };
      coverageLine.textContent = coverage.keyed + ' of ' + coverage.total + ' keyed. Missing question IDs: ' + (coverage.missing.length ? coverage.missing.join(', ') : 'none') + '.';
      validationLine.textContent = localProblems.length ? 'Client validation found ' + localProblems.length + ' problem(s).' : 'Client validation passed. Stage is ready when the source form is complete.';
      drawIssues(localProblems);
      localValid = localProblems.length === 0 && keyRows.length === paperQuestions.length && !!keyRows.length;
      stageButton.disabled = !localValid || !sourceComplete() || busy || !!stagedBatch;
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
      selectedPaper = null; paperQuestions = []; clearRows(true); resetBatch();
      selectedPaper = papers.filter(function (p) { return p.paper_id === paperSelect.value; })[0] || null;
      paperSummary.textContent = selectedPaper ? 'Loading active question metadata for ' + selectedPaper.paper_id + '…' : 'Select a paper.';
      if (!selectedPaper) { if (gridEnhancer && gridEnhancer.render) { gridEnhancer.render([]); } return; }
      ctx.api.questionsIndex({ paper_id: selectedPaper.paper_id }).then(function (r) {
        if (!responseOk(ctx, r)) { throw Object.assign(new Error('Could not load paper question metadata.'), { code: ctx.responseCode(r) }); }
        var d = ctx.responseData(r); paperQuestions = Array.isArray(d.questions) ? d.questions : [];
        paperSummary.textContent = paperQuestions.length + ' active question(s) in this paper. Question text is intentionally not shown here.';
        if (gridEnhancer && gridEnhancer.render) { gridEnhancer.render(paperQuestions); }
        updateActionState();
      }).catch(function (e) { paperQuestions = []; paperSummary.textContent = ctx.plainError(e); say(ctx.plainError(e), 'error'); });
    }
    function parseKeyFile(file) {
      clearRows(false); resetBatch();
      if (!file) { return; }
      var ext = String(file.name || '').toLowerCase(), prom;
      if (/\.xlsx$/.test(ext)) { prom = ctx.xlsx.readXlsx(file, 'keys').then(function (r) { return r.parsed; }); }
      else if (/\.(xlsm|xlsb)$/.test(ext)) { prom = Promise.reject(Object.assign(new Error('Only .xlsx workbooks are accepted.'), { code: 'unsupported_excel_type' })); }
      else { prom = ctx.parser.readFile(file).then(function (text) { return ctx.parser.parseKeys(text, file.name); }); }
      validationLine.textContent = 'Reading key file…';
      prom.then(function (parsed) {
        var rows = Array.isArray(parsed.records) ? parsed.records : [];
        setRows(rows, parsed.problems || []);
        say('Parsed ' + rows.length + ' answer-key row(s). Answer values are not displayed.', (parsed.problems && parsed.problems.length) ? 'error' : 'success');
      }).catch(function (e) { var msg = e && typeof e.message === 'string' && e.message ? e.message : ctx.plainError(e); clearRows(false); validationLine.textContent = msg; say(msg, 'error'); });
    }
    function hashPdf(file) {
      sourceHash = ''; hashLine.textContent = 'No PDF fingerprint calculated.'; updateActionState();
      if (!file) { return; }
      var cryptoApi = root.crypto;
      if (!cryptoApi || !cryptoApi.subtle || typeof cryptoApi.subtle.digest !== 'function') {
        pdfInput.value = ''; say('SHA-256 requires Web Crypto. Open the site over HTTPS in a current browser.', 'error'); return;
      }
      var read;
      if (typeof file.arrayBuffer === 'function') { read = file.arrayBuffer(); }
      else { read = new Promise(function (resolve, reject) {
        if (typeof root.FileReader !== 'function') { reject(new Error('This browser cannot read the PDF locally.')); return; }
        var fr = new root.FileReader(); fr.onload = function () { resolve(fr.result); }; fr.onerror = function () { reject(new Error('Could not read the PDF locally.')); }; fr.readAsArrayBuffer(file);
      }); }
      Promise.resolve(read).then(function (buffer) { return cryptoApi.subtle.digest('SHA-256', buffer); }).then(function (hash) {
        sourceHash = Array.prototype.map.call(new Uint8Array(hash), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
        hashLine.textContent = 'SHA-256 fingerprint: ' + sourceHash.slice(0, 12) + '… (the PDF is not uploaded)';
        pdfInput.value = ''; updateActionState();
      }).catch(function () { sourceHash = ''; pdfInput.value = ''; hashLine.textContent = 'The PDF fingerprint could not be calculated.'; updateActionState(); });
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
      busy = true; updateActionState(); say('Staging answer keys. The answers will be cleared from this page when the request returns…', '');
      ctx.api.stageKeys(batch, rowsToSend, context).then(function (r) {
        var d = ctx.responseData(r), code = ctx.responseCode(r);
        if (code !== 'ok' || (d.errors && d.errors.length)) {
          var err = Object.assign(new Error('Staging did not complete.'), { code: code, data: d, reason: r.reason });
          if (code === 'same_person_blocked') { say('The person entering keys must differ from the independent verifier. Enter another authorised verifier and stage again.', 'error'); }
          else { say(ctx.plainError(err), 'error'); }
          drawIssues(d.errors || []); return;
        }
        stagedBatch = batch; serverValidated = false; batchLine.textContent = 'Staged batch ID: ' + stagedBatch + '. Keep this ID for the approval step.';
        say('Staging succeeded. Validate the saved batch on the server before approval.', 'success');
      }).catch(function (e) {
        if (e && e.code === 'same_person_blocked') { say('The person entering keys must differ from the independent verifier. Enter another authorised verifier and stage again.', 'error'); }
        else { say(ctx.plainError(e), 'error'); }
      }).then(function () {
        /* Never retain answer values after a stage request has returned. */
        rowsToSend = []; keyRows = []; localProblems = []; parseProblems = []; localValid = false;
        if (keyInput) { keyInput.value = ''; }
        if (gridEnhancer && gridEnhancer.clear) { gridEnhancer.clear(); }
        busy = false; updateActionState(); validationLine.textContent = 'Answer values cleared from this page after the stage request.';
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

    panel.appendChild(ctx.el('h4', '', 'Official source and independent verification'));
    var sourceGrid = ctx.el('div', 'admin-form-grid');
    function textField(label, type, max) {
      var wrap = ctx.el('label', 'admin-field'); wrap.appendChild(ctx.el('span', '', label)); var input = ctx.el('input'); input.type = type || 'text'; if (max) { input.maxLength = max; } wrap.appendChild(input); sourceGrid.appendChild(wrap); return input;
    }
    nameInput = textField('Source name', 'text', 200); urlInput = textField('Official answer-key URL', 'url', 500);
    retrievedInput = textField('Retrieved date', 'date'); publishedInput = textField('Published date (if known)', 'date');
    stageSelect = ctx.el('select'); [['final','Final'],['provisional','Provisional'],['unknown','Unknown']].forEach(function (p) { var o = ctx.el('option', '', p[1]); o.value = p[0]; stageSelect.appendChild(o); });
    var stageLabel = ctx.el('label', 'admin-field'); stageLabel.appendChild(ctx.el('span', '', 'Source stage')); stageLabel.appendChild(stageSelect); sourceGrid.appendChild(stageLabel);
    sectionInput = textField('Section (default main)', 'text', 64); sectionInput.value = 'main';
    verifierInput = textField('Independent verifier username or email', 'text', 256);
    var pdfLabel = ctx.el('label', 'admin-field admin-field-wide'); pdfLabel.appendChild(ctx.el('span', '', 'Choose the official answer-key PDF (local fingerprint only)'));
    pdfInput = ctx.el('input'); pdfInput.type = 'file'; pdfInput.accept = '.pdf,application/pdf'; pdfLabel.appendChild(pdfInput); sourceGrid.appendChild(pdfLabel);
    hashLine = ctx.el('p', 'fine admin-field-wide', 'No PDF fingerprint calculated.'); sourceGrid.appendChild(hashLine);
    panel.appendChild(sourceGrid);

    panel.appendChild(ctx.el('h4', '', 'Key rows'));
    modeRow = ctx.el('div', 'admin-mode-toggle'); modeUploadButton = ctx.button('Upload a file', null, 'btn-primary'); modeGridButton = ctx.button('Type the keys', null, 'btn-quiet');
    modeUploadButton.setAttribute('aria-pressed', 'true'); modeGridButton.setAttribute('aria-pressed', 'false'); modeRow.appendChild(modeUploadButton); modeRow.appendChild(modeGridButton); panel.appendChild(modeRow);
    uploadHost = ctx.el('div', 'admin-key-upload'); gridHost = ctx.el('div', 'admin-key-grid-host');
    var fileRow = ctx.el('div', 'admin-form-row'); keyInput = ctx.el('input'); keyInput.type = 'file'; keyInput.accept = '.csv,.json,.xlsx'; keyInput.setAttribute('aria-label', 'Choose answer-key CSV, JSON, or XLSX file'); fileRow.appendChild(keyInput); templateButton = ctx.button('Download template for this paper', function () {
      var ids = paperQuestions.map(function (q) { return q.question_id; });
      try { ctx.downloadText('answer-keys-' + (selectedPaper ? selectedPaper.paper_id : 'template') + '.csv', ctx.spec.keyTemplateCsv(ids), 'text/csv;charset=utf-8'); } catch (e) { say('The browser could not start the template download.', 'error'); }
    }, 'btn-quiet'); fileRow.appendChild(templateButton); uploadHost.appendChild(fileRow); panel.appendChild(uploadHost); panel.appendChild(gridHost); gridHost.hidden = true;
    validationLine = ctx.el('p', 'admin-message', 'Choose a key file or type keys, then validate.'); validationLine.setAttribute('role', 'status'); validationLine.setAttribute('aria-live', 'polite'); panel.appendChild(validationLine);
    coverageLine = ctx.el('p', 'admin-countline'); panel.appendChild(coverageLine);
    issuesBox = ctx.el('div', 'admin-problems'); panel.appendChild(issuesBox);
    var stageActions = ctx.el('div', 'admin-action-row');
    stageButton = ctx.button('Stage keys', stage, 'btn-primary'); stageButton.disabled = true;
    validateButton = ctx.button('Validate staged batch', validateServerBatch, 'btn-quiet'); validateButton.disabled = true;
    approveButton = ctx.button('Approve batch', approve, 'btn-primary'); approveButton.disabled = true;
    stageActions.appendChild(stageButton); stageActions.appendChild(validateButton); stageActions.appendChild(approveButton); panel.appendChild(stageActions);
    batchLine = ctx.el('p', 'admin-countline'); batchLine.setAttribute('aria-live', 'polite'); panel.appendChild(batchLine);

    keyInput.addEventListener('change', function () { parseKeyFile(keyInput.files && keyInput.files[0]); });
    pdfInput.addEventListener('change', function () { hashPdf(pdfInput.files && pdfInput.files[0]); });
    paperSelect.addEventListener('change', loadPaperQuestions);
    [nameInput, urlInput, retrievedInput, publishedInput, stageSelect, sectionInput, verifierInput].forEach(function (input) {
      input.addEventListener('input', updateActionState); input.addEventListener('change', updateActionState);
    });
    function switchMode(mode) {
      uploadHost.hidden = mode !== 'upload'; gridHost.hidden = mode !== 'grid';
      modeUploadButton.setAttribute('aria-pressed', mode === 'upload' ? 'true' : 'false');
      modeGridButton.setAttribute('aria-pressed', mode === 'grid' ? 'true' : 'false');
      modeUploadButton.className = 'btn ' + (mode === 'upload' ? 'btn-primary' : 'btn-quiet');
      modeGridButton.className = 'btn ' + (mode === 'grid' ? 'btn-primary' : 'btn-quiet');
      clearRows(true); resetBatch();
      if (mode === 'grid' && gridEnhancer && gridEnhancer.render) { gridEnhancer.render(paperQuestions); }
    }
    modeUploadButton.addEventListener('click', function () { switchMode('upload'); });
    modeGridButton.addEventListener('click', function () { switchMode('grid'); });
    if (gridEnhancer && typeof gridEnhancer.mount === 'function') {
      gridEnhancer.mount(gridHost, ctx, function () { return paperQuestions; }, function (rows) { setRows(rows, []); }, function (text, state) { validationLine.textContent = text; validationLine.className = 'admin-message' + (state ? ' is-' + state : ''); });
      gridEnhancer.render([]);
    }
    loadPapers();
    /* Expose this callback before user interaction while preserving the single tab registration. */
    tabApi._active = { paperQuestions: function () { return paperQuestions; }, refreshPapers: loadPapers };
  }
  consoleApi.registerTab({ id: 'keys', label: 'Answer keys', mount: mountKeys });
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
