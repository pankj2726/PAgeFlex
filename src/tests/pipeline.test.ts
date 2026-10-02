/**
 * Integration tests: run the real worker-side pipeline (pure pdf-lib, no DOM) and RE-PARSE every output
 * (blueprint §9 "Integration: export pipeline, re-parse output … assert page count, order, fields, metadata").
 * Page identity is encoded in page width (100 + 10·index) so order can be asserted without text extraction.
 */
import { PDFDocument, degrees } from "@cantoo/pdf-lib";
import { describe, expect, it } from "vitest";
import { exportDocument } from "../lib/pdf/export";
import { mergePdfs } from "../lib/pdf/merge";
import { splitPdf } from "../lib/pdf/split";
import { protectPdf, unlockPdf } from "../lib/pdf/protect";
import { gcDocument } from "../lib/pdf/gc";
import { cropPages, setMetadata, stampPages, addWatermark } from "../lib/pdf/pageTools";
import { fillFields, listFields } from "../lib/pdf/forms";
import { imagesToPdf } from "../lib/pdf/imagesToPdf";
import type { ExportPayload } from "../lib/pdf/types";
import { createObject } from "../lib/model/objects";

async function makePdf(n: number, opts: { rotate?: Record<number, number> } = {}): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  for (let i = 0; i < n; i++) {
    const p = d.addPage([100 + i * 10, 200]);
    p.drawText(`Page ${i + 1}`, { x: 10, y: 100 });
    if (opts.rotate?.[i]) p.setRotation(degrees(opts.rotate[i]));
  }
  return d.save();
}
const widths = async (bytes: Uint8Array, password?: string) => (await PDFDocument.load(bytes, { password })).getPages().map((p) => Math.round(p.getWidth()));

const payload = (bytes: Uint8Array, pages: ExportPayload["pages"], objects: ExportPayload["objects"] = []): ExportPayload => ({
  sources: [{ id: "s", bytes }],
  primaryId: "s",
  pages,
  objects,
  rasters: {},
  redactions: {},
});
const pg = (id: string, srcIndex: number, w: number, rotation = 0) => ({ id, sourceId: "s", srcIndex, rotation, cropBox: [0, 0, w, 200] as [number, number, number, number] });

describe("export pipeline (F05/F16/F17)", () => {
  it("round-trips unchanged pages (S2/Stage 3 gate)", async () => {
    const src = await makePdf(3);
    const out = await exportDocument(payload(src, [pg("a", 0, 100), pg("b", 1, 110), pg("c", 2, 120)]));
    expect(await widths(out)).toEqual([100, 110, 120]);
  });

  it("reorders, deletes, duplicates and inserts a blank page – verified by page order", async () => {
    const src = await makePdf(4);
    const out = await exportDocument(
      payload(src, [pg("c", 2, 120), pg("a", 0, 100), pg("a2", 0, 100), { id: "blank", sourceId: null, srcIndex: 0, rotation: 0, cropBox: [0, 0, 300, 400] }])
    );
    expect(await widths(out)).toEqual([120, 100, 100, 300]);
  });

  it("applies page rotation", async () => {
    const src = await makePdf(2);
    const out = await exportDocument(payload(src, [pg("a", 0, 100, 90), pg("b", 1, 110, 270)]));
    const d = await PDFDocument.load(out);
    expect(d.getPages().map((p) => p.getRotation().angle)).toEqual([90, 270]);
  });

  it("inserts pages from another PDF", async () => {
    const a = await makePdf(2);
    const b = await makePdf(3);
    const out = await exportDocument({
      sources: [{ id: "s", bytes: a }, { id: "t", bytes: b }],
      primaryId: "s",
      pages: [pg("a", 0, 100), { id: "x", sourceId: "t", srcIndex: 2, rotation: 0, cropBox: [0, 0, 120, 200] }, pg("b", 1, 110)],
      objects: [],
      rasters: {},
      redactions: {},
    });
    expect(await widths(out)).toEqual([100, 120, 110]);
  });

  it("draws every object type without throwing and keeps the page count", async () => {
    const src = await makePdf(1);
    const types = ["text", "highlight", "underline", "strike", "draw", "rect", "ellipse", "line", "arrow", "note", "whiteout", "redact"] as const;
    const objs = types.map((t, i) => {
      const o = createObject(t, "a", 10 + i, 10 + i, 60, 20);
      if (t === "draw") o.pts = [{ x: 0, y: 0 }, { x: 0.5, y: 1 }, { x: 1, y: 0 }];
      o.rotation = i * 7;
      return o;
    });
    const out = await exportDocument(payload(src, [pg("a", 0, 100)], objs));
    const d = await PDFDocument.load(out);
    expect(d.getPageCount()).toBe(1);
    expect(out.length).toBeGreaterThan(src.length);
  });

  it("adds real form fields (F24)", async () => {
    const src = await makePdf(1);
    const kinds = ["text", "checkbox", "radio", "dropdown", "date"] as const;
    const objs = kinds.map((k, i) => ({ ...createObject("field", "a", 5, 5 + i * 25, 80, 20), fieldKind: k, fieldName: k === "radio" ? "grp" : `f_${k}`, options: ["One", "Two"], label: `L${i}` }));
    const out = await exportDocument(payload(src, [pg("a", 0, 100)], objs));
    const fields = await listFields(out);
    expect(fields.map((f) => f.name).sort()).toEqual(["f_checkbox", "f_date", "f_dropdown", "f_text", "grp"]);
    const filled = await fillFields(out, undefined, { f_text: "Hello", f_checkbox: true, f_dropdown: "Two" }, false);
    expect(filled.errors).toEqual([]);
    const back = await listFields(filled.bytes);
    expect(back.find((f) => f.name === "f_text")?.value).toBe("Hello");
    expect(back.find((f) => f.name === "f_checkbox")?.value).toBe(true);
    expect(back.find((f) => f.name === "f_dropdown")?.value).toBe("Two");
    const flat = await fillFields(out, undefined, { f_text: "Hello" }, true);
    expect(await listFields(flat.bytes)).toHaveLength(0); // F25 flatten
  });
});

describe("garbage collection (F15 support / privacy)", () => {
  it("drops objects of deleted pages from the saved bytes", async () => {
    const src = await makePdf(3);
    const full = await exportDocument(payload(src, [pg("a", 0, 100), pg("b", 1, 110), pg("c", 2, 120)]));
    const cut = await exportDocument(payload(src, [pg("a", 0, 100)]));
    expect(cut.length).toBeLessThan(full.length);
    const d = await PDFDocument.load(cut);
    const before = d.context.enumerateIndirectObjects().length;
    expect(gcDocument(d)).toBe(0); // nothing left to collect: export already cleaned up
    expect(d.context.enumerateIndirectObjects().length).toBe(before);
  });
});

describe("merge / split (F18/F19)", () => {
  it("merges in order and splits by groups", async () => {
    const a = await makePdf(2);
    const b = await makePdf(3);
    const m = await mergePdfs([{ name: "a", bytes: a }, { name: "b", bytes: b }]);
    expect(m.pageCount).toBe(5);
    expect(await widths(m.bytes)).toEqual([100, 110, 100, 110, 120]);
    const parts = await splitPdf(m.bytes, undefined, [[0, 1], [2, 3, 4]]);
    expect(parts.map((p) => p.pages.length)).toEqual([2, 3]);
    expect(await widths(parts[1].bytes)).toEqual([100, 110, 120]);
    expect(parts[0].label).toBe("pages-1-2");
  });
});

describe("protect / unlock (F31/F32)", () => {
  it("encrypted output refuses to open without the password and opens with it", async () => {
    const src = await makePdf(2);
    const enc = await protectPdf(src, undefined, { userPassword: "s3cret", ownerPassword: "owner", permissions: { printing: true, copying: false, modifying: false, annotating: true, fillingForms: true } });
    await expect(PDFDocument.load(enc)).rejects.toBeTruthy();
    expect(await widths(enc, "s3cret")).toEqual([100, 110]);
    const open = await unlockPdf(enc, "s3cret");
    expect(await widths(open)).toEqual([100, 110]); // loads with NO password
  });
});

describe("page tools (F20–F22, F33)", () => {
  it("crops (respecting rotation), stamps, watermarks and edits metadata", async () => {
    const src = await makePdf(2, { rotate: { 1: 90 } });
    const cropped = await cropPages(src, undefined, { top: 10, right: 0, bottom: 0, left: 0 });
    const d = await PDFDocument.load(cropped);
    expect(d.getPage(0).getCropBox().height).toBe(190); // rotation 0: top margin = pdf top
    expect(d.getPage(1).getCropBox().width).toBe(110 - 10); // rotation 90: visual top = pdf LEFT edge
    const stamped = await stampPages(cropped, undefined, { zones: { "footer-center": "Page {n} of {total}", "header-right": "{bates}" }, startNumber: 1, size: 9, color: "#000000", margin: 20, bates: { prefix: "ACME", start: 7, digits: 4, suffix: "" } });
    expect((await PDFDocument.load(stamped)).getPageCount()).toBe(2);
    const marked = await addWatermark(stamped, undefined, { text: "DRAFT", opacity: 0.3, angle: 45, size: 40, color: "#ff0000", tile: true });
    expect((await PDFDocument.load(marked)).getPageCount()).toBe(2);
    const meta = await setMetadata(marked, undefined, { title: "Quarterly report", author: "Ada" });
    const md = await PDFDocument.load(meta);
    expect(md.getTitle()).toBe("Quarterly report");
    expect(md.getAuthor()).toBe("Ada");
    const cleared = await setMetadata(meta, undefined, {}, true);
    expect((await PDFDocument.load(cleared)).getTitle()).toBeUndefined();
  });
});

describe("image → PDF (F28)", () => {
  it("creates one page per PNG", async () => {
    const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
    const out = await imagesToPdf([{ name: "a.png", bytes: png, mime: "image/png" }, { name: "b.png", bytes: png, mime: "image/png" }], { pageSize: "a4", margin: 20, orientation: "auto" });
    const d = await PDFDocument.load(out);
    expect(d.getPageCount()).toBe(2);
    expect(Math.round(d.getPage(0).getWidth())).toBe(595);
  });
});
