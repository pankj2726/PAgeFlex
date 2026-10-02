/**
 * Glyph-level text map (TASKS-02 Task 2, section 2.2 A–D). Pure and DOM-free so it can be unit-tested.
 *
 * Everything lives in PAGE SPACE (pt, origin top-left of the crop box, y down, page /Rotate ignored) – exactly the
 * space editor objects use – so `lib/model/coords.ts` remains the only place that handles rotation and zoom.
 *
 * LIMITATION (docs/KNOWN_LIMITATIONS.md KL-GLYPH): this pdf.js build does not expose per-glyph advances, so each
 * item's measured width is distributed over its characters with a fixed proportional-width table. Item and word
 * extents are exact; boundaries between letters INSIDE a word can be off by a fraction of a glyph.
 */
import type { FontFamily } from "../model/objects";

export interface Pt {
  x: number;
  y: number;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One pdf.js text item, converted to page space (no merging – merging is what caused the selection bleed). */
export interface RawItem {
  str: string;
  /** origin of the first glyph on the baseline */
  x: number;
  baseline: number;
  /** total advance of the item (pt) */
  w: number;
  size: number;
  /** radians, PDF orientation (counter-clockwise, y up) */
  angle: number;
  fontName: string;
  family: FontFamily;
  bold: boolean;
  italic: boolean;
}

export interface Glyph {
  /** index in `map.glyphs`; ids are assigned in READING ORDER so id order == reading order */
  id: number;
  char: string;
  itemIndex: number;
  /** oriented 4-point polygon in page space: top-left, top-right, bottom-right, bottom-left (in the glyph's own frame) */
  quad: [Pt, Pt, Pt, Pt];
  /** tight axis-aligned ink box (x-height / cap-height based, NOT the full line height) */
  ink: Rect;
  origin: Pt;
  advance: number;
  baseline: number;
  size: number;
  angle: number;
  wordId: number; // -1 for whitespace
  lineId: number;
  columnId: number;
  space: boolean;
  mark: boolean;
  fontName: string;
  family: FontFamily;
  bold: boolean;
  italic: boolean;
}

export interface LineInfo {
  id: number;
  columnId: number;
  glyphIds: number[];
  bbox: Rect;
  baseline: number;
}

export interface GlyphMap {
  glyphs: Glyph[];
  lines: LineInfo[];
  /** wordId → glyph ids */
  words: number[][];
}

const ASC = 0.8;
const DESC = 0.2;
const GUTTER_EM = 1.6; // horizontal gap that splits a baseline cluster into separate segments (column gutter / table cell)
const WORD_GAP_EM = 0.5; // gap that starts a new word (spec: gap > 0.5 × font size)
const MARK_RE = /\p{M}/u;
const ZERO_WIDTH_RE = /[\u200b-\u200f\u2060\ufeff]/;

export const isSpaceChar = (ch: string) => /^\s$/u.test(ch);

// ---------- width model ----------
const NARROW = new Set("iljtfIr'.,:;!|`’‘ ".split(""));
export function charWeight(ch: string): number {
  if (MARK_RE.test(ch) || ZERO_WIDTH_RE.test(ch)) return 0;
  if (ch === " " || ch === "\u00a0") return 0.28;
  if (NARROW.has(ch)) return 0.27;
  if (/[mM]/.test(ch)) return 0.85;
  if (/[wW]/.test(ch)) return 0.78;
  if (/[0-9]/.test(ch)) return 0.556;
  if (/[A-Z]/.test(ch)) return 0.68;
  if (/[\u2e80-\u9fff\uac00-\ud7af\uff00-\uffef]/.test(ch)) return 1;
  if (/[a-z]/.test(ch)) return 0.5;
  return 0.55;
}

function inkExtent(ch: string): [number, number] {
  let top = 0.54;
  let bottom = 0.02;
  if (/[A-Z0-9bdfhklt!?()[\]{}/|"'&%$#@ß]/.test(ch) || /[^\u0000-\u024f]/.test(ch)) top = 0.76;
  if (/[.,:;·•_-]/.test(ch)) top = 0.14;
  if (/[gjpqyQ,;()[\]{}|/@]/.test(ch)) bottom = 0.22;
  if (/[\u0900-\u097f]/.test(ch)) bottom = 0.25;
  return [top, bottom];
}

// ---------- building ----------
interface Cand extends Omit<Glyph, "id" | "wordId" | "lineId" | "columnId"> {
  rotated: boolean;
}

function explode(item: RawItem, itemIndex: number): Cand[] {
  const chars = [...item.str];
  const weights = chars.map(charWeight);
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return [];
  const a = item.angle;
  const t = { x: Math.cos(a), y: -Math.sin(a) };
  const n = { x: -Math.sin(a), y: -Math.cos(a) };
  const at = (s: number, up: number): Pt => ({ x: item.x + t.x * s + n.x * up, y: item.baseline + t.y * s + n.y * up });
  const rotated = Math.abs(a) > 0.05;
  const out: Cand[] = [];
  let s = 0;
  chars.forEach((ch, i) => {
    const adv = (weights[i] / total) * item.w;
    const s0 = s;
    const s1 = s + adv;
    s = s1;
    const [top, bottom] = inkExtent(ch);
    const corners = [at(s0, top * item.size), at(s1, top * item.size), at(s1, -bottom * item.size), at(s0, -bottom * item.size)];
    const xs = corners.map((c) => c.x);
    const ys = corners.map((c) => c.y);
    out.push({
      char: ch,
      itemIndex,
      quad: [at(s0, ASC * item.size), at(s1, ASC * item.size), at(s1, -DESC * item.size), at(s0, -DESC * item.size)],
      ink: { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) },
      origin: at(s0, 0),
      advance: adv,
      baseline: item.baseline,
      size: item.size,
      angle: a,
      space: isSpaceChar(ch),
      mark: weights[i] === 0,
      fontName: item.fontName,
      family: item.family,
      bold: item.bold,
      italic: item.italic,
      rotated,
    });
  });
  return out;
}

interface Seg {
  glyphs: Cand[];
  bbox: Rect;
}

const unionRect = (rs: Rect[]): Rect => {
  const x0 = Math.min(...rs.map((r) => r.x));
  const y0 = Math.min(...rs.map((r) => r.y));
  const x1 = Math.max(...rs.map((r) => r.x + r.w));
  const y1 = Math.max(...rs.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};

function toSeg(glyphs: Cand[]): Seg {
  return { glyphs, bbox: unionRect(glyphs.map((g) => g.ink)) };
}

export function buildGlyphMap(items: RawItem[]): GlyphMap {
  const cands: Cand[] = [];
  items.forEach((it, i) => {
    if (it.str) cands.push(...explode(it, i));
  });
  const segs: Seg[] = [];

  // rotated / skewed items: each item is its own segment (never merged with anything)
  const byItem = new Map<number, Cand[]>();
  for (const c of cands) if (c.rotated) byItem.set(c.itemIndex, [...(byItem.get(c.itemIndex) ?? []), c]);
  for (const g of byItem.values()) segs.push(toSeg(g));

  // axis-aligned: cluster by baseline (tolerant of super/subscripts), then split on large horizontal gaps
  const axis = cands.filter((c) => !c.rotated).sort((a, b) => a.baseline - b.baseline);
  const clusters: { baseline: number; size: number; glyphs: Cand[] }[] = [];
  for (const g of axis) {
    const last = clusters[clusters.length - 1];
    if (last && Math.abs(g.baseline - last.baseline) <= 0.45 * Math.max(g.size, last.size)) {
      last.glyphs.push(g);
      if (g.size > last.size) {
        last.size = g.size;
        last.baseline = g.baseline;
      }
    } else clusters.push({ baseline: g.baseline, size: g.size, glyphs: [g] });
  }
  for (const c of clusters) {
    const sorted = [...c.glyphs].sort((a, b) => a.origin.x - b.origin.x);
    // drop exact duplicates (fake-bold double strikes, stacked invisible text layers)
    const kept: Cand[] = [];
    for (const g of sorted) {
      let dup = false;
      for (let j = kept.length - 1; j >= 0 && g.origin.x - kept[j].origin.x < 0.1 * g.size; j--) {
        if (kept[j].char === g.char && Math.abs(kept[j].baseline - g.baseline) < 0.3 * g.size) dup = true;
      }
      if (!dup) kept.push(g);
    }
    let cur: Cand[] = [];
    let right = -Infinity;
    for (const g of kept) {
      if (cur.length && !g.mark && g.origin.x - right > GUTTER_EM * Math.max(g.size, cur[cur.length - 1].size)) {
        segs.push(toSeg(cur));
        cur = [];
        right = -Infinity;
      }
      cur.push(g);
      right = Math.max(right, g.origin.x + g.advance);
    }
    if (cur.length) segs.push(toSeg(cur));
  }
  if (!segs.length) return { glyphs: [], lines: [], words: [] };

  // ---- reading order: bands split by page-wide segments; columns inside a band by x-overlap ----
  const minX = Math.min(...segs.map((s) => s.bbox.x));
  const maxX = Math.max(...segs.map((s) => s.bbox.x + s.bbox.w));
  const pageW = maxX - minX;
  const cy = (s: Seg) => s.bbox.y + s.bbox.h / 2;
  const wide = segs.filter((s) => s.bbox.w > 0.6 * pageW).sort((a, b) => cy(a) - cy(b));
  const narrow = segs.filter((s) => !(s.bbox.w > 0.6 * pageW));
  const bands: Seg[][] = Array.from({ length: wide.length + 1 }, () => []);
  for (const s of narrow) {
    let b = 0;
    while (b < wide.length && cy(wide[b]) < cy(s)) b++;
    bands[b].push(s);
  }
  const ordered: Seg[] = [];
  for (let b = 0; b < bands.length; b++) {
    const list = bands[b];
    const parent = list.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const A = list[i].bbox;
        const B = list[j].bbox;
        if (A.x < B.x + B.w - 1 && B.x < A.x + A.w - 1) parent[find(i)] = find(j);
      }
    }
    const groups = new Map<number, Seg[]>();
    list.forEach((s, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), s]));
    const cols = [...groups.values()].sort((a, c2) => Math.min(...a.map((s) => s.bbox.x)) - Math.min(...c2.map((s) => s.bbox.x)));
    for (const col of cols) {
      col.sort((a, c2) => cy(a) - cy(c2) || a.bbox.x - c2.bbox.x);
      ordered.push(...col);
    }
    if (b < wide.length) ordered.push(wide[b]);
  }

  // ---- assign ids / lines / words ----
  const glyphs: Glyph[] = [];
  const lines: LineInfo[] = [];
  const words: number[][] = [];
  // A new column starts when a line barely overlaps the previous line (in reading order) horizontally. Lines of one
  // column overlap heavily; the last line of the left column and the first of the right column do not.
  let columnId = 0;
  let prevBox: Rect | null = null;
  ordered.forEach((seg, lineId) => {
    if (prevBox) {
      const overlap = Math.max(0, Math.min(prevBox.x + prevBox.w, seg.bbox.x + seg.bbox.w) - Math.max(prevBox.x, seg.bbox.x));
      if (overlap < 0.3 * Math.min(prevBox.w, seg.bbox.w)) columnId++;
    }
    prevBox = seg.bbox;
    const ids: number[] = [];
    let wordId = -1;
    let startNew = true;
    let prev: Cand | null = null;
    for (const g of seg.glyphs) {
      let w = -1;
      if (!g.space) {
        let gap = 0;
        if (prev) {
          const tx = Math.cos(g.angle);
          const ty = -Math.sin(g.angle);
          gap = (g.origin.x - prev.origin.x) * tx + (g.origin.y - prev.origin.y) * ty - prev.advance;
        }
        if (!g.mark && (startNew || !prev || gap > WORD_GAP_EM * Math.max(prev.size, g.size))) {
          wordId = words.length;
          words.push([]);
        }
        if (wordId < 0) {
          wordId = words.length;
          words.push([]);
        }
        w = wordId;
        startNew = false;
        prev = g;
      } else startNew = true;
      const id = glyphs.length;
      const { rotated: _r, ...rest } = g;
      void _r;
      glyphs.push({ ...rest, id, wordId: w, lineId, columnId });
      if (w >= 0) words[w].push(id);
      ids.push(id);
    }
    lines.push({ id: lineId, columnId, glyphIds: ids, bbox: seg.bbox, baseline: seg.glyphs[0].baseline });
  });
  return { glyphs, lines, words };
}

// ---------- hit testing ----------
export const inkCenter = (g: Glyph): Pt => ({ x: g.ink.x + g.ink.w / 2, y: g.ink.y + g.ink.h / 2 });

/** Point-in-quad for the glyph's oriented rectangle, with horizontal slack `tol` along the baseline (never vertical). */
export function distanceToGlyph(p: Pt, g: Glyph, tol: number): number | null {
  const tx = Math.cos(g.angle);
  const ty = -Math.sin(g.angle);
  const nx = -Math.sin(g.angle);
  const ny = -Math.cos(g.angle);
  const dx = p.x - g.origin.x;
  const dy = p.y - g.origin.y;
  const s = dx * tx + dy * ty;
  const u = dx * nx + dy * ny;
  if (u < -DESC * g.size || u > ASC * g.size) return null;
  if (s < -tol || s > g.advance + tol) return null;
  return Math.max(0, -s, s - g.advance);
}

export interface HitOptions {
  /** slack along the baseline in pt (spec: ≤ 2) */
  tol?: number;
  /** glyphs that must be ignored (hidden under earlier cover rectangles) */
  dead?: (g: Glyph) => boolean;
}

/** Exactly ONE glyph or null. Tie-break: smallest distance, then nearest ink centre, then smallest area. */
export function hitTest(map: GlyphMap, p: Pt, opts: HitOptions = {}): Glyph | null {
  const tol = Math.min(opts.tol ?? 2, 2);
  let best: Glyph | null = null;
  let bestKey: [number, number, number] = [Infinity, Infinity, Infinity];
  for (const g of map.glyphs) {
    if (g.space || g.mark || g.advance <= 0 || opts.dead?.(g)) continue;
    const d = distanceToGlyph(p, g, tol);
    if (d === null) continue;
    const c = inkCenter(g);
    const key: [number, number, number] = [d, Math.hypot(p.x - c.x, p.y - c.y), g.ink.w * g.ink.h];
    if (key[0] < bestKey[0] || (key[0] === bestKey[0] && (key[1] < bestKey[1] || (key[1] === bestKey[1] && key[2] < bestKey[2])))) {
      best = g;
      bestKey = key;
    }
  }
  return best;
}

// ---------- selection ----------
const trimSpaces = (map: GlyphMap, ids: number[]): number[] => {
  let a = 0;
  let b = ids.length;
  while (a < b && map.glyphs[ids[a]].space) a++;
  while (b > a && map.glyphs[ids[b - 1]].space) b--;
  return ids.slice(a, b);
};

/** Single click: exactly the word under the cursor, nothing else. */
export function selectWord(map: GlyphMap, id: number): number[] {
  const g = map.glyphs[id];
  return g && g.wordId >= 0 ? [...map.words[g.wordId]] : [];
}

/** Triple click: the line within its own column/segment only. */
export function selectLine(map: GlyphMap, id: number): number[] {
  const g = map.glyphs[id];
  return g ? trimSpaces(map, map.lines[g.lineId].glyphIds) : [];
}

/** Drag: exact character range in reading order, clamped to the start glyph's column. */
export function selectRange(map: GlyphMap, a: number, b: number): number[] {
  const ga = map.glyphs[a];
  const gb = map.glyphs[b];
  if (!ga || !gb) return [];
  let lo = Math.min(a, b);
  let hi = Math.max(a, b);
  if (gb.columnId !== ga.columnId) {
    const colIds = map.glyphs.filter((g) => g.columnId === ga.columnId).map((g) => g.id);
    if (b > a) hi = colIds[colIds.length - 1];
    else lo = colIds[0];
  }
  const ids: number[] = [];
  for (let i = lo; i <= hi; i++) if (map.glyphs[i].columnId === ga.columnId) ids.push(i);
  return trimSpaces(map, ids);
}

/** Alt+drag rectangle: glyphs whose INK CENTRES fall inside it (not whose boxes merely touch it). */
export function selectRect(map: GlyphMap, r: Rect): number[] {
  const ids = map.glyphs
    .filter((g) => {
      const c = inkCenter(g);
      return c.x >= r.x && c.x <= r.x + r.w && c.y >= r.y && c.y <= r.y + r.h;
    })
    .map((g) => g.id);
  return trimSpaces(map, ids);
}

/** Shift+click: extend the current selection to the clicked glyph. */
export function extendSelection(map: GlyphMap, current: number[], id: number): number[] {
  if (!current.length) return selectWord(map, id);
  return id >= current[0] ? selectRange(map, current[0], id) : selectRange(map, current[current.length - 1], id);
}

/** Handles: move the start or end of the range by whole characters. */
export function nudgeSelection(map: GlyphMap, ids: number[], end: "start" | "end", delta: number): number[] {
  if (!ids.length) return ids;
  let lo = ids[0];
  let hi = ids[ids.length - 1];
  if (end === "start") lo += delta;
  else hi += delta;
  lo = Math.max(0, lo);
  hi = Math.min(map.glyphs.length - 1, hi);
  return lo > hi ? ids : selectRange(map, lo, hi);
}

/** The string a selection captured. Lines are joined with "\n". */
export function targetString(map: GlyphMap, ids: number[]): string {
  let out = "";
  let line = -1;
  for (const id of ids) {
    const g = map.glyphs[id];
    if (line !== -1 && g.lineId !== line) out += "\n";
    line = g.lineId;
    out += g.char;
  }
  return out;
}

// ---------- guards (2.2 D) ----------
export type GuardResult = { ok: true } | { ok: false; reason: string };

/** Guard 1: the edit buffer's original text must equal the concatenation of the target glyphs. */
export function guardTarget(map: GlyphMap, ids: number[], origText: string): GuardResult {
  if (!ids.length) return { ok: false, reason: "Nothing is selected." };
  const s = targetString(map, ids);
  return s === origText ? { ok: true } : { ok: false, reason: `The edit buffer ("${origText}") does not match the selected text ("${s}"). Nothing was changed.` };
}

export type CoverResult = { ok: true; covers: Rect[] } | { ok: false; reason: string };

const overlapArea = (a: Rect, b: Rect) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const EPS = 0.01;

/**
 * Guards 2+3: one cover rectangle per target line, from the tight ink boxes of the target glyphs only,
 * padded by ≤ 1 pt and clipped away from every non-target glyph. If a non-target glyph overlaps the target's own ink
 * the edit is BLOCKED and the offending text is named.
 */
export function computeCovers(map: GlyphMap, ids: number[], pad = 1): CoverResult {
  const target = new Set(ids);
  const byLine = new Map<number, Glyph[]>();
  for (const id of ids) {
    const g = map.glyphs[id];
    byLine.set(g.lineId, [...(byLine.get(g.lineId) ?? []), g]);
  }
  const covers: Rect[] = [];
  for (const gs of byLine.values()) {
    const inkable = gs.filter((g) => !g.space || gs.length === 1);
    const T = unionRect((inkable.length ? inkable : gs).map((g) => g.ink));
    let L = T.x - pad;
    let R = T.x + T.w + pad;
    let U = T.y - pad;
    let D = T.y + T.h + pad;
    for (const n of map.glyphs) {
      if (target.has(n.id) || n.space || n.advance <= 0) continue;
      const ni = n.ink;
      if (overlapArea(ni, T) > EPS) {
        const word = n.wordId >= 0 ? map.words[n.wordId].map((i) => map.glyphs[i].char).join("") : n.char;
        return { ok: false, reason: `The text "${word}" overlaps the selection and would be hidden. Select a smaller range.` };
      }
      if (overlapArea(ni, { x: L, y: U, w: R - L, h: D - U }) <= EPS) continue;
      if (ni.x >= T.x + T.w - EPS) R = Math.min(R, ni.x);
      else if (ni.x + ni.w <= T.x + EPS) L = Math.max(L, ni.x + ni.w);
      else if (ni.y >= T.y + T.h - EPS) D = Math.min(D, ni.y);
      else if (ni.y + ni.h <= T.y + EPS) U = Math.max(U, ni.y + ni.h);
      else return { ok: false, reason: "Neighbouring text is in the way of this selection." };
    }
    covers.push({ x: L, y: U, w: R - L, h: D - U });
  }
  return { ok: true, covers };
}
