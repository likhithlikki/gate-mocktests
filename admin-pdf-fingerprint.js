/* admin-pdf-fingerprint.js - local PDF read progress and SHA-256 fingerprinting. */
(function (root) {
  'use strict';

  function report(onProgress, snapshot) {
    if (typeof onProgress === 'function') {
      try { onProgress(snapshot); } catch (e) { /* UI progress must never interrupt file hashing. */ }
    }
  }

  function readAsArrayBuffer(file, FileReaderCtor, onProgress) {
    if (typeof FileReaderCtor === 'function') {
      return new Promise(function (resolve, reject) {
        var reader = new FileReaderCtor();
        reader.onprogress = function (event) {
          if (event && event.lengthComputable && Number(event.total) > 0) {
            report(onProgress, { phase: 'reading', loaded: Number(event.loaded) || 0, total: Number(event.total), indeterminate: false });
          } else {
            report(onProgress, { phase: 'reading', loaded: 0, total: 0, indeterminate: true });
          }
        };
        reader.onload = function () {
          if (!(reader.result instanceof ArrayBuffer)) {
            reject(new Error('The selected PDF could not be read as binary data.'));
            return;
          }
          report(onProgress, { phase: 'reading', loaded: reader.result.byteLength, total: reader.result.byteLength, indeterminate: false });
          resolve(reader.result);
        };
        reader.onerror = function () { reject(new Error('The selected PDF could not be read. Try selecting the file again.')); };
        reader.onabort = function () { reject(new Error('Reading the selected PDF was cancelled.')); };
        try { reader.readAsArrayBuffer(file); }
        catch (error) { reject(new Error('The selected PDF could not be read.')); }
      });
    }

    if (file && typeof file.arrayBuffer === 'function') {
      report(onProgress, { phase: 'reading', loaded: 0, total: 0, indeterminate: true });
      return file.arrayBuffer().then(function (buffer) {
        if (!(buffer instanceof ArrayBuffer)) { throw new Error('The selected PDF did not return binary data.'); }
        report(onProgress, { phase: 'reading', loaded: buffer.byteLength, total: buffer.byteLength, indeterminate: false });
        return buffer;
      });
    }
    return Promise.reject(new Error('This browser cannot read the selected PDF locally.'));
  }

  function toHex(buffer) {
    return Array.prototype.map.call(new Uint8Array(buffer), function (byte) {
      return ('0' + byte.toString(16)).slice(-2);
    }).join('');
  }

  function compute(file, cryptoApi, FileReaderCtor, onProgress) {
    if (!file || typeof file !== 'object') { return Promise.reject(new Error('Choose a PDF file first.')); }
    var fileName = String(file.name || '');
    if (!/\.pdf$/i.test(fileName) && String(file.type || '').toLowerCase() !== 'application/pdf') {
      return Promise.reject(new Error('Choose a PDF document.'));
    }
    if (!cryptoApi || !cryptoApi.subtle || typeof cryptoApi.subtle.digest !== 'function') {
      return Promise.reject(new Error('SHA-256 requires Web Crypto. Open the site over HTTPS in a current browser.'));
    }

    report(onProgress, { phase: 'reading', loaded: 0, total: Number(file.size) || 0, indeterminate: !(Number(file.size) > 0) });
    return readAsArrayBuffer(file, FileReaderCtor, onProgress).then(function (buffer) {
      report(onProgress, { phase: 'hashing', loaded: buffer.byteLength, total: buffer.byteLength, indeterminate: true });
      return cryptoApi.subtle.digest('SHA-256', buffer).then(function (digest) {
        var fingerprint = toHex(digest);
        report(onProgress, { phase: 'done', loaded: buffer.byteLength, total: buffer.byteLength, indeterminate: false, percent: 100 });
        return { sha256: fingerprint, size: buffer.byteLength, name: fileName };
      });
    }).catch(function (error) {
      report(onProgress, { phase: 'error' });
      throw error;
    });
  }

  var api = Object.freeze({ compute: compute });
  root.GateAdminPdfFingerprint = api;
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
