import { PDFDocument } from "@cantoo/pdf-lib";
import { gcDocument } from "./gc";
import { loadForEdit } from "./export";
import type { Progress } from "./types";

export interface SplitResult {
  label: string;
  pages: number[];
  bytes: Uint8Array;
}

/** Create one output PDF per group of 0-based page indexes. */
export async function splitPdf(
  bytes: Uint8Array,
  password: string | undefined,
  groups: number[][],
  progress: Progress = () => undefined
): Promise<SplitResult[]> {
  const src = await loadForEdit(bytes, password);
  const results: SplitResult[] = [];
  for (let g = 0; g < groups.length; g++) {
    progress(g / groups.length, `Writing part ${g + 1} of ${groups.length}`);
    const out = await PDFDocument.create();
    const pages = await out.copyPages(src, groups[g]);
    pages.forEach((p) => out.addPage(p));
    gcDocument(out);
    const first = groups[g][0] + 1;
    const last = groups[g][groups[g].length - 1] + 1;
    results.push({ label: first === last ? `page-${first}` : `pages-${first}-${last}`, pages: groups[g], bytes: await out.save({ useObjectStreams: true }) });
  }
  progress(1);
  return results;
}
