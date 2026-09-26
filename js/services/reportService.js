/* TRACE service — Report / export generation.
   Produces structured, redacted export rows derived strictly from parsed evidence. */
window.TRACE_SERVICES = window.TRACE_SERVICES || {};
(function () {
  'use strict';

  var HEAD = ['Evidence ID', 'Date', 'Time', 'Event Type', 'Amount', 'Sender', 'Receiver',
    'URL', 'Transaction ID', 'Source', 'Status', 'Flags'];

  function csvCell(v) {
    var s = String(v == null ? '' : v);
    return '"' + s.replace(/"/g, '""') + '"';
  }

  function dateOf(r) {
    if (r.dateText) return r.dateText;
    if (r.timestamp) return String(r.timestamp).slice(0, 10);
    return '';
  }
  function timeOf(r) {
    if (r.timeText) return r.timeText;
    if (r.timestamp) return String(r.timestamp).slice(11, 16);
    return '';
  }
  function flagsOf(r) {
    var f = [];
    (r.missingFields || []).forEach(function (m) { f.push('missing:' + m); });
    if (r.duplicateGroup) f.push('possible-duplicate');
    if ((r.conflictIds || []).length) f.push('possible-contradiction');
    if (r.ok === false) f.push('unreadable');
    return f.join('; ');
  }

  /* rows(records, privacy) -> array of arrays (header first), fully redacted. */
  function rows(records, privacy) {
    var RD = window.TRACE_SERVICES.redaction;
    var out = [HEAD.slice()];
    (records || []).forEach(function (r) {
      out.push([
        r.id,
        dateOf(r),
        timeOf(r),
        r.typeLabel || r.kind || '',
        r.amount != null ? r.amount : '',
        r.sender ? RD.scrub(r.sender, privacy) : (r.phone ? RD.redact(r.phone, 'phones', privacy) : ''),
        r.recipient ? RD.scrub(r.recipient, privacy) : (r.upi ? RD.redact(r.upi, 'upi', privacy) : ''),
        r.url ? RD.redact(r.url, 'urls', privacy) : '',
        r.transactionId ? RD.redact(r.transactionId, 'txnIds', privacy) : '',
        RD.scrub(r.fileName || '', privacy),
        (r.status || '').toUpperCase(),
        flagsOf(r)
      ]);
    });
    return out;
  }

  function build(records, ctx) {
    var c = ctx || {};
    return { caseId: c.caseId || '', createdAt: c.createdAt || '', rows: rows(records, c.privacy) };
  }

  window.TRACE_SERVICES.report = {
    csvCell: csvCell,
    rows: rows,
    build: build,
    ReportGenerator: { build: build, rows: rows }
  };
})();
