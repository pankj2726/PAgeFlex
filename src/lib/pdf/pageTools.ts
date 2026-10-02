/** Page-level operations on whole documents (worker-safe): crop, resize, watermark, numbering/header/footer/Bates, metadata. */
import { PDFDict, PDFDocument, PDFName, StandardFonts, degrees, rgb, type PDFPage } from "@cantoo/pdf-lib";
import { canvasToPdf, displaySize, normRot, type PageGeo } from "../model/coords";
import { hexToRgb01 } from "../model/objects";
import { dataUrlToBytes, loadForEdit, safeText } from "./export";
import { gcDocument } from "./gc";
import type { Metadata, Progress } from "./types";

const finish = async (doc: PDFDocument) => {
  gcDocument(doc);
  return doc.save({ useObjectStreams: true });
};

const geoOf = (page: PDFPage): PageGeo => {
  const c = page.getCropBox();
  return { cropBox: [c.x, c.y, c.x + c.width, c.y + c.height], rotation: page.getRotation().angle };
};

const selectPages = (doc: PDFDocument, pages?: number[]) => {
  const all = doc.getPages();
  return (pages ?? all.map((_, i) => i)).filter((i) => i >= 0 && i < all.length).map((i) => ({ i, page: all[i] }));
};

// ---------- crop ----------
export interface CropOptions {
  pages?: number[];
  /** margins to remove, in points, as they appear on screen */
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export async function cropPages(bytes: Uint8Array, password: string | undefined, o: CropOptions): Promise<Uint8Array> {
  const doc = await loadForEdit(bytes, password);
  for (const { page } of selectPages(doc, o.pages)) {
    const c = page.getCropBox();
    const V = [o.top, o.right, o.bottom, o.left]; // visual
    const k = normRot(page.getRotation().angle) / 90;
    const P = [0, 1, 2, 3].map((i) => V[(i + k) % 4]); // pdf sides: top,right,bottom,left
    const x0 = c.x + P[3];
    const y0 = c.y + P[2];
    const w = c.width - P[3] - P[1];
    const h = c.height - P[0] - P[2];
    if (w < 10 || h < 10) throw new Error("Those margins would leave almost nothing of the page.");
    page.setCropBox(x0, y0, w, h);
  }
  return finish(doc);
}

// ---------- resize ----------
export interface ResizeOptions {
  pages?: number[];
  width: number; // pt, as displayed
  height: number;
}

export async function resizePages(bytes: Uint8Array, password: string | undefined, o: ResizeOptions): Promise<Uint8Array> {
  const doc = await loadForEdit(bytes, password);
  for (const { page } of selectPages(doc, o.pages)) {
    const swap = normRot(page.getRotation().angle) % 180 === 90;
    const tw = swap ? o.height : o.width;
    const th = swap ? o.width : o.height;
    const cb = page.getCropBox();
    page.translateContent(-cb.x, -cb.y);
    for (const k of ["TrimBox", "BleedBox", "ArtBox"]) page.node.delete(PDFName.of(k));
    const f = Math.min(tw / cb.width, th / cb.height);
    page.scaleContent(f, f);
    page.scaleAnnotations(f, f);
    page.translateContent((tw - cb.width * f) / 2, (th - cb.height * f) / 2);
    page.setMediaBox(0, 0, tw, th);
    page.setCropBox(0, 0, tw, th);
  }
  return finish(doc);
}

// ---------- watermark ----------
export interface WatermarkOptions {
  pages?: number[];
  text?: string;
  imageDataUrl?: string;
  opacity: number; // 0..1
  angle: number; // visual degrees counter-clockwise
  size: number; // text pt, or image width as % of page width
  color: string;
  tile: boolean;
}

export async function addWatermark(bytes: Uint8Array, password: string | undefined, o: WatermarkOptions, progress: Progress = () => undefined): Promise<Uint8Array> {
  const doc = await loadForEdit(bytes, password);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  let img: Awaited<ReturnType<PDFDocument["embedPng"]>> | null = null;
  if (o.imageDataUrl) {
    const { bytes: ib, mime } = dataUrlToBytes(o.imageDataUrl);
    img = mime === "image/png" ? await doc.embedPng(ib) : await doc.embedJpg(ib);
  }
  const text = safeText(o.text ?? "");
  const targets = selectPages(doc, o.pages);
  let n = 0;
  for (const { page } of targets) {
    const geo = geoOf(page);
    const R = normRot(geo.rotation);
    const disp = displaySize(geo, 1);
    const itemW = img ? (disp.w * o.size) / 100 : font.widthOfTextAtSize(text, o.size);
    const itemH = img ? (itemW * img.height) / img.width : o.size;
    const centers: { x: number; y: number }[] = [];
    if (o.tile) {
      const sx = itemW * 1.6 + 30;
      const sy = itemH * 3 + 30;
      for (let y = sy / 2; y < disp.h + sy; y += sy) for (let x = ((Math.round(y / sy) % 2) * sx) / 2; x < disp.w + sx; x += sx) centers.push({ x, y });
    } else centers.push({ x: disp.w / 2, y: disp.h / 2 });
    const pdfAngle = o.angle + R; // see coords: pdf angle = visual ccw angle + page /Rotate
    const t = (pdfAngle * Math.PI) / 180;
    for (const c of centers) {
      const p = canvasToPdf(geo, 1, c);
      // origin of the item = centre + Rot(t) · (local offset). Images anchor at their bottom-left corner,
      // text anchors at its baseline start (≈0.35em below the visual centre).
      const ox = -itemW / 2;
      const oy = img ? -itemH / 2 : -0.35 * o.size;
      const ax = p.x + ox * Math.cos(t) - oy * Math.sin(t);
      const ay = p.y + ox * Math.sin(t) + oy * Math.cos(t);
      if (img) page.drawImage(img, { x: ax, y: ay, width: itemW, height: itemH, rotate: degrees(pdfAngle), opacity: o.opacity });
      else {
        const [r, g, b] = hexToRgb01(o.color);
        page.drawText(text, { x: ax, y: ay, size: o.size, font, color: rgb(r, g, b), rotate: degrees(pdfAngle), opacity: o.opacity });
      }
    }
    progress(++n / targets.length, "Stamping pages");
  }
  return finish(doc);
}

// ---------- page numbers / header / footer / Bates ----------
export type Zone = "header-left" | "header-center" | "header-right" | "footer-left" | "footer-center" | "footer-right";
export interface StampOptions {
  pages?: number[];
  zones: Partial<Record<Zone, string>>; // templates: {n} {total} {bates}
  startNumber: number;
  size: number;
  color: string;
  margin: number;
  bates?: { prefix: string; start: number; digits: number; suffix: string };
}

export async function stampPages(bytes: Uint8Array, password: string | undefined, o: StampOptions, progress: Progress = () => undefined): Promise<Uint8Array> {
  const doc = await loadForEdit(bytes, password);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const all = doc.getPages();
  const targets = selectPages(doc, o.pages);
  const [r, g, b] = hexToRgb01(o.color);
  let k = 0;
  for (const { i, page } of targets) {
    const geo = geoOf(page);
    const R = normRot(geo.rotation);
    const disp = displaySize(geo, 1);
    const n = o.startNumber + k;
    const batesNum = o.bates ? `${o.bates.prefix}${String(o.bates.start + k).padStart(o.bates.digits, "0")}${o.bates.suffix}` : "";
    for (const [zone, tpl] of Object.entries(o.zones) as [Zone, string][]) {
      if (!tpl) continue;
      const text = safeText(tpl.replace(/\{n\}/g, String(n)).replace(/\{total\}/g, String(all.length)).replace(/\{bates\}/g, batesNum));
      if (!text) continue;
      const w = font.widthOfTextAtSize(text, o.size);
      const [vert, horiz] = zone.split("-");
      const x = horiz === "left" ? o.margin : horiz === "right" ? disp.w - o.margin - w : (disp.w - w) / 2;
      const y = vert === "header" ? o.margin + o.size : disp.h - o.margin;
      const p = canvasToPdf(geo, 1, { x, y });
      page.drawText(text, { x: p.x, y: p.y, size: o.size, font, color: rgb(r, g, b), rotate: degrees(R) });
    }
    k++;
    if (i % 10 === 0) progress(k / targets.length, "Adding text");
  }
  return finish(doc);
}

// ---------- metadata ----------
export async function setMetadata(bytes: Uint8Array, password: string | undefined, m: Metadata, clearAll = false): Promise<Uint8Array> {
  const doc = await loadForEdit(bytes, password);
  const info = (doc as unknown as { getInfoDict(): PDFDict }).getInfoDict();
  const keys: [keyof Metadata, string][] = [
    ["title", "Title"],
    ["author", "Author"],
    ["subject", "Subject"],
    ["keywords", "Keywords"],
    ["creator", "Creator"],
    ["producer", "Producer"],
  ];
  doc.catalog.delete(PDFName.of("Metadata")); // drop XMP so viewers show the Info values
  for (const [prop, key] of keys) {
    const v = clearAll ? "" : m[prop];
    if (v === undefined) continue;
    if (v === "") info.delete(PDFName.of(key));
    else {
      if (prop === "title") doc.setTitle(v);
      else if (prop === "author") doc.setAuthor(v);
      else if (prop === "subject") doc.setSubject(v);
      else if (prop === "keywords") doc.setKeywords(v.split(",").map((s) => s.trim()).filter(Boolean));
      else if (prop === "creator") doc.setCreator(v);
      else doc.setProducer(v);
    }
  }
  if (clearAll) {
    info.delete(PDFName.of("CreationDate"));
    info.delete(PDFName.of("ModDate"));
  } else doc.setModificationDate(new Date());
  return finish(doc);
}
