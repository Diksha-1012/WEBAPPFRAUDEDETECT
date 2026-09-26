/* TRACE service — Duplicate detection.
   Groups records that look like the same upload/event. Nothing is auto-deleted. */
window.TRACE_SERVICES = window.TRACE_SERVICES || {};
(function () {
  'use strict';

  function pad(n) { return String(n).padStart(3, '0'); }
  function normText(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
  function normLabel(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }

  function keyOf(r) {
    if (r.transactionId && r.amount != null) return 'txn:' + r.transactionId + ':' + r.amount;
    var t = normText(r.ocrText);
    if (t.length >= 20) return 'text:' + t;
    if (r.amount != null) {
      var when = r.timestamp || (r.timeMinutes != null ? String(r.timeMinutes) : '');
      if (when) return 'lab:' + normLabel(r.label) + ':' + r.amount + ':' + when;
    }
    return null;
  }
  function similarity(key) {
    if (key.indexOf('txn:') === 0) return 97;
    if (key.indexOf('text:') === 0) return 99;
    return 88;
  }

  function detect(records) {
    var list = (records || []).filter(function (r) { return r.ok !== false; });
    var groups = {}, order = [];
    list.forEach(function (r) {
      var key = keyOf(r);
      if (!key) return;
      if (!groups[key]) { groups[key] = []; order.push(key); }
      groups[key].push(r);
    });

    var out = [], n = 0;
    order.forEach(function (key) {
      var g = groups[key];
      if (g.length < 2) return;
      n++;
      var gid = 'DP-' + pad(n);
      out.push({ id: gid, evidenceIds: g.map(function (r) { return r.id; }), similarity: similarity(key) });
    });
    return out;
  }

  window.TRACE_SERVICES.duplicates = {
    detect: detect,
    DuplicateDetector: { detect: detect }
  };
})();
