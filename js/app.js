/* TRACE — Digital Evidence Intelligence (hackathon prototype)
 * Static SPA, no backend, no build step. Everything is derived from the user's
 * own uploaded screenshots via real client-side OCR. There is NO demo dataset:
 * the workspace starts empty and only shows what was actually extracted.
 * Local services live in js/services/*.js (window.TRACE_SERVICES).
 */
(function () {
'use strict';

var SV = window.TRACE_SERVICES || {};

/* ============================== UTILITIES ============================== */

function $(sel, root) { return (root || document).querySelector(sel); }
function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function nowISO() { return new Date().toISOString(); }
function fmtINR(n) {
  if (n == null || n === '' || isNaN(Number(n))) return '—';
  return '₹' + Number(n).toLocaleString('en-IN');
}
function fmtDateTime(iso) {
  if (!iso) return '—';
  var m = /(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(iso));
  if (!m) return String(iso);
  return m[3] + '/' + m[2] + '/' + m[1] + ' ' + m[4] + ':' + m[5];
}
function confPct(c) {
  if (c == null) return '—';
  var v = Number(c);
  return isNaN(v) ? '—' : Math.round(v) + '%';
}
function recTime(r) {
  if (r.timeText) return r.timeText;
  if (r.timestamp) return String(r.timestamp).slice(11, 16);
  return 'TIME UNKNOWN';
}
function recDate(r) {
  if (r.dateText) return r.dateText;
  if (r.timestamp) return String(r.timestamp).slice(0, 10);
  return '';
}

/* ============================== STATE ============================== */

function newCaseId() {
  var y = new Date().getFullYear();
  return 'TRC-' + y + '-' + String(Math.floor(Math.random() * 900) + 100);
}

var S = {
  caseId: newCaseId(),
  createdAt: nowISO(),
  records: [],        /* parsed, readable evidence */
  unreadable: [],     /* images with no extractable evidence */
  files: [],          /* upload queue */
  analysis: null,
  notes: {},          /* evId -> [{text, ts}] */
  reviewed: {},
  flagRes: {},
  privacy: { phones: true, emails: true, txnIds: true, upi: true, accounts: true, urls: true },
  filter: 'all',
  q: '',
  drawerId: null,
  proc: { running: false, token: 0, step: -1, result: null, error: null },
  seq: 0
};

function refresh() {
  S.analysis = SV.analyzer ? SV.analyzer.analyze(S.records, S.unreadable) : null;
}
refresh();

/* ============================== REDACTION (service) ============================== */

function R(v, t) { return SV.redaction.redact(v, t, S.privacy); }
function scrub(t) { return SV.redaction.scrub(t, S.privacy); }

/* ============================== SHARED SNIPPETS ============================== */

var KIND_ICON = { message: '💬', transaction: '💳', url: '🔗', email: '✉️', calllog: '📞', notification: '🔔', other: '🖼' };
var KIND_LABEL = { message: 'Message', transaction: 'Transaction', url: 'URL', email: 'Email', calllog: 'Call Log', notification: 'Notification', other: 'Image' };
function kindIcon(k) { return KIND_ICON[k] || '🖼'; }
function kindLabel(k) { return KIND_LABEL[k] || 'Evidence'; }

function statusBadge(r) {
  if (!r.ok) return '<span class="badge b-incomplete">NO EVIDENCE</span>';
  if (S.reviewed[r.id]) return '<span class="badge b-verified">REVIEWED</span>';
  var map = {
    'verified': ['b-verified', 'VERIFIED'],
    'needs-review': ['b-review', 'NEEDS REVIEW'],
    'incomplete': ['b-incomplete', 'INCOMPLETE'],
    'conflict': ['b-conflict', 'POTENTIAL CONTRADICTION']
  };
  var m = map[r.status] || ['b-review', String(r.status || '').toUpperCase()];
  return '<span class="badge ' + m[0] + '">' + m[1] + '</span>';
}
function confBar(c) {
  var v = c == null ? 0 : Number(c);
  if (isNaN(v)) v = 0;
  return '<div class="tr-bar" role="img" aria-label="Confidence ' + Math.round(v) + ' percent">'
    + '<div class="tr-bar-fill" style="width:' + Math.max(0, Math.min(100, v)) + '%"></div></div>'
    + '<span class="mono dim">' + confPct(c) + '</span>';
}
function evChip(id) {
  return '<button type="button" class="ev-chip mono" data-action="open-drawer" data-id="' + esc(id) + '">' + esc(id) + '</button>';
}

/* ============================== TOAST ============================== */

function toast(msg, type) {
  var root = document.getElementById('toast-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'toast-root'; root.className = 'tr-toasts'; root.setAttribute('aria-live', 'polite');
    document.body.appendChild(root);
  }
  var t = document.createElement('div');
  t.className = 'tr-toast ' + (type || 'info');
  t.setAttribute('role', 'status');
  t.textContent = msg;
  root.appendChild(t);
  setTimeout(function () { t.classList.add('out'); setTimeout(function () { t.remove(); }, 350); }, 3200);
}

/* ============================== UPLOAD INTAKE ============================== */

var IMG_EXT = /\.(png|jpe?g|webp|bmp|gif|tiff?)$/i;

function resetFile() {
  return { text: null, file: null, thumb: null, status: 'pending', progress: 0, recordId: null, error: null, note: null };
}

function addImageFiles(fileList) {
  var added = 0, rejected = 0;
  Array.prototype.forEach.call(fileList || [], function (f) {
    S.seq++;
    var isImg = (f.type && f.type.indexOf('image/') === 0) || IMG_EXT.test(f.name || '');
    if (!isImg) {
      rejected++;
      var bad = resetFile();
      bad.file = f; bad.name = f.name || 'unknown';
      bad.status = 'unsupported';
      bad.error = 'Unsupported file type — upload a screenshot or image.';
      S.files.push(bad);
      return;
    }
    var item = resetFile();
    item.file = f;
    item.name = f.name || ('image_' + String(S.seq).padStart(2, '0') + '.png');
    try { item.thumb = URL.createObjectURL(f); } catch (e) { item.thumb = null; }
    S.files.push(item);
    added++;
  });
  if (added) toast(added + ' image' + (added === 1 ? '' : 's') + ' added. Run processing when ready.', 'ok');
  if (rejected) toast(rejected + ' unsupported file' + (rejected === 1 ? '' : 's') + ' skipped.', 'warn');
}

function addTextItem(text) {
  var t = String(text || '').trim();
  if (!t) { toast('Paste some text first.', 'warn'); return; }
  var item = resetFile();
  item.text = t;
  item.name = 'pasted-text.txt';
  S.files.push(item);
  toast('Text evidence added.', 'ok');
}

function pendingQueue() {
  return S.files.filter(function (f) { return f.status === 'pending'; });
}
function queueCount() { return pendingQueue().length; }

/* ============================== ROUTER + CHROME ============================== */

var NAV = [
  ['/overview', 'Overview', '▦'],
  ['/evidence', 'Evidence', '🗂'],
  ['/timeline', 'Timeline', '◷'],
  ['/flags', 'Flags', '⚑'],
  ['/report', 'Report', '📄']
];

var ROUTES = { '/overview': vOverview, '/upload': vUpload, '/processing': vProcessing, '/evidence': vEvidence, '/timeline': vTimeline, '/flags': vFlags, '/report': vReport };
var MOUNTS = { '/upload': mountUpload, '/processing': mountProcessing };
var TITLES = { '/overview': 'Overview', '/upload': 'Upload evidence', '/processing': 'Processing', '/evidence': 'Evidence', '/timeline': 'Timeline', '/flags': 'Flags', '/report': 'Report' };

function currentRoute() {
  var h = (location.hash || '#/overview').replace(/^#/, '');
  if (!h || h === '/') h = '/overview';
  return h;
}
function logoSVG() {
  return '<svg width="30" height="30" viewBox="0 0 28 28" aria-hidden="true">'
    + '<circle cx="14" cy="14" r="12" fill="none" stroke="#22D3EE" stroke-width="2"/>'
    + '<circle cx="14" cy="14" r="4" fill="#8B5CF6"/>'
    + '<circle cx="14" cy="5.5" r="2" fill="#22D3EE"/>'
    + '<line x1="14" y1="7.5" x2="14" y2="10" stroke="#22D3EE" stroke-width="1.5"/></svg>';
}
function flagCount() {
  if (!S.analysis) return 0;
  var m = S.analysis.metrics;
  return m.conflicts + m.duplicates + m.missing + m.unreadable;
}

function chrome(viewHTML, active) {
  var nav = NAV.map(function (n) {
    return '<li><a href="#' + n[0] + '" class="nav-link' + (active === n[0] ? ' active' : '') + '"'
      + (active === n[0] ? ' aria-current="page"' : '') + '>'
      + '<span class="nav-ic" aria-hidden="true">' + n[2] + '</span><span>' + esc(n[1]) + '</span>'
      + (n[0] === '/flags' && flagCount() ? '<span class="nav-count mono">' + flagCount() + '</span>' : '')
      + '</a></li>';
  }).join('');
  var mnav = NAV.map(function (n) {
    return '<a href="#' + n[0] + '" class="mnav-link' + (active === n[0] ? ' active' : '') + '">'
      + '<span class="mnav-ic" aria-hidden="true">' + n[2] + '</span><span>' + esc(n[1]) + '</span></a>';
  }).join('');
  var masked = S.privacy.phones;
  var q = queueCount();

  return '<div class="app-shell">'
    + '<aside class="sidebar" aria-label="Primary navigation">'
    + '<a class="brand" href="#/overview">' + logoSVG() + '<span>TRACE</span></a>'
    + '<nav aria-label="Case sections"><ul class="nav-list">' + nav + '</ul></nav>'
    + '<button type="button" class="btn btn-primary side-upload" data-action="go" data-href="#/upload">+ UPLOAD EVIDENCE'
    + (q ? '<span class="pill-count">' + q + '</span>' : '') + '</button>'
    + '<div class="case-card"><div class="cc-label">CASE</div>'
    + '<div class="cc-id mono">' + esc(S.caseId) + '</div>'
    + '<div class="cc-row"><span class="cc-status">' + (S.records.length ? 'UNDER REVIEW' : 'NO EVIDENCE') + '</span></div>'
    + '<div class="cc-priv">' + (S.records.length ? S.records.length + ' record' + (S.records.length === 1 ? '' : 's') + ' · ' : '') + '🔒 PRIVATE CASE</div></div>'
    + '</aside>'
    + '<div class="shell-main">'
    + '<header class="topbar">'
    + '<div class="search-wrap"><input id="global-search" type="search" aria-label="Search evidence" placeholder="Search evidence…" autocomplete="off" value="' + esc(S.q) + '">'
    + '<kbd class="tb-kbd" aria-hidden="true">/</kbd></div>'
    + '<div class="topbar-meta">'
    + '<span class="tb-chip mono" title="Case ID">' + esc(S.caseId) + '</span>'
    + '<a class="tb-flag" href="#/flags" title="Items needing review">⚑ <span>' + flagCount() + '</span></a>'
    + '</div>'
    + '<button type="button" class="privacy-pill' + (masked ? '' : ' off') + '" data-action="toggle-redact" title="Toggle sensitive-data masking">'
    + (masked ? '🔒 SENSITIVE DATA MASKED' : '🔓 REVEALING DATA') + '</button>'
    + '<button type="button" class="btn btn-primary btn-sm top-upload" data-action="go" data-href="#/upload">+ UPLOAD</button>'
    + '</header>'
    + '<main class="main" id="view">' + viewHTML + '</main>'
    + '</div>'
    + '<nav class="mobile-nav" aria-label="Mobile navigation">' + mnav + '</nav>'
    + '</div>';
}

function bindChrome() {
  var inp = document.getElementById('global-search');
  if (inp) {
    inp.addEventListener('input', function () {
      S.q = inp.value;
      if (currentRoute() === '/evidence') renderEvGrid();
    });
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { S.q = inp.value; if (currentRoute() !== '/evidence') location.hash = '#/evidence'; else renderEvGrid(); }
      if (e.key === 'Escape') inp.blur();
    });
  }
}

function render() {
  var app = document.getElementById('app');
  var r = currentRoute();
  if (!ROUTES[r]) { location.hash = '#/overview'; return; }
  app.innerHTML = chrome(ROUTES[r](), r);
  document.title = 'TRACE — ' + (TITLES[r] || 'Evidence');
  bindChrome();
  if (MOUNTS[r]) MOUNTS[r]();
  try { window.scrollTo(0, 0); } catch (e) {}
}
window.addEventListener('hashchange', render);

/* ============================== VIEW: OVERVIEW ============================== */

function statCard(key, label, value, href, tone) {
  return '<button type="button" class="stat-card' + (tone ? ' ' + tone : '') + '" data-action="go" data-href="' + href + '" aria-label="' + esc(label) + ': ' + esc(value) + '">'
    + '<div class="stat-val">' + esc(value) + '</div><div class="stat-lbl">' + label + '</div>'
    + '<div class="stat-trace">VIEW →</div></button>';
}

function vOverview() {
  var has = S.records.length || S.unreadable.length;
  if (!has) {
    return '<div class="page-head"><h1>OVERVIEW</h1><p class="dim">Case <span class="mono">' + esc(S.caseId) + '</span> · no evidence yet</p></div>'
      + '<div class="empty-state empty-cta">'
      + '<div class="empty-icon" aria-hidden="true">⤒</div>'
      + '<h3>UPLOAD EVIDENCE</h3>'
      + '<p>Add screenshots to begin. TRACE reads the text from your images on this device and builds a traceable incident record from what it finds.</p>'
      + '<button type="button" class="btn btn-primary" data-action="go" data-href="#/upload">+ Upload Evidence</button>'
      + '<p class="dim formats">Supported: PNG · JPG · WEBP · BMP · (or paste text)</p>'
      + '</div>';
  }

  var m = S.analysis.metrics;
  var cards = statCard('evidence', 'EVIDENCE', String(m.evidence), '#/evidence')
    + statCard('transactions', 'TRANSACTIONS', String(m.txnCount), '#/evidence')
    + statCard('flagged', 'FLAGGED', String(m.flagged), '#/flags')
    + statCard('missing', 'MISSING', String(m.missing), '#/flags')
    + statCard('contradictions', 'CONTRA- DICTIONS', String(m.conflicts), '#/flags')
    + statCard('duplicates', 'DUPLICATES', String(m.duplicates), '#/flags');

  var flow = ['Upload', 'Extract', 'Timeline', 'Flags', 'Report']
    .map(function (s, i) { return (i ? '<span class="flow-arrow" aria-hidden="true">→</span>' : '') + '<span class="flow-step done">' + s + '</span>'; }).join('');

  var alerts = '';
  if (S.unreadable.length) {
    alerts = '<a class="alert alert-missing" href="#/evidence"><span class="a-ic">◌</span><div><strong>' + S.unreadable.length + ' UPLOAD' + (S.unreadable.length === 1 ? '' : 'S') + ' WITH NO EVIDENCE</strong>'
      + '<div class="dim">No transaction, message, URL or incident information could be extracted.</div></div><span class="a-go">→</span></a>';
  }
  if (m.conflicts) {
    alerts += '<a class="alert alert-conflict" href="#/flags"><span class="a-ic">⚠️</span><div><strong>' + m.conflicts + ' POTENTIAL CONTRADICTION' + (m.conflicts === 1 ? '' : 'S') + '</strong>'
      + '<div class="dim">Conflicting values were extracted from different uploads — needs investigator review.</div></div><span class="a-go">→</span></a>';
  }

  var recent = S.analysis.events.slice().reverse().slice(0, 5).map(function (r) {
    return '<button type="button" class="recent-row" data-action="open-drawer" data-id="' + esc(r.id) + '">'
      + '<span class="recent-ic" aria-hidden="true">' + kindIcon(r.kind) + '</span>'
      + '<div style="flex:1;min-width:0"><div><span class="mono" style="color:#22D3EE;font-size:12px">' + esc(r.id) + '</span> <span style="font-size:13px">' + esc(r.label) + (r.amount != null ? ' · ' + esc(fmtINR(r.amount)) : '') + '</span></div>'
      + '<div class="dim mono" style="font-size:11px">' + esc(recTime(r)) + (recDate(r) ? ' · ' + esc(recDate(r)) : '') + ' · ' + esc(scrub(r.fileName || '')) + '</div></div>'
      + statusBadge(r) + '</button>';
  }).join('');

  return '<div class="page-head"><h1>INCIDENT OVERVIEW</h1><p class="dim">Case <span class="mono">' + esc(S.caseId) + '</span> · generated from ' + m.evidence + ' uploaded record' + (m.evidence === 1 ? '' : 's') + '</p></div>'
    + '<div class="panel ai-panel"><div class="tr-sec">INCIDENT SUMMARY <span class="inf-label">DERIVED FROM UPLOADS</span></div>'
    + '<p>' + esc(SV.ai && SV.ai.summarize ? SV.ai.summarize({ metrics: m, duplicateGroups: m.duplicates }) : '') + '</p></div>'
    + '<div class="stat-grid">' + cards + '</div>'
    + '<div class="panel"><div class="tr-sec">WORKFLOW</div><div class="flow-strip">' + flow + '</div></div>'
    + (alerts ? '<div class="panel"><div class="tr-sec" style="color:#FBBF24">INVESTIGATION ALERTS</div><div class="alert-list">' + alerts + '</div></div>' : '')
    + '<div class="panel"><div class="tr-sec">RECENT EVIDENCE</div><div>' + (recent || '<p class="dim">No records yet.</p>') + '</div>'
    + '<div class="action-row"><button type="button" class="btn btn-ghost btn-sm" data-action="go" data-href="#/upload">+ UPLOAD MORE</button>'
    + '<button type="button" class="btn btn-ghost btn-sm" data-action="go" data-href="#/timeline">VIEW TIMELINE</button>'
    + '<button type="button" class="btn btn-ghost btn-sm" data-action="go" data-href="#/flags">VIEW FLAGS</button>'
    + '<button type="button" class="btn btn-primary btn-sm" data-action="export-csv">EXPORT CSV</button>'
    + '<button type="button" class="btn btn-ghost btn-sm" data-action="export-pdf">EXPORT PDF</button></div></div>';
}

/* ============================== VIEW: UPLOAD ============================== */

function fileStatusText(f) {
  if (f.status === 'pending') return 'Queued';
  if (f.status === 'processing') return f.note || 'Processing…';
  if (f.status === 'done') return 'Processed';
  if (f.status === 'no-evidence') return 'No evidence found';
  if (f.status === 'error') return f.error || 'OCR failed';
  if (f.status === 'unsupported') return f.error || 'Unsupported';
  if (f.status === 'reading') return 'Reading image…';
  return f.status;
}
function fileRow(f, i) {
  var st = f.status;
  var cls = st === 'done' ? 'is-done' : st === 'error' ? 'is-error' : st === 'no-evidence' || st === 'unsupported' ? 'is-warn' : st === 'processing' ? 'is-active' : '';
  var icon = st === 'done' ? '✓' : st === 'error' ? '✕' : st === 'no-evidence' ? '◌' : st === 'unsupported' ? '✕' : st === 'processing' ? '⟳' : '•';
  var thumb = f.thumb ? '<img class="file-thumb" src="' + f.thumb + '" alt="">' : '<span class="file-thumb file-thumb-txt" aria-hidden="true">TXT</span>';
  var prog = (st === 'processing') ? '<div class="file-prog"><div class="file-prog-fill" style="width:' + Math.round((f.progress || 0) * 100) + '%"></div></div>' : '';
  return '<div class="file-row ' + cls + '" id="frow-' + i + '">' + thumb
    + '<div class="file-info"><div class="file-name">' + esc(f.name) + '</div>'
    + '<div class="file-sub dim">' + esc(fileStatusText(f)) + '</div>' + prog + '</div>'
    + '<span class="file-status" aria-hidden="true">' + icon + '</span>'
    + '<button type="button" class="file-remove" data-action="remove-file" data-i="' + i + '" aria-label="Remove ' + esc(f.name) + '">✕</button></div>';
}

function vUpload() {
  var q = queueCount();
  var rows = S.files.map(fileRow).join('');
  return '<div class="page-head"><h1>UPLOAD EVIDENCE</h1>'
    + '<p class="dim">Add screenshots from the incident. Text is read on this device — images are never uploaded anywhere.</p></div>'
    + '<div class="panel">'
    + '<div id="dropzone" class="dropzone" role="button" tabindex="0" aria-label="Drop screenshots here or click to browse">'
    + '<div class="dz-ic" aria-hidden="true">⤒</div>'
    + '<p><strong>Drop screenshots here</strong> or click to browse</p>'
    + '<p class="dim" style="font-size:12px">Chats · bank transactions · UPI · payment requests · URLs · emails · call logs</p>'
    + '<input type="file" id="file-input" accept="image/*" multiple hidden></div>'
    + '<div class="chip-row" role="group" aria-label="Add text instead">'
    + '<button type="button" class="chip" data-action="toggle-paste">✎ Paste text instead</button></div>'
    + '<form data-form="paste" class="paste-form" hidden id="paste-form">'
    + '<label class="lbl" for="paste-text">PASTED TEXT / TRANSCRIPT</label>'
    + '<textarea id="paste-text" class="field" name="text" rows="4" placeholder="Paste message text, an SMS, or a transaction line…"></textarea>'
    + '<button type="submit" class="btn btn-ghost btn-sm" style="margin-top:8px">ADD TEXT</button></form>'
    + '</div>'
    + (S.files.length ? '<div class="panel"><div class="tr-sec">UPLOAD QUEUE · ' + S.files.length + '</div><div class="file-list">' + rows + '</div></div>' : '')
    + '<div class="action-row">'
    + '<button type="button" class="btn btn-primary" data-action="process"' + (q ? '' : ' disabled') + '>'
    + (q ? 'PROCESS ' + q + ' ITEM' + (q === 1 ? '' : 'S') : 'NOTHING TO PROCESS') + '</button>'
    + (S.records.length || S.unreadable.length ? '<button type="button" class="btn btn-ghost" data-action="go" data-href="#/overview">VIEW RESULTS</button>' : '')
    + '</div>';
}

function mountUpload() {
  var dz = document.getElementById('dropzone');
  var fi = document.getElementById('file-input');
  if (!dz || !fi) return;
  dz.addEventListener('click', function () { fi.click(); });
  dz.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fi.click(); } });
  ['dragenter', 'dragover'].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('dragover'); }); });
  ['dragleave', 'drop'].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('dragover'); }); });
  dz.addEventListener('drop', function (e) { addImageFiles(e.dataTransfer.files); render(); });
  fi.addEventListener('change', function () { addImageFiles(fi.files); fi.value = ''; render(); });
}

/* ============================== VIEW: PROCESSING ============================== */

var PROC_STEPS = ['Reading image', 'Extracting text', 'Identifying evidence', 'Building timeline', 'Checking inconsistencies', 'Redacting sensitive data', 'Ready'];
var PHASE_STEP = { 'Extracting text': 1, 'Identifying evidence': 2, 'Building timeline': 3, 'Checking inconsistencies': 4, 'Redacting sensitive data': 5 };

function vProcessing() {
  var queue = pendingQueue();
  var steps = PROC_STEPS.map(function (s, i) {
    var cls = i < S.proc.step ? 'done' : i === S.proc.step ? 'active' : 'pending';
    if (S.proc.step < 0 && i === 0) cls = 'pending';
    return '<div class="pipe-row ' + cls + '" id="pstep-' + i + '"><span class="pipe-ic" aria-hidden="true">' + (cls === 'done' ? '●' : cls === 'active' ? '◐' : '○') + '</span>'
      + '<span class="pipe-name">' + s + '</span></div>';
  }).join('');

  var rows = (queue.length ? queue : S.files.filter(function (f) { return f.status === 'done' || f.status === 'no-evidence' || f.status === 'error' || f.status === 'unsupported'; }))
    .map(function (f) { return fileRow(f, S.files.indexOf(f)); }).join('');

  var result = '';
  if (S.proc.result && !S.proc.running) {
    result = '<div class="panel"><div class="tr-sec">PROCESSING COMPLETE</div>'
      + '<p><strong>' + S.proc.result.readable + '</strong> evidence record' + (S.proc.result.readable === 1 ? '' : 's') + ' extracted · '
      + '<strong>' + S.proc.result.unreadable + '</strong> upload' + (S.proc.result.unreadable === 1 ? '' : 's') + ' with no relevant evidence.</p>'
      + '<div class="action-row"><button type="button" class="btn btn-primary" data-action="go" data-href="#/overview">VIEW RESULTS →</button>'
      + '<button type="button" class="btn btn-ghost" data-action="go" data-href="#/upload">UPLOAD MORE</button></div></div>';
  }

  return '<div class="page-head"><h1>PROCESSING</h1><p class="dim">Reading your screenshots and extracting evidence on this device.</p></div>'
    + '<div class="panel"><div class="tr-sec">PIPELINE</div><div class="pipe-list">' + steps + '</div></div>'
    + (rows ? '<div class="panel"><div class="tr-sec">FILES</div><div class="file-list">' + rows + '</div></div>' : '')
    + result
    + (S.proc.error ? '<div class="error-state" role="alert"><h3>PROCESSING ERROR</h3><p>' + esc(S.proc.error) + '</p></div>' : '');
}

function setStep(idx) {
  S.proc.step = idx;
  for (var i = 0; i < PROC_STEPS.length; i++) {
    var el = document.getElementById('pstep-' + i);
    if (!el) continue;
    el.classList.remove('done', 'active', 'pending');
    el.classList.add(i < idx ? 'done' : i === idx ? 'active' : 'pending');
    var ic = el.querySelector('.pipe-ic');
    if (ic) ic.textContent = i < idx ? '●' : i === idx ? '◐' : '○';
  }
}
function updateProcRow(f) {
  var i = S.files.indexOf(f);
  var el = document.getElementById('frow-' + i);
  if (!el) return;
  var parent = el.parentNode;
  if (parent) parent.innerHTML = S.files.map(fileRow).join('');
}

function mountProcessing() {
  if (S.proc.running) return;
  var queue = pendingQueue();
  if (!queue.length) return; /* view renders the completion state */
  runPipeline(queue);
}

function runPipeline(queue) {
  var token = (S.proc.token = S.proc.token + 1);
  S.proc.running = true;
  S.proc.result = null;
  S.proc.error = null;
  setStep(0);

  var items = queue.map(function (f) { return { name: f.name, file: f.file, text: f.text, thumb: f.thumb, ref: f }; });

  SV.evidence.processFiles(items, {
    caseId: S.caseId,
    onPhase: function (phase) {
      if (token !== S.proc.token) return;
      var idx = PHASE_STEP[phase];
      if (idx != null) setStep(idx);
    },
    onItem: function (item, status, progress, note) {
      if (token !== S.proc.token) return;
      var f = item.ref;
      f.status = status;
      if (note) f.note = note;
      if (typeof progress === 'number') f.progress = progress;
      updateProcRow(f);
    }
  }).then(function (res) {
    if (token !== S.proc.token) return;
    S.records = S.records.concat(res.records);
    S.unreadable = S.unreadable.concat(res.unreadable);
    refresh();
    setStep(PROC_STEPS.length);
    S.proc.running = false;
    S.proc.result = { readable: res.records.length, unreadable: res.unreadable.length };
    if (!res.records.length) toast('No relevant evidence found in the uploaded file(s).', 'warn');
    else toast(res.records.length + ' evidence record' + (res.records.length === 1 ? '' : 's') + ' extracted.', 'ok');
    render();
  }).catch(function (err) {
    S.proc.running = false;
    S.proc.error = (err && err.message) || 'Processing failed.';
    render();
  });
}

/* ============================== VIEW: EVIDENCE ============================== */

var FILTERS = [['all', 'All'], ['message', 'Messages'], ['transaction', 'Transactions'], ['url', 'URLs'], ['notification', 'Notifications'], ['flagged', 'Flagged'], ['missing', 'Missing'], ['unreadable', 'No evidence']];

function filteredRecords() {
  var q = S.q.trim().toLowerCase();
  var list = S.records.filter(function (r) {
    if (S.filter === 'flagged') return r.status === 'conflict' || r.status === 'incomplete' || (r.missingFields || []).length > 0 || r.duplicateGroup;
    if (S.filter === 'missing') return (r.missingFields || []).length > 0;
    if (S.filter === 'unreadable') return false;
    if (S.filter !== 'all' && r.kind !== S.filter) return false;
    return true;
  });
  if (q) list = list.filter(function (r) {
    var hay = [r.id, r.fileName, r.label, r.message, r.ocrText, r.transactionId, r.phone, r.email, r.url, r.sender, r.recipient, r.typeLabel].join(' ').toLowerCase();
    return hay.indexOf(q) >= 0;
  });
  return list;
}

function evCard(r) {
  var keys = [];
  if (r.amount != null) keys.push('<span class="k">💰 ' + esc(fmtINR(r.amount)) + '</span>');
  if (r.timeText || r.timestamp) keys.push('<span class="k mono">🕑 ' + esc(recTime(r)) + '</span>');
  if (r.transactionId) keys.push('<span class="k mono">' + esc(R(r.transactionId, 'txnIds')) + '</span>');
  if (r.phone) keys.push('<span class="k mono">' + esc(R(r.phone, 'phones')) + '</span>');
  if (r.url) keys.push('<span class="k mono">' + esc(R(r.url, 'urls')) + '</span>');
  var thumb = r.thumb ? '<img class="ev-thumb" src="' + r.thumb + '" alt="Source screenshot">' : '<span class="ev-thumb ev-thumb-txt" aria-hidden="true">' + kindIcon(r.kind) + '</span>';
  return '<button type="button" class="ev-card" data-action="open-drawer" data-id="' + esc(r.id) + '" aria-label="Open evidence ' + esc(r.id) + '">'
    + '<div class="ev-card-top">' + thumb
    + '<div class="ev-top-meta"><span class="ev-id mono">' + esc(r.id) + ' · Evidence #' + String(r.sourceImageIndex).padStart(2, '0') + '</span>' + statusBadge(r) + '</div></div>'
    + '<div class="ev-label">' + esc(r.label) + '</div>'
    + (r.message ? '<div class="ev-snippet dim">' + esc(scrub(r.message).slice(0, 120)) + '</div>' : '')
    + (keys.length ? '<div class="ev-keys">' + keys.join(' ') + '</div>' : '')
    + '<div class="ev-meta dim mono">' + esc(r.typeLabel) + ' · ' + esc(scrub(r.fileName || '')) + '</div>'
    + '</button>';
}
function unreadableCard(r) {
  var thumb = r.thumb ? '<img class="ev-thumb" src="' + r.thumb + '" alt="">' : '<span class="ev-thumb ev-thumb-txt" aria-hidden="true">◌</span>';
  return '<div class="ev-card ev-card-plain">'
    + '<div class="ev-card-top">' + thumb
    + '<div class="ev-top-meta"><span class="ev-id mono">' + esc(r.id) + '</span><span class="badge b-incomplete">NO EVIDENCE</span></div></div>'
    + '<div class="ev-label">' + esc(r.fileName || 'Upload') + '</div>'
    + '<div class="ev-meta dim">' + esc(r.reason || 'No relevant evidence found.') + '</div></div>';
}

function renderEvGrid() {
  var grid = document.getElementById('ev-grid');
  if (!grid) return;
  var html;
  if (S.filter === 'unreadable') {
    html = S.unreadable.length ? S.unreadable.map(unreadableCard).join('') : '<div class="empty-state"><h3>NO UNREADABLE UPLOADS</h3><p>Every upload produced readable text.</p></div>';
  } else {
    var list = filteredRecords();
    html = list.length ? list.map(evCard).join('') : '<div class="empty-state"><h3>NO EVIDENCE FOUND</h3><p>No records match this view. Upload screenshots, or clear the search and filters.</p></div>';
  }
  grid.innerHTML = html;
}

function vEvidence() {
  if (!S.records.length && !S.unreadable.length) {
    return '<div class="page-head"><h1>EVIDENCE</h1><p class="dim">No evidence yet.</p></div>'
      + '<div class="empty-state"><h3>NO EVIDENCE</h3><p>Add screenshots to begin.</p>'
      + '<button type="button" class="btn btn-primary" data-action="go" data-href="#/upload">+ Upload Evidence</button></div>';
  }
  var chips = FILTERS.map(function (f) {
    var n = f[0] === 'unreadable' ? S.unreadable.length : '';
    return '<button type="button" class="chip' + (S.filter === f[0] ? ' active' : '') + '" data-action="filter" data-f="' + f[0] + '" aria-pressed="' + (S.filter === f[0]) + '">' + f[1] + (n ? ' <span class="chip-n">' + n + '</span>' : '') + '</button>';
  }).join('');
  return '<div class="page-head"><h1>EVIDENCE</h1><p class="dim">' + S.records.length + ' record' + (S.records.length === 1 ? '' : 's') + ' extracted from your uploads. Open a record to see its source image and full trace.</p></div>'
    + '<div class="toolbar"><input id="ev-q" class="field" type="search" aria-label="Search evidence" placeholder="Search ID, message, amount, URL, phone…" value="' + esc(S.q) + '"></div>'
    + '<div class="chip-row" role="group" aria-label="Filter evidence">' + chips + '</div>'
    + '<div class="ev-grid" id="ev-grid"></div>';
}

/* ============================== VIEW: TIMELINE ============================== */

function vTimeline() {
  if (!S.records.length) {
    return '<div class="page-head"><h1>TIMELINE</h1></div><div class="empty-state"><h3>NO TIMELINE</h3><p>Upload evidence to build the incident timeline.</p>'
      + '<button type="button" class="btn btn-primary" data-action="go" data-href="#/upload">+ Upload Evidence</button></div>';
  }
  var events = S.analysis.events;
  var placed = events.filter(function (r) { return r.timestamp || r.timeMinutes != null; });
  var unplaced = events.filter(function (r) { return !r.timestamp && r.timeMinutes == null; });

  var items = placed.map(function (r) {
    var detail = '<div class="tl-detail">'
      + (r.message ? '<p>' + esc(scrub(r.message)) + '</p>' : '')
      + '<dl class="tr-kv">'
      + '<dt>SOURCE</dt><dd>' + esc(scrub(r.fileName || '—')) + '</dd>'
      + (r.amount != null ? '<dt>AMOUNT</dt><dd>' + esc(fmtINR(r.amount)) + '</dd>' : '')
      + (r.sender ? '<dt>SENDER</dt><dd>' + esc(scrub(r.sender)) + '</dd>' : '')
      + (r.transactionId ? '<dt>TXN ID</dt><dd class="mono">' + esc(R(r.transactionId, 'txnIds')) + '</dd>' : '')
      + (r.url ? '<dt>URL</dt><dd class="mono">' + esc(R(r.url, 'urls')) + '</dd>' : '')
      + '<dt>CONFIDENCE</dt><dd>' + confBar(r.confidence) + '</dd></dl>'
      + '<div class="action-row"><button type="button" class="btn btn-ghost btn-sm" data-action="open-drawer" data-id="' + esc(r.id) + '">OPEN RECORD</button>'
      + (r.thumb ? '<button type="button" class="btn btn-ghost btn-sm" data-action="view-source" data-id="' + esc(r.id) + '">VIEW SOURCE IMAGE</button>' : '') + '</div></div>';
    var marks = '';
    if (r.duplicateGroup) marks += '<span class="dot-flag dup" title="Possible duplicate">≈</span>';
    if ((r.conflictIds || []).length) marks += '<span class="dot-flag conf" title="Potential contradiction">⚠</span>';
    if ((r.missingFields || []).length) marks += '<span class="dot-flag miss" title="Missing information">◌</span>';
    return '<div class="tl-event' + ((r.conflictIds || []).length ? ' st-conflict' : (r.missingFields || []).length ? ' st-review' : '') + '" role="button" tabindex="0" data-action="tl-expand" data-id="' + esc(r.id) + '">'
      + '<div class="tl-time mono">' + esc(recTime(r)) + (recDate(r) ? '<span class="tl-date">' + esc(recDate(r)) + '</span>' : '') + '<span class="tl-marks">' + marks + '</span></div>'
      + '<div class="tl-body"><div class="tl-row"><span class="et-badge">' + esc(r.typeLabel) + '</span>' + statusBadge(r) + '</div>'
      + '<div class="tl-label">' + esc(r.label) + '</div>'
      + '<div class="tl-src dim">' + esc(scrub(r.fileName || '')) + ' · <span class="mono">' + esc(r.id) + '</span></div>'
      + detail + '</div></div>';
  }).join('');

  var unplacedHTML = unplaced.length ? '<div class="panel" style="margin-top:16px"><div class="tr-sec" style="color:#FBBF24">TIME UNKNOWN</div>'
    + unplaced.map(function (r) {
      return '<button type="button" class="tl-event tl-unplaced" data-action="open-drawer" data-id="' + esc(r.id) + '">'
        + '<div class="tl-time mono" style="color:#FBBF24">TIME UNKNOWN</div>'
        + '<div class="tl-body"><div class="tl-label">' + esc(r.label) + '</div>'
        + '<div class="tl-src" style="color:#FBBF24;font-size:12px">Flagged as missing information — no date or time was visible. <span class="mono">' + esc(r.id) + '</span></div></div></button>';
    }).join('') + '</div>' : '';

  return '<div class="page-head"><h1>TIMELINE</h1><p class="dim">' + placed.length + ' timed event' + (placed.length === 1 ? '' : 's') + '. Click an event to expand it.</p></div>'
    + '<div class="timeline">' + (items || '<div class="empty-state"><h3>NO TIMED EVENTS</h3><p>No upload contained a usable date or time.</p></div>') + '</div>'
    + unplacedHTML;
}

/* ============================== VIEW: FLAGS ============================== */

function vFlags() {
  if (!S.records.length && !S.unreadable.length) {
    return '<div class="page-head"><h1>FLAGS</h1></div><div class="empty-state"><h3>NO FLAGS</h3><p>Upload evidence to run checks.</p>'
      + '<button type="button" class="btn btn-primary" data-action="go" data-href="#/upload">+ Upload Evidence</button></div>';
  }
  var a = S.analysis;

  var confSection = a.contradictions.length ? a.contradictions.map(function (c) {
    return '<div class="panel conf-card"><div class="conf-head"><span class="mono" style="color:#F87171">CONTRADICTION · ' + esc(c.id) + '</span>'
      + '<span class="badge b-conflict">NEEDS REVIEW</span></div>'
      + '<h3 style="margin:6px 0">' + esc(c.title) + '</h3>'
      + '<div class="conf-vs"><div class="conf-side">' + evChip(c.evidenceA) + '<div class="conf-big">' + esc(c.valueA) + '</div></div>'
      + '<div class="conf-mid" aria-hidden="true">VS</div>'
      + '<div class="conf-side">' + evChip(c.evidenceB) + '<div class="conf-big">' + esc(c.valueB) + '</div></div></div>'
      + '<div class="conf-reason"><p>' + esc(c.reason) + '</p></div></div>';
  }).join('') : '<div class="empty-state"><p>No potential contradictions detected.</p></div>';

  var dupSection = a.duplicates.length ? a.duplicates.map(function (d) {
    var sides = (d.evidenceIds || []).map(function (id) {
      var r = S.records.filter(function (x) { return x.id === id; })[0];
      return '<div class="conf-side">' + evChip(id) + '<div class="dim" style="font-size:12px">' + esc(scrub(r ? r.fileName || '' : '')) + '</div></div>';
    }).join('<div class="conf-mid" aria-hidden="true">≈</div>');
    return '<div class="panel conf-card"><div class="conf-head"><span class="mono" style="color:#FBBF24">POSSIBLE DUPLICATE · ' + esc(d.id) + '</span>'
      + '<span class="badge b-flag">' + d.similarity + '% SIMILAR</span></div>'
      + '<div class="conf-vs">' + sides + '</div>'
      + '<p class="dim" style="font-size:12px">Both records are kept. Nothing is deleted automatically.</p></div>';
  }).join('') : '<div class="empty-state"><p>No possible duplicates detected.</p></div>';

  var missSection = a.missing.length ? a.missing.map(function (m) {
    return '<div class="panel miss-card"><div class="conf-head"><span class="mono" style="color:#FBBF24">MISSING · ' + esc(m.id) + '</span>'
      + '<span class="badge b-flag">OPEN</span></div>'
      + '<h3 style="margin:6px 0">' + esc(m.label) + '</h3>'
      + '<dl class="tr-kv"><dt>FIELD</dt><dd class="mono">' + esc(m.field) + '</dd><dt>EVIDENCE</dt><dd>' + evChip(m.evidenceId) + '</dd></dl>'
      + '<p style="font-size:13px;color:#D1D5DB"><span class="dim">WHY — </span>' + esc(m.why) + '</p></div>';
  }).join('') : '<div class="empty-state"><p>No missing information detected.</p></div>';

  var unreadSection = a.unreadableFlags.length ? a.unreadableFlags.map(function (u) {
    return '<div class="panel conf-card"><div class="conf-head"><span class="mono" style="color:#94A0B4">UNREADABLE · ' + esc(u.id) + '</span>'
      + '<span class="badge b-incomplete">NO EVIDENCE</span></div>'
      + '<h3 style="margin:6px 0">' + esc(u.label) + '</h3>'
      + '<p style="font-size:13px;color:#D1D5DB">' + esc(u.reason) + '</p>'
      + '<p class="dim" style="font-size:12px">This upload is kept in the case but contributes no evidence.</p></div>';
  }).join('') : '<div class="empty-state"><p>No unreadable uploads.</p></div>';

  return '<div class="page-head"><h1>FLAGS</h1><p class="dim">Everything below is derived from your uploaded images. TRACE flags inconsistencies for review — it never decides guilt.</p></div>'
    + '<div class="tr-sec" style="color:#F87171">CONTRADICTIONS · ' + a.contradictions.length + '</div>' + confSection
    + '<div class="tr-sec" style="color:#FBBF24;margin-top:22px">POSSIBLE DUPLICATES · ' + a.duplicates.length + '</div>' + dupSection
    + '<div class="tr-sec" style="color:#FBBF24;margin-top:22px">MISSING DATA · ' + a.missing.length + '</div>' + missSection
    + '<div class="tr-sec" style="color:#94A0B4;margin-top:22px">UNREADABLE · ' + a.unreadableFlags.length + '</div>' + unreadSection;
}

/* ============================== VIEW: REPORT ============================== */

function vReport() {
  if (!S.records.length) {
    return '<div class="page-head"><h1>REPORT</h1></div><div class="empty-state"><h3>NO REPORT</h3><p>Generate a report after uploading evidence.</p>'
      + '<button type="button" class="btn btn-primary" data-action="go" data-href="#/upload">+ Upload Evidence</button></div>';
  }
  var a = S.analysis, m = a.metrics;
  function sec(title, inner, tag) {
    return '<section class="rep-sec"><h2>' + title + ' ' + (tag || '<span class="obs-label">OBSERVED</span>') + '</h2>' + inner + '</section>';
  }
  var caseInfo = '<dl class="tr-kv">'
    + '<dt>CASE ID</dt><dd class="mono">' + esc(S.caseId) + '</dd>'
    + '<dt>GENERATED</dt><dd class="mono">' + esc(fmtDateTime(S.createdAt)) + '</dd>'
    + '<dt>SOURCES</dt><dd>' + S.files.length + ' upload' + (S.files.length === 1 ? '' : 's') + '</dd>'
    + '<dt>STATUS</dt><dd>UNDER REVIEW</dd>'
    + '<dt>PRIVACY</dt><dd>🔒 Sensitive identifiers masked</dd></dl>';

  var metrics = '<div class="rep-metrics">'
    + [['Evidence', m.evidence], ['Transactions', m.txnCount], ['Total amount', fmtINR(m.totalAmount)],
       ['Flagged', m.flagged], ['Missing', m.missing], ['Contradictions', m.conflicts],
       ['Duplicates', m.duplicates], ['Unreadable', m.unreadable],
       ['Contacts', m.contacts], ['Time span', m.timeSpan]]
      .map(function (x) { return '<div class="rep-metric"><div class="rm-v">' + esc(String(x[1])) + '</div><div class="rm-l">' + x[0] + '</div></div>'; }).join('')
    + '</div>';

  var tl = a.events.map(function (r) {
    return '<div class="rep-tl-row"><span class="mono">' + esc(recDate(r) || '—') + ' ' + esc(recTime(r)) + '</span> <span class="mono" style="color:#22D3EE">' + esc(r.id) + '</span> ' + esc(scrub(r.label));
  }).join('') || '<p class="dim">No timeline events.</p>';

  var txnRows = S.records.filter(function (r) { return r.amount != null; }).map(function (r) {
    return '<tr><td class="mono">' + esc(r.id) + '</td><td><strong>' + esc(fmtINR(r.amount)) + '</strong></td>'
      + '<td>' + esc(scrub(r.sender || '—')) + '</td>'
      + '<td class="mono">' + esc(r.transactionId ? R(r.transactionId, 'txnIds') : '—') + '</td>'
      + '<td class="mono">' + esc(recDate(r) || '—') + ' ' + esc(recTime(r)) + '</td>'
      + '<td>' + esc((r.status || '').toUpperCase()) + '</td></tr>';
  }).join('');
  var txnTable = txnRows
    ? '<div class="table-wrap"><table class="data-table"><thead><tr><th>ID</th><th>AMOUNT</th><th>SENDER</th><th>TXN ID</th><th>TIME</th><th>STATUS</th></tr></thead><tbody>' + txnRows + '</tbody></table></div>'
    : '<p class="dim">No transaction records.</p>';

  var inv = S.records.map(function (r) {
    return '<tr><td class="mono">' + esc(r.id) + '</td><td>' + esc(scrub(r.fileName || '—')) + '</td><td>' + esc(r.typeLabel) + '</td>'
      + '<td class="mono">' + esc(recDate(r) || '—') + '</td><td class="mono">' + esc(recTime(r)) + '</td>'
      + '<td>' + esc((r.status || '').toUpperCase()) + '</td></tr>';
  }).join('');
  var invTable = '<div class="table-wrap"><table class="data-table"><thead><tr><th>ID</th><th>SOURCE</th><th>TYPE</th><th>DATE</th><th>TIME</th><th>STATUS</th></tr></thead><tbody>' + inv + '</tbody></table></div>';

  var miss = a.missing.map(function (x) { return '<div class="rep-item"><span class="mono" style="color:#FBBF24">' + esc(x.id) + '</span> — ' + esc(x.label) + ' <span class="dim">(field: <span class="mono">' + esc(x.field) + '</span>, ' + esc(x.evidenceId) + ')</span></div>'; }).join('') || '<p class="dim">None open.</p>';
  var confs = a.contradictions.map(function (c) { return '<div class="rep-item"><span class="mono" style="color:#F87171">' + esc(c.id) + '</span> ' + esc(c.title) + '<br><span class="mono">' + esc(c.evidenceA) + '</span> (' + esc(c.valueA) + ') vs <span class="mono">' + esc(c.evidenceB) + '</span> (' + esc(c.valueB) + ') — <strong>NEEDS REVIEW</strong></div>'; }).join('') || '<p class="dim">None detected.</p>';
  var dups = a.duplicates.map(function (d) { return '<div class="rep-item"><span class="mono" style="color:#FBBF24">' + esc(d.id) + '</span> — ' + (d.evidenceIds || []).map(esc).join(' · ') + ' <span class="dim">(' + d.similarity + '% similar)</span></div>'; }).join('') || '<p class="dim">None detected.</p>';
  var unread = a.unreadableFlags.map(function (u) { return '<div class="rep-item"><span class="mono">' + esc(u.evidenceId) + '</span> — ' + esc(u.label) + ' <span class="dim">' + esc(u.reason) + '</span></div>'; }).join('') || '<p class="dim">None.</p>';
  var priv = '<div class="rep-item">Phone numbers — <strong>' + (S.privacy.phones ? 'MASKED' : 'VISIBLE') + '</strong></div>'
    + '<div class="rep-item">Email addresses — <strong>' + (S.privacy.emails ? 'MASKED' : 'VISIBLE') + '</strong></div>'
    + '<div class="rep-item">Transaction IDs — <strong>' + (S.privacy.txnIds ? 'MASKED' : 'VISIBLE') + '</strong></div>'
    + '<div class="rep-item">URLs — <strong>' + (S.privacy.urls ? 'MASKED' : 'VISIBLE') + '</strong></div>';
  var trace = S.records.map(function (r) { return '<div class="rep-item"><span class="mono" style="color:#22D3EE">' + esc(r.id) + '</span> ← source image <span class="mono">' + esc(scrub(r.fileName || '—')) + '</span> <span class="dim">(' + esc(r.typeLabel) + ', OCR ' + confPct(r.ocrConfidence) + ')</span></div>'; }).join('');

  return '<div class="page-head no-print"><h1>REPORT</h1><p class="dim">Generated from the uploaded evidence. Identifiers are redacted; no conclusions about wrongdoing are drawn.</p>'
    + '<div class="action-row" style="margin-top:12px"><button type="button" class="btn btn-primary" data-action="export-pdf">EXPORT PDF</button>'
    + '<button type="button" class="btn btn-ghost" data-action="export-csv">EXPORT CSV</button></div></div>'
    + '<div id="report-doc" class="panel">'
    + '<div class="rep-header"><div style="display:flex;align-items:center;gap:12px">' + logoSVG() + '<span class="rep-brand">TRACE</span></div>'
    + '<h1>DIGITAL EVIDENCE REPORT</h1><div class="dim">Case <span class="mono">' + esc(S.caseId) + '</span> · ' + esc(fmtDateTime(S.createdAt)) + '</div></div>'
    + sec('CASE INFORMATION', caseInfo)
    + sec('INCIDENT SUMMARY', '<p>' + esc(SV.ai.summarize({ metrics: m, duplicateGroups: m.duplicates })) + '</p>', '<span class="inf-label">DERIVED</span>')
    + sec('SUMMARY', metrics)
    + sec('EVIDENCE INVENTORY', invTable)
    + sec('CHRONOLOGICAL TIMELINE', tl)
    + sec('TRANSACTIONS', txnTable)
    + sec('MISSING INFORMATION', miss)
    + sec('POTENTIAL CONTRADICTIONS', confs)
    + sec('POSSIBLE DUPLICATES', dups)
    + sec('UNREADABLE UPLOADS', unread)
    + sec('PRIVACY / REDACTION', priv)
    + sec('SOURCE REFERENCES', trace)
    + '<p class="dim rep-foot">TRACE organizes evidence and flags potential inconsistencies for human investigators. It does not declare fraud, assign guilt, or replace investigator judgment.</p>'
    + '</div>';
}

/* ============================== DRAWER ============================== */

var _lastFocus = null;

function closeDrawer() {
  S.drawerId = null;
  var r = document.getElementById('drawer-root');
  if (r) r.innerHTML = '';
  document.removeEventListener('keydown', drawerKey);
  if (_lastFocus && _lastFocus.focus) { try { _lastFocus.focus(); } catch (e) {} }
  _lastFocus = null;
}
function drawerKey(e) { if (e.key === 'Escape') closeDrawer(); }

function openDrawer(id) {
  var rec = S.records.filter(function (r) { return r.id === id; })[0] || S.unreadable.filter(function (r) { return r.id === id; })[0];
  if (!rec) { toast('Record not found.', 'warn'); return; }
  _lastFocus = document.activeElement;
  S.drawerId = id;
  var root = document.getElementById('drawer-root');
  var notes = S.notes[id] || [];
  var img = rec.thumb ? '<img class="drawer-img" src="' + rec.thumb + '" alt="Source screenshot ' + esc(rec.fileName || '') + '">' : '';

  var rows = [];
  rows.push(['EVIDENCE', rec.id + ' · #' + String(rec.sourceImageIndex).padStart(2, '0')]);
  rows.push(['SOURCE IMAGE', rec.fileName || '—']);
  rows.push(['TYPE', rec.typeLabel]);
  rows.push(['DATE', rec.dateText || '—']);
  rows.push(['TIME', rec.timeText || (rec.timestamp ? String(rec.timestamp).slice(11, 16) : '—')]);
  if (rec.amount != null) rows.push(['AMOUNT', fmtINR(rec.amount) + (rec.direction ? ' (' + rec.direction + ')' : '')]);
  if (rec.sender) rows.push(['SENDER', scrub(rec.sender)]);
  if (rec.recipient) rows.push(['RECEIVER', scrub(rec.recipient)]);
  if (rec.phone) rows.push(['PHONE', R(rec.phone, 'phones')]);
  if (rec.email) rows.push(['EMAIL', R(rec.email, 'emails')]);
  if (rec.upi) rows.push(['UPI', R(rec.upi, 'upi')]);
  if (rec.transactionId) rows.push(['TXN ID', R(rec.transactionId, 'txnIds')]);
  if (rec.paymentMethod) rows.push(['METHOD', rec.paymentMethod]);
  if (rec.account) rows.push(['ACCOUNT', R(rec.account, 'accounts')]);
  if (rec.url) rows.push(['URL', R(rec.url, 'urls')]);
  rows.push(['CONFIDENCE', confPct(rec.confidence) + (rec.ocrConfidence != null ? ' (OCR ' + confPct(rec.ocrConfidence) + ')' : '')]);

  var kv = '<dl class="tr-kv">' + rows.map(function (r) { return '<dt>' + esc(r[0]) + '</dt><dd>' + (r[0].match(/ID|PHONE|EMAIL|UPI|ACCOUNT|URL|TXN/)? '<span class="mono">' + esc(r[1]) + '</span>' : esc(r[1])) + '</dd>'; }).join('') + '</dl>';

  var flags = '';
  if ((rec.missingFields || []).length) flags += '<div><div class="tr-sec" style="color:#FBBF24">MISSING INFORMATION</div>' + rec.missingFields.map(function (f) { return '<span class="ent-chip">◌ ' + esc(f) + '</span>'; }).join('') + '</div>';
  var conflicts = (rec.conflictIds || []).length ? '<div><div class="tr-sec" style="color:#F87171">POTENTIAL CONTRADICTION</div><div style="font-size:13px">' + (rec.conflictIds || []).map(function (c) { return '<span class="mono">' + esc(c) + '</span>'; }).join(', ') + ' — <a href="#/flags" style="color:#22D3EE">review →</a></div></div>' : '';
  var dup = rec.duplicateGroup ? '<div><div class="tr-sec" style="color:#FBBF24">POSSIBLE DUPLICATE</div><div style="font-size:13px">Grouped in <span class="mono">' + esc(rec.duplicateGroup) + '</span>. <a href="#/flags" style="color:#22D3EE">review →</a></div></div>' : '';
  var noEvidence = (!rec.ok) ? '<div><div class="tr-sec" style="color:#94A0B4">NO RELEVANT EVIDENCE</div><p style="font-size:13px">' + esc(rec.reason) + '</p></div>' : '';

  var html = ''
    + '<div class="tr-drawer-overlay" data-action="close-drawer" aria-hidden="true"></div>'
    + '<aside class="tr-drawer" role="dialog" aria-modal="true" aria-label="Evidence ' + esc(rec.id) + '">'
    + '<div class="tr-drawer-head"><div style="flex:1;min-width:0">'
    + '<div class="tr-sec">' + esc(rec.typeLabel) + '</div>'
    + '<div class="mono" style="color:#22D3EE;font-size:14px">' + esc(rec.id) + '</div>'
    + '<div style="margin-top:4px">' + statusBadge(rec) + '</div></div>'
    + '<button type="button" class="btn btn-ghost btn-sm" data-action="close-drawer" aria-label="Close">✕</button></div>'
    + '<div class="tr-drawer-body">'
    + (img ? '<div><div class="tr-sec">SOURCE IMAGE</div>' + img + '</div>' : '')
    + noEvidence
    + '<div><div class="tr-sec">EXTRACTED FIELDS</div>' + kv + '</div>'
    + (rec.message ? '<div><div class="tr-sec">MESSAGE</div><p style="font-size:13px;color:#D1D5DB">' + esc(scrub(rec.message)) + '</p></div>' : '')
    + flags + conflicts + dup
    + '<div><div class="tr-sec">EXTRACTED TEXT (REDACTED)</div><pre class="ocr-text">' + esc(scrub(rec.ocrText || '')) + '</pre></div>'
    + '<div><div class="tr-sec">INVESTIGATOR NOTES</div>'
    + (notes.length ? notes.map(function (n) { return '<div class="note-item">' + esc(scrub(n.text)) + '<div class="dim" style="font-size:11px;margin-top:4px">' + esc(n.ts) + '</div></div>'; }).join('') : '<div class="dim" style="font-size:13px">No notes yet.</div>')
    + '<form data-form="drawer-note" data-id="' + esc(rec.id) + '" style="display:flex;gap:8px;margin-top:8px">'
    + '<input class="field" name="note" placeholder="Add a note…" maxlength="500" aria-label="Add note">'
    + '<button type="submit" class="btn btn-ghost btn-sm">ADD</button></form></div>'
    + '</div>'
    + '<div class="tr-drawer-foot">'
    + (rec.thumb ? '<button type="button" class="btn btn-ghost btn-sm" data-action="view-source" data-id="' + esc(rec.id) + '">VIEW SOURCE</button>' : '')
    + '<button type="button" class="btn btn-ghost btn-sm" data-action="mark-reviewed" data-id="' + esc(rec.id) + '">' + (S.reviewed[rec.id] ? 'REVIEWED ✓' : 'MARK REVIEWED') + '</button>'
    + '<button type="button" class="btn btn-primary btn-sm" data-action="close-drawer">CLOSE</button>'
    + '</div></aside>';

  root.innerHTML = html;
  var panel = root.querySelector('.tr-drawer');
  if (panel) { panel.setAttribute('tabindex', '-1'); try { panel.focus({ preventScroll: true }); } catch (e) {} }
  document.addEventListener('keydown', drawerKey);
}

/* ============================== EXPORTS ============================== */

function csvCell(v) {
  var s = String(v == null ? '' : v);
  return '"' + s.replace(/"/g, '""') + '"';
}
function exportCSV() {
  var all = S.records.concat(S.unreadable);
  if (!all.length) { toast('No evidence to export yet.', 'warn'); return; }
  var rows = SV.report.rows(all, S.privacy);
  var lines = rows.map(function (r) { return r.map(csvCell).join(','); });
  var blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'trace-' + S.caseId + '-evidence.csv';
  document.body.appendChild(a);
  a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  toast('CSV exported from ' + all.length + ' record' + (all.length === 1 ? '' : 's') + '.', 'ok');
}
function exportPDF() {
  if (!S.records.length) { toast('Upload evidence first.', 'warn'); return; }
  if (currentRoute() !== '/report') { location.hash = '#/report'; setTimeout(function () { window.print(); }, 350); return; }
  toast('Opening print view — choose "Save as PDF".');
  window.print();
}

/* ============================== EVENT DELEGATION ============================== */

var ACTIONS = {
  'go': function (el) { location.hash = el.dataset.href || '#/overview'; },
  'toggle-redact': function () {
    var on = !S.privacy.phones;
    Object.keys(S.privacy).forEach(function (k) { S.privacy[k] = on; });
    toast(on ? 'Sensitive data masked.' : 'Sensitive data revealed.', on ? 'ok' : 'warn');
    render();
  },
  'toggle-paste': function () { var f = document.getElementById('paste-form'); if (f) f.hidden = !f.hidden; },
  'remove-file': function (el) {
    var i = parseInt(el.dataset.i, 10);
    var f = S.files[i];
    if (!f) return;
    if (f.thumb) { try { URL.revokeObjectURL(f.thumb); } catch (e) {} }
    S.files.splice(i, 1);
    render();
  },
  'process': function () {
    S.files.forEach(function (f) { if (f.status === 'error') f.status = 'pending'; }); /* retry failures */
    if (!queueCount()) { toast('Nothing to process.', 'warn'); return; }
    S.proc.step = -1; S.proc.result = null; S.proc.error = null;
    location.hash = '#/processing';
    if (currentRoute() === '/processing') render();
  },
  'open-drawer': function (el) { openDrawer(el.dataset.id); },
  'close-drawer': function () { closeDrawer(); },
  'view-source': function (el) {
    var rec = S.records.concat(S.unreadable).filter(function (r) { return r.id === el.dataset.id; })[0];
    if (rec && rec.thumb) window.open(rec.thumb, '_blank', 'noopener');
    else toast('No source image on this record (text input).', 'warn');
  },
  'mark-reviewed': function (el) { S.reviewed[el.dataset.id] = true; toast(el.dataset.id + ' marked reviewed.', 'ok'); if (S.drawerId) openDrawer(S.drawerId); },
  'filter': function (el) { S.filter = el.dataset.f; render(); },
  'tl-expand': function (el) {
    var open = el.classList.contains('open');
    $all('.tl-event.open').forEach(function (b) { b.classList.remove('open'); });
    if (!open) el.classList.add('open');
  },
  'export-csv': function () { exportCSV(); },
  'export-pdf': function () { exportPDF(); }
};

var FORMS = {
  'paste': function (f) { addTextItem(f.text.value); render(); },
  'drawer-note': function (f) {
    var id = f.dataset.id, text = (f.note.value || '').trim();
    if (!text) { toast('Write a note first.', 'warn'); return; }
    (S.notes[id] = S.notes[id] || []).push({ text: text, ts: fmtDateTime(nowISO()) });
    openDrawer(id);
    toast('Note added.', 'ok');
  }
};

document.addEventListener('click', function (e) {
  var el = e.target.closest ? e.target.closest('[data-action]') : null;
  if (!el) return;
  var fn = ACTIONS[el.dataset.action];
  if (fn) fn(el, e);
});
document.addEventListener('submit', function (e) {
  var f = e.target.closest ? e.target.closest('form[data-form]') : null;
  if (!f) return;
  e.preventDefault();
  var fn = FORMS[f.dataset.form];
  if (fn) fn(f);
});
document.addEventListener('input', function (e) {
  if (e.target && e.target.id === 'ev-q') { S.q = e.target.value; renderEvGrid(); }
});
document.addEventListener('keydown', function (e) {
  if ((e.key === 'Enter' || e.key === ' ') && e.target && e.target.matches && e.target.matches('.tl-event[data-action]')) {
    e.preventDefault();
    ACTIONS['tl-expand'](e.target, e);
  }
});

/* ============================== INIT ============================== */

document.addEventListener('DOMContentLoaded', function () {
  if (!document.getElementById('app')) { var d = document.createElement('div'); d.id = 'app'; document.body.appendChild(d); }
  if (!document.getElementById('drawer-root')) { var r = document.createElement('div'); r.id = 'drawer-root'; document.body.appendChild(r); }
  window.__TRACE_BOOT__ = true;
  render();
});

})();
