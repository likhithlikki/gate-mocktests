/* admin-validate.js - browser-side mirror of the question catalogue's validation rules.
 * Problems contain identifiers and rule codes only: never question text or answer values. */
(function (root) {
  'use strict';
  var SPEC = root.GateAdminSpec;
  if (!SPEC && typeof require === 'function') { try { SPEC = require('./admin-spec.js'); } catch (e) { SPEC = null; } }
  var LIMITS = SPEC ? SPEC.LIMITS : { ID_MAX: 64, FIELD_MAX: 100, TEXT_MAX: 20000, OPTION_TEXT_MAX: 5000, OPTION_ID_MAX: 16, OPTIONS_MIN: 2, OPTIONS_MAX: 26, SOURCE_NAME_MAX: 200, YEAR_MIN: 1900, YEAR_MAX: 2100, MARKS_MIN: 1, MARKS_MAX: 999 };
  var ID_RE = SPEC ? SPEC.ID_RE : /^[A-Za-z0-9_.-]{1,64}$/;
  var OPTION_ID_RE = SPEC ? SPEC.OPTION_ID_RE : /^[A-Za-z0-9_.-]{1,16}$/;
  var TYPES = SPEC ? SPEC.QUESTION_TYPES : ['MCQ', 'MSQ', 'NAT'];

  function has(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
  function object(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function countInto(map, value) { if (typeof value !== 'string' || !value) { return; } map[value] = (map[value] || 0) + 1; }
  function safeId(value) { return typeof value === 'string' && ID_RE.test(value) ? value : ''; }
  function add(problems, index, id, field, code) { problems.push({ index: index, id: safeId(id), field: field, code: code }); }
  function nonEmptyString(value, max) { return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max; }
  function whole(value) { return typeof value === 'number' && isFinite(value) && Math.floor(value) === value; }

  function optionsOf(q) {
    if (Array.isArray(q.options)) { return { options: q.options }; }
    if (q.options_json === '' || q.options_json === null || q.options_json === undefined) { return { options: null }; }
    if (typeof q.options_json !== 'string') { return { problem: true }; }
    try {
      var parsed = JSON.parse(q.options_json);
      return Array.isArray(parsed) ? { options: parsed } : { problem: true };
    } catch (e) { return { problem: true }; }
  }

  function validateOptionList(raw, type) {
    var parsed = optionsOf(raw);
    if (type === 'NAT') { return parsed.options === null && !parsed.problem ? null : 'invalid_options'; }
    if (parsed.problem || !Array.isArray(parsed.options) || parsed.options.length < LIMITS.OPTIONS_MIN || parsed.options.length > LIMITS.OPTIONS_MAX) { return 'invalid_options'; }
    var seen = Object.create(null);
    for (var i = 0; i < parsed.options.length; i++) {
      var option = parsed.options[i];
      if (!object(option)) { return 'invalid_options'; }
      var keys = Object.keys(option);
      for (var k = 0; k < keys.length; k++) { if (keys[k] !== 'id' && keys[k] !== 'text') { return 'invalid_options'; } }
      if (!nonEmptyString(option.id, LIMITS.OPTION_ID_MAX) || !OPTION_ID_RE.test(option.id.trim()) ||
          !nonEmptyString(option.text, LIMITS.OPTION_TEXT_MAX)) { return 'invalid_options'; }
      var id = option.id.trim();
      if (seen[id]) { return 'invalid_options'; }
      seen[id] = true;
    }
    return null;
  }

  function validateQuestions(list) {
    list = Array.isArray(list) ? list : [];
    var problems = [], seen = Object.create(null), byYear = Object.create(null), byType = Object.create(null), byBranch = Object.create(null);
    list.forEach(function (q, index) {
      var local = [];
      if (!object(q)) { add(problems, index, '', 'record', 'invalid_record'); return; }
      var id = q.id;
      if (typeof id !== 'string' || !ID_RE.test(id)) { add(local, index, id, 'id', 'invalid_id'); }
      ['branch', 'subject', 'topic'].forEach(function (field) {
        if (!nonEmptyString(q[field], LIMITS.FIELD_MAX)) { add(local, index, id, field, 'invalid_field'); }
      });
      if (!whole(q.year) || q.year < LIMITS.YEAR_MIN || q.year > LIMITS.YEAR_MAX) { add(local, index, id, 'year', 'invalid_year'); }
      if (TYPES.indexOf(q.type) < 0) { add(local, index, id, 'type', 'invalid_type'); }
      if (!whole(q.marks) || q.marks < LIMITS.MARKS_MIN || q.marks > LIMITS.MARKS_MAX) { add(local, index, id, 'marks', 'invalid_marks'); }
      if (!nonEmptyString(q.text, LIMITS.TEXT_MAX)) { add(local, index, id, 'text', 'invalid_text'); }
      var sourceName = q.source && typeof q.source === 'object' && !Array.isArray(q.source) ? q.source.name : q.source_name;
      if (!nonEmptyString(sourceName, LIMITS.SOURCE_NAME_MAX)) { add(local, index, id, 'source_name', 'invalid_source_name'); }
      if (TYPES.indexOf(q.type) >= 0) {
        var optionCode = validateOptionList(q, q.type);
        if (optionCode) { add(local, index, id, 'options_json', optionCode); }
      }
      /* The backend records a duplicate only after all other row checks pass. */
      if (local.length === 0 && seen[id]) { add(local, index, id, 'id', 'duplicate_id'); }
      if (local.length === 0) { seen[id] = true; }
      Array.prototype.push.apply(problems, local);
      if (whole(q.year)) { countInto(byYear, String(q.year)); }
      countInto(byType, q.type);
      countInto(byBranch, q.branch);
    });
    return { ok: problems.length === 0, problems: problems,
      summary: { count: list.length, byYear: byYear, byType: byType, byBranch: byBranch } };
  }

  function optionIdSet(q) {
    var parsed = optionsOf(q), set = Object.create(null);
    if (!parsed.options || !Array.isArray(parsed.options)) { return set; }
    parsed.options.forEach(function (o) { if (object(o) && typeof o.id === 'string') { set[o.id] = true; } });
    return set;
  }

  function strictDecimal(s) {
    return typeof s === 'string' && s.length <= 32 && /^-?\d+(\.\d+)?$/.test(s);
  }
  function compareDecimal(a, b) {
    function parse(s) {
      var neg = s.charAt(0) === '-', body = neg ? s.slice(1) : s, parts = body.split('.');
      var ip = parts[0].replace(/^0+(?=\d)/, ''), fp = parts.length > 1 ? parts[1] : '';
      if (/^0*$/.test(ip) && /^0*$/.test(fp)) { neg = false; }
      return { neg: neg, ip: ip, fp: fp };
    }
    var x = parse(a), y = parse(b);
    if (x.neg !== y.neg) { return x.neg ? -1 : 1; }
    var sign = x.neg ? -1 : 1;
    if (x.ip.length !== y.ip.length) { return (x.ip.length < y.ip.length ? -1 : 1) * sign; }
    if (x.ip !== y.ip) { return (x.ip < y.ip ? -1 : 1) * sign; }
    var width = Math.max(x.fp.length, y.fp.length), xf = x.fp, yf = y.fp;
    while (xf.length < width) { xf += '0'; }
    while (yf.length < width) { yf += '0'; }
    if (xf === yf) { return 0; }
    return (xf < yf ? -1 : 1) * sign;
  }
  function validNat(answer) {
    if (typeof answer !== 'string' || !answer.length) { return false; }
    var range = answer.split('..');
    if (range.length === 1) { return strictDecimal(answer); }
    if (range.length !== 2 || !strictDecimal(range[0]) || !strictDecimal(range[1])) { return false; }
    return compareDecimal(range[0], range[1]) <= 0;
  }

  function validateKeys(rows, questions) {
    rows = Array.isArray(rows) ? rows : [];
    questions = Array.isArray(questions) ? questions : [];
    var problems = [], questionById = Object.create(null), counts = Object.create(null), keyRows = Object.create(null), missing = [];
    questions.forEach(function (q) {
      if (object(q) && typeof q.id === 'string' && ID_RE.test(q.id) && !has(questionById, q.id)) { questionById[q.id] = q; }
    });
    rows.forEach(function (row, index) {
      var rowNo = index + 1;
      if (!object(row)) { problems.push({ row: rowNo, field: 'record', code: 'invalid_record' }); return; }
      var qid = row.question_id;
      if (typeof qid !== 'string' || !ID_RE.test(qid)) {
        problems.push({ row: rowNo, field: 'question_id', code: 'invalid_question_id' }); return;
      }
      if (!has(questionById, qid)) { problems.push({ row: rowNo, field: 'question_id', code: 'unknown_question' }); return; }
      (keyRows[qid] = keyRows[qid] || []).push({ row: rowNo, record: row });
      counts[qid] = (counts[qid] || 0) + 1;
    });

    Object.keys(keyRows).forEach(function (qid) {
      var entries = keyRows[qid];
      if (entries.length > 1) {
        for (var dup = 1; dup < entries.length; dup++) { problems.push({ row: entries[dup].row, field: 'question_id', code: 'duplicate_key' }); }
      }
      entries.forEach(function (entry) {
        var q = questionById[qid], answer = entry.record.answer;
        if (typeof answer !== 'string' || answer.length === 0) { problems.push({ row: entry.row, field: 'answer', code: 'missing_answer' }); return; }
        if (q.type === 'MCQ') {
          var ids = optionIdSet(q);
          if (!OPTION_ID_RE.test(answer) || !has(ids, answer)) { problems.push({ row: entry.row, field: 'answer', code: 'invalid_mcq_answer' }); }
        } else if (q.type === 'MSQ') {
          var parts = answer.split(';'), seen = Object.create(null), allowed = optionIdSet(q), bad = !parts.length;
          parts.forEach(function (part) {
            if (!OPTION_ID_RE.test(part) || !has(allowed, part) || seen[part]) { bad = true; }
            seen[part] = true;
          });
          if (bad) { problems.push({ row: entry.row, field: 'answer', code: 'invalid_msq_answer' }); }
        } else if (q.type === 'NAT') {
          if (!validNat(answer)) { problems.push({ row: entry.row, field: 'answer', code: 'invalid_nat_answer' }); }
        } else {
          problems.push({ row: entry.row, field: 'answer', code: 'unknown_question_type' });
        }
      });
    });

    questions.forEach(function (q) {
      if (!object(q) || typeof q.id !== 'string' || !ID_RE.test(q.id)) { return; }
      var count = counts[q.id] || 0;
      if (count === 0) {
        missing.push(q.id);
        problems.push({ row: 0, field: 'question_id', code: 'missing_key' });
      }
    });
    var keyed = questions.reduce(function (sum, q) {
      return sum + (object(q) && typeof q.id === 'string' && counts[q.id] === 1 ? 1 : 0);
    }, 0);
    return { ok: problems.length === 0, problems: problems, coverage: { total: questions.length, keyed: keyed, missing: missing } };
  }

  var api = Object.freeze({ validateQuestions: validateQuestions, validateKeys: validateKeys });
  root.GateAdminValidate = api;
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
