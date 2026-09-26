# TRACE — Digital Evidence Intelligence

> "From scattered evidence to one traceable incident."

TRACE turns screenshots of an incident — chats, bank/UPI transactions, payment
requests, suspicious URLs, emails, call logs — into one chronological, privacy-conscious
case file. Text is read from your images **in the browser** using real OCR, then parsed,
normalised, cross-checked and reported.

**There is no demo dataset.** The workspace starts empty. TRACE only ever shows what it
actually extracted from the images you upload. If an image contains no relevant evidence
(a photo, a landscape, a selfie), it says so instead of inventing anything.

Hackathon prototype — static SPA, no backend, no build step.

## Run it

**Option A — open directly**

Open `index.html` in a modern browser (double-click works; `file://` is supported).

**Option B — local server (recommended)**

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

> The OCR engine (Tesseract.js / WebAssembly) and the web fonts load from a CDN the
> first time, so the demo machine needs a connection for OCR. The uploaded images
> themselves are **never uploaded** — OCR runs entirely on-device. If the OCR engine
> can't load, TRACE reports "OCR FAILED" and lets you retry; it never fabricates text.

## How it works

```
IMAGE → validation → OCR (Tesseract.js) → text cleaning → evidence classification
      → structured extraction → normalisation → timeline → missing info
      → contradiction / duplicate detection → redaction → report → CSV / PDF
```

1. **Upload** one or many screenshots (PNG/JPG/WEBP/BMP) on the *Upload* page, or paste text.
2. **Process** — each image runs through the local pipeline with live progress.
3. **Review** — Overview metrics, the Evidence vault, the Timeline, and Flags.
4. **Report** — generated purely from the extracted records; export CSV or print/PDF.

## What gets extracted (only if actually visible)

Date · time · sender · receiver · amount · transaction ID · payment method · UPI ID ·
account · URL · message · event type. Anything absent is left **missing** and flagged —
never invented.

## Detection rules

- **Missing information** — a transaction with no time is kept and flagged `missing: timestamp`; likewise missing amount / transaction ID / sender, etc.
- **Potential contradiction** — two records that appear to describe the same event (matching transaction ID, or a time within 3 minutes, or the same clock time) but report different amounts.
- **Possible duplicate** — identical transaction ID + amount, or near-identical extracted text, or the same amount + time. Both records are always preserved; nothing is auto-deleted.
- **Unreadable** — OCR produced no usable text (or the image clearly contains no incident information). Such uploads are shown as "NO EVIDENCE" and contribute nothing.

TRACE never says "fraud", "guilty" or "scammer". It reports *potential contradiction* /
*needs review* / *inconsistent information*, and the decision stays with the investigator.

## Privacy / redaction

Phone numbers (`98••••••10`), emails (`e••••@gmail.com`), transaction IDs
(`TXN••••8291`), UPI handles, account numbers and URLs (domain only) are **masked by
default** in the UI, the timeline, the drawer and both exports. Use the top-bar pill to
reveal/mask. The original OCR text stays local.

## Project layout

```
index.html                     # shell + script order + resilient boot guard
styles.css                     # design system (tokens, components, responsive, print)
js/app.js                      # the SPA: router, state, 5 views, upload/processing, drawer, exports
js/services/                   # swappable service layer (loaded before app.js)
  ocrService.js                #   browser OCR provider (Tesseract.js) — OCRProvider seam
  evidenceParser.js            #   clean → classify → extract structured fields (EvidenceParser)
  evidenceAnalyzer.js          #   timeline + missing/contradiction/duplicate + metrics (EvidenceAnalyzer)
  evidenceService.js           #   pipeline orchestrator: processFiles() (EvidenceProcessor)
  redactionService.js          #   masking + free-text scrubbing (RedactionService)
  extractionService.js         #   low-level entity regexes (EvidenceExtractor)
  normalizeService.js          #   source-field → canonical schema mapping (SchemaNormalizer)
  contradictionService.js      #   ContradictionDetector
  duplicateService.js          #   DuplicateDetector
  timelineService.js           #   TimelineBuilder
  reportService.js             #   redacted CSV / report rows (ReportGenerator)
  aiProvider.js                #   provider registry + MockAIProvider (AI-ready seam)
  aiService.js                 #   AI facade used by the UI
```

## Adding a real model later (no UI changes)

- **OCR**: implement `run(image, onProgress)` and register it in `ocrService.js`; or
  register a cloud OCR / Gemini / OpenAI / Claude vision provider and set the active one.
- **Summaries / extraction**: register a provider in `aiProvider.js` implementing
  `summarize(ctx)` (and optionally `extract(text)`), then set `TRACE_SERVICES.aiProvider.current`.
- **Pipeline**: swap `EvidenceProcessor` in `evidenceService.js`.

The UI only talks to `window.TRACE_SERVICES.*`, so nothing above it changes.

## Test it locally

Open the app, then:

| Test | Do this | Expect |
|------|---------|--------|
| 1 | Upload a bank/UPI transaction screenshot | amount, time, transaction ID extracted from *that* image |
| 2 | Upload a chat screenshot | visible message + sender/time extracted |
| 3 | Upload two screenshots of the same payment with different amounts | **Potential contradiction** on Flags |
| 4 | Upload a transaction screenshot with no time | record kept, `missing: timestamp` on Flags |
| 5 | Upload the same screenshot twice | **Possible duplicate** |
| 6 | Upload an animal photo | "NO EVIDENCE" — no fake transaction |
| 7 | Upload a landscape | "NO EVIDENCE" — no fake timeline |
| 8 | Upload several legitimate screenshots | one combined chronological incident |
| 9 | Export CSV | rows only from extracted fields, identifiers redacted |
| 10 | Export PDF | report only from extracted fields |

## Limitations

- OCR quality depends on the screenshot's clarity and font; low-confidence text is flagged rather than guessed.
- Tesseract.js must load (CDN) for image OCR; the "paste text" path works offline.
- Amount/date parsing covers common Indian bank/UPI/chat formats; unusual layouts may parse partially (surfaced as missing fields).
- PDF export uses the browser's print-to-PDF (no bundled PDF library).
- Everything is in-memory for the session; nothing is persisted or transmitted.
