# PageFlex

**Edit, merge, and adapt PDFs instantly.**

A modern PDF editor that respects your time and your data. Drop your files into a secure, frictionless environment to split, convert, and format documents exactly the way you need them.

A free, no-login, browser-only PDF editor. Open a PDF, edit it, download it – nothing is uploaded.
UI: monospace typography throughout and a warm palette taken from Anthropic's Claude (Crail `#C15F3C`, Clay `#D97757`, Pampas `#F4F3EE`, Ivory `#FAF9F5`, Slate `#141413`). Brand name, tagline and description live in `src/lib/config.ts`; the palette and animations in `src/index.css`.
Original code, UI, copy and name. See `docs/` for the blueprint traceability, decisions and known limitations.

> **Status:** feature-complete draft written without the ability to run tests, CI, browsers or deploys.
> Read `docs/PROGRESS.md` and `docs/KNOWN_LIMITATIONS.md` before relying on it.

## Setup

```bash
npm install
npm run dev       # vite dev server
npm run build     # production build -> dist/index.html (single file, vite-plugin-singlefile)
npm run preview
```

Extra checks (run with `npx`/`node`, because `package.json` scripts were not editable in the authoring environment):

```bash
npx tsc --noEmit                      # typecheck (strict)
npx vitest run                        # unit + pipeline integration tests (src/tests)
node scripts/license-check.mjs        # fails on AGPL/GPL-only deps
node scripts/bundle-budget.mjs 200    # initial JS gzip budget (BUDGET_STRICT=1 to fail)
node scripts/make-fixtures.mjs        # synthetic fixture PDFs -> tests/fixtures
# e2e (needs: npm i -D @playwright/test && npx playwright install)
npx playwright test tests/e2e
```

## Architecture

```
UI thread (React, Tailwind, zustand)
 ├─ src/lib/model      docState (store) · commands (do/undo/serialize) · coords (the only coordinate maths) · objects
 ├─ src/components     viewer/ (virtualised pages + SVG object layer) · sidebar/ · toolbar/ · dialogs/ · tools/
 ├─ src/pages          Home · Editor · ToolPage (18 landing pages) · static pages
 ├─ pdf.js worker      render, text extraction, verification (second parser)         src/lib/pdf/render.ts
 └─ edit worker        pdf-lib: export, merge, split, compress, protect, forms, …    src/lib/workers/edit.worker.ts
Tesseract worker       OCR (lazy `import('tesseract.js')`)                           src/components/tools/ToolPanels.tsx
IndexedDB              session recovery only (opt-out, clearable)                    src/lib/pdf/persist.ts
```

Key rules (blueprint §3): **R1** the UI never mutates PDF bytes – only `exportDocument` does · **R2** `coords.ts` is the only coordinate
code (objects live in *page space*; page rotation is one matrix) · **R3** every change is a command · **R4** heavy work runs in a worker with
progress + cancel (`runJob` terminates the worker) · **R5** source bytes are never dropped while the session is open.

Export order is fixed: page ops → redaction → objects → forms → GC → save; encryption is a separate, final step (`protect.ts`).
Every download is re-parsed with pdf.js and compared with what was expected (`verify.ts`); redactions are proven by re-extracting text.

## Contributing

- Keep `src/lib/pdf/*` (except `render.ts`, `session.ts`, `load.ts`, `verify.ts`, `persist.ts`, `images.ts`, `openFile.ts`) free of DOM APIs – they run in the worker.
- New tool → add a `ToolDef` in `src/lib/tools.ts` (unique title/description/FAQ), a panel in `ToolPanels.tsx`, a worker op in `edit.worker.ts`, and a test in `src/tests`.
- Never add a dependency with an AGPL/GPL-only licence (CI enforces). Record each choice in `docs/DECISIONS.md`.
- Don't mark a feature DONE in `docs/TRACEABILITY.md` until its test has actually passed.
- Dependency updates are automated by Dependabot (`.github/dependabot.yml`).

## Deploying to Vercel

Static hosting only – no functions. `vercel.json` sets CSP, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`. Build command `npm run build`, output `dist`.
Hobby plan is for non-commercial use; check Vercel's terms if you monetise.
