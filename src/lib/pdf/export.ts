/**
 * exportPdf pipeline (worker-safe: no DOM). Fixed order: page ops → redaction → objects → forms → GC → save.
 * Security (encryption) is applied afterwards by protect.ts so that it is always last.
 */
import {
  BlendMode,
  LineCapStyle,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFPage,
  degrees,
  rgb,
  type PDFFont,
  type PDFImage,
} from "@cantoo/pdf-lib";
import { pageToPdf, rotateAbout, type PageGeo, type Pt } from "../model/coords";
import { CONTENT_BEARING, boxesIntersect, hexToRgb01, wrapText, type PdfObject } from "../model/objects";
import { isWinAnsi, standardFontName } from "../fonts/fontMap";
import { gcDocument } from "./gc";
import type { ExportPayload, KeepRun, Progress, Raster } from "./types";

const col = (hex: string) => {
  const [r, g, b] = hexToRgb01(hex);
  return rgb(r, g, b);
};

export function dataUrlToBytes(url: string): { bytes: Uint8Array; mime: string } {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(url);
  if (!m) throw new Error("Bad image data");
  const bin = m[2] ? atob(m[3]) : decodeURIComponent(m[3]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, mime: m[1] };
}

export function safeText(s: string): string {
  let out = "";
  for (const ch of s.replace(/\t/g, "    ")) out += isWinAnsi(ch) && ch !== "\n" && ch !== "\r" ? ch : ch === "\n" ? "" : "?";
  return out;
}

export async function loadForEdit(bytes: Uint8Array, password?: string): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(bytes, { password: password ?? "", updateMetadata: false });
  } catch (e) {
    if (password === undefined) {
      // some owner-password-only files need an explicit empty password; others are damaged: retry leniently
      return PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false, throwOnInvalidObject: false });
    }
    throw e;
  }
}

export interface ExportReport {
  bytes: Uint8Array;
  /** Plain-language list of objects that were skipped. The PDF is still produced (Task 1.3). */
  warnings: string[];
}

export async function exportDocumentWithReport(p: ExportPayload, progress: Progress = () => undefined): Promise<ExportReport> {
  const srcById = new Map(p.sources.map((s) => [s.id, s]));
  const primarySrc = srcById.get(p.primaryId);
  if (!primarySrc) throw new Error("Primary source missing");
  progress(0.02, "Opening document");
  const doc = await loadForEdit(primarySrc.bytes, primarySrc.password);
  const others = new Map<string, PDFDocument>();
  const getOther = async (id: string) => {
    let d = others.get(id);
    if (!d) {
      const s = srcById.get(id)!;
      d = await loadForEdit(s.bytes, s.password);
      others.set(id, d);
    }
    return d;
  };

  // ---- 1. page operations ----
  const original = doc.getPages();
  const used = new Set<string>();
  const batches = new Map<string, number[]>();
  for (const pg of p.pages) {
    if (pg.sourceId && pg.sourceId !== p.primaryId) {
      const arr = batches.get(pg.sourceId) ?? [];
      if (!arr.includes(pg.srcIndex)) arr.push(pg.srcIndex);
      batches.set(pg.sourceId, arr);
    }
  }
  const copied = new Map<string, PDFPage>(); // "src:idx" -> first copy
  for (const [sid, idxs] of batches) {
    const sd = await getOther(sid);
    const res = await doc.copyPages(sd, idxs);
    idxs.forEach((ix, k) => copied.set(`${sid}:${ix}`, res[k]));
  }
  const ordered: PDFPage[] = [];
  for (let i = 0; i < p.pages.length; i++) {
    const pg = p.pages[i];
    const key = `${pg.sourceId}:${pg.srcIndex}`;
    let page: PDFPage;
    if (pg.sourceId === null) {
      const w = Math.abs(pg.cropBox[2] - pg.cropBox[0]);
      const h = Math.abs(pg.cropBox[3] - pg.cropBox[1]);
      page = doc.addPage([w, h]);
    } else if (pg.sourceId === p.primaryId) {
      if (!used.has(key)) {
        page = original[pg.srcIndex];
        used.add(key);
      } else {
        [page] = await doc.copyPages(doc, [pg.srcIndex]);
      }
    } else if (!used.has(key)) {
      page = copied.get(key)!;
      used.add(key);
    } else {
      const sd = await getOther(pg.sourceId);
      [page] = await doc.copyPages(sd, [pg.srcIndex]);
    }
    ordered.push(page);
    if (i % 25 === 0) progress(0.05 + 0.2 * (i / p.pages.length), "Arranging pages");
  }
  // NOTE: in @cantoo/pdf-lib `removePage()` also DELETES the page object from the context (not just from the
  // page tree). Re-adding such a page would leave a dangling reference and a broken PDF, so each page object is
  // re-registered under its original ref before being re-inserted in the new order. Pages the user deleted
  // are not re-added and therefore stay deleted.
  for (let i = doc.getPageCount() - 1; i >= 0; i--) doc.removePage(i);
  for (const page of ordered) {
    doc.context.assign(page.ref, page.node);
    doc.addPage(page);
  }

  // ---- 2..4. per page: geometry, redaction, objects ----
  const fonts = new Map<string, PDFFont>();
  const getFont = async (name: string) => {
    let f = fonts.get(name);
    if (!f) {
      f = await doc.embedFont(name);
      fonts.set(name, f);
    }
    return f;
  };
  const form = { current: null as ReturnType<PDFDocument["getForm"]> | null };
  const radios = new Map<string, ReturnType<NonNullable<typeof form.current>["createRadioGroup"]>>();
  const usedFieldNames = new Set<string>();
  const warnings: string[] = [];

  for (let i = 0; i < p.pages.length; i++) {
    const model = p.pages[i];
    const page = ordered[i];
    const geo: PageGeo = { cropBox: model.cropBox, rotation: 0 };
    page.setRotation(degrees(model.rotation));
    const cb = page.getCropBox();
    const [x0, y0, x1, y1] = [Math.min(model.cropBox[0], model.cropBox[2]), Math.min(model.cropBox[1], model.cropBox[3]), Math.max(model.cropBox[0], model.cropBox[2]), Math.max(model.cropBox[1], model.cropBox[3])];
    if (Math.abs(cb.x - x0) > 0.01 || Math.abs(cb.y - y0) > 0.01 || Math.abs(cb.width - (x1 - x0)) > 0.01 || Math.abs(cb.height - (y1 - y0)) > 0.01) {
      page.setCropBox(x0, y0, x1 - x0, y1 - y0);
    }

    const objs = p.objects.filter((o) => o.pageId === model.id);
    const redactObjs = objs.filter((o) => o.type === "redact");
    if (redactObjs.some((r) => invalidReason(r))) {
      // Never skip a redaction silently: that would leave sensitive text visible.
      throw new Error(`A redaction box on page ${i + 1} has invalid coordinates, so nothing was exported.`);
    }
    const red = p.redactions[model.id];
    if (red && redactObjs.length) await applyRedaction(doc, page, geo, red.raster, red.keepRuns, getFont);

    const drawable = objs.filter((o) => o.type !== "redact").filter((o) => !(redactObjs.length && CONTENT_BEARING.includes(o.type) && redactObjs.some((r) => boxesIntersect(o, r))));
    for (const o of drawable) {
      const bad = invalidReason(o);
      if (bad) {
        warnings.push(`Skipped ${describeObject(o)} on page ${i + 1}: ${bad}.`);
        continue;
      }
      try {
        await drawObject(doc, page, geo, o, p.rasters[o.id], getFont, form, radios, usedFieldNames);
      } catch (e) {
        warnings.push(`Skipped ${describeObject(o)} on page ${i + 1}: ${(e as Error).message || "it could not be drawn"}.`);
      }
    }
    for (const r of redactObjs) {
      const tl = geoRect(geo, r);
      page.drawRectangle({ x: tl.x, y: tl.y, width: r.w, height: r.h, color: rgb(0, 0, 0), rotate: degrees(-r.rotation) });
    }
    if (i % 10 === 0) progress(0.3 + 0.55 * (i / p.pages.length), "Drawing edits");
  }
  if (warnings.length) console.warn("[export]", warnings);

  progress(0.9, "Cleaning up");
  gcDocument(doc);
  progress(0.95, "Saving");
  const out = await doc.save({ useObjectStreams: true });
  progress(1, "Done");
  return { bytes: out, warnings };
}

/** Bytes-only convenience wrapper (used by tests and tools that do not surface warnings). */
export async function exportDocument(p: ExportPayload, progress: Progress = () => undefined): Promise<Uint8Array> {
  return (await exportDocumentWithReport(p, progress)).bytes;
}

/** Why an object cannot be drawn safely (NaN/Infinity would write "NaN" into the content stream and corrupt the page). */
export function invalidReason(o: PdfObject): string | null {
  for (const k of ["x", "y", "w", "h", "rotation", "opacity", "strokeWidth"] as const) {
    if (!Number.isFinite(o[k])) return `${k} is not a finite number`;
  }
  if (o.w < 0 || o.h < 0) return "it has a negative size";
  if (o.opacity < 0 || o.opacity > 1) return "opacity is outside 0–1";
  if (o.fontSize !== undefined && !(Number.isFinite(o.fontSize) && o.fontSize > 0)) return "its font size is invalid";
  if (o.pts?.some((q) => !Number.isFinite(q.x) || !Number.isFinite(q.y))) return "a point has invalid coordinates";
  if (o.covers?.some((c) => ![c.x, c.y, c.w, c.h].every(Number.isFinite))) return "a cover rectangle is invalid";
  return null;
}

function describeObject(o: PdfObject): string {
  const t = o.text ? ` “${o.text.slice(0, 24)}${o.text.length > 24 ? "…" : ""}”` : "";
  return `${o.type}${t} (${o.id})`;
}

// ---------- helpers ----------
/** Page-space point of a box-local offset (lx,ly measured from the box's top-left, y down), honouring object rotation. */
function pagePt(o: PdfObject, lx: number, ly: number): Pt {
  const c = { x: o.x + o.w / 2, y: o.y + o.h / 2 };
  return rotateAbout({ x: o.x + lx, y: o.y + ly }, c, o.rotation);
}
const pdfPt = (geo: PageGeo, o: PdfObject, lx: number, ly: number): Pt => pageToPdf(geo, pagePt(o, lx, ly));

/** PDF-space bottom-left corner of the (rotated) box: the origin pdf-lib rotates about. */
function geoRect(geo: PageGeo, o: PdfObject): Pt {
  return pdfPt(geo, o, 0, o.h);
}

async function applyRedaction(
  doc: PDFDocument,
  page: PDFPage,
  geo: PageGeo,
  raster: Raster,
  keep: KeepRun[],
  getFont: (n: string) => Promise<PDFFont>
) {
  const ctx = doc.context;
  const node = page.node;
  // Replace content & resources in place: old streams/fonts/images become unreachable and are dropped by GC.
  node.set(PDFName.of("Contents"), ctx.obj([]));
  node.set(PDFName.of("Resources"), ctx.obj({}));
  for (const k of ["Annots", "Thumb", "Metadata", "PieceInfo", "AA", "B", "StructParents"]) node.delete(PDFName.of(k));
  const img: PDFImage = raster.mime === "image/png" ? await doc.embedPng(raster.bytes) : await doc.embedJpg(raster.bytes);
  const x0 = Math.min(geo.cropBox[0], geo.cropBox[2]);
  const y0 = Math.min(geo.cropBox[1], geo.cropBox[3]);
  const W = Math.abs(geo.cropBox[2] - geo.cropBox[0]);
  const H = Math.abs(geo.cropBox[3] - geo.cropBox[1]);
  page.drawImage(img, { x: x0, y: y0, width: W, height: H });
  // Keep the page searchable: invisible text only for runs that do NOT intersect a redaction.
  const font = await getFont("Helvetica");
  for (const r of keep) {
    const s = safeText(r.str);
    if (!s.trim()) continue;
    const pt = pageToPdf(geo, { x: r.x, y: r.baseline });
    page.drawText(s, { x: pt.x, y: pt.y, size: Math.max(1, r.size), font, opacity: 0 });
  }
}

async function drawObject(
  doc: PDFDocument,
  page: PDFPage,
  geo: PageGeo,
  o: PdfObject,
  raster: Raster | undefined,
  getFont: (n: string) => Promise<PDFFont>,
  form: { current: ReturnType<PDFDocument["getForm"]> | null },
  radios: Map<string, ReturnType<ReturnType<PDFDocument["getForm"]>["createRadioGroup"]>>,
  usedNames: Set<string>
) {
  const rot = degrees(-o.rotation);
  const opacity = o.opacity;
  switch (o.type) {
    case "text":
    case "textedit": {
      if (o.type === "textedit" && o.text === o.origText) return; // unchanged run: leave the original untouched
      if (o.type === "textedit") {
        // Cover ONLY the exact target glyphs (Task 2): `covers` is computed per line by lib/text/glyphMap.ts and is
        // already clipped away from neighbouring text. Fall back to the object box for objects created before covers existed.
        const rects = o.covers?.length ? o.covers : [{ x: o.x - 1, y: o.y - 1, w: o.w + 2, h: o.h + 2 }];
        for (const c of rects) {
          const bl = pageToPdf(geo, { x: c.x, y: c.y + c.h });
          page.drawRectangle({ x: bl.x, y: bl.y, width: c.w, height: c.h, color: col(o.bg ?? "#ffffff") });
        }
      }
      if (raster) {
        await drawRaster(doc, page, geo, o, raster);
        return;
      }
      const font = await getFont(standardFontName(o.family, o.bold, o.italic));
      const size = o.fontSize ?? 12;
      const lh = size * 1.2;
      const text = o.text ?? "";
      const lines = o.type === "text" ? wrapText(text, Math.max(10, o.w - 4), (s) => font.widthOfTextAtSize(safeText(s), size)) : text.split(/\r?\n/);
      const firstBase = o.type === "textedit" ? (o.baseline ?? size * 0.9) : 2 + size * 0.88;
      lines.forEach((ln, k) => {
        const s = safeText(ln);
        if (!s) return;
        const width = font.widthOfTextAtSize(s, size);
        const dx = o.type === "text" && o.align === "center" ? (o.w - width) / 2 : o.type === "text" && o.align === "right" ? o.w - width - 2 : o.type === "text" ? 2 : 0;
        const pt = pdfPt(geo, o, dx, firstBase + k * lh);
        page.drawText(s, { x: pt.x, y: pt.y, size, font, color: col(o.color), rotate: rot, opacity });
      });
      return;
    }
    case "highlight": {
      const bl = geoRect(geo, o);
      page.drawRectangle({ x: bl.x, y: bl.y, width: o.w, height: o.h, color: col(o.fill ?? o.color), opacity, blendMode: BlendMode.Multiply, rotate: rot });
      return;
    }
    case "underline":
    case "strike": {
      const ly = o.type === "underline" ? o.h - o.strokeWidth : o.h / 2;
      const a = pdfPt(geo, o, 0, ly);
      const b = pdfPt(geo, o, o.w, ly);
      page.drawLine({ start: a, end: b, thickness: o.strokeWidth, color: col(o.color), opacity, lineCap: LineCapStyle.Butt });
      return;
    }
    case "whiteout": {
      const bl = geoRect(geo, o);
      page.drawRectangle({ x: bl.x, y: bl.y, width: o.w, height: o.h, color: col(o.fill ?? "#ffffff"), opacity, rotate: rot });
      return;
    }
    case "rect": {
      const bl = geoRect(geo, o);
      page.drawRectangle({
        x: bl.x,
        y: bl.y,
        width: o.w,
        height: o.h,
        rotate: rot,
        borderColor: o.strokeWidth > 0 ? col(o.color) : undefined,
        borderWidth: o.strokeWidth,
        color: o.fill ? col(o.fill) : undefined,
        opacity: o.fill ? opacity : undefined,
        borderOpacity: opacity,
      });
      return;
    }
    case "ellipse": {
      const c = pdfPt(geo, o, o.w / 2, o.h / 2);
      page.drawEllipse({
        x: c.x,
        y: c.y,
        xScale: Math.max(0.5, o.w / 2),
        yScale: Math.max(0.5, o.h / 2),
        rotate: rot,
        borderColor: o.strokeWidth > 0 ? col(o.color) : undefined,
        borderWidth: o.strokeWidth,
        color: o.fill ? col(o.fill) : undefined,
        opacity: o.fill ? opacity : undefined,
        borderOpacity: opacity,
      });
      return;
    }
    case "draw":
    case "line":
    case "arrow": {
      const pts = o.pts ?? [];
      if (pts.length < 2) return;
      const local = pts.map((q) => ({ x: q.x * o.w, y: q.y * o.h }));
      for (let k = 0; k < local.length - 1; k++) {
        page.drawLine({
          start: pdfPt(geo, o, local[k].x, local[k].y),
          end: pdfPt(geo, o, local[k + 1].x, local[k + 1].y),
          thickness: o.strokeWidth,
          color: col(o.color),
          opacity,
          lineCap: LineCapStyle.Round,
        });
      }
      if (o.type === "arrow") {
        const a = pagePt(o, local[local.length - 2].x, local[local.length - 2].y);
        const b = pagePt(o, local[local.length - 1].x, local[local.length - 1].y);
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        const len = Math.max(9, o.strokeWidth * 4.5);
        for (const s of [-1, 1]) {
          const t = ang + Math.PI - s * 0.5;
          const tip = pageToPdf(geo, { x: b.x + len * Math.cos(t), y: b.y + len * Math.sin(t) });
          page.drawLine({ start: pageToPdf(geo, b), end: tip, thickness: o.strokeWidth, color: col(o.color), opacity, lineCap: LineCapStyle.Round });
        }
      }
      return;
    }
    case "image": {
      if (!o.dataUrl) return;
      const { bytes, mime } = dataUrlToBytes(o.dataUrl);
      const img = mime === "image/png" ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
      const bl = geoRect(geo, o);
      page.drawImage(img, { x: bl.x, y: bl.y, width: o.w, height: o.h, rotate: rot, opacity });
      return;
    }
    case "note": {
      const bl = geoRect(geo, { ...o, rotation: 0 });
      page.drawRectangle({ x: bl.x, y: bl.y, width: o.w, height: o.h, color: col(o.fill ?? "#fde047"), borderColor: col(o.color), borderWidth: 1 });
      for (const f of [0.3, 0.5, 0.7]) {
        const a = pageToPdf(geo, { x: o.x + o.w * 0.2, y: o.y + o.h * f });
        const b = pageToPdf(geo, { x: o.x + o.w * 0.8, y: o.y + o.h * f });
        page.drawLine({ start: a, end: b, thickness: 1, color: col("#854d0e") });
      }
      const ctx = doc.context;
      const annot = ctx.obj({
        Type: "Annot",
        Subtype: "Text",
        Rect: [bl.x, bl.y, bl.x + o.w, bl.y + o.h],
        Contents: PDFHexString.fromText(o.text ?? ""),
        T: PDFHexString.fromText("PageFlex"),
        Name: "Comment",
        C: [...hexToRgb01(o.fill ?? "#fde047")],
        F: 4,
      });
      page.node.addAnnot(ctx.register(annot));
      return;
    }
    case "field": {
      if (!form.current) form.current = doc.getForm();
      const f = form.current;
      const bl = pageToPdf(geo, { x: o.x, y: o.y + o.h });
      const opts = { x: bl.x, y: bl.y, width: o.w, height: o.h, borderWidth: 1, borderColor: col("#334155") };
      let name = (o.fieldName || "field").replace(/[.\s]+/g, "_");
      const kind = o.fieldKind ?? "text";
      if (kind !== "radio") {
        let n = name;
        for (let k = 2; usedNames.has(n) || fieldExists(f, n); k++) n = `${name}_${k}`;
        name = n;
        usedNames.add(name);
      }
      if (kind === "text" || kind === "date") {
        const t = f.createTextField(name);
        t.addToPage(page, opts);
      } else if (kind === "checkbox") {
        const c = f.createCheckBox(name);
        c.addToPage(page, { ...opts, width: Math.min(o.w, o.h), height: Math.min(o.w, o.h) });
      } else if (kind === "dropdown") {
        const d = f.createDropdown(name);
        const choices = (o.options ?? []).filter(Boolean);
        d.addOptions(choices.length ? choices : ["Option 1", "Option 2"]);
        d.addToPage(page, opts);
      } else if (kind === "radio") {
        let g = radios.get(name);
        if (!g) {
          g = f.createRadioGroup(name);
          radios.set(name, g);
        }
        g.addOptionToPage(o.label || `Choice ${g.getOptions().length + 1}`, page, { ...opts, width: Math.min(o.w, o.h), height: Math.min(o.w, o.h) });
      }
      return;
    }
    default:
      return;
  }
}

function fieldExists(f: ReturnType<PDFDocument["getForm"]>, name: string): boolean {
  try {
    f.getField(name);
    return true;
  } catch {
    return false;
  }
}

async function drawRaster(doc: PDFDocument, page: PDFPage, geo: PageGeo, o: PdfObject, r: Raster) {
  const img = r.mime === "image/png" ? await doc.embedPng(r.bytes) : await doc.embedJpg(r.bytes);
  const bl = geoRect(geo, o);
  page.drawImage(img, { x: bl.x, y: bl.y, width: o.w, height: o.h, rotate: degrees(-o.rotation), opacity: o.opacity });
}
