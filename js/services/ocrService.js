/* TRACE service — OCR.
   Runs entirely in the browser (Tesseract.js / WASM). No image ever leaves the
   device. The provider is swappable: register another implementation and the UI
   keeps calling TRACE_SERVICES.ocr.run(). */
window.TRACE_SERVICES = window.TRACE_SERVICES || {};
(function () {
  'use strict';

  var CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
  var progressCb = null;
  var workerPromise = null;
  var loadPromise = null;

  function ensureEngine() {
    if (window.Tesseract) return Promise.resolve(window.Tesseract);
    if (loadPromise) return loadPromise;
    loadPromise = new Promise(function (resolve, reject) {
      if (typeof document === 'undefined') { reject(new Error('OCR requires a browser.')); return; }
      var s = document.createElement('script');
      s.src = CDN;
      s.async = true;
      s.onload = function () {
        window.Tesseract ? resolve(window.Tesseract) : reject(new Error('OCR engine failed to initialise.'));
      };
      s.onerror = function () {
        loadPromise = null;
        reject(new Error('OCR engine could not be loaded. Check your connection and retry.'));
      };
      document.head.appendChild(s);
    });
    return loadPromise;
  }

  function getWorker() {
    return ensureEngine().then(function (T) {
      if (!workerPromise) {
        workerPromise = T.createWorker('eng', 1, {
          logger: function (m) { if (progressCb) progressCb(m); }
        });
      }
      return workerPromise;
    });
  }

  /* run(fileOrImage, onProgress) -> { text, confidence, provider }  (rejects on failure) */
  function run(image, onProgress) {
    progressCb = function (m) {
      if (!onProgress) return;
      onProgress({ status: (m && m.status) || 'working', progress: (m && typeof m.progress === 'number') ? m.progress : 0 });
    };
    return getWorker()
      .then(function (worker) {
        progressCb({ status: 'recognizing text', progress: 0 });
        return worker.recognize(image);
      })
      .then(function (res) {
        var data = (res && res.data) || {};
        return {
          text: String(data.text || ''),
          confidence: typeof data.confidence === 'number' ? data.confidence : 0,
          provider: 'tesseract'
        };
      })
      .catch(function (err) {
        workerPromise = null; /* allow a clean retry */
        throw err;
      })
      .then(function (out) { progressCb = null; return out; },
            function (err) { progressCb = null; throw err; });
  }

  function dispose() {
    if (workerPromise) {
      try { workerPromise.then(function (w) { return w.terminate(); }); } catch (e) {}
      workerPromise = null;
    }
  }

  window.TRACE_SERVICES.ocr = {
    run: run,
    dispose: dispose,
    provider: 'tesseract',
    available: function () { return !!window.Tesseract; },
    OCRProvider: { run: run } /* adapter seam for a future cloud/LLM OCR provider */
  };
})();
