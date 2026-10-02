/**
 * Find matching (TASKS-02 Task 3 §3.1/3.2). Pure string logic, usable in a worker.
 *
 * Word boundaries are decided in CODE (not with `\b`, not with lookaround) so that they can be Unicode-aware, honour the
 * apostrophe/hyphen rule below, and defer to Intl.Segmenter for scripts written without spaces (CJK, Thai).
 *
 * Documented decisions (docs/DECISIONS.md D-FR-1…4):
 *  - word characters are \p{L}\p{N}\p{M}_ ;
 *  - "don't" and "well-known" are ONE word (an apostrophe/hyphen between word characters does not end a word), with ONE
 *    exception: a possessive/contraction suffix 's / ’s ends the word, so "cat" matches in "cat's" but not in "concatenate";
 *  - the query is whitespace-tolerant: any run of whitespace (space, line break, collapsed hyphenation gap) matches any run;
 *  - replacement text is always literal (no $1 groups), also in regex mode.
 */
export interface FindOptions {
  matchCase: boolean;
  wholeWord: boolean;
  /** multi-word queries match only those words, in that order, adjacent. Off → each word is searched on its own. */
  phrase: boolean;
  regex: boolean;
  ignoreDiacritics: boolean;
  /** Replace only: "The" → "She", "THE" → "SHE" */
  caseAware: boolean;
}

export const DEFAULT_FIND: FindOptions = { matchCase: false, wholeWord: false, phrase: true, regex: false, ignoreDiacritics: false, caseAware: false };

export interface Span {
  start: number;
  end: number;
}

const WORD = /[\p{L}\p{N}\p{M}_]/u;
const APOS = /['’\-]/;
const SEGMENTED = /[\u0e00-\u0e7f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
const MAX_SPANS = 100_000;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function buildPattern(query: string, opts: FindOptions): string {
  if (opts.regex) return query;
  const q = query.trim();
  const terms = opts.phrase ? [q] : q.split(/\s+/);
  return terms
    .filter(Boolean)
    .map((t) => t.split(/\s+/).map(escapeRe).join("\\s+"))
    .join("|");
}

export type Compiled = { ok: true; re: RegExp } | { ok: false; error: string };

/** Validity indicator for the UI (regex mode) and the single place a RegExp is created. */
export function compileQuery(query: string, opts: FindOptions): Compiled {
  if (!query.trim()) return { ok: false, error: "" };
  try {
    return { ok: true, re: new RegExp(buildPattern(query, opts), `gu${opts.matchCase ? "" : "i"}`) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.replace(/^Invalid regular expression: /, "") : "Invalid pattern" };
  }
}

// ---- diacritics ----
function foldChar(ch: string): string {
  return ch.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
function fold(s: string): { s: string; back: number[] } {
  let out = "";
  const back: number[] = [];
  for (let i = 0; i < s.length; ) {
    const cp = s.codePointAt(i)!;
    const ch = String.fromCodePoint(cp);
    const f = foldChar(ch);
    for (let k = 0; k < f.length; k++) back.push(i);
    out += f;
    i += ch.length;
  }
  back.push(s.length);
  return { s: out, back };
}

// ---- boundaries ----
const prevChar = (t: string, i: number): string => (i <= 0 ? "" : ([...t.slice(Math.max(0, i - 2), i)].pop() ?? ""));
const nextChar = (t: string, i: number): string => (i >= t.length ? "" : (String.fromCodePoint(t.codePointAt(i)!)));

type SegmenterCtor = new (l?: string, o?: { granularity: "word" }) => { segment(s: string): Iterable<{ index: number; segment: string }> };
function segmentBoundaries(text: string): Set<number> | null {
  const S = (Intl as unknown as { Segmenter?: SegmenterCtor }).Segmenter;
  if (!S) return null;
  const set = new Set<number>([0, text.length]);
  for (const s of new S(undefined, { granularity: "word" }).segment(text)) {
    set.add(s.index);
    set.add(s.index + s.segment.length);
  }
  return set;
}

export function boundaryBefore(text: string, s: number, seg: Set<number> | null): boolean {
  if (s <= 0) return true;
  const first = nextChar(text, s);
  if (!WORD.test(first)) return true;
  const prev = prevChar(text, s);
  if (seg && (SEGMENTED.test(first) || SEGMENTED.test(prev))) return seg.has(s);
  if (WORD.test(prev)) return false;
  if (APOS.test(prev) && WORD.test(prevChar(text, s - prev.length))) return false;
  return true;
}

export function boundaryAfter(text: string, e: number, seg: Set<number> | null): boolean {
  if (e >= text.length) return true;
  const last = prevChar(text, e);
  if (!WORD.test(last)) return true;
  const next = nextChar(text, e);
  if (seg && (SEGMENTED.test(last) || SEGMENTED.test(next))) return seg.has(e);
  if (WORD.test(next)) return false;
  if (APOS.test(next)) {
    const after = nextChar(text, e + next.length);
    if (after && WORD.test(after)) {
      if (/['’]/.test(next) && (after === "s" || after === "S")) {
        const afterS = nextChar(text, e + next.length + after.length);
        if (!afterS || !WORD.test(afterS)) return true; // possessive 's ends the word
      }
      return false; // don't, well-known, …
    }
  }
  return true;
}

/** All non-overlapping matches, as UTF-16 spans of `text`. Throws on an invalid pattern. */
export function findAll(text: string, query: string, opts: FindOptions): Span[] {
  if (!query.trim()) return [];
  let hay = text;
  let back: number[] | null = null;
  let q = query;
  if (opts.ignoreDiacritics) {
    const f = fold(text);
    hay = f.s;
    back = f.back;
    if (!opts.regex) q = fold(query).s;
  }
  const c = compileQuery(q, opts);
  if (!c.ok) throw new Error(c.error || "Empty query");
  const re = c.re;
  re.lastIndex = 0;
  const seg = SEGMENTED.test(hay) ? segmentBoundaries(hay) : null;
  const out: Span[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(hay)) && out.length < MAX_SPANS) {
    if (m[0].length === 0) {
      re.lastIndex = m.index + 1;
      continue;
    }
    const s = m.index;
    const e = s + m[0].length;
    if (opts.wholeWord && !(boundaryBefore(hay, s, seg) && boundaryAfter(hay, e, seg))) {
      re.lastIndex = s + 1; // a rejected candidate must not hide an overlapping valid one
      continue;
    }
    out.push(back ? { start: back[s], end: back[e] } : { start: s, end: e });
  }
  return out;
}

/** "The" → "She", "THE" → "SHE", "the" → "she" (letters only decide the shape). */
export function applyCase(matched: string, replacement: string): string {
  const letters = [...matched].filter((c) => /\p{L}/u.test(c));
  if (!letters.length) return replacement;
  const allUpper = letters.every((c) => c === c.toUpperCase() && c !== c.toLowerCase());
  if (allUpper && letters.length > 1) return replacement.toUpperCase();
  const first = letters[0];
  const restLower = letters.slice(1).every((c) => c === c.toLowerCase());
  if (first === first.toUpperCase() && first !== first.toLowerCase() && restLower) {
    const [h, ...t] = [...replacement];
    return h ? h.toUpperCase() + t.join("") : replacement;
  }
  return replacement;
}

/** Reference implementation of Replace All on a plain string (used by tests; the PDF pipeline replaces glyph ranges instead). */
export function replaceAllInString(text: string, query: string, replacement: string, opts: FindOptions): string {
  const spans = findAll(text, query, opts);
  let out = text;
  for (let i = spans.length - 1; i >= 0; i--) {
    const { start, end } = spans[i];
    const r = opts.caseAware ? applyCase(text.slice(start, end), replacement) : replacement;
    out = out.slice(0, start) + r + out.slice(end);
  }
  return out;
}
