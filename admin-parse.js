/* admin-parse.js - structure-only reader for Admin Console question and key files.
 * Validation of business rules belongs to admin-validate.js. */
(function (root) {
  'use strict';

  var SPEC = root.GateAdminSpec;
  if (!SPEC && typeof require === 'function') {
    try { SPEC = require('./admin-spec.js'); } catch (e) { SPEC = null; }
  }
  var MAX_FILE_BYTES = 25 * 1024 * 1024;
  var QUESTION_FIELDS = ['id', 'branch', 'year', 'subject', 'topic', 'type', 'marks', 'text', 'options', 'source'];
  var KEY_FIELDS = ['question_id', 'answer'];

  function problem(row, field, code) { return { row: row, field: field, code: code }; }
  function codedError(code, message) { var e = new Error(message); e.code = code; return e; }
  function stripBom(text) { return text && text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text; }
  function blankRow(row) { return !row || row.every(function (v) { return String(v == null ? '' : v) === ''; }); }

  function readFile(file) {
    return new Promise(function (resolve, reject) {
      if (!file || typeof file.size !== 'number') { reject(codedError('bad_file', 'Choose a file to read.')); return; }
      if (file.size > MAX_FILE_BYTES) { reject(codedError('too_large', 'File is larger than 25 MB.')); return; }
      if (typeof root.FileReader !== 'function') { reject(codedError('file_reader_unavailable', 'This browser cannot read local files.')); return; }
      var reader = new root.FileReader();
      reader.onerror = function () { reject(codedError('read_failed', 'The file could not be read. Try saving it again.')); };
      reader.onabort = function () { reject(codedError('read_aborted', 'File reading was cancelled.')); };
      reader.onload = function () {
        if (typeof reader.result !== 'string') { reject(codedError('read_failed', 'The file did not decode as text.')); return; }
        resolve(stripBom(reader.result));
      };
      try { reader.readAsText(file, 'UTF-8'); } catch (e) { reject(codedError('read_failed', 'The file could not be read.')); }
    });
  }

  /* RFC 4180-style parser: quoted commas, doubled quotes, CRLF, and line breaks in quoted cells. */
  function parseCsv(text) {
    var rows = [], row = [], cell = '', state = 'field', i = 0, c, next;
    text = String(text == null ? '' : text);
    if (text.charCodeAt(0) === 0xFEFF) { text = text.slice(1); }
    while (i < text.length) {
      c = text.charAt(i); next = text.charAt(i + 1);
      if (state === 'quoted') {
        if (c === '"') {
          if (next === '"') { cell += '"'; i += 2; continue; }
          state = 'afterQuote'; i++; continue;
        }
        cell += c; i++; continue;
      }
      if (state === 'afterQuote') {
        if (c === ',') { row.push(cell); cell = ''; state = 'field'; i++; continue; }
        if (c === '\r' || c === '\n') {
          row.push(cell); rows.push(row); row = []; cell = ''; state = 'field';
          if (c === '\r' && next === '\n') { i += 2; } else { i++; }
          continue;
        }
        if (c === ' ' || c === '\t') { i++; continue; }
        throw codedError('malformed_csv', 'CSV has characters after a closing quote.');
      }
      if (c === '"') {
        if (state !== 'field' || cell.length) { throw codedError('malformed_csv', 'CSV has a quote inside an unquoted field.'); }
        state = 'quoted'; i++; continue;
      }
      if (c === ',') { row.push(cell); cell = ''; state = 'field'; i++; continue; }
      if (c === '\r' || c === '\n') {
        row.push(cell); rows.push(row); row = []; cell = ''; state = 'field';
        if (c === '\r' && next === '\n') { i += 2; } else { i++; }
        continue;
      }
      cell += c; state = 'unquoted'; i++;
    }
    if (state === 'quoted') { throw codedError('malformed_csv', 'CSV ends inside a quoted field.'); }
    if (cell.length || row.length || state === 'afterQuote' || state === 'unquoted') { row.push(cell); rows.push(row); }
    return rows;
  }

  function convertInteger(value, rowNo, field, problems) {
    if (value === '' || value === null || value === undefined) { return value; }
    if (typeof value === 'number') {
      if (isFinite(value) && Math.floor(value) === value) { return value; }
      problems.push(problem(rowNo, field, 'invalid_integer')); return null;
    }
    if (typeof value === 'string' && /^\s*[+-]?\d+\s*$/.test(value)) {
      var n = Number(value.trim());
      if (isFinite(n) && Math.floor(n) === n) { return n; }
    }
    problems.push(problem(rowNo, field, 'invalid_integer'));
    return null;
  }

  function stringId(value, rowNo, field, problems) {
    if (value === undefined || value === null) { return value; }
    if (typeof value !== 'string') { problems.push(problem(rowNo, field, 'expected_text')); return ''; }
    return value;
  }

  function jsonQuestion(raw, rowNo, problems) {
    var out = {}, i, field;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      problems.push(problem(rowNo, 'record', 'invalid_record')); return null;
    }
    QUESTION_FIELDS.forEach(function (name) {
      if (Object.prototype.hasOwnProperty.call(raw, name)) { out[name] = raw[name]; }
    });
    /* Accept CSV-shaped aliases when a JSON shard was exported from a table. */
    if (!Object.prototype.hasOwnProperty.call(out, 'options') && Object.prototype.hasOwnProperty.call(raw, 'options_json')) {
      if (raw.options_json === '' || raw.options_json === null || raw.options_json === undefined) { /* blank NAT options */ }
      else if (typeof raw.options_json !== 'string') { problems.push(problem(rowNo, 'options_json', 'expected_text')); }
      else {
        try { out.options = JSON.parse(raw.options_json); }
        catch (e) { problems.push(problem(rowNo, 'options_json', 'invalid_json')); }
      }
    }
    if (!Object.prototype.hasOwnProperty.call(out, 'source') && Object.prototype.hasOwnProperty.call(raw, 'source_name')) {
      out.source = { name: raw.source_name };
    }
    if (Object.prototype.hasOwnProperty.call(out, 'id')) { out.id = stringId(out.id, rowNo, 'id', problems); }
    if (Object.prototype.hasOwnProperty.call(out, 'year')) { out.year = convertInteger(out.year, rowNo, 'year', problems); }
    if (Object.prototype.hasOwnProperty.call(out, 'marks')) { out.marks = convertInteger(out.marks, rowNo, 'marks', problems); }
    if (Object.prototype.hasOwnProperty.call(out, 'source') && out.source !== null && (typeof out.source !== 'object' || Array.isArray(out.source))) {
      problems.push(problem(rowNo, 'source', 'invalid_structure')); delete out.source;
    } else if (Object.prototype.hasOwnProperty.call(out, 'source') && out.source && typeof out.source === 'object') {
      /* Only source.name belongs to the question record; ignore unrelated nested metadata. */
      out.source = { name: out.source.name };
    }
    if (Object.prototype.hasOwnProperty.call(out, 'options') && out.options !== undefined && !Array.isArray(out.options)) {
      problems.push(problem(rowNo, 'options', 'invalid_structure')); delete out.options;
    }
    /* Ignore unknown JSON fields; return only the documented question shape. */
    for (i = 0; i < QUESTION_FIELDS.length; i++) {
      field = QUESTION_FIELDS[i];
      if (!Object.prototype.hasOwnProperty.call(out, field)) { /* required-field rules are business validation */ }
    }
    return out;
  }

  function jsonKey(raw, rowNo, problems) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      problems.push(problem(rowNo, 'record', 'invalid_record')); return null;
    }
    var out = {};
    if (Object.prototype.hasOwnProperty.call(raw, 'question_id')) { out.question_id = stringId(raw.question_id, rowNo, 'question_id', problems); }
    if (Object.prototype.hasOwnProperty.call(raw, 'answer')) {
      if (raw.answer === null || raw.answer === undefined) { out.answer = ''; }
      else if (typeof raw.answer === 'string' || typeof raw.answer === 'number') { out.answer = String(raw.answer); }
      else { problems.push(problem(rowNo, 'answer', 'expected_text')); out.answer = ''; }
    }
    return out;
  }

  function jsonArray(text, kind) {
    var parsed = JSON.parse(stripBom(String(text == null ? '' : text)));
    if (Array.isArray(parsed)) { return parsed; }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      if (kind === 'questions' && Array.isArray(parsed.questions)) { return parsed.questions; }
      if (kind === 'keys' && Array.isArray(parsed.keys)) { return parsed.keys; }
      if (kind === 'keys' && Array.isArray(parsed.rows)) { return parsed.rows; }
    }
    throw codedError('wrong_json_shape', 'JSON must contain a list of records.');
  }

  function fromTable(rows2d, kind) {
    var problems = [], records = [], normalizedKind = kind === 'key' || kind === 'answer_keys' ? 'keys' : kind;
    if (normalizedKind !== 'questions' && normalizedKind !== 'keys') {
      return { records: [], problems: [problem(1, 'kind', 'unknown_kind')], meta: { format: 'table', count: 0 } };
    }
    if (!Array.isArray(rows2d) || !rows2d.length || !Array.isArray(rows2d[0])) {
      return { records: [], problems: [problem(1, 'header', 'missing_header')], meta: { format: 'table', count: 0 } };
    }
    var expected = normalizedKind === 'questions' ? (SPEC ? SPEC.QUESTION_COLUMNS : ['id','branch','year','subject','topic','type','marks','text','options_json','source_name']) : (SPEC ? SPEC.KEY_COLUMNS : KEY_FIELDS);
    var headers = rows2d[0].map(function (h) { return String(h == null ? '' : h).trim(); });
    var headerMap = {}, duplicates = {};
    headers.forEach(function (name, i) {
      if (name && Object.prototype.hasOwnProperty.call(headerMap, name)) { duplicates[name] = true; }
      if (name && !Object.prototype.hasOwnProperty.call(headerMap, name)) { headerMap[name] = i; }
    });
    Object.keys(duplicates).forEach(function (name) { problems.push(problem(1, name, 'duplicate_column')); });
    expected.forEach(function (name) { if (!Object.prototype.hasOwnProperty.call(headerMap, name)) { problems.push(problem(1, name, 'missing_column')); } });
    if (problems.length) { return { records: [], problems: problems, meta: { format: 'table', count: 0 } }; }

    for (var r = 1; r < rows2d.length; r++) {
      var row = rows2d[r];
      if (!Array.isArray(row) || blankRow(row)) { continue; }
      var rowNo = r + 1, mapped = {}, cellProblems = [], i, name, value;
      expected.forEach(function (col) {
        i = headerMap[col]; value = row[i] === null || row[i] === undefined ? '' : String(row[i]); mapped[col] = value;
      });
      if (normalizedKind === 'questions') {
        var q = { id: mapped.id, branch: mapped.branch, year: convertInteger(mapped.year, rowNo, 'year', cellProblems),
          subject: mapped.subject, topic: mapped.topic, type: mapped.type, marks: convertInteger(mapped.marks, rowNo, 'marks', cellProblems),
          text: mapped.text };
        if (mapped.options_json !== '') {
          try {
            q.options = JSON.parse(mapped.options_json);
            if (!Array.isArray(q.options)) { cellProblems.push(problem(rowNo, 'options_json', 'invalid_structure')); delete q.options; }
          } catch (e) { cellProblems.push(problem(rowNo, 'options_json', 'invalid_json')); }
        }
        q.source = { name: mapped.source_name };
        records.push(q);
      } else {
        records.push({ question_id: mapped.question_id, answer: mapped.answer });
      }
      Array.prototype.push.apply(problems, cellProblems);
    }
    return { records: records, problems: problems, meta: { format: 'table', count: records.length } };
  }

  function detectFormat(text, filename) {
    var name = String(filename || '').toLowerCase();
    if (/\.json$/.test(name)) { return 'json'; }
    if (/\.csv$/.test(name)) { return 'csv'; }
    var trimmed = stripBom(String(text == null ? '' : text)).trim();
    if (trimmed.charAt(0) === '{' || trimmed.charAt(0) === '[') { return 'json'; }
    return 'csv';
  }

  function parseQuestions(text, filename) { return parseInput(text, filename, 'questions'); }
  function parseKeys(text, filename) { return parseInput(text, filename, 'keys'); }
  function parseInput(text, filename, kind) {
    text = stripBom(String(text == null ? '' : text));
    var format = detectFormat(text, filename), parsed, problems = [], records = [];
    if (format === 'json') {
      try {
        var arr = jsonArray(text, kind);
        arr.forEach(function (raw, i) {
          var p = [], record = kind === 'questions' ? jsonQuestion(raw, i + 1, p) : jsonKey(raw, i + 1, p);
          Array.prototype.push.apply(problems, p);
          if (record) { records.push(record); }
        });
      } catch (e) {
        problems.push(problem(1, 'file', e && e.code === 'wrong_json_shape' ? 'wrong_json_shape' : 'invalid_json'));
      }
    } else {
      try {
        parsed = parseCsv(text);
        var table = fromTable(parsed, kind);
        records = table.records; problems = table.problems;
      } catch (e2) {
        problems.push(problem(1, 'file', e2 && e2.code === 'malformed_csv' ? 'malformed_csv' : 'csv_parse_failed'));
      }
    }
    return { records: records, problems: problems, meta: { format: format, count: records.length } };
  }

  var api = Object.freeze({ MAX_FILE_BYTES: MAX_FILE_BYTES, readFile: readFile, parseCsv: parseCsv,
    parseQuestions: parseQuestions, parseKeys: parseKeys, fromTable: fromTable });
  root.GateAdminParse = api;
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
