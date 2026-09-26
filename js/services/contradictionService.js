/* TRACE service — Contradiction detection.
   Flags likely inconsistencies (e.g. differing amounts for the same apparent
   event) for human review. Never decides which side is correct. */
window.TRACE_SERVICES = window.TRACE_SERVICES || {};
(function () {
  'use strict';

  function pad(n) { return String(n).padStart(3, '0'); }

  function sameEvent(a, b) {
    if (a.transactionId && b.transactionId && a.transactionId === b.transactionId) return true;
    if (a.timestamp && b.timestamp) {
      var d = Math.abs(new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      if (d <= 3 * 60 * 1000) return true;
    }
    if (a.timeMinutes != null && b.timeMinutes != null && a.timeMinutes === b.timeMinutes) return true;
    return false;
  }

  function detect(records) {
    var list = (records || []).filter(function (r) { return r.ok !== false; });
    var out = [], n = 0;
    for (var i = 0; i < list.length; i++) {
      for (var j = i + 1; j < list.length; j++) {
        var a = list[i], b = list[j];
        if (a.amount == null || b.amount == null) continue;
        if (Number(a.amount) === Number(b.amount)) continue;
        if (!sameEvent(a, b)) continue;
        n++;
        out.push({
          id: 'CF-' + pad(n),
          title: 'Amount differs across sources',
          field: 'amount',
          evidenceA: a.id,
          evidenceB: b.id,
          valueA: '₹' + Number(a.amount).toLocaleString('en-IN'),
          valueB: '₹' + Number(b.amount).toLocaleString('en-IN'),
          reason: 'Two uploaded images appear to describe the same event but record different amounts. TRACE does not decide which value is correct — this needs investigator review.',
          confidence: 78
        });
      }
    }
    return out;
  }

  window.TRACE_SERVICES.contradictions = {
    detect: detect,
    ContradictionDetector: { detect: detect }
  };
})();
