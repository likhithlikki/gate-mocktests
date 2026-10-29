/* admin-xlsx.js - optional, lazy XLSX reader. The SheetJS library is self-hosted by the site owner.
 * To calculate the SRI value after placing vendor/xlsx.full.min.js, run from GATE-site:
 * openssl dgst -sha384 -binary vendor/xlsx.full.min.js | openssl base64 -A
 */
(function (root) {
  'use strict';

  /* OWNER ACTION: replace the placeholder with "sha384-" + the command output above. */
  var XLSX_SRI = 'sha384-REPLACE_WITH_BASE64_SHA384_HASH';
  var MAX_FILE_BYTES = 10 * 1024 * 1024;
  var MAX_ROWS = 30000;
  var scriptLoad = null;
  var baseUrl = '';
  try {
    var current = root.document && root.document.currentScript;
    if (current && current.src && typeof URL === 'function') { baseUrl = new URL('.', current.src).href; }
    else if (root.location && root.location.href && typeof URL === 'function') { baseUrl = new URL('.', root.location.href).href; }
  } catch (e) { baseUrl = ''; }

  function makeError(code, message) { var e = new Error(message); e.code = code; return e; }

  function checkFile(file) {
    if (!file || typeof file.name !== 'string' || typeof file.size !== 'number') {
      throw makeError('bad_file', 'Choose an Excel .xlsx file.');
    }
    var name = file.name.toLowerCase();
    if (/\.(xlsm|xlsb)$/.test(name)) { throw makeError('unsupported_excel_type', 'Macro-enabled .xlsm and binary .xlsb files are not accepted. Save a copy as .xlsx.'); }
    if (!/\.xlsx$/.test(name)) { throw makeError('unsupported_excel_type', 'Only .xlsx workbooks are accepted here.'); }
    if (file.size > MAX_FILE_BYTES) { throw makeError('too_large', 'Excel files must be 10 MB or smaller.'); }
  }

  function loadLibrary() {
    if (root.XLSX && typeof root.XLSX.read === 'function' && root.XLSX.utils) {
      if (typeof root.XLSX.version === 'string' && /^0\.20\./.test(root.XLSX.version)) { return Promise.resolve(root.XLSX); }
      return Promise.reject(makeError('xlsx_version_unsupported', 'Use SheetJS Community Edition 0.20.x; the loaded library version is not supported.'));
    }
    if (scriptLoad) { return scriptLoad; }
    scriptLoad = new Promise(function (resolve, reject) {
      var doc = root.document;
      if (!doc || typeof doc.createElement !== 'function') {
        reject(makeError('xlsx_unavailable', 'Excel reading requires a browser document.')); return;
      }
      var script = doc.createElement('script');
      script.src = baseUrl ? new URL('vendor/xlsx.full.min.js', baseUrl).href : 'vendor/xlsx.full.min.js';
      script.integrity = XLSX_SRI;
      script.crossOrigin = 'anonymous';
      script.onload = function () {
        if (!root.XLSX || typeof root.XLSX.read !== 'function' || !root.XLSX.utils) {
          scriptLoad = null;
          reject(makeError('xlsx_unavailable', 'SheetJS loaded but did not expose the expected XLSX API. Check the vendor file version.'));
          return;
        }
        if (typeof root.XLSX.version !== 'string' || !/^0\.20\./.test(root.XLSX.version)) {
          scriptLoad = null;
          reject(makeError('xlsx_version_unsupported', 'Use SheetJS Community Edition 0.20.x; the loaded library version is not supported.'));
          return;
        }
        resolve(root.XLSX);
      };
      script.onerror = function () {
        scriptLoad = null;
        reject(makeError('xlsx_library_missing', 'Excel support library is missing or failed its integrity check. Place SheetJS Community Edition 0.20.x at GATE-site/vendor/xlsx.full.min.js and fill in XLSX_SRI.'));
      };
      (doc.head || doc.documentElement).appendChild(script);
    });
    return scriptLoad;
  }

  function readArrayBuffer(file) {
    if (file && typeof file.arrayBuffer === 'function') { return file.arrayBuffer(); }
    return new Promise(function (resolve, reject) {
      if (typeof root.FileReader !== 'function') { reject(makeError('read_failed', 'This browser cannot read local files.')); return; }
      var reader = new root.FileReader();
      reader.onerror = function () { reject(makeError('read_failed', 'The Excel file could not be read.')); };
      reader.onload = function () { resolve(reader.result); };
      try { reader.readAsArrayBuffer(file); } catch (e) { reject(makeError('read_failed', 'The Excel file could not be read.')); }
    });
  }

  function readXlsx(file, kind) {
    try { checkFile(file); } catch (e) { return Promise.reject(e); }
    return Promise.all([loadLibrary(), readArrayBuffer(file)]).then(function (loaded) {
      var XLSX = loaded[0], buffer = loaded[1], workbook;
      try {
        workbook = XLSX.read(buffer, { type: 'array', cellFormula: true, cellText: true, cellNF: true, sheetRows: MAX_ROWS + 1 });
      } catch (e) { throw makeError('invalid_xlsx', 'This workbook could not be opened. Check that it is a valid .xlsx file.'); }
      if (!workbook || !Array.isArray(workbook.SheetNames) || !workbook.SheetNames.length) {
        throw makeError('empty_workbook', 'The workbook has no readable worksheet.');
      }
      var firstName = workbook.SheetNames[0], sheet = workbook.Sheets[firstName];
      if (!sheet) { throw makeError('empty_workbook', 'The first worksheet is not readable.'); }
      var fullRef = sheet['!fullref'] || sheet['!ref'];
      if (fullRef && XLSX.utils && typeof XLSX.utils.decode_range === 'function') {
        var fullRange = XLSX.utils.decode_range(fullRef);
        if (fullRange.e.r - fullRange.s.r + 1 > MAX_ROWS) {
          throw makeError('too_many_rows', 'The first worksheet exceeds 30,000 rows.');
        }
      }

      /* Formula cells are intentionally blanked; cached formula results are not trusted as imported input. */
      Object.keys(sheet).forEach(function (address) {
        if (address.charAt(0) === '!') { return; }
        var cell = sheet[address];
        if (cell && typeof cell.f === 'string') { cell.v = ''; cell.w = ''; cell.t = 's'; delete cell.f; }
      });
      var rows2d = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '', blankrows: false });
      if (!Array.isArray(rows2d)) { rows2d = []; }
      if (rows2d.length > MAX_ROWS) { throw makeError('too_many_rows', 'The first worksheet exceeds 30,000 rows.'); }
      var parser = root.GateAdminParse;
      if (!parser || typeof parser.fromTable !== 'function') {
        throw makeError('parser_unavailable', 'Load admin-parse.js before using Excel import.');
      }
      var parsed = parser.fromTable(rows2d, kind === 'keys' || kind === 'key' ? 'keys' : 'questions');
      return { rows2d: rows2d, parsed: parsed };
    });
  }

  var api = Object.freeze({ XLSX_SRI: XLSX_SRI, MAX_FILE_BYTES: MAX_FILE_BYTES, MAX_ROWS: MAX_ROWS, readXlsx: readXlsx });
  root.GateAdminXlsx = api;
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
