/**
 * Per-page search index (Task 3 §3.3): ONE normalised text stream in reading order plus an offset map
 * stringIndex → glyph range, so a match can span runs and lines and still be edited glyph-exactly.
 *
 * Normalisation: whitespace collapsed; hyphenated line breaks joined ("infor-⏎mation" → "information"); ligatures expanded;
 * Unicode NFC (per grapheme cluster, so base + combining mark compose). Columns are separated by a control character that
 * no query can match, so a phrase never runs from one column into the next.
 *
 * DECISION D-FR-4: a line-final hyphen after a letter is treated as hyphenation (and dropped) only when the next line
 * starts with a lowercase letter; "well-⏎known" therefore indexes as "wellknown" – a real compound broken at a hyphen cannot be told apart.
 */
import { type Glyph, type GlyphMap } from "./glyphMap";
import type { Span } from "./matcher";

export const COLUMN_BREAK = "\u0001";

export interface SearchIndex {
  text: string;
  /** first / last glyph id behind each character; -1 for virtual separators */
  first: Int32Array;
  last: Int32Array;
}

interface Cluster {
  s: string;
  first: number;
  last: number;
  kind?: "line" | "column" | "word";
}

const expandLigature = (ch: string) => (ch >= "\ufb00" && ch <= "\ufb06" ? ch.normalize("NFKC") : ch);

export function buildSearchIndex(map: GlyphMap, isDead: (g: Glyph) => boolean = () => false): SearchIndex {
  const seq: Cluster[] = [];
  let prev: Glyph | null = null;
  for (const g of map.glyphs) {
    if (isDead(g)) continue;
    if (prev) {
      if (g.columnId !== prev.columnId) seq.push({ s: COLUMN_BREAK, first: -1, last: -1, kind: "column" });
      else if (g.lineId !== prev.lineId) seq.push({ s: "\n", first: -1, last: -1, kind: "line" });
      else if (!g.space && !prev.space && !g.mark && g.wordId !== prev.wordId) seq.push({ s: " ", first: -1, last: -1, kind: "word" });
    }
    const tail = seq[seq.length - 1];
    if (g.mark && tail && tail.first >= 0) {
      tail.s += g.char;
      tail.last = g.id;
    } else seq.push({ s: expandLigature(g.char), first: g.id, last: g.id });
    prev = g;
  }

  const chars: string[] = [];
  const first: number[] = [];
  const last: number[] = [];
  const push = (ch: string, f: number, l: number) => {
    chars.push(ch);
    first.push(f);
    last.push(l);
  };
  const pushSpace = (f: number, l: number) => {
    if (chars.length && chars[chars.length - 1] === " ") return;
    push(" ", f, l);
  };

  for (let i = 0; i < seq.length; i++) {
    const c = seq[i];
    if (c.kind === "column") {
      while (chars.length && chars[chars.length - 1] === " ") {
        chars.pop();
        first.pop();
        last.pop();
      }
      push(COLUMN_BREAK, -1, -1);
      continue;
    }
    if (c.kind === "line") {
      let k = chars.length - 1;
      while (k >= 0 && chars[k] === " ") k--;
      const hyphen = k >= 1 && (chars[k] === "-" || chars[k] === "\u2010" || chars[k] === "\u00ad") && /\p{L}/u.test(chars[k - 1]);
      const next = seq[i + 1];
      if (hyphen && next && next.first >= 0 && /\p{Ll}/u.test(next.s.normalize("NFC")[0] ?? "")) {
        chars.length = first.length = last.length = k; // drop the hyphen (and any trailing spaces): "infor-⏎mation" → "information"
        continue;
      }
      pushSpace(-1, -1);
      continue;
    }
    if (c.kind === "word") {
      pushSpace(-1, -1);
      continue;
    }
    const norm = c.s.normalize("NFC");
    for (let u = 0; u < norm.length; u++) {
      if (/\s/.test(norm[u])) pushSpace(c.first, c.last);
      else push(norm[u], c.first, c.last);
    }
  }
  while (chars.length && chars[chars.length - 1] === " ") {
    chars.pop();
    first.pop();
    last.pop();
  }
  let lead = 0;
  while (lead < chars.length && chars[lead] === " ") lead++;
  return { text: chars.slice(lead).join(""), first: Int32Array.from(first.slice(lead)), last: Int32Array.from(last.slice(lead)) };
}

/** Glyph ids covered by a match (reading order, live glyphs only, edge spaces trimmed). Includes a dropped hyphen when the match spans it. */
export function spanGlyphIds(idx: SearchIndex, map: GlyphMap, span: Span, isDead: (g: Glyph) => boolean = () => false): number[] {
  let s = span.start;
  while (s < span.end && idx.first[s] < 0) s++;
  let e = span.end - 1;
  while (e > s && idx.last[e] < 0) e--;
  if (s >= span.end || idx.first[s] < 0) return [];
  const ids: number[] = [];
  for (let i = idx.first[s]; i <= idx.last[e]; i++) {
    const g = map.glyphs[i];
    if (g && !isDead(g) && g.columnId === map.glyphs[idx.first[s]].columnId) ids.push(i);
  }
  let a = 0;
  let b = ids.length;
  while (a < b && map.glyphs[ids[a]].space) a++;
  while (b > a && map.glyphs[ids[b - 1]].space) b--;
  return ids.slice(a, b);
}
