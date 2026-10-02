/**
 * pdf.js access: rendering, text extraction, rasterising. pdf.js parses/decodes in its own Web Worker
 * (inlined with ?worker&inline so the single-file build works); canvas painting happens on the main thread.
 */
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import PdfWorker from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?worker&inline";
import type { PageGeo } from "../model/coords";
import { pageSize } from "../model/coords";
import type { SourceDoc } from "../model/commands";
import { classifyFont } from "../fonts/fontMap";
import type { FontFamily } from "../model/objects";
import type { RawItem } from "../text/glyphMap";

export type PdfDoc = pdfjs.PDFDocumentProxy;

let workerReady = false;
function init() {
  if (workerReady) return;
  pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker();
  workerReady = true;
}

const CDN = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}`;

/** Open bytes with pdf.js. The buffer is copied because pdf.js transfers (detaches) what it is given. */
export async function openPdfjs(data: Uint8Array, password?: string): Promise<PdfDoc> {
  init();
  const task = pdfjs.getDocument({
    data: data.slice(),
    password,
    isEvalSupported: false, // never eval PDF-controlled code
    enableXfa: false,
    cMapUrl: `${CDN}/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${CDN}/standard_fonts/`,
    wasmUrl: `${CDN}/wasm/`,
  });
  return task.promise;
}

const docs = new Map<string, Promise<PdfDoc>>();
export function getSourceDoc(src: SourceDoc): Promise<PdfDoc> {
  let p = docs.get(src.id);
  if (!p) {
    p = openPdfjs(src.bytes, src.password);
    docs.set(src.id, p);
    p.catch(() => docs.delete(src.id));
  }
  return p;
}
export function registerSourceDoc(id: string, doc: PdfDoc) {
  docs.set(id, Promise.resolve(doc));
}
export function releaseUnusedSources(keep: string[]) {
  for (const [id, p] of docs) {
    if (!keep.includes(id)) {
      docs.delete(id);
      p.then((d) => d.destroy()).catch(() => undefined);
    }
  }
}

export interface RenderHandle {
  promise: Promise<void>;
  cancel(): void;
}

/** Render one source page into `canvas`. `scale` is device px per PDF point. Cancellable. */
export function renderPage(src: SourceDoc, srcIndex: number, canvas: HTMLCanvasElement, scale: number, rotation: number): RenderHandle {
  let task: pdfjs.RenderTask | null = null;
  let cancelled = false;
  const promise = (async () => {
    const doc = await getSourceDoc(src);
    const page = await doc.getPage(srcIndex + 1);
    if (cancelled) return;
    const viewport = page.getViewport({ scale, rotation });
    const off = document.createElement("canvas"); // render offscreen, then blit: avoids white flashes on zoom
    off.width = Math.max(1, Math.floor(viewport.width));
    off.height = Math.max(1, Math.floor(viewport.height));
    const ctx = off.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Canvas unavailable");
    task = page.render({ canvasContext: ctx, canvas: off, viewport, background: "#ffffff" });
    await task.promise;
    if (cancelled) return;
    canvas.width = off.width;
    canvas.height = off.height;
    canvas.getContext("2d")!.drawImage(off, 0, 0);
    off.width = off.height = 0;
  })().catch((e) => {
    if (e && (e.name === "RenderingCancelledException" || cancelled)) return;
    throw e;
  });
  return {
    promise,
    cancel() {
      cancelled = true;
      task?.cancel();
    },
  };
}

export interface RasterResult {
  bytes: Uint8Array;
  width: number;
  height: number;
  mime: string;
}

/** Rasterise page `srcIndex` of an opened doc at `scale` (device px per pt), view rotation 0 (= page space orientation). */
export async function rasterizePage(
  doc: PdfDoc,
  srcIndex: number,
  scale: number,
  opts: { rotation?: number; mime?: "image/jpeg" | "image/png"; quality?: number; paint?: (ctx: CanvasRenderingContext2D, scale: number) => void } = {}
): Promise<RasterResult> {
  const page = await doc.getPage(srcIndex + 1);
  const viewport = page.getViewport({ scale, rotation: opts.rotation ?? 0 });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d", { alpha: false })!;
  await page.render({ canvasContext: ctx, canvas, viewport, background: "#ffffff" }).promise;
  opts.paint?.(ctx, scale);
  const mime = opts.mime ?? "image/png";
  const blob: Blob = await new Promise((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error("Encoding failed"))), mime, opts.quality ?? 0.9)
  );
  const result = { bytes: new Uint8Array(await blob.arrayBuffer()), width: canvas.width, height: canvas.height, mime };
  canvas.width = canvas.height = 0;
  return result;
}

export interface TextRun {
  str: string;
  /** page-space box (pt) */
  x: number;
  y: number;
  w: number;
  h: number;
  baseline: number; // page-space y of the baseline
  size: number;
  fontName: string;
  family: FontFamily;
  bold: boolean;
  italic: boolean;
  rotated: boolean;
}

/** extractTextRuns(doc, index) – merges adjacent pdf.js items on the same baseline into line-like runs. */
export async function extractTextRuns(doc: PdfDoc, srcIndex: number, geo: PageGeo): Promise<TextRun[]> {
  const page = await doc.getPage(srcIndex + 1);
  const content = await page.getTextContent();
  const styles = content.styles as Record<string, { fontFamily?: string }>;
  const cx0 = Math.min(geo.cropBox[0], geo.cropBox[2]);
  const cy1 = Math.max(geo.cropBox[1], geo.cropBox[3]);
  const fontCache = new Map<string, ReturnType<typeof classifyFont>>();
  const info = (fontName: string) => {
    let f = fontCache.get(fontName);
    if (!f) {
      let real = "";
      try {
        if (page.commonObjs.has(fontName)) real = (page.commonObjs.get(fontName) as { name?: string })?.name ?? "";
      } catch {
        /* font not resolved yet */
      }
      f = classifyFont(real, styles[fontName]?.fontFamily ?? "");
      fontCache.set(fontName, f);
    }
    return f;
  };
  const runs: TextRun[] = [];
  let last: TextRun | null = null;
  for (const raw of content.items) {
    const it = raw as { str: string; transform: number[]; width: number; height: number; fontName: string };
    if (!("str" in it) || it.str === "") continue;
    const [a, b, , , e, f] = it.transform;
    const size = Math.hypot(a, b) || it.height || 10;
    const rotated = Math.abs(Math.atan2(b, a)) > 0.05;
    const f0 = info(it.fontName);
    const run: TextRun = {
      str: it.str,
      x: e - cx0,
      baseline: cy1 - f,
      y: cy1 - f - size * 0.9,
      w: it.width,
      h: size * 1.15,
      size,
      fontName: it.fontName,
      family: f0.family,
      bold: f0.bold,
      italic: f0.italic,
      rotated,
    };
    if (
      last &&
      !rotated &&
      !last.rotated &&
      Math.abs(last.baseline - run.baseline) < size * 0.2 &&
      Math.abs(last.size - size) < 0.6 &&
      run.x - (last.x + last.w) > -size * 0.3 &&
      run.x - (last.x + last.w) < size * 0.7
    ) {
      const gap = run.x - (last.x + last.w);
      const needsSpace = gap > size * 0.15 && !last.str.endsWith(" ") && !run.str.startsWith(" ");
      last.str += (needsSpace ? " " : "") + run.str;
      last.w = run.x + run.w - last.x;
    } else {
      runs.push(run);
      last = run;
    }
  }
  return runs;
}

/**
 * Raw pdf.js text items in page space, WITHOUT merging (Task 2: merging items into "runs" is what made one click
 * capture neighbouring words). Used to build the glyph map.
 */
export async function extractRawItems(doc: PdfDoc, srcIndex: number, geo: PageGeo): Promise<RawItem[]> {
  const page = await doc.getPage(srcIndex + 1);
  const content = await page.getTextContent();
  const styles = content.styles as Record<string, { fontFamily?: string }>;
  const cx0 = Math.min(geo.cropBox[0], geo.cropBox[2]);
  const cy1 = Math.max(geo.cropBox[1], geo.cropBox[3]);
  const cache = new Map<string, ReturnType<typeof classifyFont>>();
  const out: RawItem[] = [];
  for (const raw of content.items) {
    const it = raw as { str?: string; transform?: number[]; width?: number; height?: number; fontName?: string };
    if (typeof it.str !== "string" || it.str === "" || !it.transform) continue;
    const [a, b, , , e, f] = it.transform;
    const fontName = it.fontName ?? "";
    let info = cache.get(fontName);
    if (!info) {
      let real = "";
      try {
        if (page.commonObjs.has(fontName)) real = (page.commonObjs.get(fontName) as { name?: string })?.name ?? "";
      } catch {
        /* font not resolved yet */
      }
      info = classifyFont(real, styles[fontName]?.fontFamily ?? "");
      cache.set(fontName, info);
    }
    out.push({ str: it.str, x: e - cx0, baseline: cy1 - f, w: it.width ?? 0, size: Math.hypot(a, b) || it.height || 10, angle: Math.atan2(b, a), fontName, family: info.family, bold: info.bold, italic: info.italic });
  }
  return out;
}

/** Sample (background, text) colours around rectangles (page space) from a one-off low-res render of a source page. */
export async function sampleColorsForRects(doc: PdfDoc, srcIndex: number, rects: { x: number; y: number; w: number; h: number }[]): Promise<{ bg: string; fg: string }[]> {
  const page = await doc.getPage(srcIndex + 1);
  const base = page.getViewport({ scale: 1, rotation: 0 });
  const scale = Math.min(2, Math.sqrt(4_000_000 / Math.max(1, base.width * base.height)));
  const viewport = page.getViewport({ scale, rotation: 0 });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d", { alpha: false, willReadFrequently: true })!;
  try {
    await page.render({ canvasContext: ctx, canvas, viewport, background: "#ffffff" }).promise;
    return rects.map((r) => sampleRunColors(canvas, r.x * scale, r.y * scale, r.w * scale, r.h * scale));
  } finally {
    canvas.width = canvas.height = 0;
  }
}

/** All text of the given pages (0-based) joined by newlines – used for PDF→text and runtime verification. */
export async function extractPlainText(doc: PdfDoc, pages?: number[]): Promise<string[]> {
  const idx = pages ?? Array.from({ length: doc.numPages }, (_, i) => i);
  const out: string[] = [];
  for (const i of idx) {
    const page = await doc.getPage(i + 1);
    const tc = await page.getTextContent();
    let s = "";
    for (const raw of tc.items) {
      const it = raw as { str?: string; hasEOL?: boolean };
      if (typeof it.str === "string") s += it.str + (it.hasEOL ? "\n" : "");
    }
    out.push(s);
  }
  return out;
}

/** Estimate (background, text) colours of a region of a rendered canvas (canvas px). */
export function sampleRunColors(canvas: HTMLCanvasElement, rx: number, ry: number, rw: number, rh: number): { bg: string; fg: string } {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const x = Math.max(0, Math.floor(rx));
  const y = Math.max(0, Math.floor(ry));
  const w = Math.max(1, Math.min(canvas.width - x, Math.ceil(rw)));
  const h = Math.max(1, Math.min(canvas.height - y, Math.ceil(rh)));
  if (!ctx || canvas.width === 0) return { bg: "#ffffff", fg: "#000000" };
  const data = ctx.getImageData(x, y, w, h).data;
  // background = most common quantised colour; text = farthest colour from it
  const counts = new Map<number, number>();
  for (let i = 0; i < data.length; i += 4) {
    const k = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  let bestK = 0;
  let bestC = -1;
  for (const [k, c] of counts) if (c > bestC) ((bestK = k), (bestC = c));
  const br = ((bestK >> 10) & 31) << 3;
  const bgc = ((bestK >> 5) & 31) << 3;
  const bb = (bestK & 31) << 3;
  let far = 0;
  let fr = 0;
  let fg = 0;
  let fb = 0;
  for (let i = 0; i < data.length; i += 4) {
    const d = (data[i] - br) ** 2 + (data[i + 1] - bgc) ** 2 + (data[i + 2] - bb) ** 2;
    if (d > far) ((far = d), (fr = data[i]), (fg = data[i + 1]), (fb = data[i + 2]));
  }
  const hex = (r: number, g: number, b: number) => "#" + [r, g, b].map((v) => Math.min(255, v).toString(16).padStart(2, "0")).join("");
  return { bg: hex(br + 4, bgc + 4, bb + 4), fg: far > 1500 ? hex(fr, fg, fb) : "#000000" };
}

export { pageSize };
