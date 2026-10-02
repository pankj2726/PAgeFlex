import { createObject, type PdfObject } from "../model/objects";
import { computeCovers, guardTarget, targetString, type GlyphMap, type Rect } from "./glyphMap";

export interface EditColors {
  bg: string;
  fg: string;
}

export type EditResult = { ok: true; obj: PdfObject; covers: Rect[]; unchanged: boolean } | { ok: false; error: string };

/**
 * The ONE place an edit object is created, for both click-to-edit (Task 2) and Replace / Replace All (Task 3).
 * Runs guards 1–3 first; nothing is returned if any of them fails.
 */
export function makeEditObject(
  map: GlyphMap,
  ids: number[],
  pageId: string,
  opts: { newText?: string; colors?: EditColors; fontScale?: number } = {}
): EditResult {
  if (!ids.length) return { ok: false, error: "Nothing is selected." };
  const first = map.glyphs[ids[0]];
  if (Math.abs(first.angle) > 0.05 || ids.some((i) => Math.abs(map.glyphs[i].angle) > 0.05)) {
    return { ok: false, error: "Rotated or skewed text can't be edited in place. Use Whiteout + Text box instead." };
  }
  const orig = targetString(map, ids);
  const g1 = guardTarget(map, ids, orig);
  if (!g1.ok) return { ok: false, error: g1.reason };
  const cov = computeCovers(map, ids);
  if (!cov.ok) return { ok: false, error: cov.reason };

  const x1 = Math.max(...cov.covers.map((c) => c.x + c.w));
  const y0 = Math.min(...cov.covers.map((c) => c.y));
  const y1 = Math.max(...cov.covers.map((c) => c.y + c.h));
  const size = first.size * (opts.fontScale ?? 1);
  const o = createObject("textedit", pageId, first.origin.x, y0, Math.max(x1 - first.origin.x, 4), Math.max(y1 - y0, 4));
  Object.assign(o, {
    text: opts.newText ?? orig,
    origText: orig,
    covers: cov.covers,
    fontSize: size,
    family: first.family,
    bold: first.bold,
    italic: first.italic,
    color: opts.colors?.fg ?? "#000000",
    bg: opts.colors?.bg ?? "#ffffff",
    baseline: first.baseline - y0,
    fill: null,
  });
  return { ok: true, obj: o, covers: cov.covers, unchanged: (opts.newText ?? orig) === orig };
}
