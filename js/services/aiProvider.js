/* TRACE service — AI provider registry (adapter seam).
   Ships with a deterministic MockAIProvider so the prototype needs no network.
   Register a real provider (e.g. 'openai') and switch `current` to enable it
   without changing any UI code. */
window.TRACE_SERVICES = window.TRACE_SERVICES || {};
(function () {
  'use strict';

  var registry = {};

  function register(name, provider) { registry[name] = provider; }
  function get(name) { return registry[name || 'mock'] || registry.mock; }

  /* --- Mock provider: deterministic, offline. --- */
  var MockAIProvider = {
    name: 'mock',
    ready: true,
    capabilities: ['summarize'],
    summarize: function (ctx) {
      var m = (ctx && ctx.metrics) || {};
      var total = m.evidence != null ? m.evidence : (m.total || 0);
      var dups = (ctx && ctx.duplicateGroups != null) ? ctx.duplicateGroups : 0;
      if (!total) return 'No evidence has been uploaded yet. Upload screenshot evidence to build the incident record.';
      var p = function (n) { return n === 1 ? '' : 's'; };
      return 'This case file holds ' + total + ' evidence record' + p(total) +
        (m.timeSpan ? ' spanning ' + m.timeSpan : '') + '. ' +
        m.txnCount + ' transaction' + p(m.txnCount) + ' totalling ₹' + Number(m.totalAmount || 0).toLocaleString('en-IN') +
        ' across ' + m.contacts + ' contact' + p(m.contacts) + '. Automated checks surfaced ' +
        m.conflicts + ' potential contradiction' + p(m.conflicts) + ', ' + dups + ' possible-duplicate group' + p(dups) +
        ' and ' + m.incomplete + ' incomplete record' + p(m.incomplete) + '. ' +
        'All figures are derived from the uploaded evidence. TRACE draws no conclusions about wrongdoing.';
    }
  };
  register('mock', MockAIProvider);

  window.TRACE_SERVICES.aiProvider = {
    registry: registry,
    register: register,
    get: get,
    current: 'mock',
    MockAIProvider: MockAIProvider
  };
})();
