/* admin-spec.js - the single source of truth for the file formats the Admin console accepts.
 * Exposes exactly one global: GateAdminSpec. No DOM access, no storage, no network. */
(function (root) {
  "use strict";

  /* Every value below is taken from the contract and checked against PrivateAuthExam.gs
   * (QI_LIMITS, QI_ID_RE, QI_OPTION_ID_RE, qiValidateRow_, qiParseOptions_, AT_MAX_QUESTIONS,
   * AT_PAPER_RE, AR_MAX_BODY). Where the code is stricter than the contract, the code wins. */
  var LIMITS = Object.freeze({
    ID_MAX: 64,
    FIELD_MAX: 100,            /* branch, subject, topic */
    TEXT_MAX: 20000,
    OPTION_TEXT_MAX: 5000,
    OPTION_ID_MAX: 16,
    OPTIONS_MIN: 2,
    OPTIONS_MAX: 26,
    SOURCE_NAME_MAX: 200,
    YEAR_MIN: 1900,
    YEAR_MAX: 2100,
    MARKS_MIN: 1,
    MARKS_MAX: 999,            /* QI_LIMITS.marks in the backend */
    CHUNK_MAX_QUESTIONS: 200,
    PAPER_MAX_QUESTIONS: 200,  /* AT_MAX_QUESTIONS */
    CATALOGUE_MAX_QUESTIONS: 2000, /* QI_LIMITS.questions */
    MAX_BODY_CHARS: 8192       /* AR_MAX_BODY: the whole request body, in characters */
  });

  var ID_RE = /^[A-Za-z0-9_.-]{1,64}$/;
  var OPTION_ID_RE = /^[A-Za-z0-9_.-]{1,16}$/;
  var PAPER_ID_RE = /^gate-(\d{4})-[a-z0-9]+(-[a-z0-9]+)*$/;

  var QUESTION_COLUMNS = Object.freeze(["id", "branch", "year", "subject", "topic", "type", "marks", "text", "options_json", "source_name"]);
  var KEY_COLUMNS = Object.freeze(["question_id", "answer"]);
  var SOURCE_FIELDS = Object.freeze(["name", "url", "sha256", "retrieved_at", "published_at"]);

  var QUESTION_TYPES = Object.freeze(["MCQ", "MSQ", "NAT"]);
  var KEY_STATES = Object.freeze(["none", "staged", "validated", "approved"]);
  var CHECK_STATES = Object.freeze(["ok", "warn", "fail", "off"]);
  var ERROR_CODES = Object.freeze(["unauthenticated", "forbidden_not_owner", "rate_limited", "bad_request", "too_large",
    "feature_disabled", "validation_failed", "not_found", "conflict", "same_person_blocked"]);

  /* ---- ready-to-download templates (one clearly fake example each) ---- */

  function exampleQuestion() {
    return {
      id: "9990001",
      branch: "EXAMPLE-BRANCH",
      year: 2099,
      subject: "Example Subject",
      topic: "Example Topic",
      type: "MCQ",
      marks: 1,
      text: "FAKE EXAMPLE - delete this question. What is 2 + 2?",
      options: [
        { id: "A", text: "3" },
        { id: "B", text: "4" },
        { id: "C", text: "5" },
        { id: "D", text: "6" }
      ],
      source: { name: "FAKE EXAMPLE SOURCE" }
    };
  }

  function csvCell(value) {
    var s = String(value);
    return /[",\r\n]/.test(s) ? "\"" + s.replace(/"/g, "\"\"") + "\"" : s;
  }

  function csvLine(cells) {
    var out = [], i;
    for (i = 0; i < cells.length; i++) { out.push(csvCell(cells[i])); }
    return out.join(",");
  }

  function questionTemplateJson() {
    return JSON.stringify({ questions: [exampleQuestion()] }, null, 2) + "\n";
  }

  function questionTemplateCsv() {
    var q = exampleQuestion();
    var row = [q.id, q.branch, q.year, q.subject, q.topic, q.type, q.marks, q.text, JSON.stringify(q.options), q.source.name];
    return csvLine(QUESTION_COLUMNS) + "\n" + csvLine(row) + "\n";
  }

  /* With a list of question ids: one row per id with the answer left blank for the owner to fill in.
   * With no ids: a single clearly fake example row. Ids that do not match ID_RE are skipped. */
  function keyTemplateCsv(questionIds) {
    var lines = [csvLine(KEY_COLUMNS)], i, id, added = 0;
    if (Array.isArray(questionIds)) {
      for (i = 0; i < questionIds.length; i++) {
        id = questionIds[i];
        if (typeof id === "string" && ID_RE.test(id)) { lines.push(csvLine([id, ""])); added++; }
      }
    }
    if (!added) { lines.push(csvLine(["9990001", "A"])); }
    return lines.join("\n") + "\n";
  }

  var SOURCE_FORM_EXAMPLE = [
    "Name:          FAKE EXAMPLE - GATE 2099 official answer key",
    "Official URL:  https://example.invalid/fake-answer-key.pdf",
    "SHA-256:       0000000000000000000000000000000000000000000000000000000000000000",
    "Retrieved on:  2099-01-01",
    "Published on:  2099-01-01"
  ].join("\n");

  var FORMAT_GUIDE = Object.freeze([
    {
      title: "Questions as a JSON file (shard)",
      lines: [
        "The file holds an object with a list called \"questions\". A plain list of questions is also fine.",
        "Each question has: id, branch, year, subject, topic, type, marks, text, options and source.",
        "The id is text. Digits are allowed, for example \"9990001\". Use only letters, digits, dot, dash and underscore, up to " + LIMITS.ID_MAX + " characters.",
        "type is MCQ (one right option), MSQ (one or more right options) or NAT (a typed number).",
        "MCQ and MSQ need " + LIMITS.OPTIONS_MIN + " to " + LIMITS.OPTIONS_MAX + " options, each with its own short id such as A, B, C and the option text. NAT questions have no options at all.",
        "year is a whole number between " + LIMITS.YEAR_MIN + " and " + LIMITS.YEAR_MAX + ". marks is a whole number from " + LIMITS.MARKS_MIN + " to " + LIMITS.MARKS_MAX + ".",
        "source is an object with a name, up to " + LIMITS.SOURCE_NAME_MAX + " characters.",
        "branch, subject and topic can be up to " + LIMITS.FIELD_MAX + " characters. The question text can be up to " + LIMITS.TEXT_MAX + " characters and each option text up to " + LIMITS.OPTION_TEXT_MAX + ".",
        "Do not put answers in question files. Answers go in the answer-key file.",
        "The large staging master file also works. Its extra fields are ignored."
      ],
      example: questionTemplateJson()
    },
    {
      title: "Questions as a CSV or Excel (XLSX) file",
      lines: [
        "The first row must be exactly: " + QUESTION_COLUMNS.join(",") + ".",
        "One question per row. The same size and wording rules as the JSON file apply.",
        "options_json holds the options as a JSON list of {\"id\":..., \"text\":...}. Leave it blank for NAT questions.",
        "In Excel, format the id column as Text so ids such as 0012345 do not lose their leading zeros.",
        "Use year and marks as plain whole numbers.",
        "Only the first sheet of an Excel file is read."
      ],
      example: questionTemplateCsv()
    },
    {
      title: "Answer keys (CSV, Excel or JSON)",
      lines: [
        "Two columns: " + KEY_COLUMNS.join(" and ") + ". One row per question in the paper.",
        "MCQ: one option id, for example A.",
        "MSQ: all right option ids separated by a semicolon, for example A;C.",
        "NAT with one exact answer: the number, for example 42 or 3.5.",
        "NAT with an accepted range: low..high, for example 3.1..3.3.",
        "For JSON, use a list of objects such as {\"question_id\":\"9990001\",\"answer\":\"A\"}.",
        "After you upload, the console checks the keys, and a key only counts once you approve it."
      ],
      example: keyTemplateCsv([])
    },
    {
      title: "Answer-key source form (filled in once per key set)",
      lines: [
        "Name: a short label for the official document.",
        "Official URL: the address of the official answer-key PDF.",
        "SHA-256: the 64-character fingerprint of that PDF file.",
        "Retrieved on: the date you downloaded the PDF.",
        "Published on: the date the organisers published it."
      ],
      example: SOURCE_FORM_EXAMPLE
    }
  ]);

  var api = {
    LIMITS: LIMITS,
    ID_RE: ID_RE,
    OPTION_ID_RE: OPTION_ID_RE,
    PAPER_ID_RE: PAPER_ID_RE,
    QUESTION_COLUMNS: QUESTION_COLUMNS,
    KEY_COLUMNS: KEY_COLUMNS,
    SOURCE_FIELDS: SOURCE_FIELDS,
    QUESTION_TYPES: QUESTION_TYPES,
    KEY_STATES: KEY_STATES,
    CHECK_STATES: CHECK_STATES,
    ERROR_CODES: ERROR_CODES,
    FORMAT_GUIDE: FORMAT_GUIDE,
    questionTemplateJson: questionTemplateJson,
    questionTemplateCsv: questionTemplateCsv,
    keyTemplateCsv: keyTemplateCsv
  };

  root.GateAdminSpec = api;
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
})(typeof window !== "undefined" ? window : {});
