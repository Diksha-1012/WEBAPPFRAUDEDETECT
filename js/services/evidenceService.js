/* TRACE service — Evidence pipeline orchestrator.
   IMAGE -> OCR -> CLEAN -> CLASSIFY -> EXTRACT -> (delegated) NORMALIZE/ANALYZE.
   Deterministic and local. Swap the OCR provider in ocrService.js and this whole
   pipeline can run against a cloud OCR / AI model without UI changes. */
window.TRACE_SERVICES = window.TRACE_SERVICES || {};
(function () {
  'use strict';

  /* A "work item" is { name, file?, text?, thumb? }. Normalises pasted text too. */
  function processFiles(items, opts) {
    opts = opts || {};
    var list = items || [];
    var records = [];
    var unreadable = [];

    function step(i) {
      if (i >= list.length) return Promise.resolve();
      var item = list[i];
      if (opts.onItem) opts.onItem(item, 'reading', 0);

      var ocrPromise;
      if (item.text != null) {
        /* pasted text: no OCR needed */
        if (opts.onPhase) opts.onPhase('Extracting text', item);
        ocrPromise = Promise.resolve({ text: item.text, confidence: null, provider: 'pasted-text' });
      } else {
        if (opts.onPhase) opts.onPhase('Extracting text', item);
        ocrPromise = window.TRACE_SERVICES.ocr.run(item.file, function (p) {
          if (opts.onItem) opts.onItem(item, 'processing', p && p.progress || 0, p && p.status);
        });
      }

      return ocrPromise.then(function (ocr) {
        if (opts.onPhase) opts.onPhase('Identifying evidence', item);
        var rec = window.TRACE_SERVICES.parser.parse(ocr.text, {
          caseId: opts.caseId,
          fileName: item.name,
          index: i + 1,
          thumb: item.thumb || null,
          ocrConfidence: ocr.confidence
        });
        rec.ocrProvider = ocr.provider || 'unknown';
        if (rec.ok) { records.push(rec); if (opts.onItem) opts.onItem(item, 'done', 1); }
        else { unreadable.push(rec); if (opts.onItem) opts.onItem(item, 'no-evidence', 1); }
        item.recordId = rec.id;
        step._index = i;
        return step(i + 1);
      }).catch(function (err) {
        item.error = (err && err.message) || 'OCR failed.';
        if (opts.onItem) opts.onItem(item, 'error', 0, item.error);
        return step(i + 1);
      });
    }

    return step(0).then(function () {
      if (opts.onPhase) opts.onPhase('Building timeline', null);
      var analysis = window.TRACE_SERVICES.analyzer.analyze(records, unreadable);
      if (opts.onPhase) opts.onPhase('Checking inconsistencies', null);
      if (opts.onPhase) opts.onPhase('Redacting sensitive data', null);
      return { records: records, unreadable: unreadable, analysis: analysis };
    });
  }

  window.TRACE_SERVICES.evidence = {
    processFiles: processFiles,
    EvidenceProcessor: { processFiles: processFiles },
    MockEvidenceProcessor: { processFiles: processFiles } /* alias kept for the seam */
  };
})();
