/* TRACE service — Evidence analyzer.
   Derives the timeline, missing-information list, potential contradictions,
   possible duplicates and dashboard metrics from REAL parsed records only. */
window.TRACE_SERVICES = window.TRACE_SERVICES || {};
(function () {
  'use strict';

  function pad(n) { return String(n).padStart(2, '0'); }

  var MISSING_WHY = {
    timestamp: 'No date or time was visible in this image, so the event cannot be placed on the timeline.',
    amount: 'A transaction was identified but no amount was visible.',
    transactionId: 'No transaction ID / reference number was visible.',
    sender: 'No sender was visible for this message.',
    phone: 'No phone number was visible in this record.',
    url: 'No URL context was visible around this link.',
    message: 'No message text could be identified.'
  };

  function analyze(records, unreadable) {
    var readable = (records || []).filter(function (r) { return r && r.ok; });
    var ignored = unreadable || [];

    var timeline = window.TRACE_SERVICES.timeline;
    var events = timeline.sortEvents(readable);

    var contradictions = window.TRACE_SERVICES.contradictions.detect(readable);
    var duplicates = window.TRACE_SERVICES.duplicates.detect(readable);

    /* tag duplicate groups + conflicts back onto the records */
    duplicates.forEach(function (d) {
      (d.evidenceIds || []).forEach(function (id) {
        var r = readable.filter(function (x) { return x.id === id; })[0];
        if (r && !r.duplicateGroup) r.duplicateGroup = d.id;
      });
    });
    contradictions.forEach(function (c) {
      [c.evidenceA, c.evidenceB].forEach(function (id) {
        var r = readable.filter(function (x) { return x.id === id; })[0];
        if (r) {
          if ((r.conflictIds || []).indexOf(c.id) < 0) r.conflictIds = (r.conflictIds || []).concat([c.id]);
          if (r.status !== 'incomplete') r.status = 'conflict';
        }
      });
    });

    var missing = [], n = 0;
    readable.forEach(function (r) {
      (r.missingFields || []).forEach(function (f) {
        n++;
        missing.push({
          id: 'MS-' + pad(n),
          label: r.label,
          field: f,
          evidenceId: r.id,
          why: MISSING_WHY[f] || 'This field was not found in the source image.'
        });
      });
    });

    var unreadableFlags = ignored.map(function (r, i) {
      return {
        id: 'UR-' + pad(i + 1),
        label: r.fileName || ('upload ' + (i + 1)),
        evidenceId: r.id,
        reason: r.reason || 'No relevant evidence found.',
        ocrText: r.ocrText || ''
      };
    });

    var contacts = {}, txnCount = 0, totalAmount = 0;
    readable.forEach(function (r) {
      [r.phone].concat((r.entities && r.entities.phones) || []).forEach(function (p) { if (p) contacts[p] = 1; });
      if (r.kind === 'transaction' && r.amount != null) { txnCount++; totalAmount += Number(r.amount) || 0; }
    });

    var flagged = readable.filter(function (r) {
      return r.status === 'needs-review' || r.status === 'conflict' || r.status === 'incomplete' ||
        (r.missingFields || []).length > 0;
    }).length;

    var tsEvents = events.filter(function (r) { return !!r.timestamp; });
    var timeSpan = '—';
    if (tsEvents.length > 1) {
      var diff = new Date(tsEvents[tsEvents.length - 1].timestamp).getTime() - new Date(tsEvents[0].timestamp).getTime();
      if (diff >= 0) {
        var h = Math.floor(diff / 3600000), mm = Math.round((diff % 3600000) / 60000);
        timeSpan = (h ? h + 'h ' : '') + mm + 'm';
      }
    } else if (tsEvents.length === 1) { timeSpan = '0m'; }

    var metrics = {
      evidence: readable.length,
      timeSpan: timeSpan,
      events: events.filter(function (r) { return !!r.timestamp; }).length,
      placed: events.filter(function (r) { return !!(r.timestamp || r.timeMinutes != null); }).length,
      txnCount: txnCount,
      totalAmount: totalAmount,
      contacts: Object.keys(contacts).length,
      flagged: flagged,
      dupCount: duplicates.reduce(function (a, d) { return a + (d.evidenceIds || []).length; }, 0),
      incomplete: readable.filter(function (r) { return (r.missingFields || []).length > 0; }).length,
      conflicts: contradictions.length,
      duplicates: duplicates.length,
      missing: missing.length,
      unreadable: unreadableFlags.length
    };

    return {
      records: readable,
      events: events,
      unreadable: ignored,
      contradictions: contradictions,
      duplicates: duplicates,
      missing: missing,
      unreadableFlags: unreadableFlags,
      metrics: metrics
    };
  }

  window.TRACE_SERVICES.analyzer = {
    analyze: analyze,
    EvidenceAnalyzer: { analyze: analyze }
  };
})();
