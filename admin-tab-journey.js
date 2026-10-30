/* admin-tab-journey.js - safe, read-only exam flow diagnostics for the owner console. */
(function (root) {
  'use strict';
  var consoleApi = root.GateAdminConsole;
  if (!consoleApi) { return; }
  var refresh = null;
  function word(state) { return ({ green: 'Green · Ready', yellow: 'Yellow · Needs attention', red: 'Red · Blocked' })[state] || 'Yellow · Unknown'; }
  function symbol(state) { return ({ green: '✓', yellow: '!', red: '✕' })[state] || '?'; }
  function badge(ctx, state) { return ctx.el('span', 'admin-flow-badge flow-' + state, symbol(state) + ' ' + word(state)); }
  function dataOf(ctx, response) { return ctx.responseData(response); }
  function codeOf(ctx, response) { return ctx.responseCode(response); }
  function isOk(ctx, response) { return codeOf(ctx, response) === 'ok'; }
  function codeExplanation(flow, checkDef, code) {
    if (checkDef && checkDef.reasons && Object.prototype.hasOwnProperty.call(checkDef.reasons, code)) { return checkDef.reasons[code]; }
    return flow.explain(code);
  }
  function safeCode(code) { return typeof code === 'string' && /^[a-z0-9_]{1,64}$/.test(code) ? code : 'server_error'; }
  function normalizeSteps(flow, data, overlay) {
    var serverSteps = Array.isArray(data && data.steps) ? data.steps : [], byId = Object.create(null);
    serverSteps.forEach(function (s) { if (s && typeof s.id === 'string' && Array.isArray(s.checks)) { byId[s.id] = s; } });
    return flow.STEPS.map(function (step) {
      var server = byId[step.id], serverChecks = Object.create(null);
      if (server) { server.checks.forEach(function (c) { if (c && typeof c.check_id === 'string') { serverChecks[c.check_id] = c; } }); }
      return { id: step.id, title: step.title, checks: step.checks.map(function (def) {
        var raw = serverChecks[def.id], code = safeCode(raw && raw.code ? raw.code : 'not_configured');
        var e = codeExplanation(flow, def, code), state = code === 'ok' ? 'green' : e.state;
        var o = overlay && overlay[step.id + ':' + def.id];
        if (o) { code = o.code || code; state = o.state || state; e = { state: state, reason: o.reason || e.reason, where: o.where || e.where, fix: o.fix || e.fix, toggle: e.toggle || null }; }
        return { id: def.id, check_id: def.id, label: def.label, code: code, state: state,
          reason: e.reason, where: e.where, fix: e.fix, toggle: e.toggle || null };
      }) };
    });
  }
  function probeSiteAssets(rootObj) {
    var doc = rootObj.document;
    var required = ['practice.html', 'exam.html', 'app.js', 'api.js', 'data/manifest.json'];
    if (typeof rootObj.fetch !== 'function') {
      return Promise.resolve({ code: 'not_configured', state: 'yellow', reason: 'This browser cannot run the same-origin asset probe.', where: 'GATE-site browser runtime.', fix: 'Open the deployed site in a current browser and inspect the Network panel for missing site assets.' });
    }
    return Promise.all(required.map(function (path) {
      return rootObj.fetch(path, { method: 'HEAD', cache: 'no-store', credentials: 'same-origin' }).then(function (r) {
        if (!r || !r.ok) { throw new Error('asset_missing'); }
        return true;
      });
    })).then(function () {
      return { code: 'ok', state: 'green', reason: 'The required site files responded to same-origin HEAD requests.', where: 'GATE-site/practice.html, exam.html, app.js, api.js and data/manifest.json.', fix: 'No action required for this check.' };
    }, function () {
      return { code: 'asset_missing', state: 'red', reason: 'At least one required site file did not respond successfully.', where: 'GATE-site/practice.html, exam.html, app.js, api.js and data/manifest.json.', fix: 'Restore the missing file or correct its published path, then rerun the journey check.' };
    });
  }
  function probePublicStatus(rootObj) {
    var api = rootObj.GatePublicApi;
    if (!api || typeof api.isConfigured !== 'function' || !api.isConfigured()) {
      return Promise.resolve({ code: 'not_configured', state: 'red', reason: 'The public catalogue endpoint is not configured with an accepted URL.', where: 'GATE-site/api.js > ENDPOINT_URL and the separate PublicCatalogue Apps Script deployment.', fix: 'Set the owner-managed public deployment URL in api.js and verify the deployment.' });
    }
    /* status.html intentionally restricts script-src to self. The public transport is JSONP, so loading
     * its remote script from this page would violate the site's CSP. Do not weaken CSP for diagnostics. */
    return Promise.resolve({ code: 'not_configured', state: 'yellow', reason: 'The endpoint URL is configured, but this strict-CSP page cannot safely probe the cross-origin JSONP response.', where: 'GATE-site/status.html CSP and GATE-site/api.js > GatePublicApi.loadCatalogueMetadata().', fix: 'Verify the public catalogue from the practice page and browser Network panel. Keep the strict script-src policy; do not add the remote endpoint as executable script.' });
  }
  function mountJourney(panel, ctx) {
    var status, fixtureStatus, banner, paperSelect, list, runButton, rehearsalButton, createButton, approveRehearsalButton, removeButton, verifierInput, removeConfirmInput, previewButton, attemptButton, previewPanel, attemptPanel,
      lastSteps = [], running = false, provisioning = false, canApproveRehearsal = false;
    function tell(text, state) { ctx.clear(status); ctx.message(status, text, state || 'info'); }
    function tellFixture(text, state) { if (!fixtureStatus) { tell(text, state); return; } ctx.clear(fixtureStatus); ctx.message(fixtureStatus, text, state || 'info'); }
    function renderBanner(steps) {
      ctx.clear(banner);
      var blocker = root.GateAdminFlow.firstBlocker(steps);
      if (!blocker) {
        banner.className = 'admin-flow-banner flow-green';
        banner.appendChild(badge(ctx, 'green'));
        banner.appendChild(ctx.el('strong', '', 'Exam can start')); return;
      }
      var source = null;
      steps.some(function (s) { if (s.id !== blocker.stepId) { return false; } source = s.checks.filter(function (c) { return c.id === blocker.checkId; })[0] || null; return !!source; });
      banner.className = 'admin-flow-banner flow-' + blocker.state;
      banner.appendChild(badge(ctx, blocker.state));
      banner.appendChild(ctx.el('strong', '', 'Exam is blocked at step ' + (blocker.stepIndex + 1) + ': ' + (source ? source.reason : blocker.reason)));
      if (source) {
        banner.appendChild(ctx.el('p', '', 'Where: ' + source.where));
        banner.appendChild(ctx.el('p', '', 'Fix: ' + source.fix));
      }
    }
    function renderSteps(steps) {
      ctx.clear(list); lastSteps = steps;
      steps.forEach(function (step, index) {
        var wrap = ctx.el('details', 'admin-flow-step flow-' + root.GateAdminFlow.stepState(step.checks));
        var sum = ctx.el('summary', 'admin-flow-summary');
        sum.appendChild(ctx.el('span', 'admin-flow-step-number', String(index + 1)));
        sum.appendChild(ctx.el('span', 'admin-flow-step-title', step.title));
        sum.appendChild(badge(ctx, root.GateAdminFlow.stepState(step.checks)));
        var nonGreen = step.checks.filter(function (c) { return c.state !== 'green'; });
        sum.appendChild(ctx.el('span', 'admin-flow-step-summary', nonGreen.length ? nonGreen.length + ' check(s) need attention' : 'All checks passed'));
        sum.addEventListener('click', function () { root.setTimeout(function () { sum.setAttribute('aria-expanded', wrap.open ? 'true' : 'false'); }, 0); });
        wrap.appendChild(sum);
        var checks = ctx.el('div', 'admin-flow-check-list');
        step.checks.forEach(function (check) {
          var card = ctx.el('article', 'admin-flow-check flow-' + check.state);
          var header = ctx.el('div', 'admin-flow-check-head');
          header.appendChild(ctx.el('strong', '', check.label)); header.appendChild(badge(ctx, check.state));
          card.appendChild(header);
          card.appendChild(ctx.el('p', '', 'Reason: ' + check.reason));
          card.appendChild(ctx.el('p', '', 'Where: ' + check.where));
          card.appendChild(ctx.el('p', '', 'Fix: ' + check.fix));
          card.appendChild(ctx.el('p', 'admin-flow-code', 'Code: ' + check.code));
          checks.appendChild(card);
        });
        wrap.appendChild(checks); list.appendChild(wrap);
      });
      renderBanner(steps);
    }
    function formatReport(steps) {
      var lines = ['GATE Prep Studio — Exam journey report', 'Status is diagnostic only; the backend remains the authority.', ''];
      steps.forEach(function (step, i) {
        lines.push((i + 1) + '. ' + step.title + ' — ' + word(root.GateAdminFlow.stepState(step.checks)));
        step.checks.forEach(function (c) {
          lines.push('  ' + c.label + ' [' + c.code + '] — ' + word(c.state));
          if (c.state !== 'green') { lines.push('    Reason: ' + c.reason, '    Where: ' + c.where, '    Fix: ' + c.fix); }
        });
      });
      return lines.join('\n');
    }
    function copyReport() {
      var text = formatReport(lastSteps);
      if (root.navigator && root.navigator.clipboard && typeof root.navigator.clipboard.writeText === 'function') {
        root.navigator.clipboard.writeText(text).then(function () { tell('Exam journey report copied. The report contains only displayed diagnostic codes and fixed guidance.', 'success'); }, function () { tell('Copy was blocked by this browser. Select the visible report status and try the browser clipboard permission again.', 'error'); });
      } else { tell('Clipboard access is unavailable in this browser. Run the check again in a secure context to enable Copy report.', 'error'); }
    }
    var REHEARSAL_ID = 'gate-2026-rehearsal';
    var REHEARSAL_QUESTION_IDS = ['rehearsal_mcq_q1', 'rehearsal_msq_q2', 'rehearsal_nat_q3'];
    var REHEARSAL_BATCH_ID = 'gps_rehearsal_keys_v1';
    var REHEARSAL_SOURCE = {
      name: 'GATE Prep Studio synthetic rehearsal fixture — NOT OFFICIAL',
      url: 'https://example.invalid/gate-prep-studio-rehearsal-fixture',
      sha256: '8e64070fcc88ff22216d7b8d5dfbd975fc4105e3c0133c88cdd47837ed801e5c',
      retrieved_at: new Date().toISOString().slice(0, 10), published_at: '', stage: 'unknown', section: 'rehearsal-fixture'
    };
    function isSuccess(r, allowed) { return !!r && allowed.indexOf(ctx.responseCode(r)) >= 0; }
    function rehearsalQuestions() {
      function q(id, type, text, options) {
        var value = { id: id, branch: 'CS', year: 2026, subject: 'FAKE REHEARSAL', topic: 'FIXTURE ONLY', type: type, marks: 1,
          text: 'FAKE REHEARSAL ONLY — not a real GATE question. ' + text,
          source: { name: 'FAKE REHEARSAL FIXTURE — NOT OFFICIAL' } };
        if (options) { value.options = options; }
        return value;
      }
      return [
        q(REHEARSAL_QUESTION_IDS[0], 'MCQ', 'Which option is the synthetic key?', [{ id: 'A', text: 'Fake A' }, { id: 'B', text: 'Fake B' }, { id: 'C', text: 'Fake C' }, { id: 'D', text: 'Fake D' }]),
        q(REHEARSAL_QUESTION_IDS[1], 'MSQ', 'Select the synthetic key options.', [{ id: 'A', text: 'Fake A' }, { id: 'B', text: 'Fake B' }, { id: 'C', text: 'Fake C' }, { id: 'D', text: 'Fake D' }]),
        q(REHEARSAL_QUESTION_IDS[2], 'NAT', 'What is the synthetic numeric answer?')
      ];
    }
    function setProvisioning(disabled) {
      provisioning = disabled;
      if (createButton) { createButton.disabled = disabled; }
      if (previewButton) { previewButton.disabled = disabled; }
      if (attemptButton) { attemptButton.disabled = disabled; }
      if (removeButton) { removeButton.disabled = disabled || !removeConfirmInput || removeConfirmInput.value !== REHEARSAL_ID; }
      if (runButton) { runButton.disabled = disabled || running; }
      if (rehearsalButton) { rehearsalButton.disabled = disabled || running; }
      if (approveRehearsalButton) { approveRehearsalButton.disabled = disabled || !canApproveRehearsal; }
    }
    function createRehearsal() {
      if (provisioning) { return; }
      var verifiedBy = verifierInput.value.trim().toLowerCase();
      if (!verifiedBy || verifiedBy.length > 256) { tellFixture('Enter a real independent reviewer identity. The verifier must not be the current owner; the server checks separation again.', 'error'); return; }
      setProvisioning(true); tellFixture('Checking whether the reserved rehearsal already exists…', 'info');
      ctx.api.papersList().then(function (r) {
        if (!isSuccess(r, ['ok'])) { throw Object.assign(new Error('Could not read registered papers.'), { code: ctx.responseCode(r) }); }
        var papers = ctx.responseData(r).papers || [];
        if (papers.some(function (p) { return p.paper_id === REHEARSAL_ID; })) {
          throw Object.assign(new Error('The reserved rehearsal already exists. Remove its data first or run the read-only Journey check.'), { code: 'conflict' });
        }
        tellFixture('Importing three clearly fake MCQ, MSQ and NAT questions…', 'info');
        return ctx.api.importQuestions(rehearsalQuestions(), function (progress) {
          tellFixture('Importing rehearsal fixture: ' + progress.done + ' / ' + progress.total + ' questions; created ' + progress.created + ', updated ' + progress.updated + ', unchanged ' + progress.unchanged + '.', 'info');
        });
      }).then(function () {
        tellFixture('Registering the reserved rehearsal paper with the pinned GATE-2026@1 profile…', 'info');
        return ctx.api.registerPaper({ paper_id: REHEARSAL_ID, year: 2026, paper_code: 'rehearsal', session: '1',
          title: 'GATE 2026 REHEARSAL — FAKE DATA ONLY', question_ids: REHEARSAL_QUESTION_IDS.slice(), marking_profile_id: 'GATE-2026', marking_profile_version: '1' });
      }).then(function (r) {
        if (!isSuccess(r, ['ok', 'registered', 'unchanged', 'membership_completed'])) { throw Object.assign(new Error('Rehearsal paper registration failed.'), { code: ctx.responseCode(r) }); }
        tellFixture('Staging the synthetic answer keys. The source is a reserved example.invalid fixture, not an official PDF.', 'info');
        return ctx.api.stageKeys(REHEARSAL_BATCH_ID, [
          { question_id: REHEARSAL_QUESTION_IDS[0], answer: 'B' },
          { question_id: REHEARSAL_QUESTION_IDS[1], answer: 'A;C' },
          { question_id: REHEARSAL_QUESTION_IDS[2], answer: '3.5' }
        ], { paper_id: REHEARSAL_ID, verified_by: verifiedBy, source: REHEARSAL_SOURCE });
      }).then(function (r) {
        if (!isSuccess(r, ['ok', 'unchanged', 'already_staged'])) { throw Object.assign(new Error('Rehearsal key staging failed.'), { code: ctx.responseCode(r) }); }
        tellFixture('Validating the staged fixture keys…', 'info');
        return ctx.api.validateKeys(REHEARSAL_BATCH_ID);
      }).then(function (r) {
        if (!isSuccess(r, ['ok', 'validated', 'unchanged'])) { throw Object.assign(new Error('Rehearsal key validation failed.'), { code: ctx.responseCode(r) }); }
        tellFixture('Rehearsal data is staged and validated. A different active owner must finish approval: the account that staged this batch cannot approve its own keys. Sign in as the independent approver, then use the approval button below. Exam-start remains OFF.', 'warning');
        return ctx.api.papersList();
      }).then(function (r) {
        if (isSuccess(r, ['ok'])) {
          var matchingPaper = (ctx.responseData(r).papers || []).filter(function (p) { return p.paper_id === REHEARSAL_ID; })[0];
          var found = !!matchingPaper;
          canApproveRehearsal = !!matchingPaper && ['staged', 'validated'].indexOf(matchingPaper.key_state) >= 0;
          removeConfirmInput.value = '';
          removeButton.disabled = true;
          approveRehearsalButton.disabled = !canApproveRehearsal;
          if (!found) { tellFixture('Creation returned but the reserved paper was not found on refresh. Run the Journey check and inspect backend setup before retrying.', 'error'); }
          else if (!canApproveRehearsal) { tellFixture('The fixture exists, but the paper does not report staged or validated keys. Inspect key state before approving.', 'error'); }
        }
      }).catch(function (e) {
        tellFixture(ctx.plainError(e) + ' The operation uses idempotent import; inspect the paper/key state before retrying or use the reserved cleanup action after confirming the fixture.', 'error');
      }).then(function () { setProvisioning(false); });
    }
    function approveRehearsal() {
      if (provisioning) { return; }
      setProvisioning(true);
      tellFixture('Rechecking the reserved synthetic key batch. Approval uses the normal server-side two-person checks; use an owner account different from the enterer and the recorded verifier.', 'info');
      ctx.api.papersList().then(function (r) {
        if (!isSuccess(r, ['ok'])) { throw Object.assign(new Error('Could not read registered papers.'), { code: ctx.responseCode(r) }); }
        var exists = (ctx.responseData(r).papers || []).some(function (p) { return p.paper_id === REHEARSAL_ID; });
        if (!exists) { throw Object.assign(new Error('The reserved rehearsal paper does not exist. Create and validate the fixture first.'), { code: 'not_found' }); }
        return ctx.api.validateKeys(REHEARSAL_BATCH_ID);
      }).then(function (r) {
        if (!isSuccess(r, ['ok', 'validated', 'unchanged'])) { throw Object.assign(new Error('The reserved rehearsal key batch is not ready for approval.'), { code: ctx.responseCode(r) }); }
        return ctx.api.approveKeys(REHEARSAL_BATCH_ID);
      }).then(function (r) {
        if (!isSuccess(r, ['ok', 'approved', 'unchanged']) || (r.data && r.data.committed === false)) {
          throw Object.assign(new Error('Server did not confirm the rehearsal key approval.'), { code: ctx.responseCode(r) });
        }
        tellFixture('Synthetic rehearsal keys approved through the normal backend path. This does not enable candidate starts; the code-level release hold remains OFF.', 'success');
        return ctx.api.papersList();
      }).then(function (r) {
        var latestPaper = isSuccess(r, ['ok']) ? (ctx.responseData(r).papers || []).filter(function (p) { return p.paper_id === REHEARSAL_ID; })[0] : null;
        canApproveRehearsal = !!latestPaper && ['staged', 'validated'].indexOf(latestPaper.key_state) >= 0;
        setProvisioning(false);
        run(false);
      }).catch(function (e) { tellFixture(ctx.plainError(e) + ' Keep the release hold OFF; check the batch and the distinct-enterer/verifier/approver rule before retrying.', 'error'); setProvisioning(false); });
    }

    function renderRehearsalPreview(data) {
      ctx.clear(previewPanel);
      previewPanel.appendChild(ctx.el('h4', '', 'Read-only rehearsal preview'));
      previewPanel.appendChild(ctx.el('p', '', data.title + ' · ' + data.profile + ' · ' + data.total_marks + ' marks · ' + Math.floor(data.duration_seconds / 60) + ' minutes'));
      previewPanel.appendChild(ctx.el('p', 'fine', 'Synthetic answer keys are shown to the signed-in owner. This preview does not create an attempt or write to any database.'));
      (data.marking_rules || []).forEach(function (rule) {
        previewPanel.appendChild(ctx.el('p', '', rule.type + ': ' + rule.rule));
      });
      (data.questions || []).forEach(function (question, index) {
        var card = ctx.el('article', 'admin-flow-check');
        card.appendChild(ctx.el('strong', '', 'Question ' + (index + 1) + ' · ' + question.type + ' · ' + question.marks + ' mark'));
        card.appendChild(ctx.el('p', '', question.text));
        (question.options || []).forEach(function (option) {
          card.appendChild(ctx.el('p', '', option.id + '. ' + option.text));
        });
        var key = (data.answer_keys || []).filter(function (item) { return item.question_id === question.question_id; })[0];
        card.appendChild(ctx.el('p', 'admin-flow-code', 'Synthetic answer key: ' + (key ? key.answer : 'Not available')));
        previewPanel.appendChild(card);
      });
    }

    function showPreview() {
      if (provisioning) { return; }
      setProvisioning(true);
      ctx.clear(previewPanel);
      previewPanel.appendChild(ctx.el('p', 'fine', 'Loading the owner-only synthetic fixture preview…'));
      ctx.api.rehearsalPreview().then(function (r) {
        if (!isSuccess(r, ['ok'])) { throw Object.assign(new Error('Could not load the rehearsal preview.'), { code: ctx.responseCode(r) }); }
        renderRehearsalPreview(ctx.responseData(r));
        tellFixture('Read-only preview loaded. No attempt, answer or result rows were created.', 'success');
      }).catch(function (e) {
        ctx.clear(previewPanel);
        previewPanel.appendChild(ctx.el('p', 'fine is-error', ctx.plainError(e)));
      }).then(function () { setProvisioning(false); });
    }

    function startSimulation() {
      if (provisioning) { return; }
      setProvisioning(true);
      ctx.clear(attemptPanel);
      attemptPanel.appendChild(ctx.el('p', 'fine', 'Creating an isolated owner-only rehearsal simulation…'));
      ctx.api.rehearsalAttemptStart().then(function (r) {
        if (!isSuccess(r, ['ok'])) { throw Object.assign(new Error('Could not start the rehearsal simulation.'), { code: ctx.responseCode(r) }); }
        var data = ctx.responseData(r);
        ctx.clear(attemptPanel);
        attemptPanel.appendChild(ctx.el('h4', '', 'Isolated rehearsal attempt'));
        attemptPanel.appendChild(ctx.el('p', 'fine', 'This is a temporary simulation, not a candidate attempt. It expires automatically and never writes to EXAM_DB attempts or results.'));
        var responseInputs = Object.create(null);
        (data.questions || []).forEach(function (question, index) {
          var card = ctx.el('fieldset', 'admin-flow-check');
          card.appendChild(ctx.el('legend', '', 'Question ' + (index + 1) + ' · ' + question.type));
          card.appendChild(ctx.el('p', '', question.text));
          if (question.type === 'NAT') {
            var number = ctx.el('input');
            number.type = 'text'; number.maxLength = 64; number.autocomplete = 'off';
            number.setAttribute('aria-label', 'Answer for rehearsal question ' + (index + 1));
            responseInputs[question.question_id] = { type: 'NAT', input: number };
            card.appendChild(number);
          } else {
            var selected = [];
            (question.options || []).forEach(function (option) {
              var label = ctx.el('label', 'admin-field');
              var input = ctx.el('input');
              input.type = question.type === 'MSQ' ? 'checkbox' : 'radio';
              input.name = 'rehearsal-' + question.question_id;
              input.value = option.id;
              label.appendChild(input);
              label.appendChild(ctx.el('span', '', option.id + '. ' + option.text));
              card.appendChild(label);
              selected.push(input);
            });
            responseInputs[question.question_id] = { type: question.type, inputs: selected };
          }
          attemptPanel.appendChild(card);
        });
        var submit = ctx.button('Submit rehearsal answers', function () {
          if (submit.disabled) { return; }
          submit.disabled = true;
          var responses = {};
          Object.keys(responseInputs).forEach(function (id) {
            var item = responseInputs[id];
            if (item.type === 'NAT') { responses[id] = item.input.value; }
            else {
              var chosen = item.inputs.filter(function (input) { return input.checked; }).map(function (input) { return input.value; });
              responses[id] = item.type === 'MSQ' ? chosen : (chosen[0] || '');
            }
          });
          ctx.api.rehearsalAttemptSubmit(data.simulation_id, responses).then(function (result) {
            if (!isSuccess(result, ['ok'])) { throw Object.assign(new Error('The rehearsal simulation could not be scored.'), { code: ctx.responseCode(result) }); }
            var score = ctx.responseData(result);
            ctx.clear(attemptPanel);
            attemptPanel.appendChild(ctx.el('h4', '', 'Rehearsal simulation result'));
            attemptPanel.appendChild(ctx.el('p', '', 'Score: ' + score.total_marks + ' / ' + score.maximum_marks + ' (' + score.percentage + '%)'));
            (score.details || []).forEach(function (detail, i) {
              attemptPanel.appendChild(ctx.el('p', '', 'Question ' + (i + 1) + ': ' + (detail.correct ? 'Correct' : 'Incorrect') + ' · ' + detail.awarded_marks + ' / ' + detail.max_marks));
            });
            attemptPanel.appendChild(ctx.el('p', 'fine', 'Simulation only. No production attempt or persistent result was created. The production exam-start hold remains OFF.'));
          }).catch(function (e) {
            attemptPanel.appendChild(ctx.el('p', 'fine is-error', ctx.plainError(e)));
            submit.disabled = false;
          });
        }, 'btn-primary');
        attemptPanel.appendChild(submit);
      }).catch(function (e) {
        ctx.clear(attemptPanel);
        attemptPanel.appendChild(ctx.el('p', 'fine is-error', ctx.plainError(e)));
      }).then(function () { setProvisioning(false); });
    }

    function removeRehearsal() {
      if (provisioning) { return; }
      if (!removeConfirmInput || removeConfirmInput.value !== REHEARSAL_ID) { tellFixture('Type ' + REHEARSAL_ID + ' exactly to confirm cleanup.', 'error'); return; }
      setProvisioning(true); tellFixture('Removing only the reserved synthetic rehearsal paper and linked fixture rows…', 'warning');
      ctx.api.rehearsalRemove(REHEARSAL_ID).then(function (r) {
        if (!isSuccess(r, ['ok'])) { throw Object.assign(new Error('Rehearsal cleanup was not confirmed.'), { code: ctx.responseCode(r) }); }
        var d = ctx.responseData(r);
        removeConfirmInput.value = ''; removeButton.disabled = true;
        tellFixture('Synthetic rehearsal removed. Deleted ' + Number(d.counts && d.counts.paper || 0) + ' paper row(s), ' + Number(d.counts && d.counts.questions || 0) + ' question row(s), ' + Number(d.counts && d.counts.key_rows || 0) + ' key rows, and ' + Number(d.counts && d.counts.attempts || 0) + ' attempt row(s). Aggregate question-import provenance and security audit logs are retained.', 'success');
        return ctx.api.papersList();
      }).then(function () { canApproveRehearsal = false; setProvisioning(false); run(false); }).catch(function (e) { tellFixture(ctx.plainError(e), 'error'); setProvisioning(false); });
    }
    function run(rehearsalOnly) {
      if (running || provisioning) { return; }
      running = true; runButton.disabled = true; if (rehearsalButton) { rehearsalButton.disabled = true; }
      tell(rehearsalOnly ? 'Checking whether a rehearsal can be run safely…' : 'Checking site files and exam services…', 'info');
      Promise.all([probeSiteAssets(root), probePublicStatus(root)]).then(function (probes) {
        var payload = paperSelect.value ? { paper_id: paperSelect.value } : {};
        return ctx.api.flowCheck(payload).then(function (r) {
          if (!isOk(ctx, r)) { var e = new Error('Flow check failed.'); e.code = codeOf(ctx, r); throw e; }
          var d = dataOf(ctx, r), overlay = { 'site_files:assets': probes[0], 'public_backend:public_endpoint': probes[1] };
          var steps = normalizeSteps(root.GateAdminFlow, d, overlay);
          renderSteps(steps);
          if (rehearsalOnly) {
            tell('Readiness check completed; this button is read-only and created no rehearsal records or attempt. Use the separate synthetic rehearsal controls to create or remove only the reserved fixture. The server-side exam-start release hold remains OFF.', 'warning');
          } else { tell('Flow check completed. The report is read-only; it does not create an exam attempt.', 'success'); }
        });
      }).catch(function (e) {
        if (e && e.code === 'forbidden_not_owner') {
          var section = root.document.getElementById('admin-console'); if (section) { section.hidden = true; }
          return;
        }
        tell(ctx.plainError(e), 'error');
      }).then(function () { running = false; runButton.disabled = provisioning; if (rehearsalButton) { rehearsalButton.disabled = provisioning; } });
    }
    refresh = run;
    ctx.clear(panel);
    panel.appendChild(ctx.el('h3', '', 'Exam journey'));
    panel.appendChild(ctx.el('p', 'fine', 'Run a read-only preflight from site assets through result review. This report cannot enable an exam; the private server validates every operation again.'));
    var controls = ctx.el('div', 'admin-journey-controls');
    var paperLabel = ctx.el('label', 'admin-field'); paperLabel.appendChild(ctx.el('span', '', 'Paper (optional for general checks)'));
    paperSelect = ctx.el('select'); paperSelect.setAttribute('aria-label', 'Paper for exam flow check');
    var noPaper = ctx.el('option', '', 'General checks — no paper selected'); noPaper.value = ''; paperSelect.appendChild(noPaper); paperLabel.appendChild(paperSelect); controls.appendChild(paperLabel);
    runButton = ctx.button('Run again', function () { run(false); }, 'btn-primary'); controls.appendChild(runButton);
    rehearsalButton = ctx.button('Rehearsal readiness check', function () { run(true); }, 'btn-quiet'); controls.appendChild(rehearsalButton);
    controls.appendChild(ctx.button('Copy report', copyReport, 'btn-quiet'));
    panel.appendChild(controls);
    panel.appendChild(ctx.el('h4', '', 'Isolated synthetic rehearsal'));
    panel.appendChild(ctx.el('p', 'fine', 'Creates exactly three fake MCQ/MSQ/NAT questions and the reserved gate-2026-rehearsal paper using the normal import, registration, stage and validation routes. The source is a fixed example.invalid marker, not an official answer key. Approval is a separate step for a different active owner; no rehearsal action turns on exam-start gates.'));
    var simulationControls = ctx.el('div', 'admin-journey-controls');
    previewButton = ctx.button('Open read-only preview', showPreview, 'btn-quiet');
    attemptButton = ctx.button('Start isolated rehearsal attempt', startSimulation, 'btn-primary');
    simulationControls.appendChild(previewButton);
    simulationControls.appendChild(attemptButton);
    panel.appendChild(simulationControls);
    previewPanel = ctx.el('div', 'admin-rehearsal-preview');
    previewPanel.setAttribute('aria-live', 'polite');
    panel.appendChild(previewPanel);
    attemptPanel = ctx.el('div', 'admin-rehearsal-attempt');
    attemptPanel.setAttribute('aria-live', 'polite');
    panel.appendChild(attemptPanel);
    var reviewerLabel = ctx.el('label', 'admin-field admin-field-wide'); reviewerLabel.appendChild(ctx.el('span', '', 'Independent verifier identity (not the current owner)'));
    verifierInput = ctx.el('input'); verifierInput.type = 'text'; verifierInput.maxLength = 256; verifierInput.autocomplete = 'off'; verifierInput.setAttribute('aria-label', 'Independent rehearsal key verifier identity');
    reviewerLabel.appendChild(verifierInput); panel.appendChild(reviewerLabel);
    createButton = ctx.button('Create rehearsal questions, paper and staged keys', createRehearsal, 'btn-primary'); panel.appendChild(createButton);
    approveRehearsalButton = ctx.button('Approve staged rehearsal keys (different owner)', approveRehearsal, 'btn-quiet'); approveRehearsalButton.disabled = true; panel.appendChild(approveRehearsalButton);
    panel.appendChild(ctx.el('p', 'fine', 'Approval must be completed by an owner account different from both the enterer and the recorded verifier. If you staged the fixture, sign out and sign in with the distinct approval owner before pressing Approve. To clean up, type the reserved paper ID below. The server refuses any other ID or a fixture that fails its synthetic-data checks.'));
    var removeLabel = ctx.el('label', 'admin-field admin-field-wide'); removeLabel.appendChild(ctx.el('span', '', 'Type gate-2026-rehearsal to confirm removal'));
    removeConfirmInput = ctx.el('input'); removeConfirmInput.type = 'text'; removeConfirmInput.autocomplete = 'off'; removeConfirmInput.maxLength = 64;
    removeConfirmInput.setAttribute('aria-label', 'Type gate-2026-rehearsal to confirm removal'); removeLabel.appendChild(removeConfirmInput); panel.appendChild(removeLabel);
    removeButton = ctx.button('Remove rehearsal data', removeRehearsal, 'btn-quiet'); removeButton.disabled = true; panel.appendChild(removeButton);
    removeConfirmInput.addEventListener('input', function () { removeButton.disabled = provisioning || removeConfirmInput.value !== REHEARSAL_ID; });
    banner = ctx.el('div', 'admin-flow-banner flow-yellow'); banner.setAttribute('role', 'status'); banner.setAttribute('aria-live', 'polite'); panel.appendChild(banner);
    list = ctx.el('div', 'admin-flow-steps'); panel.appendChild(list);
    status = ctx.el('div', 'admin-status-area'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); panel.appendChild(status);
    fixtureStatus = ctx.el('div', 'admin-status-area admin-rehearsal-status'); fixtureStatus.setAttribute('role', 'status'); fixtureStatus.setAttribute('aria-live', 'polite'); panel.appendChild(fixtureStatus);
    var paperStatus = ctx.el('p', 'fine', 'Loading registered papers…'); panel.appendChild(paperStatus);
    ctx.api.papersList().then(function (r) {
      if (!isOk(ctx, r)) { throw Object.assign(new Error('Could not load papers.'), { code: codeOf(ctx, r) }); }
      var d = dataOf(ctx, r), papers = Array.isArray(d.papers) ? d.papers : [];
      papers.forEach(function (paper) { var opt = ctx.el('option', '', String(paper.title || paper.paper_id || 'Registered paper') + ' · ' + String(paper.question_count || 0) + ' questions'); opt.value = String(paper.paper_id || ''); paperSelect.appendChild(opt); });
      var rehearsalPaper = papers.filter(function (paper) { return paper.paper_id === REHEARSAL_ID; })[0];
      canApproveRehearsal = !!rehearsalPaper && ['staged', 'validated'].indexOf(rehearsalPaper.key_state) >= 0;
      approveRehearsalButton.disabled = !canApproveRehearsal;
      paperStatus.textContent = papers.length ? papers.length + ' registered paper(s) available.' : 'No registered papers. The paper step will be reported as blocked until a paper is registered.';
      if (!papers.length) { paperStatus.className = 'fine is-error'; }
    }).catch(function (e) { paperStatus.textContent = ctx.plainError(e); paperStatus.className = 'fine is-error'; });
    run(false);
  }
  consoleApi.registerTab({ id: 'journey', label: 'Journey', mount: mountJourney });
  root.GateAdminJourney = Object.freeze({ refresh: function () { if (typeof refresh === 'function') { refresh(); } }, normalizeSteps: normalizeSteps, probeSiteAssets: probeSiteAssets, probePublicStatus: probePublicStatus });
  if (typeof module !== 'undefined' && module.exports) { module.exports = root.GateAdminJourney; }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
