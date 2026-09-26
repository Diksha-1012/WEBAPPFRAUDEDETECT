/* TRACE service — Evidence extraction.
   Deterministic entity extraction from free text (mock/local). Replaceable by an
   OCR/LLM extractor later: the UI only depends on the returned shape. */
window.TRACE_SERVICES = window.TRACE_SERVICES || {};
(function () {
  'use strict';

  var RE = {
    urls: /https?:\/\/[^\s"'<>)]+/gi,
    emails: /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g,
    phones: /(?:\+91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}\b/g,
    txnIds: /\b(?:TXN|UTR|REF)[-\s]?[A-Z0-9-]{3,}\b/gi,
    upi: /\b[\w.+-]{2,}@(?:up[il]|novapay|quicksettle|okaxis|ybl|paytm)\b/gi,
    amounts: /(?:₹|rs\.?|inr)\s?([\d][\d,]*(?:\.\d{1,2})?)/gi
  };

  function uniq(arr) {
    var seen = {}, out = [];
    arr.forEach(function (v) {
      var k = String(v).trim();
      if (k && !seen[k]) { seen[k] = 1; out.push(v); }
    });
    return out;
  }
  function nums(list) {
    return list.map(function (s) { return parseFloat(String(s).replace(/,/g, '')); })
      .filter(function (n) { return !isNaN(n); });
  }

  function extract(text) {
    var s = String(text == null ? '' : text);
    var amountsRaw, amounts;
    RE.amounts.lastIndex = 0;
    amountsRaw = (s.match(RE.amounts) || []).map(function (m) { return m.replace(/^[^0-9]+/, ''); });
    amounts = nums(amountsRaw);
    return {
      phones: uniq(s.match(RE.phones) || []),
      emails: uniq(s.match(RE.emails) || []),
      urls: uniq(s.match(RE.urls) || []),
      txnIds: uniq(s.match(RE.txnIds) || []),
      upi: uniq(s.match(RE.upi) || []),
      amounts: uniq(amounts)
    };
  }

  window.TRACE_SERVICES.extraction = {
    extract: extract,
    EvidenceExtractor: { extract: extract }
  };
})();
