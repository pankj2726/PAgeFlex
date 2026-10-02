/** Main-thread orchestration: busy overlay, export preparation, baking results back into the editor, downloads. */
import { create } from "zustand";
import { replaceBase, type DocData } from "../model/commands";
import { useEditor } from "../model/docState";
import { boxesIntersect, wrapText, type PdfObject } from "../model/objects";
import { cssFont, unsupportedChars } from "../fonts/fontMap";
import { buildDocData, PdfError } from "./load";
import { extractTextRuns, getSourceDoc, rasterizePage } from "./render";
import type { ExportPayload, KeepRun, Raster } from "./types";
import type { ExportReport } from "./export";
import { CancelledError, runJob, type Job } from "../workers/client";

// ---------------- busy overlay ----------------
interface BusyState {
  active: boolean;
  label: string;
  progress: number;
  cancel: (() => void) | null;
}
export const useBusy = create<BusyState>(() => ({ active: false, label: "", progress: 0, cancel: null }));

export function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (e instanceof RangeError || /allocation|out of memory|memory/i.test(msg)) {
    return "Your device ran out of memory. Try a smaller file, fewer pages, or close other tabs.";
  }
  if (e instanceof PdfError) return e.message;
  if (/encrypt|password/i.test(msg)) return "This PDF is encrypted. Unlock it first (Unlock tool) or enter its password when opening.";
  return msg || "Something went wrong.";
}

export interface LocalCtx {
  progress(v: number, label?: string): void;
  cancelled(): boolean;
}
/** Wrap an async main-thread function as a cancellable Job. */
export function localJob<T>(fn: (c: LocalCtx) => Promise<T>, onProgress?: (v: number, l?: string) => void): Job<T> {
  let cancelled = false;
  const promise = fn({
    progress: (v, l) => onProgress?.(v, l),
    cancelled: () => cancelled,
  }).then((r) => {
    if (cancelled) throw new CancelledError();
    return r;
  });
  return {
    promise,
    cancel() {
      cancelled = true;
    },
  };
}

export async function withBusy<T>(label: string, start: (onProgress: (v: number, l?: string) => void) => Job<T>): Promise<T | undefined> {
  const job = start((v, l) => useBusy.setState({ progress: v, label: l ?? label }));
  useBusy.setState({ active: true, label, progress: 0, cancel: () => job.cancel() });
  try {
    return await job.promise;
  } catch (e) {
    if (e instanceof CancelledError) useEditor.getState().toast("info", "Cancelled – nothing was changed.");
    else useEditor.getState().toast("error", friendlyError(e));
    return undefined;
  } finally {
    useBusy.setState({ active: false, cancel: null });
  }
}

// ---------------- password prompt ----------------
interface PromptState {
  req: null | { name: string; wrong: boolean; resolve: (pw: string | null) => void };
}
export const usePasswordPrompt = create<PromptState>(() => ({ req: null }));
export function askPassword(name: string, wrong: boolean): Promise<string | null> {
  return new Promise((resolve) => {
    usePasswordPrompt.setState({
      req: {
        name,
        wrong,
        resolve: (pw) => {
          usePasswordPrompt.setState({ req: null });
          resolve(pw);
        },
      },
    });
  });
}

/** Validate + open bytes, prompting for a password when needed. Returns null if the user cancels. Throws PdfError otherwise. */
export async function openBytes(bytes: Uint8Array, name: string): Promise<{ doc: DocData; password?: string } | null> {
  let pw: string | undefined;
  for (;;) {
    try {
      const { doc } = await buildDocData(bytes, name, pw);
      return { doc, password: pw };
    } catch (e) {
      if (e instanceof PdfError && (e.code === "PasswordRequired" || e.code === "WrongPassword")) {
        const answer = await askPassword(name, e.code === "WrongPassword");
        if (answer === null) return null;
        pw = answer;
        continue;
      }
      throw e;
    }
  }
}

export async function readFileBytes(file: File | Blob): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

export function createDownloadUrl(data: Uint8Array | Blob, mime = "application/pdf"): string {
  const blob = data instanceof Blob ? data : new Blob([data as BlobPart], { type: mime });
  return URL.createObjectURL(blob);
}

/** Click a temporary anchor. The URL is revoked only after 60 s (spec: at least 10 s) so slow saves still work. */
export function downloadBlob(data: Uint8Array | Blob, filename: string, mime = "application/pdf"): string {
  const url = createDownloadUrl(data, mime);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return url;
}

type SavePicker = (o: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<{
  createWritable(): Promise<{ write(b: BlobPart): Promise<void>; close(): Promise<void> }>;
}>;
export const canUseSavePicker = () => typeof (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker === "function";

/** Progressive enhancement: native "Save as…" (Chromium). Must be called from a click handler. Returns false if the user cancels. */
export async function saveWithPicker(bytes: Uint8Array, filename: string): Promise<boolean> {
  const picker = (window as unknown as { showSaveFilePicker: SavePicker }).showSaveFilePicker;
  try {
    const h = await picker({ suggestedName: filename, types: [{ description: "PDF document", accept: { "application/pdf": [".pdf"] } }] });
    const w = await h.createWritable();
    await w.write(bytes as BlobPart);
    await w.close();
    return true;
  } catch (e) {
    if ((e as Error)?.name === "AbortError") return false;
    throw e;
  }
}

// ---------------- export preparation ----------------
const RASTER_SCALE = 3;
const REDACT_SCALE = 2.4;

async function canvasPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob: Blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("PNG encode failed"))), "image/png"));
  return new Uint8Array(await blob.arrayBuffer());
}

/** Draw text containing glyphs the standard fonts lack (Devanagari, Arabic, CJK…) with the browser's fonts. */
export async function renderTextRaster(o: PdfObject): Promise<Raster> {
  const size = o.fontSize ?? 12;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(o.w * RASTER_SCALE));
  canvas.height = Math.max(1, Math.ceil(o.h * RASTER_SCALE));
  const ctx = canvas.getContext("2d")!;
  ctx.scale(RASTER_SCALE, RASTER_SCALE);
  ctx.font = cssFont(o.family, o.bold, o.italic, size);
  ctx.fillStyle = o.color;
  ctx.textBaseline = "alphabetic";
  const text = o.text ?? "";
  const lines = o.type === "text" ? wrapText(text, Math.max(10, o.w - 4), (s) => ctx.measureText(s).width) : text.split(/\r?\n/);
  const first = o.type === "textedit" ? (o.baseline ?? size * 0.9) : 2 + size * 0.88;
  lines.forEach((ln, k) => {
    const w = ctx.measureText(ln).width;
    const x = o.type === "text" && o.align === "center" ? (o.w - w) / 2 : o.type === "text" && o.align === "right" ? o.w - w - 2 : o.type === "text" ? 2 : 0;
    ctx.fillText(ln, x, first + k * size * 1.2);
  });
  const bytes = await canvasPng(canvas);
  const r = { bytes, mime: "image/png", width: canvas.width, height: canvas.height };
  canvas.width = canvas.height = 0;
  return r;
}

export interface Prepared {
  payload: ExportPayload;
  /** text that sat under redaction boxes: used to PROVE removal after export */
  redactedStrings: string[];
}

export async function prepareExport(doc: DocData, c?: LocalCtx): Promise<Prepared> {
  const rasters: Record<string, Raster> = {};
  for (const o of doc.objects) {
    if ((o.type === "text" || o.type === "textedit") && o.text && unsupportedChars(o.text).length) rasters[o.id] = await renderTextRaster(o);
  }
  const redactions: ExportPayload["redactions"] = {};
  const redactedStrings: string[] = [];
  const keptText: string[] = [];
  const redactPages = doc.pages.filter((p) => doc.objects.some((o) => o.pageId === p.id && o.type === "redact"));
  for (let i = 0; i < redactPages.length; i++) {
    const page = redactPages[i];
    c?.progress((i / redactPages.length) * 0.4, `Securing redacted page ${i + 1} of ${redactPages.length}`);
    if (!page.sourceId) continue; // blank page: nothing underneath
    const src = doc.sources[page.sourceId];
    const pdf = await getSourceDoc(src);
    const boxes = doc.objects.filter((o) => o.pageId === page.id && o.type === "redact");
    const raster = await rasterizePage(pdf, page.srcIndex, REDACT_SCALE, {
      mime: "image/jpeg",
      quality: 0.9,
      paint: (ctx, s) => {
        ctx.fillStyle = "#000";
        for (const b of boxes) {
          ctx.save();
          ctx.translate((b.x + b.w / 2) * s, (b.y + b.h / 2) * s);
          ctx.rotate((b.rotation * Math.PI) / 180);
          ctx.fillRect((-b.w / 2) * s, (-b.h / 2) * s, b.w * s, b.h * s);
          ctx.restore();
        }
      },
    });
    const runs = await extractTextRuns(pdf, page.srcIndex, { cropBox: page.cropBox, rotation: 0 });
    const keep: KeepRun[] = [];
    for (const r of runs) {
      const hit = boxes.some((b) => boxesIntersect({ x: r.x - 1, y: r.y - 1, w: r.w + 2, h: r.h + 2 }, b));
      if (hit) redactedStrings.push(...r.str.split(/\s{2,}|\n/).map((s) => s.trim()).filter((s) => s.length >= 3));
      else keep.push({ str: r.str, x: r.x, y: r.y, w: r.w, h: r.h, size: r.size, baseline: r.baseline });
    }
    redactions[page.id] = { raster, keepRuns: keep };
    for (const k of keep) keptText.push(k.str.toLowerCase());
  }
  // Only demand removal of strings that do not also legitimately appear in text that is kept on a redacted page.
  const keptAll = keptText.join("\n");
  const toProve = [...new Set(redactedStrings)].filter((s) => !keptAll.includes(s.toLowerCase()));
  return {
    redactedStrings: toProve,
    payload: {
      sources: Object.values(doc.sources).map((s) => ({ id: s.id, bytes: s.bytes, password: s.password })),
      primaryId: doc.primaryId,
      pages: doc.pages.map((p) => ({ id: p.id, sourceId: p.sourceId, srcIndex: p.srcIndex, rotation: p.rotation, cropBox: p.cropBox })),
      objects: doc.objects,
      rasters,
      redactions,
    },
  };
}

export interface ExportOutcome {
  /** objects that had to be skipped (the PDF was still produced) */
  warnings: string[];
  bytes: Uint8Array;
  redactedStrings: string[];
  pageCount: number;
}

/** exportPdf(state) → bytes. Cancellable, with progress. */
export function exportJob(doc: DocData, onProgress?: (v: number, l?: string) => void): Job<ExportOutcome> {
  let inner: Job<ExportReport> | null = null;
  let cancelled = false;
  const promise = (async () => {
    const prep = await prepareExport(doc, { progress: (v, l) => onProgress?.(v, l), cancelled: () => cancelled });
    if (cancelled) throw new CancelledError();
    inner = runJob<ExportReport>("export", prep.payload, (v, l) => onProgress?.(0.4 + v * 0.6, l));
    const report = await inner.promise;
    if (!report.bytes || report.bytes.byteLength < 8) throw new Error("The export produced an empty file."); // hypothesis (c): zero-length/detached buffer
    return { bytes: report.bytes, warnings: report.warnings ?? [], redactedStrings: prep.redactedStrings, pageCount: doc.pages.length };
  })();
  return {
    promise,
    cancel() {
      cancelled = true;
      inner?.cancel();
    },
  };
}

/** Make `bytes` the new base document (undoable). This is how crop/merge/OCR/protect… chain without re-upload (F35). */
export async function commitBytes(label: string, bytes: Uint8Array, name?: string, fresh = false): Promise<boolean> {
  const st = useEditor.getState();
  const fileName = name ?? st.fileName;
  try {
    const { doc } = await buildDocData(bytes, fileName);
    if (st.doc && !fresh) {
      st.exec(replaceBase(label, doc));
      st.set({ selection: [], selectedPages: [], currentPage: 0 });
    } else st.open(doc, fileName);
    return true;
  } catch (e) {
    st.toast("error", `The result could not be re-opened: ${friendlyError(e)}`);
    return false;
  }
}
