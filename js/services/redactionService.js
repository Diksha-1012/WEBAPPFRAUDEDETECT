/* TRACE service — Redaction.
   Pure masking primitives + free-text scrubber. All UI redaction flows through
   here so a future server-side redactor can replace it without touching views. */
window.TRACE_SERVICES = window.TRACE_SERVICES || {};
(function () {
  'use strict';

  var MASK = {
    phones: function (p) {
      var d = String(p).replace(/\D/g, '');
      if (!d) return '';
      var sub = d.slice(-10);
      var cc = d.length > 10 ? '+' + d.slice(0, -10) + ' ' : '';
      return cc + sub.slice(0, 2) + 'XXXXXX' + sub.slice(-2);
    },
    emails: function (e) {
      var s = String(e), at = s.indexOf('@');
      if (at < 0) return '••••';
      return s.slice(0, 2) + '••••' + s.slice(at);
    },
    txnIds: function (t) {
      var s = String(t);
      var digits = s.replace(/\D/g, '');
      var last4 = (digits || s).slice(-4);
      return 'TXN-••••-' + last4;
    },
    upi: function (u) { return String(u).slice(0, 2) + '••••@upi'; },
    accounts: function (a) { return '••••••••' + String(a).replace(/\D/g, '').slice(-4); },
    urls: function (u) {
      var s = String(u).replace(/^https?:\/\//i, '');
      var host = s.split('/')[0];
      var parts = host.split('.');
      if (parts.length < 2) return 'https://' + host.slice(0, 4) + '••••';
      return 'https://' + parts[0].slice(0, 4) + '••••.' + parts[parts.length - 1];
    }
  };

  /* redact(value, type, privacy) — mask only when the category toggle is ON. */
  function redact(value, type, privacy) {
    if (value == null || value === '') return '';
    var on = privacy ? privacy[type] : true;
    return on ? MASK[type](String(value)) : String(value);
  }

  /* scrub(text, privacy) — mask PII patterns inside free text. */
  function scrub(s, privacy) {
    if (s == null) return '';
    var p = privacy || {};
    var out = String(s);
    if (p.urls) out = out.replace(/https?:\/\/[^\s"'<>]+/gi, function (m) { return MASK.urls(m); });
    if (p.emails) out = out.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, function (m) { return MASK.emails(m); });
    if (p.txnIds) out = out.replace(/\bTXN-[A-Za-z0-9-]+\b/g, function (m) { return MASK.txnIds(m); });
    if (p.upi) out = out.replace(/[\w.+-]{2,}@(?:novapay|quicksettle|upi)\b/gi, function (m) { return MASK.upi(m); });
    if (p.phones) out = out.replace(/\b(\+91[\s-]?)?([6-9]\d{4})[\s-]?(\d{5})\b/g, function (m, cc, a, b) {
      return (cc ? '+91 ' : '') + a.slice(0, 2) + 'XXXXXX' + b.slice(-2);
    });
    if (p.accounts) out = out.replace(/\b\d{11,18}\b/g, function (m) { return MASK.accounts(m); });
    return out;
  }

  window.TRACE_SERVICES.redaction = {
    MASK: MASK,
    redact: redact,
    scrub: scrub,
    RedactionService: { mask: MASK, redact: redact, scrub: scrub }
  };
})();
