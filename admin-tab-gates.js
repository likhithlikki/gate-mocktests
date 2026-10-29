/* admin-tab-gates.js - owner-controlled, password-reverified operational gate UI. */
(function (root) {
  'use strict';
  var consoleApi = root.GateAdminConsole;
  if (!consoleApi) { return; }
  function stateLabel(state) { return ({ on: 'ON', off: 'OFF', unset: 'UNSET', invalid: 'INVALID VALUE' })[state] || 'UNKNOWN'; }
  function stateSymbol(state) { return ({ on: '✓', off: '○', unset: '!', invalid: '✕' })[state] || '?'; }
  function badge(ctx, state) { return ctx.el('span', 'admin-gate-badge gate-' + state, stateSymbol(state) + ' ' + stateLabel(state)); }
  function responseOk(ctx, r) { return ctx.responseCode(r) === 'ok'; }
  function dataOf(ctx, r) { return ctx.responseData(r); }
  function codeOf(ctx, r) { return ctx.responseCode(r); }
  function mountGates(panel, ctx) {
    var status, groupsNode, dialog, dialogHeading, dialogMessage, dialogReasonLabel, dialogReason, dialogPassword,
      dialogConfirm, dialogCancel, loadedGates = [], action = null, busy = false, emergency = false;
    var families = [ { id: 'auth', title: 'Authentication gates' }, { id: 'exam', title: 'Exam gates' }, { id: 'scoring', title: 'Scoring gates' } ];
    function tell(text, state) { ctx.clear(status); ctx.message(status, text, state || 'info'); }
    function currentGate(id) { return loadedGates.filter(function (g) { return g.id === id; })[0] || null; }
    function cleanDialog() {
      dialogPassword.value = ''; dialogReason.value = ''; action = null; emergency = false;
      if (dialog && typeof dialog.close === 'function' && dialog.open) { dialog.close(); }
      else if (dialog) { dialog.hidden = true; }
    }
    function refreshJourney() { if (root.GateAdminJourney && typeof root.GateAdminJourney.refresh === 'function') { root.GateAdminJourney.refresh(); } }
    function renderGates(gates) {
      loadedGates = Array.isArray(gates) ? gates.slice() : [];
      ctx.clear(groupsNode);
      families.forEach(function (family) {
        var familyGates = loadedGates.filter(function (g) { return g.family === family.id; });
        if (!familyGates.length) { return; }
        var section = ctx.el('section', 'admin-gate-family'); section.appendChild(ctx.el('h4', '', family.title));
        familyGates.forEach(function (gate) {
          var article = ctx.el('article', 'admin-gate-row' + (gate.risk_level === 'high' ? ' is-high-risk' : ''));
          var head = ctx.el('div', 'admin-gate-row-head'); head.appendChild(ctx.el('h5', '', gate.id)); head.appendChild(badge(ctx, gate.state)); article.appendChild(head);
          article.appendChild(ctx.el('p', '', gate.description || 'No description is available.'));
          article.appendChild(ctx.el('p', '', 'What it blocks: ' + (gate.blocks || 'Not specified.')));
          if (gate.risk_level === 'high') { article.appendChild(ctx.el('p', 'admin-gate-risk-note', 'High risk: this gate can affect real student access, scoring, or results. Only change it after the related policy and rehearsal are approved.')); }
          var prereq = ctx.el('div', 'admin-gate-prerequisites');
          prereq.appendChild(ctx.el('strong', '', gate.prerequisites_met ? 'Prerequisites: met' : 'Prerequisites: not met'));
          if (Array.isArray(gate.missing_prerequisites) && gate.missing_prerequisites.length) {
            var ul = ctx.el('ul'); gate.missing_prerequisites.forEach(function (item) { ul.appendChild(ctx.el('li', '', String(item))); }); prereq.appendChild(ul);
          }
          article.appendChild(prereq);
          if (gate.state === 'invalid') {
            var invalidNote = ctx.el('p', 'admin-gate-invalid-note', 'The Script Property is not exactly "true" or "false". The legacy runtime may trim spaces and ignore case; use a canonical value to remove ambiguity.'); article.appendChild(invalidNote);
          }
          var actions = ctx.el('div', 'admin-gate-actions');
          var onButton = ctx.button('Turn ON', function () { openDialog(gate, true); }, 'btn-primary');
          onButton.disabled = busy || !gate.changeable || !gate.prerequisites_met || gate.state === 'on';
          onButton.setAttribute('aria-label', 'Turn on ' + gate.id);
          if (!gate.prerequisites_met && gate.changeable) { onButton.title = 'Cannot turn on until all listed prerequisites are met.'; }
          var offButton = ctx.button('Turn OFF', function () { openDialog(gate, false); }, 'btn-quiet');
          offButton.disabled = busy || !gate.changeable || gate.state === 'off'; offButton.setAttribute('aria-label', 'Turn off ' + gate.id);
          actions.appendChild(onButton); actions.appendChild(offButton);
          if (!gate.changeable) { actions.appendChild(ctx.el('span', 'fine', 'Manual recovery only. This gate protects the authentication path used by the toggle service.')); }
          if (!gate.changeable && gate.state === 'invalid') { actions.appendChild(ctx.el('p', 'fine is-error', 'Fix in Private Apps Script > Script Properties: set this property to exactly true or false.')); }
          article.appendChild(actions); section.appendChild(article);
        });
        groupsNode.appendChild(section);
      });
      if (!loadedGates.length) { groupsNode.appendChild(ctx.el('p', 'fine', 'No gate registry entries were returned. Check the backend deployment.')); }
    }
    function loadGates(silent) {
      if (busy && !silent) { return Promise.resolve(); }
      if (!silent) { tell('Reading the allowlisted gate registry…', 'info'); }
      return ctx.api.gatesGet().then(function (r) {
        if (!responseOk(ctx, r)) { throw Object.assign(new Error('Could not read gates.'), { code: codeOf(ctx, r) }); }
        var d = dataOf(ctx, r); renderGates(Array.isArray(d.gates) ? d.gates : []);
        if (!silent) { tell('Gate state refreshed. Green/ON does not by itself prove that an exam is ready; review the Journey report.', 'success'); }
      }).catch(function (e) {
        if (e && e.code === 'forbidden_not_owner') { var shell = root.document.getElementById('admin-console'); if (shell) { shell.hidden = true; } return; }
        tell(ctx.plainError(e), 'error');
      });
    }
    function openDialog(gate, value) {
      if (busy) { return; }
      emergency = false; action = { gateIds: [gate.id], value: value, label: gate.id };
      dialogHeading.textContent = value ? 'Turn on ' + gate.id : 'Turn off ' + gate.id;
      dialogMessage.textContent = value
        ? 'This changes the gate that controls: ' + gate.blocks + ' Review the prerequisites and confirm the policy decision. ' + gate.description
        : 'Confirm that you want to switch OFF ' + gate.id + '. Turning a gate off blocks the features it controls.';
      dialogReasonLabel.hidden = !value;
      dialogReason.required = value;
      dialogReason.value = value ? '' : 'Owner turned gate off from Gate Prep Studio';
      dialogPassword.value = '';
      dialogConfirm.textContent = value ? 'Turn on' : 'Turn off';
      dialogConfirm.disabled = !gate.changeable || (value && !gate.prerequisites_met);
      showDialog();
    }
    function openEmergencyDialog() {
      if (busy) { return; }
      var targets = loadedGates.filter(function (g) { return /^(EXAM_POLICY_|SCORING_POLICY_)/.test(g.id) && g.changeable && g.state !== 'off'; });
      if (!targets.length) { tell('All changeable exam and scoring gates are already OFF. Manual-only authentication gates are not touched.', 'success'); return; }
      emergency = true; action = { gateIds: targets.map(function (g) { return g.id; }), value: false, label: 'all changeable exam and scoring gates' };
      dialogHeading.textContent = 'Emergency: turn OFF all exam gates';
      dialogMessage.textContent = 'This will issue one audited, password-reverified OFF request for each of ' + targets.length + ' changeable EXAM_POLICY and SCORING_POLICY gate(s). Authentication gates are not changed. This action intentionally blocks exam/scoring operations.';
      dialogReasonLabel.hidden = true; dialogReason.required = false; dialogReason.value = 'Emergency exam shutdown from Gate Prep Studio';
      dialogPassword.value = ''; dialogConfirm.textContent = 'Turn OFF all exam gates'; dialogConfirm.disabled = false; showDialog();
    }
    function showDialog() {
      if (typeof dialog.showModal === 'function') { try { dialog.showModal(); } catch (e) { dialog.hidden = false; } }
      else { dialog.hidden = false; }
      root.setTimeout(function () { try { dialogPassword.focus(); } catch (e) {} }, 0);
    }
    function derivePasswordProof(passwordText) {
      var session = root.GateAuth;
      if (!session || typeof session.deriveH1 !== 'function') { return Promise.reject(Object.assign(new Error('Secure password re-verification is unavailable.'), { code: 'crypto_unavailable' })); }
      return ctx.api.call('session_get', {}).then(function (s) {
        if (!responseOk(ctx, s)) { throw Object.assign(new Error('Session verification failed.'), { code: codeOf(ctx, s) }); }
        var user = dataOf(ctx, s).user;
        if (!user || typeof user.username !== 'string' || !user.username) { throw Object.assign(new Error('Could not identify the signed-in account.'), { code: 'bad_response' }); }
        return ctx.api.call('kdf_params', { identifier: user.username }).then(function (p) {
          if (!responseOk(ctx, p)) { throw Object.assign(new Error('Password parameters could not be loaded.'), { code: codeOf(ctx, p) }); }
          return session.deriveH1(passwordText, dataOf(ctx, p));
        });
      });
    }
    function submitAction(event) {
      if (event && typeof event.preventDefault === 'function') { event.preventDefault(); }
      if (busy || !action) { return; }
      var current = action, passwordText = String(dialogPassword.value || ''), reason = String(dialogReason.value || '').trim();
      if (!passwordText) { tell('Re-enter your password to confirm this change.', 'error'); dialogPassword.focus(); return; }
      if (!current.value && !reason) { reason = emergency ? 'Emergency exam shutdown from Gate Prep Studio' : 'Owner turned gate off from Gate Prep Studio'; }
      if (current.value && (!reason || reason.length > 200)) { tell('Enter a reason between 1 and 200 characters.', 'error'); dialogReason.focus(); return; }
      /* Clear form controls before awaiting network or cryptographic work. No password or H1 is stored in browser storage. */
      dialogPassword.value = ''; dialogReason.value = '';
      busy = true; dialogConfirm.disabled = true; dialogCancel.disabled = true; tell('Verifying the owner and applying the requested gate change…', 'info');
      var proof = '';
      derivePasswordProof(passwordText).then(function (h1) {
        passwordText = ''; proof = h1;
        var chain = Promise.resolve(), changed = 0;
        current.gateIds.forEach(function (gateId) {
          chain = chain.then(function () {
            return ctx.api.gatesSet({ gate_id: gateId, value: current.value, confirm_password: proof, reason: reason }).then(function (r) {
              if (!responseOk(ctx, r)) { throw Object.assign(new Error('Gate change failed.'), { code: codeOf(ctx, r) }); }
              changed++;
            });
          });
        });
        return chain.then(function () { return { changed: changed }; });
      }).then(function (result) {
        tell((emergency ? 'Emergency shutdown completed for ' : 'Gate change completed for ') + result.changed + ' gate(s). Reloading gate state and the Journey report.', 'success');
        cleanDialog();
        return loadGates(true).then(refreshJourney);
      }).catch(function (e) {
        var safeMessage = ctx.plainError(e);
        cleanDialog();
        return loadGates(true).then(function () { tell(safeMessage, 'error'); refreshJourney(); });
      }).then(function () {
        proof = ''; passwordText = ''; reason = ''; busy = false; dialogConfirm.disabled = false; dialogCancel.disabled = false;
      });
    }

    ctx.clear(panel);
    panel.appendChild(ctx.el('h3', '', 'Operational gates'));
    panel.appendChild(ctx.el('p', 'fine', 'The backend is authoritative. Changes require an active owner session and fresh password proof. Enabling is allowed only when every prerequisite is met; turning OFF is the emergency fail-closed path.'));
    var topActions = ctx.el('div', 'admin-gates-top-actions');
    topActions.appendChild(ctx.button('Refresh gates', function () { loadGates(false); }, 'btn-quiet'));
    topActions.appendChild(ctx.button('Turn OFF all exam gates', openEmergencyDialog, 'btn-danger'));
    panel.appendChild(topActions);
    status = ctx.el('div', 'admin-status-area'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); panel.appendChild(status);
    groupsNode = ctx.el('div', 'admin-gate-groups'); panel.appendChild(groupsNode);
    dialog = ctx.el('dialog', 'admin-gate-dialog'); dialog.setAttribute('aria-labelledby', 'admin-gate-dialog-heading');
    var dialogForm = ctx.el('form', 'admin-gate-dialog-form'); dialogForm.noValidate = false;
    dialogHeading = ctx.el('h3', '', 'Confirm gate change'); dialogHeading.id = 'admin-gate-dialog-heading'; dialogForm.appendChild(dialogHeading);
    dialogMessage = ctx.el('p', '', ''); dialogForm.appendChild(dialogMessage);
    dialogReasonLabel = ctx.el('label', 'admin-field'); dialogReasonLabel.appendChild(ctx.el('span', '', 'Reason for audit log'));
    dialogReason = ctx.el('input'); dialogReason.type = 'text'; dialogReason.maxLength = 200; dialogReason.autocomplete = 'off'; dialogReasonLabel.appendChild(dialogReason); dialogForm.appendChild(dialogReasonLabel);
    var passLabel = ctx.el('label', 'admin-field'); passLabel.appendChild(ctx.el('span', '', 'Re-enter your password'));
    dialogPassword = ctx.el('input'); dialogPassword.type = 'password'; dialogPassword.autocomplete = 'current-password'; dialogPassword.maxLength = 1024; passLabel.appendChild(dialogPassword); dialogForm.appendChild(passLabel);
    var dialogActions = ctx.el('div', 'admin-gate-dialog-actions');
    dialogCancel = ctx.button('Cancel', function () { cleanDialog(); }, 'btn-quiet'); dialogActions.appendChild(dialogCancel);
    dialogConfirm = ctx.button('Confirm', submitAction, 'btn-primary'); dialogConfirm.type = 'submit'; dialogActions.appendChild(dialogConfirm); dialogForm.appendChild(dialogActions);
    dialogForm.addEventListener('submit', submitAction); dialog.appendChild(dialogForm); panel.appendChild(dialog);
    loadGates(false);
  }
  consoleApi.registerTab({ id: 'gates', label: 'Gates', mount: mountGates });
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
