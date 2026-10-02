/**
 * Post-edit verification with auto-rollback support (Task 2 §2.2 D).
 * Re-extracts the text of every page that carries a text edit from the EXPORTED bytes (pdf.js, a second parser)
 * and checks: output text == original text − replaced text + new text. Pages that fail are reported so the caller can
 * re-export without those edits.
 */
import type { DocData } from "../model/commands";
import { unsupportedChars } from "../fonts/fontMap";
import { verifyEditedText } from "../text/verifyEdit";
import { extractPlainText, getSourceDoc, openPdfjs } from "./render";

export interface EditCheck {
  failedPageIds: string[];
  notes: string[];
  /** pages where the replaced original is still extractable under the cover (KL-EDIT-2) */
  hiddenOriginalPages: number[];
}

export async function verifyTextEdits(doc: DocData, bytes: Uint8Array): Promise<EditCheck> {
  const res: EditCheck = { failedPageIds: [], notes: [], hiddenOriginalPages: [] };
  const targets = doc.pages.map((p, i) => ({ p, i })).filter(({ p }) => p.sourceId && doc.objects.some((o) => o.pageId === p.id && o.type === "textedit" && o.text !== o.origText) && !doc.objects.some((o) => o.pageId === p.id && o.type === "redact"));
  if (!targets.length) return res;
  const out = await openPdfjs(bytes);
  try {
    for (const { p, i } of targets) {
      const src = await getSourceDoc(doc.sources[p.sourceId!]);
      const before = (await extractPlainText(src, [p.srcIndex]))[0];
      const after = (await extractPlainText(out, [i]))[0];
      const objs = doc.objects.filter((o) => o.pageId === p.id);
      const removed = objs.filter((o) => o.type === "textedit" && o.text !== o.origText).map((o) => o.origText ?? "");
      // text drawn as an image (glyphs the built-in fonts lack) is not extractable, so it is not expected in the output
      const added = objs.filter((o) => (o.type === "textedit" && o.text !== o.origText) || o.type === "text").filter((o) => !unsupportedChars(o.text ?? "").length).map((o) => o.text ?? "");
      const v = verifyEditedText(before, after, removed, added);
      if (!v.ok) {
        res.failedPageIds.push(p.id);
        res.notes.push(`Page ${i + 1}: text outside your edit changed${v.missing ? ` (lost “${v.missing.slice(0, 20)}”)` : ""}${v.extra ? ` (unexpected “${v.extra.slice(0, 20)}”)` : ""}. Those edits were rolled back.`);
      } else if (v.hiddenOriginalsPresent) res.hiddenOriginalPages.push(i + 1);
    }
  } finally {
    out.destroy().catch(() => undefined);
  }
  if (res.hiddenOriginalPages.length) res.notes.push(`Pages ${res.hiddenOriginalPages.join(", ")}: the replaced original words are covered, not deleted, and can still be extracted. Use Redact to remove text permanently.`);
  return res;
}
