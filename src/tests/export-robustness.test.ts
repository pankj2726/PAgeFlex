/**
 * TASKS-02 Task 1 regression tests (NOT YET RUN – no shell in the authoring environment).
 * Every "edit type" from the task is exported through the real worker-side pipeline and the output is re-parsed
 * with the pdf-lib loader (page count) – the browser-side second-parser check lives in tests/e2e/download.spec.ts.
 */
import { PDFDocument } from "@cantoo/pdf-lib";
import { describe, expect, it } from "vitest";
import { exportDocument, exportDocumentWithReport, invalidReason } from "../lib/pdf/export";
import { mergePdfs } from "../lib/pdf/merge";
import { addWatermark } from "../lib/pdf/pageTools";
import { fillFields, listFields } from "../lib/pdf/forms";
import { createObject, type PdfObject } from "../lib/model/objects";
import type { ExportPayload } from "../lib/pdf/types";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function makePdf(n: number): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  for (let i = 0; i < n; i++) d.addPage([100 + i * 10, 200]).drawText(`Page ${i + 1}`, { x: 10, y: 100 });
  return d.save();
}
const pg = (id: string, i: number, rotation = 0) => ({ id, sourceId: "s", srcIndex: i, rotation, cropBox: [0, 0, 100 + i * 10, 200] as [number, number, number, number] });
const payload = (bytes: Uint8Array, pages: ExportPayload["pages"], objects: PdfObject[] = []): ExportPayload => ({ sources: [{ id: "s", bytes }], primaryId: "s", pages, objects, rasters: {}, redactions: {} });
const count = async (b: Uint8Array) => (await PDFDocument.load(b)).getPageCount();

describe("Task 1 – export succeeds for every edit type", () => {
  it("edit text (cover-and-replace)", async () => {
    const src = await makePdf(1);
    const o = { ...createObject("textedit", "a", 10, 80, 40, 14), text: "Changed", origText: "Page 1", covers: [{ x: 9, y: 79, w: 42, h: 16 }], baseline: 11, fontSize: 12, family: "sans" as const, bg: "#ffffff" };
    const r = await exportDocumentWithReport(payload(src, [pg("a", 0)], [o]));
    expect(r.warnings).toEqual([]);
    expect(await count(r.bytes)).toBe(1);
  });
  it("whiteout", async () => {
    const src = await makePdf(1);
    expect(await count(await exportDocument(payload(src, [pg("a", 0)], [createObject("whiteout", "a", 5, 5, 50, 20)])))).toBe(1);
  });
  it("page delete", async () => {
    const src = await makePdf(3);
    expect(await count(await exportDocument(payload(src, [pg("a", 0), pg("c", 2)])))).toBe(2);
  });
  it("rotate", async () => {
    const src = await makePdf(2);
    const out = await PDFDocument.load(await exportDocument(payload(src, [pg("a", 0, 90), pg("b", 1, 180)])));
    expect(out.getPages().map((p) => p.getRotation().angle)).toEqual([90, 180]);
  });
  it("merge then export the merged base", async () => {
    const m = await mergePdfs([{ name: "a", bytes: await makePdf(2) }, { name: "b", bytes: await makePdf(1) }]);
    expect(await count(await exportDocument(payload(m.bytes, [pg("a", 0), pg("b", 1), pg("c", 2)])))).toBe(3);
  });
  it("watermark then export", async () => {
    const w = await addWatermark(await makePdf(2), undefined, { text: "DRAFT", opacity: 0.3, angle: 30, size: 40, color: "#ff0000", tile: false });
    expect(await count(await exportDocument(payload(w, [pg("a", 0), pg("b", 1)])))).toBe(2);
  });
  it("signature (image object)", async () => {
    const src = await makePdf(1);
    const o = { ...createObject("image", "a", 10, 10, 60, 20), dataUrl: PNG, label: "signature" };
    const r = await exportDocumentWithReport(payload(src, [pg("a", 0)], [o]));
    expect(r.warnings).toEqual([]);
    expect(await count(r.bytes)).toBe(1);
  });
  it("form fill then export", async () => {
    const src = await makePdf(1);
    const f = { ...createObject("field", "a", 5, 5, 80, 20), fieldKind: "text" as const, fieldName: "name" };
    const withField = await exportDocument(payload(src, [pg("a", 0)], [f]));
    const filled = await fillFields(withField, undefined, { name: "Ada" }, false);
    expect((await listFields(filled.bytes)).find((x) => x.name === "name")?.value).toBe("Ada");
    expect(await count(await exportDocument(payload(filled.bytes, [pg("a", 0)])))).toBe(1);
  });
});

describe("Task 1 – robustness", () => {
  it("exports twice from the same inputs: source bytes are not mutated or detached (hypotheses c, f)", async () => {
    const src = await makePdf(3);
    const before = src.byteLength;
    const copy = src.slice();
    const p = payload(src, [pg("a", 0), pg("b", 1), pg("c", 2)], [createObject("rect", "a", 5, 5, 30, 30)]);
    const a = await exportDocument(p);
    const b = await exportDocument(p);
    expect(src.byteLength).toBe(before);
    expect(src).toEqual(copy);
    expect(await count(a)).toBe(3);
    expect(await count(b)).toBe(3);
  });

  it("one bad object is skipped with a warning; the PDF is still produced (forced failure)", async () => {
    const src = await makePdf(1);
    const good = createObject("rect", "a", 5, 5, 30, 30);
    const nan = { ...createObject("rect", "a", 5, 5, 30, 30), x: Number.NaN };
    const neg = { ...createObject("ellipse", "a", 5, 5, 30, 30), w: -4 };
    const garbage = { ...createObject("image", "a", 5, 5, 30, 30), dataUrl: "data:image/png;base64,AAAA" };
    const r = await exportDocumentWithReport(payload(src, [pg("a", 0)], [good, nan, neg, garbage]));
    expect(await count(r.bytes)).toBe(1);
    expect(r.warnings).toHaveLength(3);
    expect(r.warnings.join("\n")).toMatch(/not a finite number/);
    expect(r.warnings.join("\n")).toMatch(/negative size/);
    expect(r.warnings.every((w) => w.startsWith("Skipped "))).toBe(true);
  });

  it("an invalid redaction box aborts instead of silently leaving text visible", async () => {
    const src = await makePdf(1);
    const bad = { ...createObject("redact", "a", 5, 5, 30, 30), y: Number.NaN };
    await expect(exportDocumentWithReport(payload(src, [pg("a", 0)], [bad]))).rejects.toThrow(/redaction box/i);
  });

  it("unusual characters never throw (hypothesis b)", async () => {
    const src = await makePdf(1);
    const t = { ...createObject("text", "a", 5, 5, 120, 30), text: "naïve – “quotes” € नमस्ते 你好 😀\ttab" };
    const r = await exportDocumentWithReport(payload(src, [pg("a", 0)], [t]));
    expect(await count(r.bytes)).toBe(1);
  });

  it("page ops run before objects: objects follow their page after reorder/delete (hypothesis g)", async () => {
    const src = await makePdf(3);
    const onC = createObject("rect", "c", 5, 5, 20, 20);
    const out = await exportDocument(payload(src, [pg("c", 2), pg("a", 0)], [onC, createObject("rect", "b", 1, 1, 5, 5)]));
    const d = await PDFDocument.load(out);
    expect(d.getPages().map((p) => Math.round(p.getWidth()))).toEqual([120, 100]);
    expect(await invalidReason(onC)).toBeNull();
  });

  it("deleting down to one page of a large nested page tree still yields a loadable file", async () => {
    const src = await makePdf(60);
    expect(await count(await exportDocument(payload(src, [pg("x", 59)])))).toBe(1);
  });
});
