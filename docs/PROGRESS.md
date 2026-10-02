# PROGRESS

## Honest summary

The blueprint asks for gated stages, each ending with a local CI run, `PROGRESS.md` update, commit and preview deploy.
**None of that could be done here**: the environment offers file tools and `vite build` only (no shell, git, Playwright,
browser, Lighthouse, axe or Vercel). All ten stages were therefore written in a single pass, and the only gate that was
actually run at each point was **"TypeScript compiles"** (the file tool type-checks on every write) plus **`vite build`** at the end
(twice). *Every other gate below is UNVERIFIED.* This is logged as KL-ENV-1…5 rather than hidden.

## Measured numbers (the only ones I have)

| Metric | Value | Source |
| --- | --- | --- |
| `vite build` | succeeds, 110 modules, ~9 s | `build_project` |
| `dist/index.html` | 2,851.80 kB (959.17 kB gzip) | `build_project` output |
| Blueprint budget | initial JS ≤ 200 KB gzip | **exceeded ≈ 4.8×** (single-file build inlines pdf.js, its worker, pdf-lib twice, tesseract loader) |
| Typecheck | clean at every file write (tsconfig strict, noUnusedLocals) | tool feedback |
| Unit/integration tests | **written, never executed** (`src/tests/*.test.ts`, 5 files) | – |
| Lighthouse / axe / S1 / memory / 300-page scroll | **not measured** | – |

## Stage log

| Stage | Built | Gate | Result |
| --- | --- | --- | --- |
| 1 Foundation | Vite+React+TS strict+Tailwind (D1), `vercel.json` headers, `ci.yml`, Dependabot, `.prettierrc`, license-check + bundle-budget scripts, vitest, docs | blank app deployed; CI green; license audit | **Not verified**: no deploy, CI never ran, license script never run. ESLint & Playwright not installed (KL-ENV-4); no analytics (KL-ANALYTICS) |
| 2 Upload & viewer | magic bytes, typed errors, size warn/limit, password dialog, pdf.js worker, lazy per-page rendering with eviction, thumbnails, zoom/fit/jump/view-rotate | 300-page scroll, memory, encrypted prompt | **Not verified** (code complete) |
| 3 Model/commands/export | `DocData`, command stack, `coords.ts`, export skeleton, filename edit, runtime re-parse | round-trip of every fixture opens in a 2nd viewer | Tests written (`coords`, `commands`, `pipeline`), **not run**; only second *parser* (pdf.js) available, not second *viewer* |
| 4 Annotations | all tools, selection/move/resize/rotate/duplicate/z-order/eraser, properties panel, shortcuts | visual regression across 3 viewers | **Not verified**; no visual-regression harness |
| 5 Text edit & redaction | text-run extraction, cover-and-replace with sampled colours, font mapping + missing-glyph path, whiteout, rasterising redaction with GC + re-extraction proof | edited fixtures render elsewhere; redacted text not extractable | **Not verified** on real files |
| 6 Page management | thumbnail reorder/rotate/delete/duplicate/blank/insert/extract, merge, split, crop, resize, numbers/header/footer/Bates, watermark | page counts & order verified programmatically | Tests written (`pipeline.test.ts`), **not run** |
| 7 Forms & signing | field detection/fill/flatten, add 5 field kinds, signature dialog | forms persist in other viewers | Tests written, **not run** |
| 8 Convert/optimise/secure/OCR | PDF→image/text, image→PDF, compress, protect/unlock, metadata, OCR | compressed smaller; protected prompts in Adobe/Chrome; OCR selectable | Runtime re-parse built in; **not run**; only pdf.js used as 2nd reader |
| 9 Polish | chaining, autosave/recovery/clear, responsive layouts, dark mode, tour, i18n (en/es scaffold), 18 landing pages w/ FAQ JSON-LD, sitemap/robots, privacy/terms/about/contact | Lighthouse Perf ≥ 90 / A11y ≥ 95 / SEO ≥ 95 | **Not measured**; Perf will almost certainly fail until code-split |
| 10 Hardening | `ErrorBoundary`, security headers, Section 12 audit (see final report) | S1–S6 verified | **Not met** – see audit |

## TASKS-02 (download fix · precise text selection · find & replace)

Same constraints as before: file tools + `vite build` only. **No Playwright, no browsers, no second viewer, no deploy – so none of the three gates has passed.** What was measured:

| Item | Result |
| --- | --- |
| `vite build` (final) | succeeds, 122 modules, `dist/index.html` 2,895.59 kB (974.32 kB gzip) – still ≈ 4.9× the 200 KB budget (KL-LH) |
| Type-check | clean across `src/` **including all test files** (the file tool type-checks on every write) |
| vitest / Playwright | **not executed.** Written: `export-robustness.test.ts`, `glyphMap.test.ts`, `matcher.test.ts` (unit/integration); `tests/e2e/{download,selection,findreplace}.spec.ts` |
| Incident | `build_project` timed out 4× in a row mid-task. Cause: several parallel `edit_file` calls on one file had silently overwritten each other (missing import / usage / functions), leaving a broken module graph. Fixed by re-applying edits one per file; files touched earlier were re-verified by grep (DECISIONS D18). |

| Task | Built | Gate status |
| --- | --- | --- |
| 1 Download | root cause from source (D14); per-object validation + warnings returned and shown; redaction never skipped silently; typed `JobError` with idle timeout / `onmessageerror` / clone-failure handling; zero-length-result guard; deduplicated transfer list; 60 s URL revoke; always-visible fallback link; Save-as where supported; retry-safe dialog | **Not verified**: E2E for 9 edit types × 3 browsers, 4 viewers, double download, forced-failure test are all written (`download.spec.ts`, `export-robustness.test.ts`) but unrun |
| 2 Selection | glyph map, explicit hit-test, word/line/range/rect/extend/handles, captured-string label + `data-testid`, `?debug=text` overlay, guards 1–3, tight covers, post-edit verify + auto-rollback, dead-glyph exclusion | **Not verified**; only synthetic layouts tested. **Not done:** real glyph removal from content streams, OCR-layer update (KL-EDIT-2); real-PDF fixtures (KL-T2-FIXTURES) |
| 3 Find & Replace | matcher with all options, search index with offset map, hyphen join, ligatures, NFC, column-safe phrases, regex worker + timeout, scoped search with progress/cancel, highlights, counter, Replace / Skip / Replace All as ONE command, shrink/overflow/skip, case-aware, summary + skipped list, Ctrl/Cmd+F/H | **Not verified**; §3.5 matrix is unit-tested (unrun); 300-page and pixel/undo checks are e2e code only |

## What to do next (in order)

1. `npm i && npx tsc --noEmit && npx vitest run && node scripts/license-check.mjs` – fix whatever the unexecuted tests reveal.
2. `node scripts/make-fixtures.mjs`, then open each fixture in the editor, export, and open the result in Chrome, Firefox, Safari/Preview and Adobe Reader.
3. Replace the placeholders listed in KL-OPS.
4. Move off the single-file build (hashed chunks, lazy tesseract/pdf.js) – required for S1/NF1 and to remove CSP `unsafe-inline`.
5. Run Playwright (`tests/e2e`) and Lighthouse/axe against the preview; record numbers here.
