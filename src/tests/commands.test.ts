import { describe, expect, it } from "vitest";
import {
  addObjects,
  applyCommand,
  deleteObjects,
  deletePages,
  duplicateObjects,
  duplicatePages,
  insertBlankPage,
  movePages,
  redo,
  reorderZ,
  replaceBase,
  rotatePages,
  undo,
  updateObjects,
  type DocData,
  type HistoryState,
  type PageModel,
} from "../lib/model/commands";
import { createObject } from "../lib/model/objects";

const page = (id: string, i: number): PageModel => ({ id, sourceId: "s", srcIndex: i, rotation: 0, cropBox: [0, 0, 100, 100] });
const doc = (): DocData => ({ sources: { s: { id: "s", name: "a.pdf", bytes: new Uint8Array([1]) } }, primaryId: "s", pages: [page("p1", 0), page("p2", 1), page("p3", 2)], objects: [] });
const hist = (d = doc()): HistoryState => ({ doc: d, past: [], future: [] });

describe("command stack (F04)", () => {
  it("do / undo / redo are pure and symmetric", () => {
    const h0 = hist();
    const o = createObject("rect", "p1", 1, 2, 3, 4);
    const h1 = applyCommand(h0, addObjects([o]));
    expect(h0.doc.objects).toHaveLength(0); // original untouched
    expect(h1.doc.objects).toHaveLength(1);
    const h2 = undo(h1);
    expect(h2.doc).toBe(h0.doc);
    const h3 = redo(h2);
    expect(h3.doc.objects[0].id).toBe(o.id);
    expect(h3.future).toHaveLength(0);
  });

  it("a new command clears the redo stack", () => {
    let h = applyCommand(hist(), addObjects([createObject("rect", "p1", 0, 0, 1, 1)]));
    h = undo(h);
    expect(h.future).toHaveLength(1);
    h = applyCommand(h, addObjects([createObject("rect", "p1", 0, 0, 1, 1)]));
    expect(h.future).toHaveLength(0);
  });

  it("every command serializes", () => {
    const cmds = [addObjects([]), updateObjects(["x"], { x: 1 }), deleteObjects(["x"]), reorderZ(["x"], "front"), rotatePages(["p1"], 90), deletePages(["p1"]), duplicatePages(["p1"]), movePages(["p1"], 1), insertBlankPage(0), replaceBase("x", doc())];
    for (const c of cmds) expect(c.serialize().type).toBeTruthy();
  });

  it("update / delete objects", () => {
    const o = createObject("text", "p1", 0, 0, 10, 10);
    let h = applyCommand(hist(), addObjects([o]));
    h = applyCommand(h, updateObjects([o.id], { text: "Hi" }));
    expect(h.doc.objects[0].text).toBe("Hi");
    h = applyCommand(h, deleteObjects([o.id]));
    expect(h.doc.objects).toHaveLength(0);
    expect(undo(h).doc.objects[0].text).toBe("Hi");
  });

  it("z-order moves to front/back and one step", () => {
    const [a, b, c] = ["a", "b", "c"].map((t) => ({ ...createObject("rect", "p1", 0, 0, 1, 1), id: t }));
    let h = applyCommand(hist(), addObjects([a, b, c]));
    expect(applyCommand(h, reorderZ(["a"], "front")).doc.objects.map((o) => o.id)).toEqual(["b", "c", "a"]);
    expect(applyCommand(h, reorderZ(["c"], "back")).doc.objects.map((o) => o.id)).toEqual(["c", "a", "b"]);
    expect(applyCommand(h, reorderZ(["a"], "forward")).doc.objects.map((o) => o.id)).toEqual(["b", "a", "c"]);
    h = applyCommand(h, reorderZ(["c"], "backward"));
    expect(h.doc.objects.map((o) => o.id)).toEqual(["a", "c", "b"]);
  });

  it("duplicateObjects creates new ids offset from the original", () => {
    const o = createObject("rect", "p1", 5, 5, 10, 10);
    const h = applyCommand(hist(), addObjects([o]));
    const { cmd, newIds } = duplicateObjects([o.id]);
    const h2 = applyCommand(h, cmd);
    expect(h2.doc.objects).toHaveLength(2);
    expect(h2.doc.objects[1].id).toBe(newIds[0]);
    expect(h2.doc.objects[1].x).toBe(17);
  });
});

describe("page commands (F16/F17)", () => {
  it("rotate normalises into 0..359", () => {
    const h = applyCommand(hist(), rotatePages(["p1"], -90));
    expect(h.doc.pages[0].rotation).toBe(270);
    expect(applyCommand(h, rotatePages(["p1"], 180)).doc.pages[0].rotation).toBe(90);
  });

  it("delete removes the page's objects and refuses to delete everything", () => {
    let h = applyCommand(hist(), addObjects([createObject("rect", "p2", 0, 0, 1, 1)]));
    h = applyCommand(h, deletePages(["p2"]));
    expect(h.doc.pages.map((p) => p.id)).toEqual(["p1", "p3"]);
    expect(h.doc.objects).toHaveLength(0);
    expect(applyCommand(h, deletePages(["p1", "p3"])).doc.pages).toHaveLength(2);
  });

  it("duplicate keeps order and clones objects onto the copy", () => {
    let h = applyCommand(hist(), addObjects([createObject("rect", "p1", 0, 0, 1, 1)]));
    h = applyCommand(h, duplicatePages(["p1"]));
    expect(h.doc.pages).toHaveLength(4);
    expect(h.doc.pages[0].id).toBe("p1");
    expect(h.doc.pages[1].srcIndex).toBe(0);
    expect(h.doc.objects).toHaveLength(2);
    expect(h.doc.objects[1].pageId).toBe(h.doc.pages[1].id);
  });

  it("movePages reorders relative to the remaining pages", () => {
    const h = applyCommand(hist(), movePages(["p1"], 2));
    expect(h.doc.pages.map((p) => p.id)).toEqual(["p2", "p3", "p1"]);
    const h2 = applyCommand(hist(), movePages(["p3", "p2"], 0));
    expect(h2.doc.pages.map((p) => p.id)).toEqual(["p2", "p3", "p1"]);
    expect(applyCommand(hist(), movePages(["p1"], 0))).toEqual(hist()); // no-op => no history entry
  });

  it("insertBlankPage uses the requested size", () => {
    const h = applyCommand(hist(), insertBlankPage(1, 300, 400));
    expect(h.doc.pages[1].sourceId).toBeNull();
    expect(h.doc.pages[1].cropBox).toEqual([0, 0, 300, 400]);
  });

  it("replaceBase (baked operations) is undoable and keeps the old sources (R5)", () => {
    const next = { ...doc(), pages: [page("n1", 0)] };
    const h = applyCommand(hist(), replaceBase("Crop", next));
    expect(h.doc.pages).toHaveLength(1);
    const u = undo(h);
    expect(u.doc.pages).toHaveLength(3);
    expect(u.doc.sources.s.bytes).toEqual(new Uint8Array([1]));
  });
});
