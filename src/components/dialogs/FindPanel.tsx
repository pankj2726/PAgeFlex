import { useEffect, useRef } from "react";
import { useEditor } from "../../lib/model/docState";
import { useUi } from "../../lib/model/ui";
import { cancelFind, next, prev, replaceAll, replaceCurrent, runSearch, useFind, type Overflow, type Scope } from "../../lib/text/find";
import type { FindOptions } from "../../lib/text/matcher";
import { btn, btnPrimary, input } from "../ui";

const OPTION_LABELS: [keyof FindOptions, string, string][] = [
  ["matchCase", "Match case", "“The” ≠ “the”"],
  ["wholeWord", "Whole word", "“the” does not match inside “theft”"],
  ["phrase", "Exact phrase", "Multi-word queries match those words in that order. Off: each word is searched alone."],
  ["regex", "Regex", "Advanced. Replacement text stays literal."],
  ["ignoreDiacritics", "Ignore accents", "“cafe” also finds “café”"],
];

/** Find (Ctrl/Cmd+F) and Find & Replace (Ctrl/Cmd+H). Not a modal: the page stays visible and highlighted. */
export function FindPanel() {
  const f = useFind();
  const revision = useEditor((s) => s.revision);
  const currentPage = useEditor((s) => s.currentPage);
  const findRef = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (f.open) setTimeout(() => findRef.current?.select(), 30);
  }, [f.open, f.mode]);

  // live search (debounced) whenever query / options / scope / document change
  useEffect(() => {
    if (!f.open) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void runSearch({ keepSummary: true }), 250);
    return () => clearTimeout(timer.current);
  }, [f.open, f.query, f.opts, f.scope, revision, f.scope === "page" ? currentPage : -1]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!f.open) return null;
  const close = () => {
    cancelFind();
    useFind.setState({ open: false, matches: [], current: -1, summary: null, skipped: [], error: null });
  };
  const setOpt = (k: keyof FindOptions, v: boolean) => f.set({ opts: { ...f.opts, [k]: v } });
  const n = f.matches.length;
  const replacing = f.mode === "replace";

  return (
    <section
      role="search"
      aria-label={replacing ? "Find and replace" : "Find"}
      className="animate-slide-in fixed right-3 top-28 z-30 max-h-[78vh] w-[min(94vw,26rem)] overflow-y-auto rounded-2xl border border-slate-300 bg-slate-50 p-3 text-sm shadow-2xl shadow-slate-950/15 dark:border-slate-600 dark:bg-slate-900"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          close();
        }
      }}
    >
      <div className="mb-2 flex items-center justify-between">
        <div role="tablist" className="flex gap-1">
          <button role="tab" aria-selected={!replacing} className={`${btn} !px-2 !py-1 ${!replacing ? "!bg-indigo-100 dark:!bg-indigo-900" : ""}`} onClick={() => f.set({ mode: "find" })}>Find</button>
          <button role="tab" aria-selected={replacing} className={`${btn} !px-2 !py-1 ${replacing ? "!bg-indigo-100 dark:!bg-indigo-900" : ""}`} onClick={() => f.set({ mode: "replace" })}>Replace</button>
        </div>
        <button className="rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" onClick={close} aria-label="Close find panel">✕</button>
      </div>

      <div className="flex gap-1">
        <input
          ref={findRef}
          className={input}
          value={f.query}
          placeholder="Find…"
          aria-label="Find"
          onChange={(e) => f.set({ query: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.shiftKey ? prev() : next();
            }
          }}
        />
        <button className={`${btn} !px-2`} onClick={prev} disabled={!n} aria-label="Previous match" title="Previous (Shift+Enter)">↑</button>
        <button className={`${btn} !px-2`} onClick={next} disabled={!n} aria-label="Next match" title="Next (Enter)">↓</button>
      </div>
      {replacing && (
        <input className={`${input} mt-1`} value={f.replacement} placeholder="Replace with…" aria-label="Replace with" onChange={(e) => f.set({ replacement: e.target.value })} />
      )}

      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
        {OPTION_LABELS.map(([k, label, hint]) => (
          <label key={k} className="flex items-center gap-1.5" title={hint}>
            <input type="checkbox" checked={f.opts[k]} onChange={(e) => setOpt(k, e.target.checked)} /> {label}
          </label>
        ))}
        {replacing && (
          <label className="flex items-center gap-1.5" title="“The” → “She”, “THE” → “SHE”">
            <input type="checkbox" checked={f.opts.caseAware} onChange={(e) => setOpt("caseAware", e.target.checked)} /> Case-aware replace
          </label>
        )}
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <label className="block">
          <span className="mb-0.5 block text-xs text-slate-500">Scope</span>
          <select className={input} value={f.scope} onChange={(e) => f.set({ scope: e.target.value as Scope })} aria-label="Search scope">
            <option value="page">Current page</option>
            <option value="selected">Selected pages</option>
            <option value="all">Entire document</option>
          </select>
        </label>
        {replacing && (
          <label className="block">
            <span className="mb-0.5 block text-xs text-slate-500">If longer than the space</span>
            <select className={input} value={f.overflow} onChange={(e) => f.set({ overflow: e.target.value as Overflow })} aria-label="When the new text is longer">
              <option value="shrink">Shrink to fit (≥ 60%)</option>
              <option value="overflow">Allow overflow</option>
              <option value="skip">Skip it</option>
            </select>
          </label>
        )}
      </div>

      <p className="mt-2 text-xs" aria-live="polite" data-testid="match-counter">
        {f.error ? (
          <span role="alert" className="text-red-600">{f.opts.regex ? "Invalid pattern: " : ""}{f.error}</span>
        ) : f.busy ? (
          <span>{f.label}…</span>
        ) : !f.query.trim() ? (
          <span className="text-slate-500">Type to search. Enter = next, Shift+Enter = previous, Esc = close.</span>
        ) : n ? (
          <span className="font-medium">{f.current + 1} of {n}</span>
        ) : (
          <span className="text-slate-500">No results</span>
        )}
        {f.opts.regex && f.query && !f.error && <span className="ml-2 text-emerald-700">✔ valid pattern</span>}
      </p>

      {f.busy && (
        <div className="mt-1 flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700" role="progressbar" aria-valuenow={Math.round(f.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-indigo-600" style={{ width: `${Math.max(4, Math.round(f.progress * 100))}%` }} />
          </div>
          <button className={`${btn} !px-2 !py-0.5 text-xs`} onClick={cancelFind}>Cancel</button>
        </div>
      )}

      {f.noTextPages > 0 && !f.busy && (
        <p className="mt-2 rounded-md bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {f.noTextPages} page{f.noTextPages === 1 ? " has" : "s have"} no text layer (scans). <button className="font-semibold underline" onClick={() => useUi.getState().set({ toolPanel: "ocr" })}>Run OCR first</button> to search them.
        </p>
      )}

      {replacing && (
        <div className="mt-2 flex flex-wrap gap-2">
          <button className={btn} onClick={() => void replaceCurrent()} disabled={!n || f.busy}>Replace</button>
          <button className={btn} onClick={next} disabled={!n || f.busy}>Skip</button>
          <button className={btnPrimary} onClick={() => void replaceAll()} disabled={!n || f.busy}>Replace all ({n})</button>
        </div>
      )}

      {f.summary && (
        <p className="mt-2 rounded-md bg-slate-100 p-2 text-xs dark:bg-slate-800" role="status" data-testid="replace-summary">{f.summary}</p>
      )}
      {f.skipped.length > 0 && (
        <ul className="mt-1 max-h-28 list-disc overflow-y-auto pl-5 text-xs text-slate-600 dark:text-slate-300" aria-label="Skipped matches">
          {f.skipped.map((s, i) => (
            <li key={i}>Page {s.page}: “{s.text}” – {s.reason}</li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[11px] text-slate-500">
        Replacements are cover-and-replace edits (new text is real text; the covered original stays in the file's text layer – use Redact to remove text permanently). Matches inside earlier edits are not searched.
      </p>
    </section>
  );
}
