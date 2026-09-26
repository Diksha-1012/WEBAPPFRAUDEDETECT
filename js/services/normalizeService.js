/* TRACE service — Schema normalization.
   Maps heterogeneous source field names onto TRACE's canonical schema.
   (amount | txn_amount | transaction_value ... -> amount) */
window.TRACE_SERVICES = window.TRACE_SERVICES || {};
(function () {
  'use strict';

  var FIELD_ALIASES = {
    id: ['id'],
    timestamp: ['timestamp', 'date', 'datetime', 'time', 'transaction_time', 'txn_time', 'created_at', 'occurred_at', 'event_time', 'when'],
    event_type: ['event_type', 'eventtype', 'type', 'category', 'event'],
    source: ['source', 'src', 'origin', 'channel', 'provider'],
    sender: ['sender', 'from', 'payer', 'sender_name', 'from_number', 'originator'],
    recipient: ['recipient', 'to', 'payee', 'beneficiary', 'to_number'],
    amount: ['amount', 'amt', 'txn_amount', 'transaction_amount', 'transaction_value', 'payment', 'value', 'total', 'debit', 'credit'],
    currency: ['currency', 'ccy'],
    message: ['message', 'text', 'body', 'content', 'note', 'description'],
    url: ['url', 'link', 'href', 'website'],
    transaction_id: ['transaction_id', 'txn_id', 'txnid', 'txn', 'reference', 'ref', 'utr', 'transaction_ref'],
    phone: ['phone', 'mobile', 'contact', 'phone_number', 'msisdn'],
    email: ['email', 'email_address', 'mail'],
    location: ['location', 'place', 'city', 'address'],
    status: ['status', 'state']
  };

  var LOOKUP = (function () {
    var m = {};
    Object.keys(FIELD_ALIASES).forEach(function (canon) {
      FIELD_ALIASES[canon].forEach(function (a) { m[a] = canon; });
    });
    return m;
  })();

  function canonicalField(name) {
    if (!name) return null;
    var key = String(name).trim().toLowerCase().replace(/[\s-]+/g, '_');
    return LOOKUP[key] || null;
  }

  /* normalizeRecord(raw, mapping) -> canonical record. */
  function normalizeRecord(raw, mapping) {
    var out = {};
    Object.keys(raw || {}).forEach(function (k) {
      var canon = (mapping && mapping[k]) || canonicalField(k) || k;
      out[canon] = raw[k];
    });
    return out;
  }

  window.TRACE_SERVICES.normalize = {
    FIELD_ALIASES: FIELD_ALIASES,
    canonicalField: canonicalField,
    normalizeRecord: normalizeRecord,
    SchemaNormalizer: { canonicalField: canonicalField, normalizeRecord: normalizeRecord }
  };
})();
