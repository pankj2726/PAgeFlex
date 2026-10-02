import { create } from "zustand";
import {
  applyCommand,
  redo as redoFn,
  snapshot,
  undo as undoFn,
  type Command,
  type DocData,
  type HistoryEntry,
} from "./commands";
import type { ObjType } from "./objects";

export type ToolId = "select" | "hand" | "edittext" | "eraser" | ObjType | "signature";

export interface Toast {
  id: number;
  kind: "info" | "error" | "success";
  text: string;
}

export interface EditorState {
  doc: DocData | null;
  past: HistoryEntry[];
  future: HistoryEntry[];
  fileName: string;
  /** bumps every time the doc is replaced so caches can invalidate */
  revision: number;
  gestureBase: DocData | null;

  tool: ToolId;
  selection: string[];
  selectedPages: string[];
  zoom: number;
  fitWidth: boolean;
  viewRotation: number;
  currentPage: number;
  toasts: Toast[];

  open(doc: DocData, fileName: string): void;
  close(): void;
  exec(cmd: Command): void;
  undo(): void;
  redo(): void;
  liveUpdate(fn: (d: DocData) => DocData): void;
  beginGesture(): void;
  endGesture(label: string): void;
  set(p: Partial<EditorState>): void;
  toast(kind: Toast["kind"], text: string): void;
  dismissToast(id: number): void;
}

let toastId = 0;

export const useEditor = create<EditorState>((set, get) => ({
  doc: null,
  past: [],
  future: [],
  fileName: "document.pdf",
  revision: 0,
  gestureBase: null,
  tool: "select",
  selection: [],
  selectedPages: [],
  zoom: 1,
  fitWidth: true,
  viewRotation: 0,
  currentPage: 0,
  toasts: [],

  open(doc, fileName) {
    set({
      doc,
      past: [],
      future: [],
      fileName,
      revision: get().revision + 1,
      selection: [],
      selectedPages: [],
      tool: "select",
      currentPage: 0,
      viewRotation: 0,
      fitWidth: true,
    });
  },
  close() {
    set({ doc: null, past: [], future: [], selection: [], selectedPages: [], revision: get().revision + 1 });
  },
  exec(cmd) {
    const s = get();
    if (!s.doc) return;
    const next = applyCommand({ doc: s.doc, past: s.past, future: s.future }, cmd);
    set({ doc: next.doc, past: next.past, future: next.future, revision: s.revision + 1 });
  },
  undo() {
    const s = get();
    if (!s.doc) return;
    const next = undoFn({ doc: s.doc, past: s.past, future: s.future });
    set({ doc: next.doc, past: next.past, future: next.future, revision: s.revision + 1, selection: [] });
  },
  redo() {
    const s = get();
    if (!s.doc) return;
    const next = redoFn({ doc: s.doc, past: s.past, future: s.future });
    set({ doc: next.doc, past: next.past, future: next.future, revision: s.revision + 1, selection: [] });
  },
  liveUpdate(fn) {
    const s = get();
    if (!s.doc) return;
    set({ doc: fn(s.doc) });
  },
  beginGesture() {
    set({ gestureBase: get().doc });
  },
  endGesture(label) {
    const s = get();
    if (!s.doc || !s.gestureBase) return;
    if (s.doc !== s.gestureBase) {
      const cmd = snapshot(label, s.doc);
      set({
        past: [...s.past, { cmd, before: s.gestureBase, after: s.doc }].slice(-100),
        future: [],
        gestureBase: null,
        revision: s.revision + 1,
      });
    } else set({ gestureBase: null });
  },
  set(p) {
    set(p);
  },
  toast(kind, text) {
    const id = ++toastId;
    set({ toasts: [...get().toasts, { id, kind, text }] });
    setTimeout(() => get().dismissToast(id), kind === "error" ? 9000 : 4500);
  },
  dismissToast(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
}));
