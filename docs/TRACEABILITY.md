# TRACEABILITY — Feature registry (Section 7), final state

**Status vocabulary.** This environment had file tools and `vite build` only – no shell, git, CI, browser, Lighthouse, axe or deploy.
Blueprint rule 3 defines DONE as "has a *passing* test". No test has been *executed*, so **no feature is marked DONE.**

- `IMPLEMENTED` – module exists, is wired into the UI, type-checks and the production build succeeds. Behaviour not yet proven by an executed test.
- `LIMITED` – implemented, with a disclosed gap (ID → `KNOWN_LIMITATIONS.md`).
- Test column: `written` = file exists but has **never been run**; `runtime` = the app itself re-checks the result at use time with `src/lib/pdf/verify.ts` (pdf.js, a second parser); `none` = no automated test.

All paths are under `src/` unless noted. Tests: `src/tests/*.test.ts` (vitest, written), `tests/e2e/smoke.spec.ts` (Playwright, written, Playwright not installed).

| ID | Feature | Stage | Module(s) | Test / verification | Status |
| --- | --- | --- | --- | --- | --- |
| F01 | Drag-drop / picker upload with validation | 2 | `lib/pdf/load.ts` (magic bytes, size warn/limit, typed errors), `lib/pdf/openFile.ts`, `components/UploadZone.tsx` | e2e `not-a-PDF and corrupt files show typed errors` (written) | IMPLEMENTED |
| F02 | Password-protected PDF open | 2 | `lib/pdf/load.ts` (`PasswordRequired`/`WrongPassword`), `lib/pdf/session.ts` (`openBytes`), `components/ui.tsx` (`PasswordDialog`) | e2e `encrypted file prompts…` (written); `pipeline.test.ts › protect / unlock` (written) | IMPLEMENTED |
| F03 | Virtualized viewer, zoom, fit, nav, thumbnails, view rotation | 2 | `components/viewer/{Viewer,PageView}.tsx`, `components/sidebar/Thumbnails.tsx`, `lib/pdf/render.ts` | none (300-page smoothness/memory unmeasured – KL-PERF-UNVERIFIED) | IMPLEMENTED |
| F04 | Undo/redo for all edits | 3 | `lib/model/commands.ts`, `lib/model/docState.ts` | `commands.test.ts` (written) | IMPLEMENTED |
| F05 | Download with custom filename | 3 | `lib/pdf/export.ts`, `lib/pdf/session.ts`, `components/dialogs/ExportDialog.tsx`, `lib/pdf/range.ts` (`sanitizeFilename`) | `pipeline.test.ts › export pipeline` (written); runtime re-parse on every download | IMPLEMENTED |
| F06 | Text box | 4 | `components/viewer/ObjectLayer.tsx`, `lib/model/objects.ts`, `lib/pdf/export.ts` | `pipeline.test.ts › draws every object type` (written) | IMPLEMENTED |
| F07 | Highlight / underline / strikethrough | 4 | same | same | LIMITED (KL-ANN: flattened, not `/Annot`) |
| F08 | Freehand draw | 4 | same | same | IMPLEMENTED |
| F09 | Shapes (rect, ellipse, line, arrow) | 4 | same | same | IMPLEMENTED |
| F10 | Insert image | 4 | `components/toolbar/Toolbar.tsx`, `lib/pdf/images.ts`, `export.ts` | none | IMPLEMENTED |
| F11 | Sticky note | 4 | `ObjectLayer.tsx`, `export.ts` (`/Text` annotation + flattened square) | `pipeline.test.ts` (note in "every object type") | IMPLEMENTED |
| F12 | Select/move/resize/rotate/duplicate/delete/z-order, properties panel, shortcuts, eraser | 4 | `ObjectLayer.tsx`, `components/sidebar/PropertiesPanel.tsx`, `pages/Editor.tsx` | `commands.test.ts` (z-order, duplicate) (written); pointer interactions untested | IMPLEMENTED |
| F13 | Edit existing text (cover-and-replace) | 5 | `components/viewer/TextEditLayer.tsx`, `lib/pdf/render.ts` (`extractTextRuns`, `sampleRunColors`), `lib/fonts/fontMap.ts`, `export.ts` | `fontMap.test.ts` (written) | LIMITED (KL-EDIT, KL-FONT) |
| F14 | Whiteout | 5 | `ObjectLayer.tsx`, `export.ts` | `pipeline.test.ts` (whiteout drawn) | IMPLEMENTED |
| F15 | True redaction | 5 | `lib/pdf/session.ts` (`prepareExport` raster + keep-runs), `lib/pdf/export.ts` (`applyRedaction`), `lib/pdf/gc.ts`, `lib/pdf/verify.ts` | runtime proof (re-extract text, blocks download on failure); `pipeline.test.ts › garbage collection`; **no automated redaction test** (needs canvas) | LIMITED (KL-REDACT, KL-REDACT-2) |
| F16 | Reorder / delete / duplicate / rotate pages | 6 | `components/sidebar/Thumbnails.tsx`, `commands.ts`, `export.ts` | `commands.test.ts`, `pipeline.test.ts` (order via page widths) (written) | IMPLEMENTED |
| F17 | Insert blank page / pages from another PDF | 6 | `Thumbnails.tsx`, `commands.ts`, `export.ts` | `pipeline.test.ts › inserts pages from another PDF` (written) | IMPLEMENTED |
| F18 | Merge | 6 | `lib/pdf/merge.ts`, `components/tools/ToolPanels.tsx` | `pipeline.test.ts › merge / split` (written) | LIMITED (KL-FORM/KL-NOLINK: forms & outlines of inputs not carried over) |
| F19 | Split (range / every N / selection) | 6 | `lib/pdf/split.ts`, `lib/pdf/range.ts`, `ToolPanels.tsx` | `range.test.ts`, `pipeline.test.ts` (written) | IMPLEMENTED |
| F20 | Crop / resize pages | 6 | `lib/pdf/pageTools.ts` | `pipeline.test.ts › page tools` (crop with rotation) (written); resize untested | IMPLEMENTED |
| F21 | Page numbers, header/footer, Bates | 6 | `pageTools.ts` (`stampPages`) | `pipeline.test.ts › page tools` (written) | IMPLEMENTED |
| F22 | Watermark (text/image, opacity, rotation, tiling) | 6 | `pageTools.ts` (`addWatermark`) | `pipeline.test.ts › page tools` (text+tile) (written) | IMPLEMENTED |
| F23 | Fill existing form fields | 7 | `lib/pdf/forms.ts`, `components/sidebar/FormsPanel.tsx` | `pipeline.test.ts › adds real form fields` (fill → re-read) (written) | LIMITED (KL-FORM: side panel, not inline) |
| F24 | Add form fields (text, checkbox, radio, dropdown, date) | 7 | `export.ts`, `ObjectLayer.tsx`, `PropertiesPanel.tsx` | `pipeline.test.ts` (written) | LIMITED (KL-FORM: date = text field) |
| F25 | Flatten forms | 7 | `forms.ts` | `pipeline.test.ts` (flatten → 0 fields) (written) | IMPLEMENTED |
| F26 | Visual signature (draw/type/upload) | 7 | `components/dialogs/SignatureDialog.tsx`, `lib/pdf/images.ts` | none | IMPLEMENTED (visual by design; disclosed in dialog, properties panel, export dialog, terms) |
| F27 | PDF to image (DPI, zip) | 8 | `ToolPanels.tsx` (`ToImagePanel`), `lib/pdf/render.ts` | none | IMPLEMENTED |
| F28 | Image to PDF (size, margin, orientation) | 8 | `lib/pdf/imagesToPdf.ts`, `ToolPanels.tsx` | `pipeline.test.ts › image → PDF` (PNG path) (written) | IMPLEMENTED |
| F29 | PDF to text | 8 | `ToolPanels.tsx` (`ToTextPanel`), `render.ts` (`extractPlainText`) | none | IMPLEMENTED |
| F30 | Compress with presets, before/after size | 8 | `lib/pdf/compress.ts`, `ToolPanels.tsx` | none (needs OffscreenCanvas); size delta shown in UI | LIMITED (KL-COMPRESS: JPEG only) |
| F31 | Protect (password / permissions) | 8 | `lib/pdf/protect.ts`, `ToolPanels.tsx` | `pipeline.test.ts › protect / unlock` (written); runtime re-parse (prompts + opens with password) | LIMITED (KL-PROTECT) |
| F32 | Unlock (known password) | 8 | `protect.ts`, `ToolPanels.tsx` | `pipeline.test.ts` (written); runtime re-parse | IMPLEMENTED |
| F33 | Metadata editor | 8 | `pageTools.ts` (`setMetadata`), `ToolPanels.tsx` | `pipeline.test.ts › page tools` (title/author/clear) (written) | IMPLEMENTED |
| F34 | OCR to searchable PDF (progress, cancel, on-demand languages) | 8 | `lib/pdf/imagesToPdf.ts` (`addTextLayer`), `ToolPanels.tsx` (`OcrPanel`, tesseract.js) | runtime: re-extracts text from output and reports count; no automated test | LIMITED (KL-OCR, KL-CDN) |
| F35 | Tool chaining without re-upload | 9 | `lib/pdf/session.ts` (`commitBytes` → `replaceBase`), `ToolPage.tsx` ("Run again", "Chain another tool", "Continue in editor") | none | IMPLEMENTED |
| F36 | Autosave / recovery / clear data | 9 | `lib/pdf/persist.ts`, `pages/Home.tsx`, `pages/Editor.tsx`, `Toolbar.tsx` | e2e `Clear my data wipes IndexedDB` (written) | LIMITED (KL-HISTORY) |
| F37 | Responsive + touch | 9 | Tailwind breakpoints, drawer sidebars, Pointer Events (`touch-action`) | none; no device testing (KL-ENV-5) | IMPLEMENTED |
| F38 | Dark mode | 9 | `lib/theme.ts`, `index.css`, `index.html` (no-flash script) | none | IMPLEMENTED |
| F39 | Per-tool SEO landing pages | 9 | `lib/tools.ts` (unique copy/FAQ ×18), `pages/ToolPage.tsx`, `lib/seo.ts` (title, description, canonical, FAQ/WebApplication/Breadcrumb JSON-LD), `public/sitemap.xml`, `public/robots.txt` | none | LIMITED (KL-SEO, KL-OPS) |
| F40 | Privacy / terms / about / contact pages | 9 | `pages/StaticPages.tsx`, `lib/config.ts` | none | LIMITED (KL-OPS: contact address is a placeholder) |
| F41 | Find: scope (page / selected / document), next/prev with wrap-around, highlight all, match counter, progress + cancel, Ctrl/Cmd+F | TASKS-02 T3 | `lib/text/find.ts`, `lib/text/searchIndex.ts`, `lib/text/matcher.ts`, `components/dialogs/FindPanel.tsx`, `components/viewer/FindHighlights.tsx` | `matcher.test.ts` (search index block) (written, not run); `tests/e2e/findreplace.spec.ts` (written, not run) | IMPLEMENTED (unverified) |
| F42 | Replace / Replace All (single undoable command, skipped-list summary, shrink/overflow/skip, case-aware, Ctrl/Cmd+H) | TASKS-02 T3 | `lib/text/find.ts` (`planReplace`, `applyReplace`), `lib/text/editObject.ts` (guarded edit pipeline shared with Task 2) | `matcher.test.ts` §3.5 matrix + X→X property (written, not run); `findreplace.spec.ts` (written, not run) | LIMITED (KL-EDIT-2, KL-FR-1, KL-FR-2) |
| F43 | Match options: match case, whole word (Unicode-aware, possessive rule), exact phrase / word order, regex (+ validity + timeout), ignore diacritics | TASKS-02 T3 | `lib/text/matcher.ts`, `lib/text/matchTexts.ts`, `lib/workers/search.worker.ts` | `src/tests/matcher.test.ts` (written, not run) | IMPLEMENTED (unverified) |

## Non-functional registry

| ID | Item | Where | Status |
| --- | --- | --- | --- |
| NF1 | Performance | virtualised viewer, 16 MP canvas cap, worker offload; bundle **2.85 MB / 959 KB gzip** (`scripts/bundle-budget.mjs`) | **NOT MET** (KL-LH, KL-PERF-UNVERIFIED) |
| NF2 | Memory | canvas eviction outside ±1400 px, per-job workers terminated on completion/cancel | unmeasured |
| NF3 | Accessibility | ARIA labels/roles, focus trap in dialogs, skip link, visible focus, reduced motion, keyboard path for core flow | unmeasured (no axe) – KL-A11Y |
| NF4 | Security | `vercel.json` headers (CSP, nosniff, referrer, permissions, frame-ancestors), filename sanitising, `isEvalSupported:false`, PDF JS never run | partly (CSP needs `unsafe-inline`, KL-CSP) |
| NF5 | Privacy | no uploads, no cookies, no analytics, autosave opt-out + clear | implemented; network log not inspected (KL-ENV-1) |
| NF6 | SEO | see F39 | LIMITED |
| NF7 | Browser support | pdf.js legacy build, OffscreenCanvas needed for compress/image→PDF fallback | untested on Firefox/WebKit |
| NF8 | Error handling | typed `PdfError`s, `ErrorBoundary`, cancel on every job, OOM mapping (`friendlyError`) | implemented; untested |
| NF9 | License compliance | `scripts/license-check.mjs` in CI; deps: pdfjs-dist (Apache-2.0), @cantoo/pdf-lib (MIT), jszip (MIT OR GPL-3.0 → MIT elected), tesseract.js (Apache-2.0), zustand (MIT), vitest (MIT) | script written, **not run** |
| NF10 | Observability | console-only | NOT MET (KL-ANALYTICS) |

## TASKS-02 fixes → regression tests (all written, **none executed**)

| Fix | Affects | Regression test(s) | Status |
| --- | --- | --- | --- |
| Pages restored under their refs after `removePage` (root cause D14) | F05, F16, F17 | `export-robustness.test.ts` (every edit type; 60-page tree → 1 page); `pipeline.test.ts` round-trip; `download.spec.ts` | fixed in code, unverified |
| Per-object validation + warnings; invalid redaction aborts | F05, F15 | `export-robustness.test.ts › forced failure`, `› invalid redaction box`; `download.spec.ts › forced failure` | unverified |
| `JobError`, idle timeout, `onmessageerror`, clone failure, zero-length guard | F05 | none automated (needs a worker harness) | unverified |
| Fallback link, Save-as, 60 s revoke, retry-safe dialog | F05 | `download.spec.ts › twice in a row`, `› fallback link` | unverified |
| Glyph-level selection, tight covers, guards 1–3 | F13 | `glyphMap.test.ts` (sweep, negatives, columns, rotations ×4, guards, forced overlap/block); `selection.spec.ts` | unverified; synthetic layouts only |
| Post-edit verification + auto-rollback | F13 | `glyphMap.test.ts › post-edit verification`; `selection.spec.ts` (no rollback on a clean edit) | rollback path not exercised end-to-end |
| Debug overlay / captured-text test id | F13 | `selection.spec.ts` | unverified |
