import { PDFArray, PDFDict, PDFRef, PDFStream, type PDFDocument } from "@cantoo/pdf-lib";

/**
 * Drop every indirect object that is not reachable from the trailer (Root / Info).
 * pdf-lib never garbage-collects: pages removed from the tree, or page content replaced during redaction,
 * would otherwise still be written to the output file. Returns how many objects were dropped.
 */
export function gcDocument(doc: PDFDocument): number {
  const ctx = doc.context;
  const seen = new Set<string>();
  const stack: unknown[] = [ctx.trailerInfo.Root, ctx.trailerInfo.Info];
  while (stack.length) {
    const o = stack.pop();
    if (!o) continue;
    if (o instanceof PDFRef) {
      if (seen.has(o.tag)) continue;
      seen.add(o.tag);
      stack.push(ctx.lookup(o));
    } else if (o instanceof PDFDict) {
      for (const [, v] of o.entries()) stack.push(v);
    } else if (o instanceof PDFArray) {
      for (let i = 0; i < o.size(); i++) stack.push(o.get(i));
    } else if (o instanceof PDFStream) {
      stack.push(o.dict);
    }
  }
  let dropped = 0;
  for (const [ref] of ctx.enumerateIndirectObjects()) {
    if (!seen.has(ref.tag)) {
      ctx.delete(ref);
      dropped++;
    }
  }
  return dropped;
}
