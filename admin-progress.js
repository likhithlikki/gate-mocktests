/* admin-progress.js - accessible, truthful progress UI for owner question imports. */
(function (root) {
  'use strict';

  function element(doc, tag, className, text) {
    var node = doc.createElement(tag);
    if (className) { node.className = className; }
    if (text !== undefined) { node.textContent = String(text); }
    return node;
  }
  function formatDuration(seconds) {
    seconds = Math.max(0, Math.floor(seconds || 0));
    var minutes = Math.floor(seconds / 60), remainder = seconds % 60;
    return minutes ? minutes + 'm ' + remainder + 's' : remainder + 's';
  }
  function formatBytes(value) {
    if (value < 1024) { return value + ' B'; }
    if (value < 1024 * 1024) { return (value / 1024).toFixed(1) + ' KB'; }
    return (value / (1024 * 1024)).toFixed(1) + ' MB';
  }
  function create(container) {
    var doc = container && container.ownerDocument;
    if (!doc) { throw new Error('A document-backed progress container is required.'); }
    var card = element(doc, 'section', 'admin-progress-card');
    card.setAttribute('aria-label', 'Question import progress');
    var head = element(doc, 'div', 'admin-progress-head');
    var title = element(doc, 'strong', 'admin-progress-title', 'Import progress');
    var percent = element(doc, 'strong', 'admin-progress-percent', '0%');
    head.appendChild(title); head.appendChild(percent);
    var bar = element(doc, 'progress', 'admin-progress'); bar.max = 100; bar.value = 0;
    bar.setAttribute('aria-label', 'Question import progress');
    bar.setAttribute('aria-valuetext', 'Waiting for a file');
    var phase = element(doc, 'p', 'admin-progress-phase', 'Waiting for a file');
    var detail = element(doc, 'p', 'admin-progress-detail', 'Choose a file to begin.');
    var timing = element(doc, 'p', 'admin-progress-timing', 'Elapsed 0s');
    var waitingRow = element(doc, 'p', 'admin-progress-waiting');
    var waitingDot = element(doc, 'span', 'admin-progress-waiting-dot', '●');
    var waitingText = element(doc, 'span', '', 'Waiting for server confirmation…');
    waitingDot.setAttribute('aria-hidden', 'true'); waitingRow.appendChild(waitingDot); waitingRow.appendChild(waitingText);
    waitingRow.hidden = true;
    var retry = element(doc, 'p', 'admin-progress-retry'); retry.hidden = true;
    var live = element(doc, 'p', 'admin-progress-live');
    live.setAttribute('role', 'status'); live.setAttribute('aria-live', 'polite'); live.setAttribute('aria-atomic', 'true');
    card.appendChild(head); card.appendChild(bar); card.appendChild(phase); card.appendChild(detail);
    card.appendChild(timing); card.appendChild(waitingRow); card.appendChild(retry); card.appendChild(live);
    container.insertBefore(card, container.firstChild || null);

    var startedAt = 0, timer = null, lastAnnouncement = 0, lastPhase = '', frozenElapsed = 0, etaBaseSeconds = null, etaAtElapsed = 0;
    function updateElapsed() {
      if (!startedAt) { return; }
      var elapsed = Math.floor((Date.now() - startedAt) / 1000);
      var remaining = etaBaseSeconds === null ? null : Math.max(0, Math.ceil(etaBaseSeconds - Math.max(0, elapsed - etaAtElapsed)));
      timing.textContent = 'Elapsed ' + formatDuration(elapsed) + (remaining === null ? '' : ' · About ' + formatDuration(remaining) + ' remaining');
    }
    function startClock() {
      if (!startedAt) { startedAt = Date.now(); }
      if (!timer && typeof root.setInterval === 'function') { timer = root.setInterval(updateElapsed, 1000); }
    }
    function stopClock() {
      if (timer && typeof root.clearInterval === 'function') { root.clearInterval(timer); timer = null; }
      if (startedAt) { frozenElapsed = Math.floor((Date.now() - startedAt) / 1000); timing.textContent = 'Elapsed ' + formatDuration(frozenElapsed); }
    }
    function announce(message, phaseName, force) {
      var now = Date.now();
      if (force || phaseName !== lastPhase || now - lastAnnouncement >= 3000) {
        live.textContent = message; lastAnnouncement = now; lastPhase = phaseName;
      }
    }
    function reset() {
      stopClock(); startedAt = 0; frozenElapsed = 0; lastAnnouncement = 0; lastPhase = ''; etaBaseSeconds = null; etaAtElapsed = 0;
      percent.textContent = '0%'; bar.max = 100; bar.value = 0; bar.setAttribute('aria-valuetext', 'Waiting for a file');
      phase.textContent = 'Waiting for a file'; detail.textContent = 'Choose a file to begin.';
      timing.textContent = 'Elapsed 0s'; waitingRow.hidden = true; retry.hidden = true; retry.textContent = ''; live.textContent = '';
      card.classList.remove('is-error', 'is-success', 'is-active');
    }
    function update(snapshot) {
      snapshot = snapshot && typeof snapshot === 'object' ? snapshot : {};
      var phaseName = String(snapshot.phase || 'uploading');
      if (phaseName === 'uploading' && lastPhase === 'stopped') { stopClock(); startedAt = 0; frozenElapsed = 0; etaBaseSeconds = null; etaAtElapsed = 0; }
      var done = Number(snapshot.done !== undefined ? snapshot.done : snapshot.value) || 0;
      var total = Number(snapshot.total) || 0;
      var pct = total > 0 ? Math.floor(Math.min(1, Math.max(0, done / total)) * 100) : 0;
      var parsing = phaseName === 'parsing';
      var unit = snapshot.unit === 'bytes' ? 'bytes' : 'questions';
      var message = String(snapshot.message || '');
      if (phaseName === 'done') { pct = 100; }
      else if ((phaseName === 'uploading' || phaseName === 'finishing' || phaseName === 'stopped') && total > 0 && done >= total) { pct = 99; }
      var activePhase = phaseName === 'reading' || phaseName === 'parsing' || phaseName === 'uploading' || phaseName === 'finishing' ||
        (phaseName === 'checking' && !(total > 0 && done >= total));
      if (activePhase) { card.classList.add('is-active'); } else { card.classList.remove('is-active'); }
      if (phaseName === 'reading' || phaseName === 'parsing' || phaseName === 'checking') { startClock(); }
      if (phaseName === 'uploading' || phaseName === 'finishing') { startClock(); }
      percent.textContent = parsing ? '…' : pct + '%'; bar.max = 100;
      if (parsing) { bar.removeAttribute('value'); } else { bar.value = pct; }
      var label = parsing ? 'Parsing file' : phaseName === 'reading' ? 'Reading file' : phaseName === 'checking' ? 'Checking questions' :
        phaseName === 'uploading' ? 'Uploading questions' : phaseName === 'finishing' ? 'Finishing import' :
        phaseName === 'done' ? 'Done' : phaseName === 'stopped' ? 'Stopped' : 'Import progress';
      phase.textContent = label + (message ? ' · ' + message : '');
      if (parsing && unit === 'bytes') {
        detail.textContent = formatBytes(total) + ' read · parsing file structure (no invented percentage)';
      } else if (unit === 'bytes') {
        detail.textContent = formatBytes(done) + ' of ' + formatBytes(total) + ' read';
      } else if (phaseName === 'uploading' || phaseName === 'finishing' || phaseName === 'done' || phaseName === 'stopped') {
        detail.textContent = (snapshot.chunk !== undefined && snapshot.chunks ? 'Chunk ' + snapshot.chunk + ' of ' + snapshot.chunks + ' · ' : '') +
          done.toLocaleString() + ' of ' + total.toLocaleString() + ' questions confirmed';
      } else {
        detail.textContent = done.toLocaleString() + ' of ' + total.toLocaleString() + ' questions checked';
      }
      bar.setAttribute('aria-valuetext', parsing ? detail.textContent : pct + ' percent. ' + detail.textContent);
      waitingRow.hidden = snapshot.inFlight !== true;
      if (snapshot.retry && Number(snapshot.retry) > 1) {
        retry.hidden = false;
        retry.textContent = 'Retrying chunk ' + (snapshot.chunk || '?') + ' (attempt ' + snapshot.retry + ' of ' + (snapshot.maxRetries || 4) + ')…';
      } else { retry.hidden = true; retry.textContent = ''; }
      if (phaseName === 'uploading' && Number(snapshot.completedChunks) >= 2 && Number(snapshot.chunks) > Number(snapshot.completedChunks)) {
        var elapsed = Math.max(1, (Date.now() - startedAt) / 1000);
        var perChunk = elapsed / Number(snapshot.completedChunks);
        etaBaseSeconds = perChunk * (Number(snapshot.chunks) - Number(snapshot.completedChunks));
        etaAtElapsed = elapsed;
      } else if (phaseName !== 'uploading') { etaBaseSeconds = null; etaAtElapsed = 0; }
      if (startedAt) { updateElapsed(); }
      if (phaseName === 'done') { card.classList.remove('is-error', 'is-active'); card.classList.add('is-success'); stopClock(); }
      else if (phaseName === 'stopped') { card.classList.remove('is-success', 'is-active'); card.classList.add('is-error'); stopClock(); }
      else if (phaseName === 'checking' && total > 0 && done >= total) { stopClock(); }
      else { card.classList.remove('is-error', 'is-success'); }
      announce(label + '. ' + detail.textContent + (snapshot.inFlight ? '. Waiting for server confirmation.' : ''), phaseName, false);
    }
    return Object.freeze({ element: card, reset: reset, update: update, dispose: stopClock });
  }

  function validateInSlices(records, validator, onProgress, sliceSize) {
    records = Array.isArray(records) ? records : [];
    if (!validator || typeof validator.validateQuestions !== 'function') { return Promise.reject(new Error('Question validator is unavailable.')); }
    sliceSize = Math.max(1, Math.min(2000, Number(sliceSize) || 500));
    var problems = [], seen = Object.create(null), summary = { count: records.length, byYear: Object.create(null), byType: Object.create(null), byBranch: Object.create(null) };
    function mergeCounts(target, source) {
      Object.keys(source || {}).forEach(function (key) { target[key] = (target[key] || 0) + source[key]; });
    }
    function run(start) {
      if (start >= records.length) { return Promise.resolve({ ok: problems.length === 0, problems: problems, summary: summary }); }
      var end = Math.min(records.length, start + sliceSize), part = records.slice(start, end), result = validator.validateQuestions(part);
      var byIndex = Object.create(null);
      result.problems.forEach(function (problem) {
        var index = Number(problem.index);
        if (!byIndex[index]) { byIndex[index] = []; }
        byIndex[index].push(problem);
      });
      for (var i = 0; i < part.length; i++) {
        var rowProblems = byIndex[i] || [], q = part[i];
        if (q && typeof q === 'object' && !Array.isArray(q) && rowProblems.length === 0 && typeof q.id === 'string') {
          if (seen[q.id]) { rowProblems.push({ index: i, id: q.id, field: 'id', code: 'duplicate_id' }); }
          else { seen[q.id] = true; }
        }
        for (var j = 0; j < rowProblems.length; j++) {
          var p = rowProblems[j];
          problems.push({ index: start + i, id: p.id || '', field: p.field, code: p.code });
        }
      }
      mergeCounts(summary.byYear, result.summary && result.summary.byYear);
      mergeCounts(summary.byType, result.summary && result.summary.byType);
      mergeCounts(summary.byBranch, result.summary && result.summary.byBranch);
      if (typeof onProgress === 'function') {
        try { onProgress({ phase: 'checking', done: end, total: records.length, unit: 'questions', inFlight: false }); } catch (e) { /* progress must not interrupt validation */ }
      }
      if (end >= records.length) { return Promise.resolve({ ok: problems.length === 0, problems: problems, summary: summary }); }
      return new Promise(function (resolve) { root.setTimeout(resolve, 0); }).then(function () { return run(end); });
    }
    return run(0);
  }

  var api = Object.freeze({ create: create, validateInSlices: validateInSlices, formatDuration: formatDuration });
  root.GateAdminProgress = api;
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
