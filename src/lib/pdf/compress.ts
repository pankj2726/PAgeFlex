/** Compression presets (worker-safe: uses createImageBitmap + OffscreenCanvas which exist in workers). */
import { PDFArray, PDFBool, PDFName, PDFNumber, PDFRawStream } from "@cantoo/pdf-lib";
import { gcDocument } from "./gc";
import { loadForEdit } from "./export";
import type { Progress } from "./types";

export type CompressPreset = "light" | "balanced" | "strong";

const PRESETS: Record<CompressPreset, { maxDim: number; quality: number; recompress: boolean }> = {
  light: { maxDim: 0, quality: 0, recompress: false },
  balanced: { maxDim: 1800, quality: 0.72, recompress: true },
  strong: { maxDim: 1100, quality: 0.5, recompress: true },
};

export interface CompressResult {
  bytes: Uint8Array;
  imagesRecompressed: number;
  originalSize: number;
  newSize: number;
  /** false when the result was not smaller and the original bytes were returned */
  smaller: boolean;
}

export async function compressPdf(bytes: Uint8Array, password: string | undefined, preset: CompressPreset, progress: Progress = () => undefined): Promise<CompressResult> {
  const cfg = PRESETS[preset];
  const doc = await loadForEdit(bytes, password);
  const ctx = doc.context;
  let count = 0;

  if (cfg.recompress && typeof OffscreenCanvas !== "undefined") {
    const entries = ctx.enumerateIndirectObjects();
    for (let n = 0; n < entries.length; n++) {
      const [ref, obj] = entries[n];
      if (!(obj instanceof PDFRawStream)) continue;
      const d = obj.dict;
      if (d.lookup(PDFName.of("Subtype"))?.toString() !== "/Image") continue;
      const filter = d.lookup(PDFName.of("Filter"));
      const filters = filter instanceof PDFArray ? filter.asArray().map((f) => f.toString()) : [filter?.toString()];
      if (filters.length !== 1 || filters[0] !== "/DCTDecode") continue;
      const maskFlag = d.lookup(PDFName.of("ImageMask"));
      if (maskFlag instanceof PDFBool && maskFlag.asBoolean()) continue;
      const w = d.lookup(PDFName.of("Width"));
      const h = d.lookup(PDFName.of("Height"));
      if (!(w instanceof PDFNumber) || !(h instanceof PDFNumber)) continue;
      try {
        const bmp = await createImageBitmap(new Blob([obj.contents as BlobPart], { type: "image/jpeg" }));
        const scale = Math.min(1, cfg.maxDim / Math.max(bmp.width, bmp.height));
        const nw = Math.max(1, Math.round(bmp.width * scale));
        const nh = Math.max(1, Math.round(bmp.height * scale));
        const canvas = new OffscreenCanvas(nw, nh);
        const c2d = canvas.getContext("2d")!;
        c2d.fillStyle = "#fff";
        c2d.fillRect(0, 0, nw, nh);
        c2d.drawImage(bmp, 0, 0, nw, nh);
        bmp.close();
        const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: cfg.quality });
        const out = new Uint8Array(await blob.arrayBuffer());
        if (out.length < obj.contents.length * 0.92) {
          const dict = ctx.obj({
            Type: "XObject",
            Subtype: "Image",
            Width: nw,
            Height: nh,
            ColorSpace: "DeviceRGB",
            BitsPerComponent: 8,
            Filter: "DCTDecode",
            Length: out.length,
          });
          const smask = d.get(PDFName.of("SMask"));
          if (smask) dict.set(PDFName.of("SMask"), smask);
          ctx.assign(ref, PDFRawStream.of(dict, out));
          count++;
        }
      } catch {
        /* undecodable image: leave untouched */
      }
      if (n % 5 === 0) progress(0.1 + 0.7 * (n / entries.length), "Recompressing images");
    }
  }

  // metadata strip + object cleanup (all presets)
  doc.catalog.delete(PDFName.of("Metadata"));
  const info = (doc as unknown as { getInfoDict(): { delete(k: PDFName): void } }).getInfoDict();
  for (const k of ["Author", "Creator", "Producer", "Subject", "Keywords"]) info.delete(PDFName.of(k));
  gcDocument(doc);
  progress(0.9, "Saving");
  const out = await doc.save({ useObjectStreams: true });
  progress(1);
  const smaller = out.length < bytes.length;
  return { bytes: smaller ? out : bytes, imagesRecompressed: count, originalSize: bytes.length, newSize: smaller ? out.length : bytes.length, smaller };
}
