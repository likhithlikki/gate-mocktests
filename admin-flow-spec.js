/* admin-flow-spec.js - pure, safe explanations for the GATE exam journey.
 * Source of truth: docs/FLOW-MAP.md. No DOM, network, or browser storage access. */
(function (root) {
  "use strict";

  var ORDER = Object.freeze({ green: 0, yellow: 1, red: 2 });
  var STATES = Object.freeze(["green", "yellow", "red"]);

  function words(code) {
    return String(code).replace(/_/g, " ").replace(/\bd\s+(\d+)\b/gi, "D-$1").replace(/^./, function (s) { return s.toUpperCase(); });
  }
  function list(text) { return text.replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "").split(" "); }
  function copy(obj) {
    var out = {}, k;
    for (k in obj) { if (Object.prototype.hasOwnProperty.call(obj, k)) { out[k] = obj[k]; } }
    return out;
  }

  /* The lists below are grouped by the source-map checks where they can arise.
   * They include public error codes, blocked reasons, and nested integrity reasons
   * named in docs/FLOW-MAP.md. */
  var CODE_GROUPS = {
    site_files: list("asset_missing not_configured connection timeout bad_response malformed_data"),
    public_backend: list("not_configured source_unavailable sheet_missing bad_columns forbidden_columns empty_catalogue too_large malformed_data timeout connection bad_response server_error"),
    private_backend: list("not_configured connection timeout bad_response unauthenticated not_initialized server_error"),
    sheets: list("schema_mismatch attempts_migration_required repository_inconsistent paper_registry_inconsistent server_error attempt_corrupt start_verification_failed"),
    login_session: list("feature_disabled invalid_credentials try_later session_standard_disabled session_remember_disabled unauthenticated not_signed_in not_found payload_invalid connection timeout bad_response"),
    questions: list("license_ref_unset license_ref_invalid paper_questions_unavailable server_error question_publication_unapproved"),
    paper: list("paper_identity_missing paper_not_registered paper_registry_inconsistent paper_questions_unavailable profile_unverified payload_invalid selection_empty mock_composition_unresolved_d12 subset_policy_unresolved_d12 selection_too_large request_key_reused key_set_revision_mismatch duration_marks_invalid duration_policy_unresolved_d11 profile_set_missing profile_set_invalid paper_id_unresolved paper_id_invalid conflict"),
    answer_keys: list("answer_keys_unavailable answer_key_profile_mismatch answer_key_coverage_missing key_set_revision_mismatch keys_unavailable key_integrity_failed row_mac digest key_missing key_ambiguous key_not_current key_invalid question_mismatch version_mismatch type_mismatch marks_mismatch year_mismatch content_hash_mismatch key_kind identity profile_mismatch mta_has_answer_fields mcq_answer msq_answers nat_boundary_unspecified nat_range_invalid key_profile_not_pinned attempt_key_set_unpinned approved key_missing key_ambiguous profile_unverified profile_set_missing profile_set_invalid key_not_current"),
    gates: list("feature_disabled scoring_spec_unapproved marking_rules_unconfirmed scoring_backend_not_ready exam_engine_not_available unanswered_zero_not_approved marks_to_all_not_approved nat_syntax_not_approved nat_boundaries_not_approved nat_rounding_not_approved mixed_year_not_approved answer_review_unresolved_d18 question_publication_unapproved"),
    start_check: list("ok payload_invalid selection_empty feature_disabled paper_identity_missing paper_not_registered paper_questions_unavailable profile_unverified attempt_policy_unenforced mock_composition_unresolved_d12 subset_policy_unresolved_d12 selection_too_large duration_marks_invalid duration_policy_unresolved_d11 request_key_reused key_set_revision_mismatch answer_keys_unavailable answer_key_profile_mismatch answer_key_coverage_missing try_later busy conflict active_attempt attempt_corrupt start_verification_failed"),
    scoring: list("feature_disabled answer_keys_unavailable answer_key_profile_mismatch answer_key_coverage_missing key_set_revision_mismatch profile_unverified keys_unavailable key_integrity_failed attempt_key_set_unpinned key_missing key_ambiguous key_not_current key_invalid row_mac digest invalid_integer invalid_fraction fraction_overflow blocked nat_range_invalid nat_boundary_unspecified question_mismatch version_mismatch type_mismatch marks_mismatch year_mismatch content_hash_mismatch key_kind identity profile_mismatch mta_has_answer_fields mcq_answer msq_answers response_malformed question_invalid type content_hash_missing options bad_input questions responses duplicate_question response_for_unknown_question profile_has_no_marks_to_all server_error conflict attempt_not_closed attempt_status_unresolved attempt_status_invalid attempt_close_reason_invalid paper_id_unresolved paper_id_invalid attempts_migration_required attempt_not_found bad_attempt_id attempt_duplicate attempt_metadata_invalid attempt_timing_invalid answers_hash_missing answers_hash_invalid answers_hash_mismatch answers_invalid key_set_pin_missing key_set_pin_invalid profile_hash_mismatch question_count_mismatch pinned_questions_invalid total_marks_mismatch question_not_found question_version_missing question_ambiguous question_field_missing question_field_invalid question_marks_mismatch question_year_mismatch question_crosscheck_failed committed_attempt_status_pending scoring_integrity_error"),
    result_review: list("attempt_not_closed attempt_status_unresolved attempt_status_invalid attempt_close_reason_invalid paper_id_unresolved paper_id_invalid attempts_migration_required attempt_not_found bad_attempt_id attempt_duplicate attempt_metadata_invalid attempt_timing_invalid answers_hash_missing answers_hash_invalid answers_hash_mismatch answers_invalid key_set_pin_missing key_set_pin_invalid profile_set_missing profile_set_invalid profile_hash_mismatch question_count_mismatch pinned_questions_invalid total_marks_mismatch question_not_found question_version_missing question_ambiguous question_field_missing question_field_invalid question_marks_mismatch question_year_mismatch question_crosscheck_failed committed_attempt_status_pending result_not_committed not_found feature_disabled answer_review_unresolved_d18 scoring_integrity_error"),
    save_submit: list("question_publication_unapproved payload_invalid not_found attempt_closed attempt_expired bookmark_limit conflict sequence_mismatch attempt_not_closed attempt_status_unresolved attempt_status_invalid attempt_close_reason_invalid paper_id_unresolved paper_id_invalid attempts_migration_required try_later busy server_error scoring_integrity_error empty_catalogue malformed_data too_large source_unavailable sheet_missing bad_columns forbidden_columns schema_mismatch not_initialized not_configured")
  };

  var REASONS = Object.create(null);
  var GATE_META = {
    question_publication_unapproved: { property: "EXAM_POLICY_QUESTION_PUBLICATION", label: "question publication", state: "yellow", fix: "Review the public question set and publication approval, then set the named property to exactly true only when approved." },
    scoring_spec_unapproved: { property: "EXAM_POLICY_APPROVED", label: "scoring specification approval", state: "yellow", fix: "Review the scoring specification and completed rehearsal, then set the named property to exactly true only after approval." },
    marking_rules_unconfirmed: { property: "EXAM_POLICY_MARKING_RULES_CONFIRMED", label: "marking rules confirmation", state: "yellow", fix: "Verify the marking rules against an authoritative source and worked examples, then record owner approval." },
    scoring_backend_not_ready: { property: "EXAM_POLICY_SCORING_BACKEND_READY", label: "scoring backend readiness", state: "yellow", fix: "Repair and rehearse the scoring backend first; only then set the named property to exactly true." },
    exam_engine_not_available: { property: "EXAM_POLICY_EXAM_ENGINE_AVAILABLE", label: "exam engine availability", state: "yellow", fix: "Complete the exam-engine readiness checks and rehearsal before recording approval." },
    answer_review_unresolved_d18: { property: "EXAM_POLICY_ANSWER_REVIEW", label: "answer review policy", state: "yellow", fix: "Resolve the answer-review policy decision. Review mode must not expose correct options, NAT ranges, keys, or explanations." },
    unanswered_zero_not_approved: { property: "SCORING_POLICY_UNANSWERED_ZERO", label: "unanswered-zero rule", state: "yellow", fix: "Approve and document the unanswered-zero rule after reviewing the official rules and worked examples." },
    marks_to_all_not_approved: { property: "SCORING_POLICY_MARKS_TO_ALL", label: "marks-to-all rule", state: "yellow", fix: "Approve and document the marks-to-all rule after reviewing the official rules and worked examples." },
    nat_syntax_not_approved: { property: "SCORING_POLICY_NAT_SYNTAX", label: "NAT syntax rule", state: "yellow", fix: "Define and verify accepted NAT answer syntax before approving the corresponding scoring property." },
    nat_boundaries_not_approved: { property: "SCORING_POLICY_NAT_BOUNDARIES", label: "NAT range boundary rule", state: "yellow", fix: "Define whether each NAT range boundary is inclusive and verify the behavior before approval." },
    nat_rounding_not_approved: { property: "SCORING_POLICY_NAT_ROUNDING", label: "NAT rounding rule", state: "yellow", fix: "Define and test the NAT rounding rule with worked examples before approval." },
    mixed_year_not_approved: { property: "SCORING_POLICY_MIXED_YEAR", label: "mixed-year scoring rule", state: "yellow", fix: "Keep mixed-year attempts blocked until the owner/spec owner approves a rule and the server implements it. Current start validation requires one paper year." },
    mock_composition_unresolved_d12: { property: null, label: "mock composition decision D-12", state: "yellow", fix: "Keep mock composition blocked until the owner decides and the server implementation is reviewed." },
    subset_policy_unresolved_d12: { property: null, label: "question-subset decision D-12", state: "yellow", fix: "Use the full matching paper for now. Resolve D-12 before supporting arbitrary subsets." },
    duration_policy_unresolved_d11: { property: null, label: "exact-100-mark duration decision D-11", state: "yellow", fix: "Keep this case blocked until the duration policy is explicitly decided and implemented." },
    attempt_policy_unenforced: { property: null, label: "server-enforced attempt policy", state: "yellow", where: "GATE-site/app.js > ATTEMPT_POLICY.enforcedNow and PrivateAuthExam.gs > EX_ATTEMPT_LIFECYCLE_ENABLED / exStartPaperPreflightLocked_().", fix: "Keep online attempts blocked until the server-side attempt lifecycle is approved, deployed, and passes the rehearsal. Do not enable it by changing a browser flag." }
  };

  function addDefaultReason(code) {
    if (REASONS[code]) { return; }
    var gate = GATE_META[code];
    var state = code === "ok" ? "green" : (gate ? gate.state : "red");
    var reason;
    if (code === "ok") {
      reason = "This check passed.";
    } else if (gate) {
      reason = "The " + gate.label + " is not approved or is unresolved.";
    } else if (/^(not_configured|not_initialized|source_unavailable|sheet_missing|bad_columns|forbidden_columns|schema_mismatch)$/.test(code)) {
      state = "red"; reason = "Required configuration or spreadsheet structure is missing or invalid.";
    } else if (/^(empty_catalogue|paper_questions_unavailable|paper_not_registered|paper_identity_missing|license_ref_unset|license_ref_invalid|answer_keys_unavailable|answer_key_coverage_missing|key_missing|profile_unverified|profile_set_missing|result_not_committed)$/.test(code)) {
      state = "yellow"; reason = "A required question, paper, key, licence, profile, or committed result is not ready.";
    } else if (/^(unauthenticated|not_signed_in|invalid_credentials|session_standard_disabled|session_remember_disabled|forbidden_not_owner)$/.test(code)) {
      state = "yellow"; reason = "The current login/session is not permitted to continue this operation.";
    } else if (/^(try_later|busy)$/.test(code)) {
      state = "yellow"; reason = "The service is rate-limited or busy; no new attempt should be created by retrying rapidly.";
    } else if (/^(payload_invalid|selection_empty|selection_too_large|duration_marks_invalid|invalid_integer|invalid_fraction|fraction_overflow)$/.test(code)) {
      state = "yellow"; reason = "The request or selected exam configuration does not meet the expected format or limits.";
    } else if (/^(conflict|request_key_reused|sequence_mismatch|attempt_not_closed|attempt_closed|attempt_expired)$/.test(code)) {
      state = "yellow"; reason = "The request does not match the attempt's current saved state.";
    } else if (/^(not_found|attempt_not_found|question_not_found)$/.test(code)) {
      state = "yellow"; reason = "The requested item was not found or is not available to this account.";
    } else if (/^(server_error|scoring_integrity_error|key_integrity_failed|row_mac|digest|answers_hash_.*|pinned_questions_invalid|key_set_pin_invalid|attempt_duplicate|question_crosscheck_failed|total_marks_mismatch|question_count_mismatch|attempt_metadata_invalid|attempt_timing_invalid)$/.test(code)) {
      state = "red"; reason = "Stored exam data failed an integrity check. The result must remain blocked until investigated.";
    } else if (/^(profile_|key_|nat_|question_|response_|bad_input|duplicate_question|content_hash_|version_mismatch|type_mismatch|marks_mismatch|year_mismatch|mcq_answer|msq_answers|mta_has_answer_fields)/.test(code)) {
      state = "red"; reason = "A question, answer-key, profile, or saved-response value failed server validation.";
    } else if (/^(attempt_status_|attempt_close_reason_|paper_id_|attempts_migration|required|committed_attempt_status_pending)/.test(code)) {
      state = "red"; reason = "The stored attempt or paper state is inconsistent or requires a migration.";
    } else if (code === "feature_disabled" || code === "blocked") {
      state = "yellow"; reason = "A required feature or policy gate is currently disabled.";
    } else if (code === "conflict") {
      state = "yellow"; reason = "The request conflicts with the current saved state.";
    } else {
      state = "red"; reason = "The backend reported: " + words(code) + ".";
    }
    REASONS[code] = {
      state: state,
      reason: reason,
      where: gate ? (gate.where || (gate.property ? "Private Apps Script > Script Properties > " + gate.property : "Private Apps Script policy/code decision")) : "See the matching check below; backend names and table locations are listed in docs/FLOW-MAP.md.",
      fix: gate ? gate.fix : "Use the check's Where and Fix guidance. Do not bypass this condition in the browser; repair the source data/configuration or server code, then rerun the check.",
      toggle: gate && gate.property ? gate.property : null
    };
  }

  var allCodes = Object.create(null), groupName, i, j;
  for (groupName in CODE_GROUPS) {
    if (Object.prototype.hasOwnProperty.call(CODE_GROUPS, groupName)) {
      for (i = 0; i < CODE_GROUPS[groupName].length; i++) { allCodes[CODE_GROUPS[groupName][i]] = true; }
    }
  }
  /* Explicit codes and nested reasons listed in the T0 reason/error catalog. */
  var CATALOG_CODES = list("payload_invalid selection_empty feature_disabled question_publication_unapproved mock_composition_unresolved_d12 paper_identity_missing scoring_spec_unapproved marking_rules_unconfirmed scoring_backend_not_ready exam_engine_not_available answer_keys_unavailable answer_key_profile_mismatch answer_key_coverage_missing key_set_revision_mismatch paper_not_registered profile_unverified paper_questions_unavailable subset_policy_unresolved_d12 selection_too_large duration_marks_invalid duration_policy_unresolved_d11 unanswered_zero_not_approved marks_to_all_not_approved nat_syntax_not_approved nat_boundaries_not_approved nat_rounding_not_approved mixed_year_not_approved answer_review_unresolved_d18 attempt_policy_unenforced attempt_key_set_unpinned keys_unavailable key_integrity_failed row_mac digest profile_set_missing profile_set_invalid blocked invalid_integer invalid_fraction fraction_overflow key_missing key_ambiguous key_not_current key_invalid question_mismatch version_mismatch type_mismatch marks_mismatch year_mismatch content_hash_mismatch key_kind identity profile_mismatch mta_has_answer_fields mcq_answer msq_answers nat_boundary_unspecified nat_range_invalid response_malformed question_invalid type content_hash_missing options bad_input questions responses duplicate_question response_for_unknown_question profile_has_no_marks_to_all server_error conflict request_key_reused sequence_mismatch attempt_not_closed attempt_status_unresolved attempt_status_invalid attempt_close_reason_invalid paper_id_unresolved paper_id_invalid attempts_migration_required bookmark_limit unauthenticated not_signed_in not_found attempt_closed attempt_expired try_later busy result_not_committed attempt_not_found bad_attempt_id attempt_duplicate attempt_metadata_invalid attempt_timing_invalid answers_hash_missing answers_hash_invalid key_set_pin_missing key_set_pin_invalid profile_hash_mismatch question_count_mismatch pinned_questions_invalid total_marks_mismatch question_not_found question_version_missing question_ambiguous question_field_missing question_field_invalid question_marks_mismatch question_year_mismatch answers_hash_mismatch answers_invalid question_crosscheck_failed committed_attempt_status_pending scoring_integrity_error license_ref_unset license_ref_invalid not_configured source_unavailable sheet_missing bad_columns forbidden_columns empty_catalogue too_large malformed_data connection timeout bad_response not_initialized schema_mismatch repository_inconsistent paper_registry_inconsistent invalid_credentials session_standard_disabled session_remember_disabled attempt_corrupt start_verification_failed key_profile_not_pinned asset_missing");
  for (i = 0; i < CATALOG_CODES.length; i++) { allCodes[CATALOG_CODES[i]] = true; }
  for (groupName in allCodes) { if (Object.prototype.hasOwnProperty.call(allCodes, groupName)) { addDefaultReason(groupName); } }

  function explain(code) {
    if (typeof code === "string" && Object.prototype.hasOwnProperty.call(REASONS, code)) { return copy(REASONS[code]); }
    return { state: "yellow", reason: "Unknown status, copy the report.", where: "Status report; code path not mapped in docs/FLOW-MAP.md.", fix: "Copy the report for the maintainer. Do not change a policy gate to work around an unknown status.", toggle: null };
  }

  /* The attempt service (save/submit) is only as ready as its prerequisites. When it is unavailable because the public question
   * catalogue cannot be built, point to that source instead of the save/submit code, which is not the problem. Read-only guidance. */
  var DEPENDENCY_WHERE = "Private Apps Script > Script Property PUBLIC_CATALOGUE_SPREADSHEET_ID > tab Questions_Public (served by the public catalogue web app); qiBuildCatalogue_(). Run admin_diagnose_public_catalogue() (read-only) in the editor.";
  var ATTEMPT_SERVICE_DEPENDENCY = {
    empty_catalogue: { where: DEPENDENCY_WHERE, fix: "Questions_Public has no usable data rows. Only add question content you have the right to distribute because this catalogue is publicly served. If you do not have distribution rights, do not copy third-party questions here; keep real-question publication OFF and use only synthetic data for a technical rehearsal. Save/submit code is not the failing dependency.", reason: "The attempt service depends on the public question catalogue, which has no valid rows." },
    malformed_data: { where: DEPENDENCY_WHERE, fix: "One or more Questions_Public rows fail validation. Run admin_diagnose_public_catalogue() for row numbers and field names. Correct only content you have the right to distribute; the public catalogue may expose question text and options. IDs must be text, year/marks must be numbers, and options use only id and text. Do not loosen the validator or publish third-party questions without permission.", reason: "The attempt service depends on the public question catalogue, which has invalid rows.", state: "yellow" },
    too_large: { where: DEPENDENCY_WHERE, fix: "Questions_Public exceeds the catalogue size limit. Reduce it to the supported number of questions, then rerun the check.", reason: "The attempt service depends on the public question catalogue, which is too large." },
    source_unavailable: { where: DEPENDENCY_WHERE, fix: "The public catalogue spreadsheet cannot be opened. Check PUBLIC_CATALOGUE_SPREADSHEET_ID and that the script owner can access it.", reason: "The attempt service depends on the public question catalogue, whose spreadsheet cannot be opened." },
    sheet_missing: { where: DEPENDENCY_WHERE, fix: "Create the tab named exactly Questions_Public with the allowlisted header columns.", reason: "The attempt service depends on the public question catalogue, whose tab is missing." },
    bad_columns: { where: DEPENDENCY_WHERE, fix: "Questions_Public must have exactly: id, branch, year, subject, topic, type, marks, text, options_json, source_name.", reason: "The attempt service depends on the public question catalogue, whose header is invalid." },
    forbidden_columns: { where: DEPENDENCY_WHERE, fix: "Remove any answer, key, solution or scoring column from Questions_Public. It must stay free of answers.", reason: "The attempt service depends on the public question catalogue, which has a forbidden column." },
    schema_mismatch: { where: "Private Apps Script > checkPrivateDatabases() and migratePrivateDatabaseHeaders().", fix: "A private database tab is incompatible with the expected schema. Back up, run checkPrivateDatabases(), and follow its migration guidance; do not edit headers by hand.", reason: "The attempt service depends on a private database whose tab schema is incompatible." },
    not_initialized: { where: "Private Apps Script > Script Properties and checkPrivateDatabases().", fix: "A private database is configured but unreachable or not initialised. Verify the database ID properties and run setupPrivateDatabases() only as the owner.", reason: "The attempt service depends on a private database that is unreachable or not initialised." },
    not_configured: { where: DEPENDENCY_WHERE, fix: "A required configuration value is missing. Review the named Script Property and rerun the check.", reason: "The attempt service depends on a configuration value that is missing." }
  };

  var CHECK_DEFS = {
    site_files: [
      { id: "assets", label: "Site files and local question data", where: "GATE-site/practice.html, exam.html, app.js, api.js, data/manifest.json and manifest-listed shards.", fix: "Check the browser console and network panel; restore the missing or malformed published file/shard, then reload.", codes: CODE_GROUPS.site_files }
    ],
    public_backend: [
      { id: "public_endpoint", label: "Public catalogue endpoint", where: "GATE-site/api.js and the separate PublicCatalogue Apps Script deployment.", fix: "Confirm the configured public endpoint and deployment are reachable; inspect the safe status response in DevTools.", codes: list("not_configured source_unavailable sheet_missing timeout connection bad_response server_error") },
      { id: "public_catalogue", label: "Public question catalogue and schema", where: "Public Apps Script > Script Property PUBLIC_DB_ID; Questions_Public; PublicCatalogue.gs readHeader_() / buildCatalogue_().", fix: "Restore access to Questions_Public and its allowlisted headers; fix empty, duplicated or malformed rows without adding answers or scoring columns.", codes: list("bad_columns forbidden_columns empty_catalogue too_large malformed_data") }
    ],
    private_backend: [
      { id: "private_endpoint", label: "Private exam endpoint", where: "GATE-site/auth.js and exam-api.js; PrivateAuthExam.gs doPost().", fix: "Verify the private deployment URL, access setting and deployed version; inspect only safe transport/status codes.", codes: list("not_configured connection timeout bad_response unauthenticated") },
      { id: "private_database_config", label: "Private database configuration", where: "Private Apps Script > Script Properties > AUTH_DB_ID, EXAM_DB_ID, KEYS_DB_ID, PUBLIC_CATALOGUE_SPREADSHEET_ID.", fix: "Run the documented setup/migration and confirm the required database properties exist. Never paste their values into a report.", codes: list("not_initialized schema_mismatch server_error") }
    ],
    sheets: [
      { id: "sheet_integrity", label: "Required tabs, headers and stored-record integrity", where: "PRIVATE_DB_SCHEMAS; AUTH_DB, EXAM_DB and KEYS_DB tabs documented in docs/FLOW-MAP.md.", fix: "Run documented setup/migration only where appropriate; do not manually rewrite attempt or key rows. Investigate integrity errors before retrying.", codes: CODE_GROUPS.sheets }
    ],
    login_session: [
      { id: "login_policy", label: "Login and session policy", where: "Private Apps Script > Script Properties > AUTH_POLICY_* and AUTH_DB.sessions / users.", fix: "Review the named auth policy and sign in again if the session is missing or expired. Do not expose password or token values.", codes: list("feature_disabled invalid_credentials try_later session_standard_disabled session_remember_disabled unauthenticated not_signed_in not_found payload_invalid") },
      { id: "owner_status", label: "Recognized account status", where: "AUTH_DB.users status/role; owner-only operations additionally require role exactly owner.", fix: "For owner-only controls, have the owner grant the approved account the lowercase role owner. This does not change candidate exam authorization.", codes: list("forbidden_not_owner") }
    ],
    questions: [
      { id: "question_repository", label: "Active question repository and licensing", where: "EXAM_DB.questions and QUESTION_LICENSE_REF; qiReadRepo_(), qiActiveRow_(), qiImportCore_().", fix: "Import valid active questions through the supported flow. Set a valid license reference only after confirming the source rights; repair corrupt versions/hashes in the supported workflow.", codes: list("license_ref_unset license_ref_invalid paper_questions_unavailable repository_inconsistent question_not_found question_version_missing question_ambiguous question_field_missing question_field_invalid question_marks_mismatch question_year_mismatch question_count_mismatch total_marks_mismatch") },
      { id: "question_publication", label: "Question-publication approval", where: "Private Apps Script > Script Properties > EXAM_POLICY_QUESTION_PUBLICATION; exRequireOpen_().", fix: "Review the catalogue and owner approval. Publication remains a server-enforced gate and must not be bypassed in browser code.", codes: list("question_publication_unapproved") }
    ],
    paper: [
      { id: "paper_registration", label: "Registered paper and immutable membership", where: "EXAM_DB.papers and EXAM_DB.paper_questions; exLoadPaper_() and the paper registry.", fix: "Register a valid active paper using the supported operation. If membership digest or positions are inconsistent, investigate rather than editing attempt pins.", codes: list("paper_identity_missing paper_not_registered paper_registry_inconsistent paper_questions_unavailable paper_id_unresolved paper_id_invalid paper_registry_inconsistent") },
      { id: "marking_profile", label: "Verified marking profile", where: "Server SC_PROFILES / KEYSTORE_VERIFIED_PROFILES and browser MARKING_PROFILES in GATE-site/app.js.", fix: "Use only a verified server profile. The baseline contains GATE 2026 only; do not invent or borrow rules for another year.", codes: list("profile_unverified profile_set_missing profile_set_invalid key_profile_not_pinned profile_hash_mismatch") },
      { id: "selection_and_duration", label: "Selection, mock/subset mode and duration", where: "opStartAttempt_(), exCheckKeys_(), EX_FILTER_KEYS and exDurationPlan_() in PrivateAuthExam.gs.", fix: "Use the valid full paper with supported selection and duration. Keep D-11/D-12 cases blocked until the owner/spec decision and reviewed implementation.", codes: list("payload_invalid selection_empty mock_composition_unresolved_d12 subset_policy_unresolved_d12 selection_too_large duration_marks_invalid duration_policy_unresolved_d11 request_key_reused key_set_revision_mismatch conflict") }
    ],
    answer_keys: [
      { id: "approved_key_set", label: "Approved complete answer-key set", where: "KEYS_DB.key_sets and KEYS_DB.answer_keys; ksLoadApprovedKeySetLocked_().", fix: "Use the documented stage → validate → approve workflow; ensure every paper question is covered before starting or scoring.", codes: list("answer_keys_unavailable answer_key_coverage_missing keys_unavailable key_missing key_ambiguous key_not_current not_found") },
      { id: "key_integrity_and_profile", label: "Key integrity, type and profile match", where: "KEYS_DB key rows and KEY_ROW_MAC_SECRET_V1; ssValidateKeySet_() / exValidateStartKeyCoverage_().", fix: "Re-stage and re-validate from the official source with a matching verified profile. Do not hand-edit signed rows or expose answer values.", codes: list("answer_key_profile_mismatch key_set_revision_mismatch key_integrity_failed row_mac digest key_invalid question_mismatch version_mismatch type_mismatch marks_mismatch year_mismatch content_hash_mismatch key_kind identity profile_mismatch mta_has_answer_fields mcq_answer msq_answers nat_boundary_unspecified nat_range_invalid key_profile_not_pinned attempt_key_set_unpinned profile_unverified profile_set_missing profile_set_invalid") }
    ],
    gates: [
      { id: "operational_gate", label: "Global exam/scoring approval gates", where: "Private Apps Script > Script Properties > EXAM_POLICY_APPROVED, EXAM_POLICY_MARKING_RULES_CONFIRMED, EXAM_POLICY_SCORING_BACKEND_READY, EXAM_POLICY_EXAM_ENGINE_AVAILABLE.", fix: "Review authoritative rules and pass the rehearsal before setting a gate. Turning a browser flag on is not an approval.", codes: list("scoring_spec_unapproved marking_rules_unconfirmed scoring_backend_not_ready exam_engine_not_available") },
      { id: "scoring_policy", label: "Detailed scoring-policy decisions", where: "Private Apps Script > Script Properties > SCORING_POLICY_*; scPolicyFromProperties_().", fix: "Document and test the specific rule before approving it. Keep unresolved D-11/D-12 and mixed-year scenarios blocked.", codes: list("unanswered_zero_not_approved marks_to_all_not_approved nat_syntax_not_approved nat_boundaries_not_approved nat_rounding_not_approved mixed_year_not_approved mock_composition_unresolved_d12 subset_policy_unresolved_d12 duration_policy_unresolved_d11") },
      { id: "publication_and_review_gates", label: "Publication and answer-review gates", where: "Private Apps Script > Script Properties > EXAM_POLICY_QUESTION_PUBLICATION and EXAM_POLICY_ANSWER_REVIEW.", fix: "Review the corresponding policy and data first. Review never releases correct options, NAT ranges, keys, or explanations.", codes: list("question_publication_unapproved answer_review_unresolved_d18") }
    ],
    start_check: [
      { id: "start_preconditions", label: "Read-only start preconditions", where: "opStartAttempt_(), exRequireOpen_(), exRequireScoringOperations_() and the exam/key repositories in PrivateAuthExam.gs.", fix: "Correct the earliest failed paper, question, key, profile or gate check. Never call start_attempt just to test readiness; it may create an attempt.", codes: list("feature_disabled blocked payload_invalid selection_empty paper_identity_missing paper_not_registered paper_questions_unavailable profile_unverified attempt_policy_unenforced mock_composition_unresolved_d12 subset_policy_unresolved_d12 selection_too_large duration_marks_invalid duration_policy_unresolved_d11 answer_keys_unavailable answer_key_profile_mismatch answer_key_coverage_missing key_set_revision_mismatch request_key_reused conflict try_later busy attempt_corrupt start_verification_failed") },
      { id: "active_attempt_and_rate_limit", label: "Active attempt and start limits", where: "EXAM_DB.attempts; opStartAttempt_() and EX_STARTS_PER_HOUR.", fix: "Resume the existing active attempt or wait for the limit window. Retry with the same request key only for an identical idempotent request.", codes: list("try_later busy request_key_reused") }
    ],
    scoring: [
      { id: "scoring_state_and_policies", label: "Closed attempt and approved scoring policy", where: "opScoreAttempt_(), ssComputeScore_(), SC_OPERATIONAL_GATES and SCORING_POLICY_*.", fix: "Submit/close the attempt and resolve the precise gate or policy blocker. Do not display a total until a valid result is committed.", codes: list("feature_disabled blocked unanswered_zero_not_approved marks_to_all_not_approved nat_syntax_not_approved nat_boundaries_not_approved nat_rounding_not_approved mixed_year_not_approved attempt_not_closed attempt_status_unresolved attempt_status_invalid attempt_close_reason_invalid paper_id_unresolved paper_id_invalid attempts_migration_required not_found try_later busy") },
      { id: "key_scoring_validation", label: "Pinned keys, question versions and scoring validation", where: "ssLoadKeys_(), ssValidateKeySet_(), scScoreQuestionCore_() and immutable question/answer/key rows.", fix: "Resolve missing or mismatched key/profile/question data through the supported owner workflow; integrity failures require maintainer investigation.", codes: list("answer_keys_unavailable answer_key_profile_mismatch answer_key_coverage_missing key_set_revision_mismatch answer_key_profile_mismatch keys_unavailable key_integrity_failed row_mac digest key_missing key_ambiguous key_not_current key_invalid question_mismatch version_mismatch type_mismatch marks_mismatch year_mismatch content_hash_mismatch key_kind identity profile_mismatch mta_has_answer_fields mcq_answer msq_answers nat_boundary_unspecified nat_range_invalid invalid_integer invalid_fraction fraction_overflow response_malformed question_invalid type content_hash_missing options bad_input questions responses duplicate_question response_for_unknown_question profile_has_no_marks_to_all key_profile_not_pinned attempt_key_set_unpinned profile_set_missing profile_set_invalid profile_hash_mismatch") },
      { id: "attempt_and_result_integrity", label: "Attempt, saved-answer and result integrity", where: "atLoadAttemptForScoring_(), ssValidateLoaded_(), ssValidateScored_(), ssReadCommitted_(); EXAM_DB attempts/answers/results and KEYS_DB key rows.", fix: "Keep scoring and result display blocked. Preserve records and have the maintainer investigate integrity/migration errors; do not edit result rows manually.", codes: list("server_error scoring_integrity_error attempt_not_found bad_attempt_id attempt_duplicate attempt_metadata_invalid attempt_timing_invalid answers_hash_missing answers_hash_invalid answers_hash_mismatch answers_invalid key_set_pin_missing key_set_pin_invalid question_count_mismatch pinned_questions_invalid total_marks_mismatch question_not_found question_version_missing question_ambiguous question_field_missing question_field_invalid question_marks_mismatch question_year_mismatch question_crosscheck_failed committed_attempt_status_pending attempt_corrupt start_verification_failed") }
    ],
    save_submit: [
      { id: "save_submit_lifecycle", label: "Save and submit lifecycle", where: "opSaveAnswers_() and opSubmitAttempt_(); EXAM_DB.attempts, attempt_questions and answers.", fix: "Use the signed-in account and the current attempt, save only valid pinned-question responses before the deadline, and resynchronize on sequence conflicts. Submission closes the attempt but does not approve keys or score it.", codes: CODE_GROUPS.save_submit, codeOverrides: ATTEMPT_SERVICE_DEPENDENCY }
    ],
    result_review: [
      { id: "result_available", label: "Committed result availability", where: "opGetResult_(), ssGetCommittedResult_(); EXAM_DB.attempts, results and result_items.", fix: "Confirm the attempt is closed and scoring completed. If the result is not committed or fails integrity checks, do not show a score; investigate the scoring report.", codes: list("result_not_committed attempt_not_closed not_found server_error scoring_integrity_error committed_attempt_status_pending attempt_duplicate attempt_metadata_invalid attempt_timing_invalid answers_hash_missing answers_hash_invalid answers_hash_mismatch answers_invalid pinned_questions_invalid key_set_pin_invalid question_count_mismatch total_marks_mismatch profile_hash_mismatch") },
      { id: "answer_review_policy", label: "Answer-review permission", where: "Private Apps Script > Script Properties > EXAM_POLICY_ANSWER_REVIEW; opGetResultReview_().", fix: "Resolve the review policy through the owner process; even enabled review must not expose answer keys, correct options, NAT ranges, or explanations.", codes: list("answer_review_unresolved_d18 feature_disabled") },
      { id: "review_integrity", label: "Review consistency with the committed attempt", where: "opGetResultReview_(); EXAM_DB.attempt_questions, answers, results and result_items.", fix: "Keep review blocked and ask the maintainer to investigate mismatched or corrupt stored rows.", codes: list("scoring_integrity_error server_error pinned_questions_invalid question_crosscheck_failed result_not_committed") }
    ]
  };

  function makeCheck(def) {
    var reasons = Object.create(null), codes = (def.codes || []).slice(), i, code, entry, gate;
    if (codes.indexOf("ok") < 0) { codes.unshift("ok"); }
    for (i = 0; i < codes.length; i++) {
      code = codes[i];
      if (!REASONS[code]) { addDefaultReason(code); }
      entry = copy(REASONS[code]);
      /* Context-specific locations and fixes are more helpful than a generic code-only hint. */
      if (!GATE_META[code] && code !== "ok") { entry.where = def.where; entry.fix = def.fix; }
      if (def.codeOverrides && Object.prototype.hasOwnProperty.call(def.codeOverrides, code)) {
        entry.where = def.codeOverrides[code].where; entry.fix = def.codeOverrides[code].fix;
        if (def.codeOverrides[code].reason) { entry.reason = def.codeOverrides[code].reason; }
        if (def.codeOverrides[code].state) { entry.state = def.codeOverrides[code].state; }
      }
      if (code === "ok") { entry.where = def.where; entry.fix = "No action required for this check."; entry.toggle = null; }
      gate = GATE_META[code];
      if (gate && gate.property) { entry.toggle = gate.property; entry.where = "Private Apps Script > Script Properties > " + gate.property; entry.fix = gate.fix; }
      reasons[code] = entry;
    }
    return { id: def.id, label: def.label, reasons: reasons };
  }

  var STEP_DEFS = [
    { id: "site_files", title: "Site files", checks: CHECK_DEFS.site_files },
    { id: "public_backend", title: "Public backend", checks: CHECK_DEFS.public_backend },
    { id: "private_backend", title: "Private backend", checks: CHECK_DEFS.private_backend },
    { id: "sheets", title: "Sheets and schema", checks: CHECK_DEFS.sheets },
    { id: "login_session", title: "Login and session", checks: CHECK_DEFS.login_session },
    { id: "questions", title: "Questions", checks: CHECK_DEFS.questions },
    { id: "paper", title: "Paper", checks: CHECK_DEFS.paper },
    { id: "answer_keys", title: "Answer keys", checks: CHECK_DEFS.answer_keys },
    { id: "gates", title: "Gates", checks: CHECK_DEFS.gates },
    { id: "start_check", title: "Start check", checks: CHECK_DEFS.start_check },
    { id: "scoring", title: "Save, submit and score", checks: CHECK_DEFS.save_submit.concat(CHECK_DEFS.scoring) },
    { id: "result_review", title: "Result and review", checks: CHECK_DEFS.result_review }
  ];

  var STEPS = [], assignedCodes = Object.create(null), stepIndex, checkIndex, stepDef, checkDef, mk, codeKey;
  for (stepIndex = 0; stepIndex < STEP_DEFS.length; stepIndex++) {
    stepDef = STEP_DEFS[stepIndex];
    var checks = [];
    for (checkIndex = 0; checkIndex < stepDef.checks.length; checkIndex++) {
      checkDef = stepDef.checks[checkIndex]; mk = makeCheck(checkDef); checks.push(mk);
      for (codeKey in mk.reasons) { if (Object.prototype.hasOwnProperty.call(mk.reasons, codeKey)) { assignedCodes[codeKey] = true; } }
    }
    STEPS.push({ id: stepDef.id, title: stepDef.title, checks: checks });
  }

  function codeEntryFor(checkDef, code) {
    if (checkDef && checkDef.reasons && Object.prototype.hasOwnProperty.call(checkDef.reasons, code)) { return checkDef.reasons[code]; }
    return explain(code);
  }
  function stateForResult(check) {
    if (check && typeof check.state === "string" && Object.prototype.hasOwnProperty.call(ORDER, check.state)) { return check.state; }
    if (check && typeof check.code === "string") { return explain(check.code).state; }
    return "yellow";
  }
  function stepState(checks) {
    var best = "green", i, state;
    if (!Array.isArray(checks) || checks.length === 0) { return "yellow"; }
    for (i = 0; i < checks.length; i++) {
      state = stateForResult(checks[i]);
      if (ORDER[state] > ORDER[best]) { best = state; }
      if (best === "red") { return best; }
    }
    return best;
  }
  function findStepDef(id) {
    var i;
    for (i = 0; i < STEPS.length; i++) { if (STEPS[i].id === id) { return STEPS[i]; } }
    return null;
  }
  function findCheckDef(step, id) {
    var i, wanted = id;
    if (!step || !Array.isArray(step.checks)) { return null; }
    for (i = 0; i < step.checks.length; i++) {
      if (step.checks[i].id === wanted) { return step.checks[i]; }
    }
    return null;
  }
  function firstBlocker(steps) {
    var s, c, runStep, defStep, runCheck, defCheck, code, entry, state, checkId;
    if (!Array.isArray(steps) || steps.length === 0) { return null; }
    for (s = 0; s < steps.length; s++) {
      runStep = steps[s] || {};
      defStep = findStepDef(runStep.id);
      if (!Array.isArray(runStep.checks) || runStep.checks.length === 0) { continue; }
      for (c = 0; c < runStep.checks.length; c++) {
        runCheck = runStep.checks[c] || {};
        checkId = runCheck.check_id || runCheck.id;
        code = runCheck.code;
        defCheck = findCheckDef(defStep, checkId);
        if (typeof runCheck.state === "string" && Object.prototype.hasOwnProperty.call(ORDER, runCheck.state)) {
          state = runCheck.state;
          entry = typeof code === "string" ? codeEntryFor(defCheck, code) : { state: state, reason: "This check is not green.", where: "Status report.", fix: "Review the check details before proceeding.", toggle: null };
          if (entry.state !== state) { entry = copy(entry); entry.state = state; }
        } else {
          entry = codeEntryFor(defCheck, code);
          state = entry.state;
        }
        if (state !== "green") {
          return {
            stepId: runStep.id || null,
            stepIndex: s,
            stepTitle: (defStep && defStep.title) || runStep.title || "Unknown step",
            checkId: checkId || null,
            code: typeof code === "string" ? code : null,
            state: state,
            reason: entry.reason,
            where: entry.where,
            fix: entry.fix,
            toggle: entry.toggle || null
          };
        }
      }
    }
    return null;
  }

  var REASON_CODES = Object.keys(assignedCodes).sort();
  for (var r = 0; r < REASON_CODES.length; r++) { REASONS[REASON_CODES[r]] = REASONS[REASON_CODES[r]] || explain(REASON_CODES[r]); }

  function deepFreeze(value) {
    var k;
    if (!value || typeof value !== "object" || Object.isFrozen(value)) { return value; }
    Object.freeze(value);
    for (k in value) { if (Object.prototype.hasOwnProperty.call(value, k)) { deepFreeze(value[k]); } }
    return value;
  }
  var api = {
    STEP_IDS: Object.freeze(STEP_DEFS.map(function (s) { return s.id; })),
    STEPS: deepFreeze(STEPS),
    REASON_CODES: Object.freeze(REASON_CODES),
    stepState: stepState,
    firstBlocker: firstBlocker,
    explain: explain
  };
  deepFreeze(api);
  root.GateAdminFlow = api;
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : {}));
