/* admin-api.js - owner-console adapter for the Admin API contract.
 * Never logs payloads, imported records, answers, or session tokens. */
(function (root) {
  'use strict';
  var SPEC = root.GateAdminSpec;
  if (!SPEC && typeof require === 'function') { try { SPEC = require('./admin-spec.js'); } catch (e) { SPEC = null; } }
  var MAX_CHUNK_QUESTIONS = SPEC && SPEC.LIMITS ? SPEC.LIMITS.CHUNK_MAX_QUESTIONS : 200;
  var MAX_CHUNK_JSON_CHARS = 600000;
  var MAX_RETRIES = 3;

  /* Contract operation names. The bundled backend currently needs matching authenticated router handlers. */
  var OPS = Object.freeze({
    whoami: 'admin_whoami',
    checks: 'admin_checks',
    questionsIndex: 'admin_questions_index',
    questionsIds: 'admin_questions_ids',
    papersList: 'admin_papers_list',
    registerPaper: 'admin_paper_register',
    stageKeys: 'admin_keys_stage',
    validateKeys: 'admin_keys_validate',
    approveKeys: 'admin_keys_approve',
    importChunk: 'admin_import_questions_chunk',
    importFinish: 'admin_import_finish',
    flowCheck: 'admin_flow_check',
    gatesGet: 'admin_gates_get',
    gatesSet: 'admin_gates_set',
    rehearsalPreview: 'admin_rehearsal_preview',
    rehearsalAttemptStart: 'admin_rehearsal_attempt_start',
    rehearsalAttemptSubmit: 'admin_rehearsal_attempt_submit',
    rehearsalRemove: 'admin_rehearsal_remove'
  });

  var ERROR_MESSAGES = Object.freeze({
    unauthenticated: 'Your session has expired. Sign in again and retry.',
    forbidden_not_owner: 'This account is not marked as owner in the users sheet. Ask the site owner to correct the owner record.',
    rate_limited: 'Too many requests were made. Wait briefly before trying again.',
    bad_request: 'The request format was not accepted. Download a fresh template and check the column names and values.',
    too_large: 'The file or request is too large. Split the input into smaller files or chunks.',
    feature_disabled: 'This admin feature is not enabled. The site owner must review and approve its required security gate.',
    validation_failed: 'The server rejected the data. Review the reported row and field issues, correct the file, and retry.',
    not_found: 'The requested record was not found. Refresh the index and check the ID.',
    conflict: 'The record or batch conflicts with existing data. Refresh the latest state before retrying.',
    same_person_blocked: 'A second-person approval is required. Ask another authorised owner to complete this step.',
    bad_response: 'The server returned an unreadable response. Check the deployment and try again.',
    connection: 'The server could not be reached. Check your connection and retry.',
    timeout: 'The server took too long to respond. Check the import status before retrying.',
    try_later: 'The server is temporarily unavailable. The import will retry shortly.',
    busy: 'The server is busy. The import will retry shortly.',
    not_configured: 'The authentication service is not configured. Ask the site owner to check its deployment URL.',
    unknown_op: 'The server does not recognise this admin operation. Deploy the matching backend version.',
    server_error: 'The server could not complete the request. Check its status and retry later.',
    crypto_unavailable: 'Secure random generation is unavailable in this browser. Use a current browser on HTTPS.',
    too_many_rows: 'The input contains too many rows. Split it into smaller files.',
    invalid_json: 'The input is not valid JSON. Download a fresh template and correct the file.',
    invalid: 'The data failed validation. Review row and field errors before retrying.'
  });

  function apiError(code, message, cause) {
    var causeData = cause && cause.data && typeof cause.data === 'object' ? cause.data : {};
    var detail = { code: code || 'server_error', reason: cause && typeof cause.reason === 'string' ? cause.reason : causeData.reason, data: causeData };
    var e = new Error(message || plainError(detail));
    e.code = code || 'server_error';
    if (cause) { e.cause = cause; }
    if (detail.reason) { e.reason = detail.reason; }
    return e;
  }
  function plainError(err) {
    var code = err && typeof err.code === 'string' ? err.code : '';
    var reason = err && typeof err.reason === 'string' ? err.reason : '';
    if (!reason && err && typeof err.data === 'object' && err.data && typeof err.data.reason === 'string') { reason = err.data.reason; }
    if (code === 'feature_disabled' && reason === 'license_ref_unset') { return 'Set QUESTION_LICENSE_REF in Apps Script first, then retry the question import.'; }
    if (!code && err && err.data && typeof err.data.code === 'string') { code = err.data.code; }
    if (!code && err && err.kind === 'timeout') { code = 'timeout'; }
    if (!code && err && ['connection', 'bad_response', 'server_error'].indexOf(err.kind) >= 0) { code = err.kind; }
    return ERROR_MESSAGES[code] || ERROR_MESSAGES.server_error;
  }
  function auth() {
    var service = root.GateAuth;
    if (!service || typeof service.call !== 'function' || typeof service.readSession !== 'function') {
      throw apiError('not_configured', 'GateAuth is not available. Load auth.js before admin-api.js.');
    }
    return service;
  }
  function call(op, payload) {
    var service;
    try { service = auth(); } catch (e) { return Promise.reject(e); }
    var session;
    try { session = service.readSession(); } catch (e2) { return Promise.reject(apiError('unauthenticated', null, e2)); }
    var token = session && typeof session.token === 'string' ? session.token : '';
    try { return Promise.resolve(service.call(op, payload || {}, token)); }
    catch (e3) { return Promise.reject(e3); }
  }
  function optionalPayload(payload) { return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}; }
  function randomBatchId() {
    var cryptoApi = root.crypto || (typeof globalThis !== 'undefined' ? globalThis.crypto : null);
    if (!cryptoApi || typeof cryptoApi.getRandomValues !== 'function') { throw apiError('crypto_unavailable'); }
    var bytes = new Uint8Array(8);
    cryptoApi.getRandomValues(bytes);
    return Array.prototype.map.call(bytes, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }
  function chunkJsonSize(batchId, seq, questions) {
    return JSON.stringify({ batch_id: batchId, seq: seq, questions: questions }).length;
  }
  function splitChunks(list, batchId) {
    var chunks = [], current = [], seq = 1;
    for (var i = 0; i < list.length; i++) {
      var candidate = current.concat([list[i]]);
      if (candidate.length <= MAX_CHUNK_QUESTIONS && chunkJsonSize(batchId, seq, candidate) <= MAX_CHUNK_JSON_CHARS) {
        current = candidate; continue;
      }
      if (!current.length) { throw apiError('too_large', 'One question record exceeds the 600,000-character import chunk limit.'); }
      chunks.push(current); seq++; current = [list[i]];
      if (chunkJsonSize(batchId, seq, current) > MAX_CHUNK_JSON_CHARS) {
        throw apiError('too_large', 'One question record exceeds the 600,000-character import chunk limit.');
      }
    }
    if (current.length) { chunks.push(current); }
    return chunks;
  }
  function codeOf(errOrResult) {
    if (errOrResult && typeof errOrResult.code === 'string') { return errOrResult.code; }
    if (errOrResult && errOrResult.data && typeof errOrResult.data.code === 'string') { return errOrResult.data.code; }
    if (errOrResult && ['timeout', 'connection', 'bad_response', 'server_error'].indexOf(errOrResult.kind) >= 0) { return errOrResult.kind; }
    return '';
  }
  function incrementCount(stats, key, value) {
    if (typeof value === 'number' && isFinite(value)) { stats[key] += value; }
    else if (key === 'issues' && Array.isArray(value)) { stats.issues += value.length; }
  }
  function updateStats(stats, response) {
    var data = response && response.data && typeof response.data === 'object' ? response.data : response || {};
    incrementCount(stats, 'created', data.created);
    incrementCount(stats, 'updated', data.updated);
    incrementCount(stats, 'unchanged', data.unchanged);
    incrementCount(stats, 'issues', data.issues);
  }
  function applyFinalStats(stats, response) {
    var data = response && response.data && typeof response.data === 'object' ? response.data : response || {};
    ['created', 'updated', 'unchanged'].forEach(function (key) {
      if (typeof data[key] === 'number' && isFinite(data[key])) { stats[key] = data[key]; }
    });
    if (typeof data.issues === 'number' && isFinite(data.issues)) { stats.issues = data.issues; }
    else if (Array.isArray(data.issues)) { stats.issues = data.issues.length; }
  }
  function progress(onProgress, stats, extra) {
    if (typeof onProgress !== 'function') { return; }
    var snapshot = { done: stats.done, total: stats.total, created: stats.created, updated: stats.updated,
      unchanged: stats.unchanged, issues: stats.issues, chunk: 0, chunks: stats.chunks || 0, phase: 'uploading', retry: 0, inFlight: false, completedChunks: 0, maxRetries: MAX_RETRIES + 1 };
    if (extra && typeof extra === 'object') { Object.keys(extra).forEach(function (key) { snapshot[key] = extra[key]; }); }
    try { onProgress(snapshot); } catch (e) { /* a progress display must not interrupt an import */ }
  }
  var FATAL_IMPORT_CODES = Object.freeze(['feature_disabled', 'bad_request', 'too_large', 'unauthenticated',
    'forbidden_not_owner', 'validation_failed', 'conflict']);
  /* Only explicit busy/try_later replies are safe to retry: the server rejected
   * the request before entering the import writer. Transport failures and server_error
   * are ambiguous because Apps Script may have committed rows before the response was lost. */
  var RETRYABLE_IMPORT_CODES = Object.freeze(['busy', 'try_later']);
  function isFatalImportError(err) {
    return FATAL_IMPORT_CODES.indexOf(codeOf(err)) >= 0;
  }
  function isRetryableImportError(err) {
    return RETRYABLE_IMPORT_CODES.indexOf(codeOf(err)) >= 0;
  }
  function sendChunk(batchId, seq, questions, onAttempt, chunks, stats) {
    var payload = { batch_id: batchId, seq: seq, questions: questions };
    var attempt = 0;
    function tryOnce() {
      attempt++;
      progress(onAttempt, stats, { chunk: seq, chunks: chunks, phase: 'uploading', retry: attempt, inFlight: true, completedChunks: seq - 1 });
      return call(OPS.importChunk, payload).then(function (result) {
        var code = codeOf(result);
        if (code === 'ok') { return result; }
        /* GateAuth resolves HTTP envelopes whose ok flag is true even when an admin handler
         * returns a contract failure code in its inner {code,data} result. Treat every
         * non-ok chunk result as a failed attempt, except the two fatal codes below. */
        throw apiError(code || 'bad_response', null, result);
      }).catch(function (err) {
        /* Only a confirmed server-side contention response is retried. A timeout,
         * connection loss, unreadable response or server_error may happen after writes;
         * replaying automatically could overlap the still-running doPost. */
        if (isFatalImportError(err) || !isRetryableImportError(err)) { throw err; }
        if (attempt >= MAX_RETRIES + 1) { throw err; }
        var nextAttempt = attempt + 1;
        progress(onAttempt, stats, { chunk: seq, chunks: chunks, phase: 'uploading', retry: nextAttempt, inFlight: false, completedChunks: seq - 1 });
        var delayMs = Math.min(2000, 250 * Math.pow(2, attempt - 1));
        var schedule = typeof root.setTimeout === 'function' ? root.setTimeout.bind(root) : setTimeout;
        return new Promise(function (resolve) { schedule(resolve, delayMs); }).then(tryOnce);
      });
    }
    return tryOnce();
  }
  function importQuestions(list, onProgress) {
    if (!Array.isArray(list) || !list.length) { return Promise.reject(apiError('bad_request', 'Choose at least one question to import.')); }
    var batchId;
    try { batchId = randomBatchId(); } catch (e) { return Promise.reject(e); }
    var chunks;
    try { chunks = splitChunks(list, batchId); } catch (e2) { return Promise.reject(e2); }
    var stats = { done: 0, total: list.length, chunks: chunks.length, completedChunks: 0, currentChunk: 0, created: 0, updated: 0, unchanged: 0, issues: 0 };
    progress(onProgress, stats, { chunk: 0, chunks: chunks.length, phase: 'uploading', retry: 0, inFlight: false, completedChunks: 0 });
    var chain = Promise.resolve();
    chunks.forEach(function (chunk, i) {
      (function (localChunk, seq) {
        chain = chain.then(function () {
          stats.currentChunk = seq;
          return sendChunk(batchId, seq, localChunk, onProgress, chunks.length, stats).then(function (result) {
            updateStats(stats, result);
            stats.done += localChunk.length;
            stats.completedChunks = seq;
            progress(onProgress, stats, { chunk: seq, chunks: chunks.length, phase: 'uploading', retry: 0, inFlight: false, completedChunks: stats.completedChunks });
          });
        });
      })(chunk, i + 1);
    });
    return chain.then(function () {
      progress(onProgress, stats, { chunk: chunks.length, chunks: chunks.length, phase: 'finishing', retry: 0, inFlight: true, completedChunks: stats.completedChunks });
      return call(OPS.importFinish, { batch_id: batchId, chunks: chunks.length, question_count: list.length });
    }).then(function (finished) {
      var finishCode = codeOf(finished);
      if (finishCode !== 'ok') { throw apiError(finishCode || 'bad_response', null, finished); }
      applyFinalStats(stats, finished);
      progress(onProgress, stats, { chunk: chunks.length, chunks: chunks.length, phase: 'done', retry: 0, inFlight: false, completedChunks: stats.completedChunks });
      return { batch_id: batchId, chunks: chunks.length, progress: { done: stats.done, total: stats.total,
        created: stats.created, updated: stats.updated, unchanged: stats.unchanged, issues: stats.issues }, result: finished };
    }).catch(function (error) {
      var code = codeOf(error);
      var ambiguousOutcome = ['timeout', 'connection', 'bad_response', 'server_error'].indexOf(code) >= 0;
      var confirmedMessage = stats.done + ' of ' + stats.total + ' questions have a server acknowledgement.';
      var reasonMessage = ambiguousOutcome ? ({
        timeout: 'The import request timed out while waiting for Apps Script.',
        connection: 'The browser did not receive a response from Apps Script.',
        bad_response: 'The response from Apps Script could not be validated.',
        server_error: 'Apps Script reported a server-side failure.'
      }[code] || plainError(error)) : plainError(error);
      var nextStep = ambiguousOutcome
        ? ' The server may still have saved some or all of this chunk. Do not immediately start another import. Wait for the Apps Script execution to finish, then check the question repository before retrying.'
        : ' Correct the reported issue or wait for the server to become available, then review the import status before trying again.';
      var stopMessage = reasonMessage + ' ' + confirmedMessage + nextStep;
      if (error && typeof error === 'object') { error.progress = { done: stats.done, total: stats.total, created: stats.created, updated: stats.updated, unchanged: stats.unchanged, issues: stats.issues, chunks: chunks.length, outcome: ambiguousOutcome ? 'unknown' : 'not_committed_by_this_attempt', batch_id: batchId, message: stopMessage }; }
      progress(onProgress, stats, { chunk: stats.currentChunk || chunks.length, chunks: chunks.length, phase: 'stopped', retry: 0, inFlight: false, completedChunks: stats.completedChunks, message: stopMessage, outcome: ambiguousOutcome ? 'unknown' : 'not_committed_by_this_attempt' });
      throw error;
    });
  }

  var api = Object.freeze({
    OPS: OPS,
    MAX_CHUNK_QUESTIONS: MAX_CHUNK_QUESTIONS,
    MAX_CHUNK_JSON_CHARS: MAX_CHUNK_JSON_CHARS,
    plainError: plainError,
    call: call,
    whoami: function () { return call(OPS.whoami, {}); },
    checks: function () { return call(OPS.checks, {}); },
    questionsIndex: function (payload) { return call(OPS.questionsIndex, optionalPayload(payload)); },
    questionsIds: function (payload) { return call(OPS.questionsIds, optionalPayload(payload)); },
    papersList: function (payload) { return call(OPS.papersList, optionalPayload(payload)); },
    registerPaper: function (paper) { return call(OPS.registerPaper, { paper: paper }); },
    stageKeys: function (batchId, rows, context) {
      var payload = { batch_id: batchId, rows: rows };
      context = optionalPayload(context);
      ['paper_id', 'verified_by', 'source'].forEach(function (k) { if (context[k] !== undefined) { payload[k] = context[k]; } });
      return call(OPS.stageKeys, payload);
    },
    validateKeys: function (batchId) { return call(OPS.validateKeys, { batch_id: batchId }); },
    approveKeys: function (batchId) { return call(OPS.approveKeys, { batch_id: batchId, confirm: batchId }); },
    flowCheck: function (payload) { return call(OPS.flowCheck, optionalPayload(payload)); },
    gatesGet: function () { return call(OPS.gatesGet, {}); },
    gatesSet: function (payload) { return call(OPS.gatesSet, optionalPayload(payload)); },
    rehearsalPreview: function () { return call(OPS.rehearsalPreview, {}); },
    rehearsalAttemptStart: function () { return call(OPS.rehearsalAttemptStart, {}); },
    rehearsalAttemptSubmit: function (simulationId, responses) {
      return call(OPS.rehearsalAttemptSubmit, { simulation_id: String(simulationId || ''), responses: optionalPayload(responses) });
    },
    rehearsalRemove: function (confirmPaperId) { return call(OPS.rehearsalRemove, { confirm: String(confirmPaperId || '') }); },
    importQuestions: importQuestions
  });
  root.GateAdminApi = api;
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
