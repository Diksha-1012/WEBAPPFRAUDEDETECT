/* TRACE service — AI facade.
   The single seam the UI talks to for AI-assisted output. Currently backed by the
   mock provider; swapping in a real model requires no view changes. */
window.TRACE_SERVICES = window.TRACE_SERVICES || {};
(function () {
  'use strict';

  function provider() {
    var reg = window.TRACE_SERVICES.aiProvider;
    return reg.get(reg.current);
  }

  function summarize(ctx) {
    try { return provider().summarize(ctx); }
    catch (e) { return 'Summary unavailable.'; }
  }

  /* AIEvidenceProcessor placeholder — mirrors the mock EvidenceProcessor shape so
     a model-backed processor can be dropped in later. */
  function aiExtract(text) {
    var p = provider();
    if (p.capabilities && p.capabilities.indexOf('extract') >= 0 && p.extract) return p.extract(text);
    return window.TRACE_SERVICES.extraction.extract(text);
  }

  window.TRACE_SERVICES.ai = {
    summarize: summarize,
    aiExtract: aiExtract,
    AIEvidenceProcessor: { extract: aiExtract },
    provider: window.TRACE_SERVICES.aiProvider.current
  };
})();
