/** Image → PDF and OCR text-layer writing (worker-safe). */
import { PDFDocument, StandardFonts, degrees } from "@cantoo/pdf-lib";
import { canvasToPdf, normRot, type Box } from "../model/coords";
import { gcDocument } from "./gc";
import { loadForEdit, safeText } from "./export";
import type { Progress } from "./types";

export interface ImageInput {
  name: string;
  bytes: Uint8Array;
  mime: string;
}

export interface ImagesToPdfOptions {
  pageSize: "fit" | "a4" | "letter";
  margin: number; // pt
  orientation: "auto" | "portrait" | "landscape";
}

const SIZES = { a4: [595.28, 841.89], letter: [612, 792] } as const;

function exifOrientation(b: Uint8Array): number {
  if (b[0] !== 0xff || b[1] !== 0xd8) return 1;
  let off = 2;
  while (off + 4 < b.length) {
    if (b[off] !== 0xff) break;
    const marker = b[off + 1];
    const len = (b[off + 2] << 8) | b[off + 3];
    if (marker === 0xe1 && b[off + 4] === 0x45 && b[off + 5] === 0x78) {
      const t = off + 10;
      const le = b[t] === 0x49;
      const u16 = (p: number) => (le ? b[p] | (b[p + 1] << 8) : (b[p] << 8) | b[p + 1]);
      const u32 = (p: number) => (le ? (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0 : ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0);
      const ifd = t + u32(t + 4);
      const n = u16(ifd);
      for (let i = 0; i < n; i++) {
        const e = ifd + 2 + i * 12;
        if (u16(e) === 0x0112) return u16(e + 8);
      }
      return 1;
    }
    off += 2 + len;
  }
  return 1;
}

async function viaCanvas(bytes: Uint8Array, mime: string, asJpeg: boolean): Promise<{ bytes: Uint8Array; mime: string }> {
  const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type: mime }));
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const c = canvas.getContext("2d")!;
  if (asJpeg) {
    c.fillStyle = "#fff";
    c.fillRect(0, 0, bmp.width, bmp.height);
  }
  c.drawImage(bmp, 0, 0);
  bmp.close();
  const blob = await canvas.convertToBlob(asJpeg ? { type: "image/jpeg", quality: 0.92 } : { type: "image/png" });
  return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: asJpeg ? "image/jpeg" : "image/png" };
}

export async function imagesToPdf(images: ImageInput[], o: ImagesToPdfOptions, progress: Progress = () => undefined): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < images.length; i++) {
    progress(i / images.length, `Adding ${images[i].name}`);
    let { bytes, mime } = images[i];
    const isJpeg = mime === "image/jpeg";
    const isPng = mime === "image/png";
    if (isJpeg && exifOrientation(bytes) !== 1) ({ bytes, mime } = await viaCanvas(bytes, mime, true));
    else if (!isJpeg && !isPng) ({ bytes, mime } = await viaCanvas(bytes, mime, false));
    const img = mime === "image/png" ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    let pw: number;
    let ph: number;
    if (o.pageSize === "fit") {
      pw = img.width * 0.75 + o.margin * 2;
      ph = img.height * 0.75 + o.margin * 2;
    } else {
      [pw, ph] = SIZES[o.pageSize];
      const landscape = o.orientation === "landscape" || (o.orientation === "auto" && img.width > img.height);
      if (landscape) [pw, ph] = [ph, pw];
    }
    const page = doc.addPage([pw, ph]);
    const aw = pw - o.margin * 2;
    const ah = ph - o.margin * 2;
    const f = Math.min(aw / img.width, ah / img.height);
    const w = img.width * f;
    const h = img.height * f;
    page.drawImage(img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
  }
  doc.setProducer("PageFlex");
  progress(0.95, "Saving");
  return doc.save({ useObjectStreams: true });
}

export interface OcrWord {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
export interface OcrPage {
  pageIndex: number;
  /** pixels per PDF point of the rendered image the words refer to */
  scale: number;
  words: OcrWord[];
}

/** Add an invisible (opacity 0) text layer so the scanned page becomes searchable/selectable. */
export async function addTextLayer(bytes: Uint8Array, password: string | undefined, pages: OcrPage[], progress: Progress = () => undefined): Promise<Uint8Array> {
  const doc = await loadForEdit(bytes, password);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const all = doc.getPages();
  for (let n = 0; n < pages.length; n++) {
    const pg = pages[n];
    const page = all[pg.pageIndex];
    if (!page) continue;
    const c = page.getCropBox();
    const cropBox: Box = [c.x, c.y, c.x + c.width, c.y + c.height];
    const R = normRot(page.getRotation().angle);
    const geo = { cropBox, rotation: R };
    for (const w of pg.words) {
      const text = safeText(w.text);
      if (!text.trim()) continue;
      const wPt = (w.x1 - w.x0) / pg.scale;
      const hPt = (w.y1 - w.y0) / pg.scale;
      const base = font.widthOfTextAtSize(text, 1) || 1;
      const size = Math.min(Math.max(wPt / base, 2), Math.max(hPt * 3, 4));
      const p = canvasToPdf(geo, 1, { x: w.x0 / pg.scale, y: w.y1 / pg.scale - hPt * 0.2 });
      page.drawText(text, { x: p.x, y: p.y, size, font, opacity: 0, rotate: degrees(R) });
    }
    progress((n + 1) / pages.length, "Writing text layer");
  }
  gcDocument(doc);
  return doc.save({ useObjectStreams: true });
}
