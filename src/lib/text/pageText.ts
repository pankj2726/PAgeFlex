import type { Box } from "../model/coords";
import type { SourceDoc } from "../model/commands";
import { extractRawItems, getSourceDoc } from "../pdf/render";
import { buildGlyphMap, type GlyphMap } from "./glyphMap";

/** Per-source-page glyph map cache, shared by click-to-edit and Find & Replace. Sources are immutable, so entries never go stale. */
const cache = new Map<string, Promise<GlyphMap>>();

export function getGlyphMap(src: SourceDoc, srcIndex: number, cropBox: Box): Promise<GlyphMap> {
  const key = `${src.id}:${srcIndex}:${cropBox.join(",")}`;
  let p = cache.get(key);
  if (!p) {
    p = getSourceDoc(src)
      .then((pdf) => extractRawItems(pdf, srcIndex, { cropBox, rotation: 0 }))
      .then(buildGlyphMap);
    cache.set(key, p);
    p.catch(() => cache.delete(key));
  }
  return p;
}

export function pruneTextCache(keepSourceIds: string[]) {
  for (const k of cache.keys()) if (!keepSourceIds.some((id) => k.startsWith(`${id}:`))) cache.delete(k);
}
