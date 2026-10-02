import { PDFDocument } from "@cantoo/pdf-lib";
import { gcDocument } from "./gc";
import { loadForEdit } from "./export";
import type { Progress } from "./types";

export interface PdfInput {
  name: string;
  bytes: Uint8Array;
  password?: string;
}

/** Merge files in the given order. Form fields/outlines of the inputs are not carried over (see KL-FORM). */
export async function mergePdfs(inputs: PdfInput[], progress: Progress = () => undefined): Promise<{ bytes: Uint8Array; pageCount: number }> {
  const out = await PDFDocument.create();
  let total = 0;
  for (let i = 0; i < inputs.length; i++) {
    progress(i / inputs.length, `Merging ${inputs[i].name}`);
    const src = await loadForEdit(inputs[i].bytes, inputs[i].password);
    const pages = await out.copyPages(src, src.getPageIndices());
    for (const p of pages) out.addPage(p);
    total += pages.length;
  }
  gcDocument(out);
  progress(0.95, "Saving");
  const bytes = await out.save({ useObjectStreams: true });
  progress(1);
  return { bytes, pageCount: total };
}
