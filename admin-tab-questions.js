/* admin-tab-questions.js - local file import, filter, dry-run, and safe summary. */
(function (root) {
  'use strict';
  var consoleApi = root.GateAdminConsole;
  if (!consoleApi) { return; }
  var H = consoleApi.helpers;

  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function keys(map) { return Object.keys(map).sort(function (a, b) { return a.localeCompare(b, undefined, { numeric: true }); }); }
  function downloadGuide(ctx, guide, index) {
    if (index === 0) { ctx.downloadText('questions-example.json', ctx.spec.questionTemplateJson(), 'application/json;charset=utf-8'); }
    else if (index === 1) { ctx.downloadText('questions-template.csv', ctx.spec.questionTemplateCsv(), 'text/csv;charset=utf-8'); }
    else if (index === 2) { ctx.downloadText('answer-keys-template.csv', ctx.spec.keyTemplateCsv([]), 'text/csv;charset=utf-8'); }
    else { ctx.downloadText('answer-key-source-form-example.txt', guide.example, 'text/plain;charset=utf-8'); }
  }
  function countText(map) {
    return keys(map).map(function (k) { return k + ': ' + map[k]; }).join(' · ') || 'None';
  }
  function mountQuestions(panel, ctx) {
    var allRecords = null, parserProblems = [], activeRecords = [], validatedProblems = [], hasValidated = false, importing = false, ticket = 0;
    var fileInput, parseState, filterBox, branchBox, yearBox, dryBox, problemsBox, importButton, validateButton, progressUi, reportButton, fileName, importCount;
    var selectedBranches = Object.create(null), selectedYears = Object.create(null);

    function clearData(clearMessage) {
      ticket++;
      allRecords = null; parserProblems = []; activeRecords = []; validatedProblems = []; hasValidated = false;
      selectedBranches = Object.create(null); selectedYears = Object.create(null);
      ctx.clear(filterBox); ctx.clear(dryBox); ctx.clear(problemsBox);
      if (fileInput) { fileInput.value = ''; }
      if (importButton) { importButton.disabled = true; }
      if (validateButton) { validateButton.disabled = true; }
      if (reportButton) { reportButton.disabled = true; }
      if (progressUi) { progressUi.reset(); }
      if (fileName) { fileName.textContent = ''; }
      if (clearMessage !== false && parseState) { parseState.textContent = 'Choose a JSON, CSV, or XLSX question file to begin.'; parseState.className = 'admin-message'; }
    }
    function clearParsedAfterImport() {
      /* Drop records and selection state without erasing the completed progress or final summary. */
      ticket++; allRecords = null; parserProblems = []; activeRecords = []; validatedProblems = []; hasValidated = false;
      selectedBranches = Object.create(null); selectedYears = Object.create(null);
      ctx.clear(filterBox);
      if (fileInput) { fileInput.value = ''; fileInput.disabled = false; }
      if (importButton) { importButton.disabled = true; }
      if (validateButton) { validateButton.disabled = true; }
      if (reportButton) { reportButton.disabled = true; }
      if (fileName) { fileName.textContent = ''; }
    }
    function formatIssues(list) {
      return list.slice(0, 20).map(function (p) {
        var row = Number(p.row || (p.index !== undefined ? p.index + 1 : 0)) || 0;
        return { row: row, field: String(p.field || ''), code: String(p.code || 'invalid') };
      });
    }
    function currentRecords() {
      if (!Array.isArray(allRecords)) { return []; }
      return allRecords.filter(function (q) {
        var branch = typeof q.branch === 'string' ? q.branch : '';
        var year = q.year === null || q.year === undefined ? '' : String(q.year);
        return (!Object.keys(selectedBranches).length || selectedBranches[branch] === true) &&
          (!Object.keys(selectedYears).length || selectedYears[year] === true);
      });
    }
    function createFilterGroup(title, container, labels, selectedMap) {
      var fieldset = ctx.el('fieldset', 'admin-filter-group');
      fieldset.appendChild(ctx.el('legend', '', title));
      if (!labels.length) { fieldset.appendChild(ctx.el('p', 'fine', 'No values available.')); }
      labels.forEach(function (value) {
        selectedMap[value] = true;
        var label = ctx.el('label', 'admin-check-label');
        var cb = ctx.el('input'); cb.type = 'checkbox'; cb.checked = true; cb.value = value;
        cb.addEventListener('change', function () {
          selectedMap[value] = cb.checked;
          hasValidated = false; validatedProblems = [];
          if (validateButton) { validateButton.disabled = false; }
          if (importButton) { importButton.disabled = true; }
          ctx.clear(dryBox); ctx.clear(problemsBox); refreshSelectedCount();
        });
        label.appendChild(cb); label.appendChild(ctx.el('span', '', value || '(blank)'));
        fieldset.appendChild(label);
      });
      container.appendChild(fieldset);
    }
    function refreshSelectedCount() {
      activeRecords = currentRecords();
      var count = ctx.el('p', 'admin-countline', activeRecords.length + ' question record(s) selected from ' + (allRecords ? allRecords.length : 0) + '.');
      var old = filterBox.querySelector('.admin-countline');
      if (old && old.parentNode) { old.parentNode.replaceChild(count, old); } else { filterBox.appendChild(count); }
    }
    function renderFilters() {
      ctx.clear(filterBox);
      var branches = Object.create(null), years = Object.create(null);
      allRecords.forEach(function (q) {
        if (q && typeof q.branch === 'string') { branches[q.branch] = true; }
        if (q && q.year !== null && q.year !== undefined && q.year !== '') { years[String(q.year)] = true; }
      });
      var groups = ctx.el('div', 'admin-filter-grid');
      createFilterGroup('Branches (include)', branchBox = ctx.el('div', 'admin-filter-scroll'), keys(branches), selectedBranches);
      createFilterGroup('Years (include)', yearBox = ctx.el('div', 'admin-filter-scroll'), keys(years), selectedYears);
      groups.appendChild(branchBox); groups.appendChild(yearBox); filterBox.appendChild(groups);
      var selectRow = ctx.el('div', 'admin-action-row');
      var selectAll = ctx.button('Select all', function () {
        [branchBox, yearBox].forEach(function (box) { Array.prototype.forEach.call(box.querySelectorAll('input[type="checkbox"]'), function (cb) { cb.checked = true; selectedMapSet(box === branchBox ? selectedBranches : selectedYears, cb.value, true); }); });
        hasValidated = false; ctx.clear(dryBox); ctx.clear(problemsBox); if (importButton) { importButton.disabled = true; } refreshSelectedCount();
      }, 'btn-quiet');
      var clearAll = ctx.button('Clear all', function () {
        [branchBox, yearBox].forEach(function (box) { Array.prototype.forEach.call(box.querySelectorAll('input[type="checkbox"]'), function (cb) { cb.checked = false; selectedMapSet(box === branchBox ? selectedBranches : selectedYears, cb.value, false); }); });
        hasValidated = false; ctx.clear(dryBox); ctx.clear(problemsBox); if (importButton) { importButton.disabled = true; } refreshSelectedCount();
      }, 'btn-quiet');
      selectRow.appendChild(selectAll); selectRow.appendChild(clearAll); filterBox.appendChild(selectRow);
      refreshSelectedCount();
    }
    function selectedMapSet(map, key, val) { map[key] = val; }
    function renderProblems(problems) {
      ctx.clear(problemsBox);
      if (!problems.length) { ctx.message(problemsBox, 'No problems found in the selected records.', 'success'); return; }
      ctx.message(problemsBox, problems.length + ' problem(s) found. Showing at most 20; import is disabled until the selected data is clean.', 'error');
      var table = ctx.el('table', 'admin-table'), head = ctx.el('thead'), hr = ctx.el('tr');
      ['Row', 'Field', 'Code'].forEach(function (x) { hr.appendChild(ctx.el('th', '', x)); }); head.appendChild(hr); table.appendChild(head);
      var body = ctx.el('tbody');
      formatIssues(problems).forEach(function (p) { var tr = ctx.el('tr'); [p.row || '—', p.field || '—', p.code].forEach(function (v) { tr.appendChild(ctx.el('td', '', v)); }); body.appendChild(tr); });
      table.appendChild(body); problemsBox.appendChild(table);
    }
    function renderDryReport(vResult, records, parseErrs) {
      ctx.clear(dryBox);
      var summary = vResult && vResult.summary ? vResult.summary : { count: records.length, byYear: {}, byType: {}, byBranch: {} };
      dryBox.appendChild(ctx.el('h3', '', 'Dry-run report'));
      var grid = ctx.el('div', 'admin-summary-grid');
      [[ 'Selected questions', String(summary.count) ], [ 'By year', countText(summary.byYear) ], [ 'By type', countText(summary.byType) ], [ 'By branch', countText(summary.byBranch) ]].forEach(function (pair) {
        var card = ctx.el('div', 'admin-summary-card'); card.appendChild(ctx.el('strong', '', pair[0])); card.appendChild(ctx.el('p', '', pair[1])); grid.appendChild(card);
      });
      dryBox.appendChild(grid);
      var problems = parseErrs.concat((vResult && vResult.problems ? vResult.problems : []).map(function (p) {
        return { row: p.index + 1, field: p.field, code: p.code };
      }));
      validatedProblems = problems; hasValidated = true;
      renderProblems(problems);
      if (validateButton) { validateButton.disabled = false; }
      if (reportButton) { reportButton.disabled = problems.length === 0; }
      if (importButton) { importButton.disabled = problems.length > 0 || !records.length || importing; importButton.textContent = 'Import ' + records.length + ' questions'; }
    }
    function parseChosenFile(file) {
      clearData(false);
      if (!file) { parseState.textContent = 'Choose a JSON, CSV, or XLSX question file to begin.'; return; }
      fileName.textContent = file.name + ' (' + Math.ceil(file.size / 1024) + ' KB)';
      var thisTicket = ticket;
      parseState.textContent = 'Reading and parsing the selected file…'; parseState.className = 'admin-message';
      var ext = String(file.name || '').toLowerCase();
      var parsePromise;
      if (progressUi) { progressUi.update({ phase: 'reading', done: 0, total: file.size, unit: 'bytes', message: 'Reading the selected file' }); }
      function schedulePaint() { return new Promise(function (resolve) { var schedule = typeof root.setTimeout === 'function' ? root.setTimeout.bind(root) : setTimeout; schedule(resolve, 0); }); }
      function reading(p) {
        if (!progressUi || !p || !p.total) { return; }
        if (p.phase === 'parsing') { progressUi.update({ phase: 'parsing', done: p.loaded, total: p.total, unit: 'bytes', message: 'Parsing workbook structure' }); }
        else { progressUi.update({ phase: 'reading', done: p.loaded, total: p.total, unit: 'bytes', message: 'Reading the selected file' }); }
      }
      if (/\.xlsx$/.test(ext)) {
        parsePromise = ctx.xlsx.readXlsx(file, 'questions', reading).then(function (result) { return result.parsed; });
      } else if (/\.(xlsm|xlsb)$/.test(ext)) {
        parsePromise = Promise.reject(Object.assign(new Error('Only .xlsx workbooks are accepted.'), { code: 'unsupported_excel_type' }));
      } else {
        parsePromise = ctx.parser.readFile(file, reading).then(function (text) {
          if (progressUi) { progressUi.update({ phase: 'parsing', done: file.size, total: file.size, unit: 'bytes', message: 'Parsing JSON/CSV structure' }); }
          return schedulePaint().then(function () { return ctx.parser.parseQuestions(text, file.name); });
        });
      }
      parsePromise.then(function (parsed) {
        if (thisTicket !== ticket) { return; }
        allRecords = Array.isArray(parsed.records) ? parsed.records : [];
        parserProblems = Array.isArray(parsed.problems) ? parsed.problems.slice() : [];
        validatedProblems = parserProblems.slice();
        renderFilters();
        if (progressUi) { progressUi.update({ phase: 'reading', done: file.size, total: file.size, unit: 'bytes', message: 'File read and parsed; ready for validation' }); }
        parseState.textContent = 'Parsed as ' + String(parsed.meta && parsed.meta.format || 'unknown') + ': ' + allRecords.length + ' record(s), ' + parserProblems.length + ' structural problem(s).';
        parseState.className = 'admin-message' + (parserProblems.length ? ' is-error' : ' is-success');
        validateButton.disabled = false;
        if (parserProblems.length) { renderProblems(parserProblems); reportButton.disabled = false; }
      }).catch(function (error) {
        if (thisTicket !== ticket) { return; }
        var errorText = error && typeof error.message === 'string' && error.message ? error.message : ctx.plainError(error);
        clearData(false);
        parseState.textContent = errorText + (error && error.code ? ' (' + error.code + ')' : '');
        parseState.className = 'admin-message is-error';
        if (progressUi) { progressUi.update({ phase: 'stopped', done: 0, total: 0, message: errorText }); }
      });
    }

    ctx.clear(panel);
    progressUi = root.GateAdminProgress && typeof root.GateAdminProgress.create === 'function' ? root.GateAdminProgress.create(panel) : null;
    panel.appendChild(ctx.el('h3', '', 'Accepted input and templates'));
    var guide = ctx.el('div', 'admin-guide-grid');
    ctx.spec.FORMAT_GUIDE.forEach(function (entry, index) {
      var details = ctx.el('details', 'admin-guide'); if (index === 0) { details.open = true; }
      details.appendChild(ctx.el('summary', '', entry.title));
      var list = ctx.el('ul'); entry.lines.forEach(function (line) { list.appendChild(ctx.el('li', '', line)); }); details.appendChild(list);
      details.appendChild(ctx.button('Download example', function () { try { downloadGuide(ctx, entry, index); } catch (e) { ctx.message(panel, 'The browser could not start the template download.', 'error'); } }, 'btn-quiet'));
      guide.appendChild(details);
    });
    panel.appendChild(guide);
    panel.appendChild(ctx.el('h3', '', 'Import questions'));
    panel.appendChild(ctx.el('p', 'fine', 'Files are read in this browser and are not saved locally. Review the dry run before importing.'));
    var fileRow = ctx.el('div', 'admin-form-row');
    fileInput = ctx.el('input'); fileInput.type = 'file'; fileInput.accept = '.json,.csv,.xlsx'; fileInput.setAttribute('aria-label', 'Choose questions JSON, CSV, or XLSX file');
    fileName = ctx.el('span', 'fine'); fileRow.appendChild(fileInput); fileRow.appendChild(fileName); panel.appendChild(fileRow);
    parseState = ctx.el('p', 'admin-message', 'Choose a JSON, CSV, or XLSX question file to begin.'); parseState.setAttribute('role', 'status'); parseState.setAttribute('aria-live', 'polite'); panel.appendChild(parseState);
    filterBox = ctx.el('div', 'admin-filter-panel'); panel.appendChild(filterBox);
    var actions = ctx.el('div', 'admin-action-row');
    validateButton = ctx.button('Validate selected records', function () {
      if (importing) { return; }
      activeRecords = currentRecords();
      validateButton.disabled = true; importButton.disabled = true;
      if (progressUi) { progressUi.update({ phase: 'checking', done: 0, total: activeRecords.length, unit: 'questions', message: 'Checking selected records' }); }
      var validateAsync = root.GateAdminProgress && typeof root.GateAdminProgress.validateInSlices === 'function' ?
        root.GateAdminProgress.validateInSlices(activeRecords, ctx.validator, function (p) { if (progressUi) { progressUi.update(p); } }, 500) :
        Promise.resolve(ctx.validator.validateQuestions(activeRecords));
      validateAsync.then(function (val) {
        var parserErrs = parserProblems.map(function (p) { return { row: p.row, field: p.field, code: p.code }; });
        renderDryReport(val, activeRecords, parserErrs);
        if (progressUi) { progressUi.update({ phase: 'checking', done: activeRecords.length, total: activeRecords.length, unit: 'questions', message: parserErrs.length ? 'Validation complete; structural errors remain' : (val.ok ? 'Validation complete; no question-rule errors' : 'Validation complete; review the reported errors') }); }
        parseState.textContent = 'Validation complete: ' + val.problems.length + ' question-rule problem(s), ' + parserErrs.length + ' structural problem(s).';
        parseState.className = 'admin-message' + (val.problems.length || parserErrs.length ? ' is-error' : ' is-success');
      }).catch(function (error) {
        validateButton.disabled = false;
        parseState.textContent = error && error.message ? error.message : ctx.plainError(error);
        parseState.className = 'admin-message is-error';
        if (progressUi) { progressUi.update({ phase: 'stopped', done: 0, total: activeRecords.length, message: 'Validation could not finish' }); }
      });
    }, 'btn-primary'); validateButton.disabled = true;
    importButton = ctx.button('Import 0 questions', function () {
      if (!hasValidated || validatedProblems.length || !activeRecords.length || importing) { return; }
      importing = true; importButton.disabled = true; validateButton.disabled = true; fileInput.disabled = true;
      var unloadGuard = function (event) { event.preventDefault(); event.returnValue = ''; return ''; };
      if (typeof root.addEventListener === 'function') { root.addEventListener('beforeunload', unloadGuard); }
      parseState.textContent = 'Import in progress. Confirmed progress is reported after each server response.';
      if (progressUi) { progressUi.update({ phase: 'uploading', done: 0, total: activeRecords.length, chunk: 0, chunks: 0, retry: 0, inFlight: false }); }
      ctx.api.importQuestions(activeRecords, function (p) {
        if (progressUi) { progressUi.update(p); }
        importCount.textContent = 'Created ' + p.created + ' · updated ' + p.updated + ' · unchanged ' + p.unchanged + ' · issues ' + p.issues;
      }).then(function (result) {
        parseState.textContent = 'Import completed: ' + result.progress.created + ' created, ' + result.progress.updated + ' updated, ' + result.progress.unchanged + ' unchanged.';
        parseState.className = 'admin-message is-success';
        importing = false; clearParsedAfterImport();
      }).catch(function (error) {
        var counts = error && error.progress ? error.progress : { done: 0, total: activeRecords.length };
        var confirmed = Number(counts.done) || 0, total = Number(counts.total) || activeRecords.length;
        var safeMessage = counts.message || ('Stopped after ' + confirmed + ' of ' + total + ' questions received a server acknowledgement. ' + ctx.plainError(error));
        parseState.textContent = safeMessage;
        parseState.className = 'admin-message is-error';
        importing = false; fileInput.disabled = false; validateButton.disabled = false;
        importButton.disabled = !hasValidated || validatedProblems.length > 0 || !activeRecords.length;
        if (progressUi) { progressUi.update({ phase: 'stopped', done: confirmed, total: total, chunk: error && error.progress ? error.progress.chunks : 0, chunks: error && error.progress ? error.progress.chunks : 0, inFlight: false, message: safeMessage, outcome: counts.outcome || 'unknown' }); }
      }).then(function () {
        if (typeof root.removeEventListener === 'function') { root.removeEventListener('beforeunload', unloadGuard); }
      });
    }, 'btn-primary'); importButton.disabled = true;
    reportButton = ctx.button('Download problems as CSV', function () {
      var csv = ['row,field,code'].concat(validatedProblems.map(function (p) { return [p.row || p.index + 1 || '', p.field || '', p.code || ''].map(ctx.csvCell).join(','); })).join('\r\n') + '\r\n';
      try { ctx.downloadText('question-import-problems.csv', csv, 'text/csv;charset=utf-8'); } catch (e) { ctx.message(problemsBox, 'The browser could not start the CSV download.', 'error'); }
    }, 'btn-quiet'); reportButton.disabled = true;
    actions.appendChild(validateButton); actions.appendChild(importButton); actions.appendChild(reportButton); panel.appendChild(actions);
    importCount = ctx.el('p', 'admin-countline', 'Created 0 · updated 0 · unchanged 0 · issues 0'); panel.appendChild(importCount);
    dryBox = ctx.el('div', 'admin-dryrun'); panel.appendChild(dryBox);
    problemsBox = ctx.el('div', 'admin-problems'); panel.appendChild(problemsBox);
    fileInput.addEventListener('change', function () { parseChosenFile(fileInput.files && fileInput.files[0]); });
  }

  consoleApi.registerTab({ id: 'questions', label: 'Questions', mount: mountQuestions });
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
