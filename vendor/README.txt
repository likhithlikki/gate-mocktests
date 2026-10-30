Optional Excel import dependency goes here only when the site owner supplies the authorized SheetJS Community Edition 0.20.x distribution.
Expected file: xlsx.full.min.js
Compute its actual SRI value using:
openssl dgst -sha384 -binary vendor/xlsx.full.min.js | openssl base64 -A
Then fill the marked XLSX_SRI constant in admin-xlsx.js. Do not use a hash from another file/version. JSON and CSV do not require this library.
