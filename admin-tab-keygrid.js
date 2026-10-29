/* admin-tab-keygrid.js - keyboard-accessible manual answer entry; no question text is shown. */
(function (root) {
  'use strict';
  var keysTab = root.GateAdminKeysTab;
  if (!keysTab || typeof keysTab.setEnhancer !== 'function') { return; }
  var host = null, context = null, getQuestions = null, acceptRows = null, onMessage = null, questions = [], rowNodes = [];
  function el(tag, cls, text) {
    var n = context.el(tag, cls, text);
    return n;
  }
  function clear() {
    if (host) { context.clear(host); }
    questions = []; rowNodes = [];
  }
  function idsFor(q) {
    if (Array.isArray(q.option_ids)) { return q.option_ids.slice(); }
    if (Array.isArray(q.options)) { return q.options.map(function (x) { return x.id; }).filter(function (x) { return typeof x === 'string'; }); }
    return [];
  }
  function rowAnswer(node, question) {
    if (question.type === 'MCQ') {
      var selected = node.querySelector('input[type="radio"]:checked'); return selected ? selected.value : '';
    }
    if (question.type === 'MSQ') {
      var checked = Array.prototype.slice.call(node.querySelectorAll('input[type="checkbox"]:checked')).map(function (x) { return x.value; });
      return checked.join(';');
    }
    var exact = node.querySelector('[data-nat-exact]'), lo = node.querySelector('[data-nat-low]'), hi = node.querySelector('[data-nat-high]');
    if (exact && exact.value.trim() !== '') { return exact.value.trim(); }
    if (lo && hi && lo.value.trim() !== '' && hi.value.trim() !== '') { return lo.value.trim() + '..' + hi.value.trim(); }
    return '';
  }
  function buildRows() {
    return rowNodes.map(function (node, index) { return { question_id: questions[index].question_id, answer: rowAnswer(node, questions[index]) }; });
  }
  function refreshProgress() {
    var answered = 0;
    rowNodes.forEach(function (node, i) { if (rowAnswer(node, questions[i]) !== '') { answered++; } });
    if (progress) { progress.textContent = answered + ' / ' + questions.length + ' answered'; }
    return answered;
  }
  var progress = null;
  function render(nextQuestions) {
    if (!host || !context) { return; }
    clear(); questions = Array.isArray(nextQuestions) ? nextQuestions.slice() : [];
    if (!questions.length) { host.appendChild(el('p', 'fine', 'Choose a registered paper to load its question types.')); return; }
    host.appendChild(el('p', 'fine', 'Only question number, type, marks and option IDs are shown. Enter answers without question text.'));
    var list = el('div', 'admin-key-grid-list');
    questions.forEach(function (q, index) {
      var fs = el('fieldset', 'admin-key-grid-row'); fs.appendChild(el('legend', '', 'Question ' + (index + 1) + ' · ' + String(q.type || 'Unknown') + ' · ' + String(q.marks || '—') + ' mark(s)'));
      var ids = idsFor(q);
      if (q.type === 'MCQ') {
        if (!ids.length) { fs.appendChild(el('p', 'admin-message is-error', 'This question has no available option IDs.')); }
        ids.forEach(function (id) {
          var label = el('label', 'admin-check-label'), input = el('input'); input.type = 'radio'; input.name = 'admin-key-mcq-' + index; input.value = id; input.setAttribute('aria-label', 'Question ' + (index + 1) + ' option ' + id);
          label.appendChild(input); label.appendChild(el('span', '', id)); fs.appendChild(label);
        });
      } else if (q.type === 'MSQ') {
        if (!ids.length) { fs.appendChild(el('p', 'admin-message is-error', 'This question has no available option IDs.')); }
        fs.appendChild(el('p', 'fine', 'Select every correct option.'));
        ids.forEach(function (id) {
          var label = el('label', 'admin-check-label'), input = el('input'); input.type = 'checkbox'; input.value = id; input.setAttribute('aria-label', 'Question ' + (index + 1) + ' option ' + id);
          label.appendChild(input); label.appendChild(el('span', '', id)); fs.appendChild(label);
        });
      } else if (q.type === 'NAT') {
        var grid = el('div', 'admin-form-grid');
        var exactLabel = el('label', 'admin-field'); exactLabel.appendChild(el('span', '', 'Exact numeric answer')); var exact = el('input'); exact.type = 'number'; exact.step = 'any'; exact.setAttribute('data-nat-exact', 'true'); exact.setAttribute('aria-label', 'Question ' + (index + 1) + ' exact numeric answer'); exactLabel.appendChild(exact); grid.appendChild(exactLabel);
        var lowLabel = el('label', 'admin-field'); lowLabel.appendChild(el('span', '', 'Accepted range low')); var low = el('input'); low.type = 'number'; low.step = 'any'; low.setAttribute('data-nat-low', 'true'); low.setAttribute('aria-label', 'Question ' + (index + 1) + ' accepted range low'); lowLabel.appendChild(low); grid.appendChild(lowLabel);
        var highLabel = el('label', 'admin-field'); highLabel.appendChild(el('span', '', 'Accepted range high')); var high = el('input'); high.type = 'number'; high.step = 'any'; high.setAttribute('data-nat-high', 'true'); high.setAttribute('aria-label', 'Question ' + (index + 1) + ' accepted range high'); highLabel.appendChild(high); grid.appendChild(highLabel);
        fs.appendChild(grid);
        exact.addEventListener('input', function () { if (exact.value.trim()) { low.value = ''; high.value = ''; } refreshProgress(); });
        low.addEventListener('input', function () { if (low.value.trim() || high.value.trim()) { exact.value = ''; } refreshProgress(); });
        high.addEventListener('input', function () { if (low.value.trim() || high.value.trim()) { exact.value = ''; } refreshProgress(); });
      } else { fs.appendChild(el('p', 'admin-message is-error', 'Unsupported question type.')); }
      Array.prototype.forEach.call(fs.querySelectorAll('input[type="radio"],input[type="checkbox"]'), function (input) { input.addEventListener('change', refreshProgress); });
      rowNodes.push(fs); list.appendChild(fs);
    });
    host.appendChild(list);
    var actionRow = el('div', 'admin-action-row');
    progress = el('p', 'admin-countline', '0 / ' + questions.length + ' answered'); progress.setAttribute('role', 'status'); progress.setAttribute('aria-live', 'polite'); host.appendChild(progress);
    var use = context.button('Use these keys', function () {
      if (typeof acceptRows === 'function') { acceptRows(buildRows()); if (typeof onMessage === 'function') { onMessage('Manual grid converted to answer-key rows. Review validation before staging.', 'success'); } }
    }, 'btn-primary');
    actionRow.appendChild(use);
    var clearButton = context.button('Clear grid', function () {
      render(getQuestions ? getQuestions() : []);
      if (typeof onMessage === 'function') { onMessage('Manual entries cleared.', ''); }
    }, 'btn-quiet'); actionRow.appendChild(clearButton); host.appendChild(actionRow);
    refreshProgress();
  }
  var enhancer = {
    mount: function (target, ctx, questionGetter, onRows, messageFn) {
      host = target; context = ctx; getQuestions = questionGetter; acceptRows = onRows; onMessage = messageFn;
    },
    render: render,
    clear: clear
  };
  keysTab.setEnhancer(enhancer);
  root.GateAdminKeyGrid = Object.freeze({ render: render, clear: clear });
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
