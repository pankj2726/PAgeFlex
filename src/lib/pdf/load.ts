import type { Box } from "../model/coords";
import type { DocData, PageModel, SourceDoc } from "../model/commands";
import { uid } from "../model/objects";
import { openPdfjs, registerSourceDoc, type PdfDoc } from "./render";

export type PdfErrorCode = "NotPdf" | "Corrupt" | "PasswordRequired" | "WrongPassword" | "TooLarge";

export class PdfError extends Error {
  code: PdfErrorCode;
  constructor(code: PdfErrorCode, message: string) {
    super(message);
    this.name = "PdfError";
    this.code = code;
  }
}

export const WARN_BYTES = 50 * 1024 * 1024;
export const MAX_BYTES = 400 * 1024 * 1024;

/** `%PDF-` must appear within the first 1024 bytes (PDF spec allows leading junk). */
export function hasPdfMagic(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length - 4, 1024);
  for (let i = 0; i < limit; i++) {
    if (bytes[i] === 0x25 && bytes[i + 1] === 0x50 && bytes[i + 2] === 0x44 && bytes[i + 3] === 0x46 && bytes[i + 4] === 0x2d) return true;
  }
  return false;
}

export interface PageGeometry {
  srcIndex: number;
  cropBox: Box;
  rotation: number;
}

export interface DocHandle {
  pageCount: number;
  metadata: { title?: string; author?: string; subject?: string; keywords?: string; creator?: string; producer?: string };
  pages: PageGeometry[];
  pdfjs: PdfDoc;
}

/** loadPdf(bytes, password?) → DocHandle. Throws PdfError with a typed code. */
export async function loadPdf(bytes: Uint8Array, password?: string): Promise<DocHandle> {
  if (bytes.length > MAX_BYTES) throw new PdfError("TooLarge", "This file is larger than the 400 MB browser limit.");
  if (bytes.length < 8 || !hasPdfMagic(bytes)) throw new PdfError("NotPdf", "This file isn't a PDF (missing %PDF- header).");
  let doc: PdfDoc;
  try {
    doc = await openPdfjs(bytes, password);
  } catch (e) {
    throw mapError(e, password);
  }
  try {
    const pages: PageGeometry[] = [];
    for (let start = 0; start < doc.numPages; start += 40) {
      const batch = await Promise.all(
        Array.from({ length: Math.min(40, doc.numPages - start) }, async (_, k) => {
          const p = await doc.getPage(start + k + 1);
          const v = p.view as number[];
          return { srcIndex: start + k, cropBox: [v[0], v[1], v[2], v[3]] as Box, rotation: ((p.rotate % 360) + 360) % 360 };
        })
      );
      pages.push(...batch);
    }
    const meta = await doc.getMetadata().catch(() => null);
    const info = (meta?.info ?? {}) as Record<string, string>;
    return {
      pageCount: doc.numPages,
      metadata: {
        title: info.Title,
        author: info.Author,
        subject: info.Subject,
        keywords: info.Keywords,
        creator: info.Creator,
        producer: info.Producer,
      },
      pages,
      pdfjs: doc,
    };
  } catch (e) {
    doc.destroy().catch(() => undefined);
    throw mapError(e, password);
  }
}

function mapError(e: unknown, password?: string): PdfError {
  const err = e as { name?: string; code?: number; message?: string };
  if (err?.name === "PasswordException") {
    return err.code === 2 || password ? new PdfError("WrongPassword", "That password is incorrect.") : new PdfError("PasswordRequired", "This PDF is password protected.");
  }
  if (err instanceof RangeError || /allocation|memory/i.test(err?.message ?? "")) {
    return new PdfError("TooLarge", "Your device ran out of memory opening this file.");
  }
  return new PdfError("Corrupt", "This PDF appears to be damaged or truncated and can't be opened.");
}

/** Build a fresh DocData from raw bytes (used for open, merge results, baked operations…). */
export async function buildDocData(bytes: Uint8Array, name: string, password?: string): Promise<{ doc: DocData; handle: DocHandle }> {
  const handle = await loadPdf(bytes, password);
  const source: SourceDoc = { id: uid("s"), name, bytes, password };
  registerSourceDoc(source.id, handle.pdfjs);
  const pages: PageModel[] = handle.pages.map((g) => ({
    id: uid("p"),
    sourceId: source.id,
    srcIndex: g.srcIndex,
    rotation: g.rotation,
    cropBox: g.cropBox,
  }));
  return { doc: { sources: { [source.id]: source }, primaryId: source.id, pages, objects: [] }, handle };
}
