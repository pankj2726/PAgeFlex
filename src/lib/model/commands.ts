/**
 * Command stack (rule R3). Every state change is a Command with do / undo / serialize.
 * `applyCommand` / `undo` / `redo` are pure functions over HistoryState.
 */
import type { Box } from "./coords";
import { uid, type PdfObject } from "./objects";

export interface SourceDoc {
  id: string;
  name: string;
  bytes: Uint8Array;
  password?: string;
}

export interface PageModel {
  id: string;
  /** null => blank page created in the editor */
  sourceId: string | null;
  srcIndex: number;
  /** absolute /Rotate value (multiple of 90) */
  rotation: number;
  /** crop box in PDF space (for blank pages: [0,0,w,h]) */
  cropBox: Box;
}

export interface DocData {
  sources: Record<string, SourceDoc>;
  /** source whose catalog (forms, outlines, metadata) is preserved on export */
  primaryId: string;
  pages: PageModel[];
  objects: PdfObject[];
}

export interface Command {
  label: string;
  do(d: DocData): DocData;
  /** `before` is the immutable snapshot taken when the command was applied. */
  undo(d: DocData, before: DocData): DocData;
  serialize(): { type: string; label: string; args?: unknown };
}

export interface HistoryEntry {
  cmd: Command;
  before: DocData;
  after: DocData;
}

export interface HistoryState {
  doc: DocData;
  past: HistoryEntry[];
  future: HistoryEntry[];
}

const MAX_HISTORY = 100;

export function applyCommand(s: HistoryState, cmd: Command): HistoryState {
  const after = cmd.do(s.doc);
  if (after === s.doc) return s;
  return { doc: after, past: [...s.past, { cmd, before: s.doc, after }].slice(-MAX_HISTORY), future: [] };
}

export function undo(s: HistoryState): HistoryState {
  const e = s.past[s.past.length - 1];
  if (!e) return s;
  return { doc: e.cmd.undo(s.doc, e.before), past: s.past.slice(0, -1), future: [e, ...s.future] };
}

export function redo(s: HistoryState): HistoryState {
  const e = s.future[0];
  if (!e) return s;
  return { doc: e.cmd.do(e.before), past: [...s.past, e], future: s.future.slice(1) };
}

function cmd(label: string, type: string, doFn: (d: DocData) => DocData, args?: unknown): Command {
  return { label, do: doFn, undo: (_d, before) => before, serialize: () => ({ type, label, args }) };
}

// ---------- object commands ----------
export const addObjects = (objs: PdfObject[]): Command =>
  cmd("Add object", "addObjects", (d) => ({ ...d, objects: [...d.objects, ...objs] }), objs.map((o) => o.id));

export const updateObjects = (ids: string[], patch: Partial<PdfObject>, label = "Edit object"): Command =>
  cmd(
    label,
    "updateObjects",
    (d) => ({ ...d, objects: d.objects.map((o) => (ids.includes(o.id) ? { ...o, ...patch } : o)) }),
    { ids, patch }
  );

export const deleteObjects = (ids: string[]): Command =>
  cmd("Delete", "deleteObjects", (d) => ({ ...d, objects: d.objects.filter((o) => !ids.includes(o.id)) }), ids);

export type ZMode = "front" | "back" | "forward" | "backward";
export const reorderZ = (ids: string[], mode: ZMode): Command =>
  cmd(
    "Change order",
    "reorderZ",
    (d) => {
      const sel = d.objects.filter((o) => ids.includes(o.id));
      const rest = d.objects.filter((o) => !ids.includes(o.id));
      if (mode === "front") return { ...d, objects: [...rest, ...sel] };
      if (mode === "back") return { ...d, objects: [...sel, ...rest] };
      const arr = [...d.objects];
      const step = mode === "forward" ? 1 : -1;
      const order = step === 1 ? [...arr.keys()].reverse() : [...arr.keys()];
      for (const i of order) {
        const j = i + step;
        if (ids.includes(arr[i].id) && j >= 0 && j < arr.length && !ids.includes(arr[j].id)) {
          [arr[i], arr[j]] = [arr[j], arr[i]];
        }
      }
      return { ...d, objects: arr };
    },
    { ids, mode }
  );

export function duplicateObjects(ids: string[]): { cmd: Command; newIds: string[] } {
  const map = new Map(ids.map((id) => [id, uid("o")] as const));
  return {
    newIds: [...map.values()],
    cmd: cmd(
      "Duplicate",
      "duplicateObjects",
      (d) => {
        const copies = d.objects.filter((o) => map.has(o.id)).map((o) => ({ ...o, id: map.get(o.id)!, x: o.x + 12, y: o.y + 12 }));
        return { ...d, objects: [...d.objects, ...copies] };
      },
      ids
    ),
  };
}

// ---------- page commands ----------
export const rotatePages = (ids: string[], delta: number): Command =>
  cmd(
    "Rotate pages",
    "rotatePages",
    (d) => ({
      ...d,
      pages: d.pages.map((p) => (ids.includes(p.id) ? { ...p, rotation: (((p.rotation + delta) % 360) + 360) % 360 } : p)),
    }),
    { ids, delta }
  );

export const deletePages = (ids: string[]): Command =>
  cmd(
    "Delete pages",
    "deletePages",
    (d) => {
      const pages = d.pages.filter((p) => !ids.includes(p.id));
      if (pages.length === 0 || pages.length === d.pages.length) return d;
      return { ...d, pages, objects: d.objects.filter((o) => !ids.includes(o.pageId)) };
    },
    ids
  );

export function duplicatePages(ids: string[]): Command {
  const idMap = new Map(ids.map((id) => [id, uid("p")] as const));
  return cmd(
    "Duplicate pages",
    "duplicatePages",
    (d) => {
      const pages: PageModel[] = [];
      const objs: PdfObject[] = [];
      for (const p of d.pages) {
        pages.push(p);
        const nid = idMap.get(p.id);
        if (nid) {
          pages.push({ ...p, id: nid });
          for (const o of d.objects) if (o.pageId === p.id) objs.push({ ...o, id: uid("o"), pageId: nid });
        }
      }
      return { ...d, pages, objects: [...d.objects, ...objs] };
    },
    ids
  );
}

/** Move the given pages so they start at `toIndex` of the list that remains after removing them. */
export const movePages = (ids: string[], toIndex: number): Command =>
  cmd(
    "Reorder pages",
    "movePages",
    (d) => {
      const moving = d.pages.filter((p) => ids.includes(p.id));
      const rest = d.pages.filter((p) => !ids.includes(p.id));
      const at = Math.max(0, Math.min(rest.length, toIndex));
      const pages = [...rest.slice(0, at), ...moving, ...rest.slice(at)];
      return pages.every((p, i) => p.id === d.pages[i].id) ? d : { ...d, pages };
    },
    { ids, toIndex }
  );

export const insertBlankPage = (at: number, w = 595.28, h = 841.89): Command => {
  const page: PageModel = { id: uid("p"), sourceId: null, srcIndex: 0, rotation: 0, cropBox: [0, 0, w, h] };
  return cmd("Insert blank page", "insertBlank", (d) => ({ ...d, pages: [...d.pages.slice(0, at), page, ...d.pages.slice(at)] }), { at, w, h });
};

export const insertPagesFromSource = (
  source: SourceDoc,
  geos: { cropBox: Box; rotation: number; srcIndex: number }[],
  at: number
): Command =>
  cmd(
    "Insert pages",
    "insertPages",
    (d) => {
      const pages: PageModel[] = geos.map((g) => ({
        id: uid("p"),
        sourceId: source.id,
        srcIndex: g.srcIndex,
        rotation: g.rotation,
        cropBox: g.cropBox,
      }));
      return {
        ...d,
        sources: { ...d.sources, [source.id]: source },
        pages: [...d.pages.slice(0, at), ...pages, ...d.pages.slice(at)],
      };
    },
    { at, count: geos.length, source: source.name }
  );

/** Replace the entire base document (used by "bake" operations such as crop, merge, OCR, protect). */
export const replaceBase = (label: string, next: DocData): Command => cmd(label, "replaceBase", () => next, { label });

/** Snapshot command used when a drag gesture has already mutated the live doc. */
export const snapshot = (label: string, after: DocData): Command => cmd(label, "snapshot", () => after);
