/// <reference lib="webworker" />
/**
 * Edit/export worker: all pdf-lib work happens here, never on the UI thread.
 * Protocol: main → worker {op, payload}; worker → main {type:'progress'|'done'|'error', ...}.
 */
import { exportDocumentWithReport } from "../pdf/export";
import { mergePdfs, type PdfInput } from "../pdf/merge";
import { splitPdf } from "../pdf/split";
import { compressPdf, type CompressPreset } from "../pdf/compress";
import { protectPdf, unlockPdf, type ProtectOptions } from "../pdf/protect";
import { fillFields, flattenForm, listFields, type FormValues } from "../pdf/forms";
import {
  addWatermark,
  cropPages,
  resizePages,
  setMetadata,
  stampPages,
  type CropOptions,
  type ResizeOptions,
  type StampOptions,
  type WatermarkOptions,
} from "../pdf/pageTools";
import { addTextLayer, imagesToPdf, type ImageInput, type ImagesToPdfOptions, type OcrPage } from "../pdf/imagesToPdf";
import type { ExportPayload, Metadata, Progress } from "../pdf/types";

interface Bytes {
  bytes: Uint8Array;
  password?: string;
}

const handlers: Record<string, (p: never, progress: Progress) => Promise<unknown>> = {
  export: (p: ExportPayload, pr) => exportDocumentWithReport(p, pr),
  merge: (p: { inputs: PdfInput[] }, pr) => mergePdfs(p.inputs, pr),
  split: (p: Bytes & { groups: number[][] }, pr) => splitPdf(p.bytes, p.password, p.groups, pr),
  compress: (p: Bytes & { preset: CompressPreset }, pr) => compressPdf(p.bytes, p.password, p.preset, pr),
  protect: (p: Bytes & { options: ProtectOptions }) => protectPdf(p.bytes, p.password, p.options),
  unlock: (p: Bytes & { password: string }) => unlockPdf(p.bytes, p.password),
  listFields: (p: Bytes) => listFields(p.bytes, p.password),
  fillFields: (p: Bytes & { values: FormValues; flatten: boolean }) => fillFields(p.bytes, p.password, p.values, p.flatten),
  flatten: (p: Bytes) => flattenForm(p.bytes, p.password),
  crop: (p: Bytes & { options: CropOptions }) => cropPages(p.bytes, p.password, p.options),
  resize: (p: Bytes & { options: ResizeOptions }) => resizePages(p.bytes, p.password, p.options),
  watermark: (p: Bytes & { options: WatermarkOptions }, pr) => addWatermark(p.bytes, p.password, p.options, pr),
  stamp: (p: Bytes & { options: StampOptions }, pr) => stampPages(p.bytes, p.password, p.options, pr),
  metadata: (p: Bytes & { metadata: Metadata; clearAll?: boolean }) => setMetadata(p.bytes, p.password, p.metadata, p.clearAll),
  imagesToPdf: (p: { images: ImageInput[]; options: ImagesToPdfOptions }, pr) => imagesToPdf(p.images, p.options, pr),
  textLayer: (p: Bytes & { pages: OcrPage[] }, pr) => addTextLayer(p.bytes, p.password, p.pages, pr),
};

function transfers(result: unknown, acc: ArrayBuffer[] = []): ArrayBuffer[] {
  // De-duplicate: listing the same ArrayBuffer twice in a transfer list throws DataCloneError.
  if (result instanceof Uint8Array) {
    if (!acc.includes(result.buffer as ArrayBuffer)) acc.push(result.buffer as ArrayBuffer);
  }
  else if (Array.isArray(result)) result.forEach((r) => transfers(r, acc));
  else if (result && typeof result === "object") Object.values(result).forEach((r) => transfers(r, acc));
  return acc;
}

self.onmessage = async (e: MessageEvent<{ op: string; payload: unknown }>) => {
  const { op, payload } = e.data;
  try {
    const h = handlers[op];
    if (!h) throw new Error(`Unknown operation: ${op}`);
    const result = await h(payload as never, (value, label) => self.postMessage({ type: "progress", value, label }));
    self.postMessage({ type: "done", result }, transfers(result));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    self.postMessage({ type: "error", message: msg, name: err instanceof Error ? err.name : "Error" });
  }
};
