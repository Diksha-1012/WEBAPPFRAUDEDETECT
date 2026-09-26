/* TRACE service — Evidence parser.
   Turns OCR text into a structured evidence record. It extracts ONLY information
   that is actually present; anything absent is left missing and flagged.
   No field is ever invented. */
window.TRACE_SERVICES = window.TRACE_SERVICES || {};
(function () {
  'use strict';

  var MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

  function pad(n, w) { return String(n).padStart(w || 2, '0'); }
  function uniq(a) { var s = {}; return a.filter(function (v) { var k = String(v); if (s[k]) return false; s[k] = 1; return true; }); }
  function firstMatch(re, text) { re.lastIndex = 0; var m = re.exec(text); return m ? m[1] : null; }
  function num(s) { return parseFloat(String(s).replace(/[,\s]/g, '')); }

  /* ---------------- text cleaning ---------------- */
  function clean(text) {
    var s = String(text == null ? '' : text).replace(/\r/g, '\n').replace(/[\u00A0\t]+/g, ' ');
    var lines = s.split('\n').map(function (l) { return l.replace(/\s+/g, ' ').trim(); });
    lines = lines.filter(function (l) {
      if (!l) return false;
      var alnum = l.replace(/[^A-Za-z0-9]/g, '');
      if (alnum.length >= 2) return true;
      return /[0-9]/.test(l) && l.length >= 2;
    });
    return lines.join('\n').trim();
  }

  /* ---------------- classification ---------------- */
  var SIGNALS = {
    url: ['http://', 'https://', 'www.', '.com', '.in/', '.net', '.org', 'click here', 'verify', 'link', 'login'],
    transaction: ['debited', 'credited', 'transaction', 'txn', 'paid', 'payment', 'transfer', 'upi', 'imps', 'neft', 'rtgs', 'balance', 'a/c', 'account', 'amount', '₹', 'rs.', 'inr', 'ref no', 'utr', 'successful', 'gst'],
    payment: ['payment successful', 'paid to', 'pay to', 'collect request', 'request money', 'merchant', 'autopay', 'mandate', 'receipt'],
    chat: ['whatsapp', 'message', 'typing', 'delivered', 'hello', 'hi ', 'dear', 'thanks', 'forwarded', 'online', 'last seen', 'reply'],
    email: ['subject:', 'from:', 'to:', 'gmail', 'outlook', 'unsubscribe', 'sent from', 'regards', 'cc:'],
    calllog: ['incoming', 'outgoing', 'missed call', 'call duration', 'call log', 'mins', 'dialed', 'declined'],
    sms: ['sms', 'sent to', 'message from', 'message regarding'],
    notification: ['notification', 'alert', 'bank alert', 'reminder', 'new message', 'you have received']
  };

  function score(text, words) {
    var t = text.toLowerCase(), n = 0;
    words.forEach(function (w) { if (t.indexOf(w) >= 0) n++; });
    return n;
  }

  function classify(text) {
    var sig = {};
    Object.keys(SIGNALS).forEach(function (k) { sig[k] = score(text, SIGNALS[k]); });
    var best = 'other', bestScore = 0;
    Object.keys(sig).forEach(function (k) { if (sig[k] > bestScore) { bestScore = sig[k]; best = k; } });
    var confidence = bestScore === 0 ? 0 : Math.min(92, 40 + bestScore * 13);
    return { type: bestScore === 0 ? 'other' : best, confidence: confidence, signals: sig };
  }

  var KIND = {
    chat: 'message', sms: 'message', transaction: 'transaction', payment: 'transaction',
    url: 'url', email: 'email', calllog: 'calllog', notification: 'notification', other: 'other'
  };
  var TYPE_LABEL = {
    chat: 'Chat / Screenshot', sms: 'SMS', transaction: 'Transaction', payment: 'Payment',
    url: 'URL', email: 'Email', calllog: 'Call Log', notification: 'Notification', other: 'Unknown / Needs review'
  };

  /* ---------------- field extraction ---------------- */
  function extractAmounts(text) {
    var out = [], m, re = /(?:₹|rs\.?|inr)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/gi;
    while ((m = re.exec(text))) { var v = num(m[1]); if (!isNaN(v) && v > 0) out.push(v); }
    return uniq(out);
  }
  function pickAmount(text, amounts) {
    if (!amounts.length) return null;
    var lines = text.split('\n');
    for (var i = 0; i < lines.length; i++) {
      if (/(debited|credited|paid|sent|received|amount|transaction|₹|rs\.?|inr)/i.test(lines[i])) {
        var a = extractAmounts(lines[i]);
        if (a.length) return a[0];
      }
    }
    return amounts[0];
  }

  function extractTime(text) {
    var m = /\b([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?\s*(am|pm)?\b/i.exec(text);
    if (!m) return null;
    var h = parseInt(m[1], 10), mi = parseInt(m[2], 10), ap = m[4] ? m[4].toLowerCase() : null;
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    return { h: h, m: mi, minutes: h * 60 + mi, text: m[0].trim() };
  }
  function extractDate(text) {
    var m;
    if ((m = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(text))) return { y: +m[1], mo: +m[2], d: +m[3], text: m[0] };
    if ((m = /\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/.exec(text))) {
      var a = +m[1], b = +m[2], y = +m[3];
      if (y < 100) y += 2000;
      var d, mo;
      if (a > 12) { d = a; mo = b; } else if (b > 12) { mo = a; d = b; } else { d = a; mo = b; }
      return { y: y, mo: mo, d: d, text: m[0] };
    }
    var mm = /\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*(\d{2,4})?/i.exec(text);
    if (mm) {
      var y2 = mm[3] ? +mm[3] : null;
      if (y2 && y2 < 100) y2 += 2000;
      return { y: y2, mo: MONTHS[mm[2].slice(0, 3).toLowerCase()], d: +mm[1], text: mm[0].trim() };
    }
    return null;
  }
  function buildISO(date, time) {
    if (!date || !date.y || !time) return null;
    return date.y + '-' + pad(date.mo) + '-' + pad(date.d) + 'T' + pad(time.h) + ':' + pad(time.m) + ':00';
  }

  function extractLabeledFields(text) {
    var out = {};
    text.split('\n').forEach(function (line) {
      var m = /^\s*([A-Za-z][A-Za-z ._\/-]{1,28})\s*[:\-]\s*(.+?)\s*$/.exec(line);
      if (!m) return;
      var canon = window.TRACE_SERVICES.normalize
        ? window.TRACE_SERVICES.normalize.canonicalField(m[1]) : null;
      if (!canon) return;
      if (out[canon] == null && m[2]) out[canon] = m[2];
    });
    return out;
  }

  function extractLine(text, labels) {
    var re = new RegExp('^\\s*(?:' + labels + ')\\s*[:\\-]\\s*(.+)$', 'i');
    var lines = text.split('\n');
    for (var i = 0; i < lines.length; i++) {
      var m = re.exec(lines[i]);
      if (m && m[1]) return m[1].trim().slice(0, 90);
    }
    return null;
  }

  function guessMessage(lines) {
    var cand = lines.filter(function (l) {
      if (l.replace(/[^A-Za-z]/g, '').length < 6) return false;
      if (/^(from|to|subject|date|time|amount|txn|ref|balance|account)\b/i.test(l)) return false;
      if (/\b\d{1,2}:\d{2}\b/.test(l)) return false;
      if (/(?:₹|rs\.?|inr)\s?\d/i.test(l)) return false;
      return true;
    });
    cand.sort(function (a, b) { return b.length - a.length; });
    return cand.slice(0, 3).join(' ').slice(0, 280);
  }

  function expectedMissing(kind, f) {
    var missing = [];
    var txn = kind === 'transaction';
    if (txn) {
      if (f.amount == null) missing.push('amount');
      if (!f.timestampISO && f.timeMinutes == null && !f.hasDate) missing.push('timestamp');
      if (!f.transactionId) missing.push('transactionId');
    } else if (kind === 'message') {
      if (!f.sender) missing.push('sender');
      if (!f.timestampISO && f.timeMinutes == null && !f.hasDate) missing.push('timestamp');
    } else if (kind === 'email') {
      if (!f.sender) missing.push('sender');
    } else if (kind === 'calllog') {
      if (!f.phone) missing.push('phone');
      if (!f.timestampISO && f.timeMinutes == null && !f.hasDate) missing.push('timestamp');
    } else if (kind === 'url') {
      if (!f.message) missing.push('message');
    }
    return missing;
  }

  /* ---------------- assemble ---------------- */
  function parse(rawText, ctx) {
    ctx = ctx || {};
    var text = clean(rawText);
    var index = ctx.index || 1;
    var id = 'EV-' + pad(index);
    var cls = classify(text);
    var type = cls.type;
    var kind = KIND[type] || 'other';

    var base = (window.TRACE_SERVICES.extraction ? window.TRACE_SERVICES.extraction.extract(text) : {}) || {};
    var labeled = extractLabeledFields(text);

    var amounts = extractAmounts(text);
    var time = extractTime(text);
    var date = extractDate(text);
    var timestampISO = buildISO(date, time);

    var txnId = (base.txnIds && base.txnIds[0]) ||
      firstMatch(/(?:txn|utr|rrn|ref(?:erence)?|order|neft|imps)[\s.:#-]*([A-Z0-9][A-Z0-9-]{4,})/i, text);
    var upi = ((base.upi && base.upi[0]) || firstMatch(/\b([A-Za-z0-9._-]{2,}@[A-Za-z]{2,})\b(?!\.[a-z])/i, text));
    var email = (base.emails && base.emails[0]) || firstMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, text);
    var phone = (base.phones && base.phones[0]) || firstMatch(/(?:\+91[\s-]?)?[6-9]\d{9}\b/, text);
    var url = (base.urls && base.urls[0]) ||
      firstMatch(/\b(?:https?:\/\/|www\.)[^\s"'<>)]+/i, text) ||
      firstMatch(/\b([a-z0-9-]+\.(?:com|in|org|net|io|co|xyz|info)(?:\/[^\s]*)?)/i, text);

    var sender = labeled.sender || extractLine(text, 'from|sender|paid by|debited from|received from|sent by');
    var recipient = labeled.recipient || extractLine(text, 'to|receiver|payee|beneficiary|paid to|credited to|sent to');
    var paymentMethod = firstMatch(/\b(UPI|IMPS|NEFT|RTGS|RUPAY|VISA|MASTERCARD|DEBIT CARD|CREDIT CARD|CARD|WALLET|NET ?BANKING|AUTOPAY|MANDATE)\b/i, text);
    var account = firstMatch(/(?:a\/c|acct|account)(?:\s*(?:no|number))?[\s.:#-]*([Xx*\d][Xx*\d\s-]{3,20})/i, text);
    var message = guessMessage(text.split('\n')) || (labeled.message || '');
    var direction = /\b(debit|debited|paid|sent|withdraw|purchase|spent)\b/i.test(text) ? 'outgoing'
      : /\b(credit|credited|received|deposit|refund)\b/i.test(text) ? 'incoming' : null;

    var amount = pickAmount(text, amounts);
    if (amount == null && labeled.amount != null) { var lv = num(labeled.amount); if (!isNaN(lv)) amount = lv; }

    var fields = {
      amount: amount, timestampISO: timestampISO, timeMinutes: time ? time.minutes : null,
      hasDate: !!date, transactionId: txnId, sender: sender, phone: phone, message: message
    };
    var missingFields = expectedMissing(kind, fields);

    /* Decide whether this image actually contains relevant evidence.
       Free text only counts when the image looks like a genuine message/email/
       notification — so a random photo caption is never mistaken for evidence. */
    var ocrConfidence = typeof ctx.ocrConfidence === 'number' ? ctx.ocrConfidence : null;
    var messaging = kind === 'message' || kind === 'email' || kind === 'notification';
    var hasField = (amount != null) || !!txnId || !!url || !!phone || !!email || !!upi ||
      (messaging && message && message.length >= 8) ||
      (messaging && sender && sender.length >= 2);
    var ok = true, reason = null;

    if (text.replace(/[^A-Za-z0-9]/g, '').length < 3) {
      ok = false; reason = 'No readable text could be extracted from this image.';
    } else if (ocrConfidence != null && ocrConfidence < 35 && !hasField) {
      ok = false; reason = 'Text could not be read confidently from this image.';
    } else if (kind === 'other' && !hasField) {
      ok = false; reason = 'No transaction, message, URL, payment or incident-related information could be extracted from this image.';
    }

    var confidence = Math.round(((cls.confidence || 40) + (ocrConfidence != null ? Math.min(ocrConfidence, 95) : 70)) / 2);
    var status = !ok ? 'unreadable' : missingFields.length ? 'incomplete' : confidence >= 75 ? 'verified' : 'needs-review';

    var label;
    if (kind === 'transaction') label = (amount != null ? 'Transaction ' + fmtAmount(amount) : 'Transaction') + (direction ? ' (' + direction + ')' : '');
    else if (kind === 'message') label = type === 'chat' ? 'Chat message' : 'Message';
    else if (kind === 'url') label = 'URL detected';
    else if (kind === 'email') label = 'Email';
    else if (kind === 'calllog') label = 'Call log';
    else if (kind === 'notification') label = 'Notification';
    else label = 'Image evidence';

    return {
      ok: ok,
      reason: reason,
      id: id,
      caseId: ctx.caseId || null,
      fileName: ctx.fileName || null,
      sourceImageIndex: index,
      thumb: ctx.thumb || null,
      kind: kind,
      type: type,
      typeLabel: TYPE_LABEL[type] || 'Unknown / Needs review',
      eventType: kind,
      label: label,
      message: message,
      ocrText: text,
      ocrConfidence: ocrConfidence,
      timestamp: timestampISO,
      dateText: date ? date.text : null,
      timeText: time ? time.text : null,
      timeMinutes: time ? time.minutes : null,
      amount: amount,
      currency: 'INR',
      direction: direction,
      sender: sender,
      recipient: recipient,
      phone: phone,
      email: email,
      url: url,
      transactionId: txnId,
      upi: upi,
      paymentMethod: paymentMethod,
      account: account,
      confidence: confidence,
      status: status,
      missingFields: uniq(missingFields),
      flags: missingFields.map(function (f) { return 'missing:' + f; }),
      entities: {
        phones: uniq((base.phones || []).concat(phone ? [phone] : [])),
        emails: uniq((base.emails || []).concat(email ? [email] : [])),
        urls: uniq((base.urls || []).concat(url ? [url] : [])),
        amounts: amounts,
        txnIds: uniq((base.txnIds || []).concat(txnId ? [txnId] : [])),
        upi: uniq((base.upi || []).concat(upi ? [upi] : []))
      },
      relatedIds: [],
      duplicateGroup: null,
      conflictIds: [],
      notes: ''
    };
  }

  function fmtAmount(n) { return '₹' + Number(n).toLocaleString('en-IN'); }

  window.TRACE_SERVICES.parser = {
    clean: clean,
    classify: classify,
    parse: parse,
    EvidenceParser: { parse: parse, classify: classify },
    TYPE_LABEL: TYPE_LABEL
  };
})();
