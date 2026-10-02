import { useEffect, useMemo } from "react";
import { Toolbar, TOOL_BUTTONS, pickTool } from "../components/toolbar/Toolbar";
import { Viewer } from "../components/viewer/Viewer";
import { Thumbnails } from "../components/sidebar/Thumbnails";
import { PropertiesPanel } from "../components/sidebar/PropertiesPanel";
import { FormsPanel } from "../components/sidebar/FormsPanel";
import { ExportDialog } from "../components/dialogs/ExportDialog";
import { SignatureDialog } from "../components/dialogs/SignatureDialog";
import { Tour } from "../components/dialogs/Tour";
import { FindPanel } from "../components/dialogs/FindPanel";
import { useFind } from "../lib/text/find";
import { Modal, btn } from "../components/ui";
import { PANEL_TITLES, ToolPanel, type ToolHost, type ToolResult } from "../components/tools/ToolPanels";
import { useEditor } from "../lib/model/docState";
import { duplicateObjects, deleteObjects, updateObjects } from "../lib/model/commands";
import { useUi } from "../lib/model/ui";
import { commitBytes, downloadBlob, exportJob, withBusy } from "../lib/pdf/session";
import { autosaveEnabled, saveSession } from "../lib/pdf/persist";
import { sanitizeFilename } from "../lib/pdf/range";
import { navigate } from "../lib/router";
import { useSeo } from "../lib/seo";
import { SITE } from "../lib/config";
import { cn } from "../utils/cn";

function useEditorHost(): ToolHost {
  const selectedIds = useEditor((s) => s.selectedPages);
  const pages = useEditor((s) => s.doc?.pages);
  return useMemo<ToolHost>(
    () => ({
      hasDoc: true,
      selectedPages: selectedIds.map((id) => pages?.findIndex((p) => p.id === id) ?? -1).filter((i) => i >= 0).sort((a, b) => a - b),
      async getInput() {
        const s = useEditor.getState();
        const out = await withBusy("Preparing your document", (p) => exportJob(s.doc!, p));
        if (!out) return undefined;
        return { bytes: out.bytes, pageCount: out.pageCount, name: s.fileName };
      },
      deliver(r: ToolResult) {
        const st = useEditor.getState();
        if (r.kind === "pdf") {
          commitBytes(r.label, r.bytes).then((ok) => {
            if (ok) {
              st.toast("success", `${r.label} applied. ${r.note ?? ""} (Undo with Ctrl+Z)`);
              useUi.getState().set({ toolPanel: null });
            }
          });
        } else {
          downloadBlob(r.data, sanitizeFilename(r.name, r.name.split(".").pop() || "bin"), r.mime);
          st.toast("success", `Downloaded ${r.name}. ${r.note ?? ""}`);
        }
      },
    }),
    [selectedIds, pages]
  );
}

export default function Editor() {
  const doc = useEditor((s) => s.doc);
  const revision = useEditor((s) => s.revision);
  const ui = useUi();
  const host = useEditorHost();
  useSeo({ title: `Editor – ${SITE.name}`, description: "Edit your PDF privately in the browser.", path: "/edit", noindex: true });

  useEffect(() => {
    if (!doc) navigate("/");
  }, [doc]);

  // first-run tour
  useEffect(() => {
    try {
      if (doc && !localStorage.getItem("qf-tour")) useUi.getState().set({ tourOpen: true });
    } catch {
      /* ignore */
    }
  }, [doc !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  // autosave (F36)
  useEffect(() => {
    if (!doc || !autosaveEnabled()) return;
    const id = setTimeout(() => saveSession(doc, useEditor.getState().fileName).catch(() => undefined), 1500);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision]);

  // unload warning only when autosave is off
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (useEditor.getState().past.length && !autosaveEnabled()) e.preventDefault();
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, []);

  // keyboard shortcuts
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
      const st = useEditor.getState();
      const mod = e.ctrlKey || e.metaKey;
      if (document.querySelector('[role="dialog"]')) return;
      if (mod && (e.key.toLowerCase() === "f" || e.key.toLowerCase() === "h")) {
        e.preventDefault(); // Ctrl/Cmd+F = Find, Ctrl/Cmd+H = Find & Replace
        useFind.getState().set({ open: true, mode: e.key.toLowerCase() === "h" ? "replace" : "find" });
        return;
      }
      if (mod && e.key.toLowerCase() === "z" && !typing) {
        e.preventDefault();
        e.shiftKey ? st.redo() : st.undo();
      } else if (mod && e.key.toLowerCase() === "y" && !typing) {
        e.preventDefault();
        st.redo();
      } else if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        useUi.getState().set({ exportOpen: true });
      } else if (typing) return;
      else if (mod && e.key.toLowerCase() === "d" && st.selection.length) {
        e.preventDefault();
        const r = duplicateObjects(st.selection);
        st.exec(r.cmd);
        useEditor.setState({ selection: r.newIds });
      } else if ((e.key === "Delete" || e.key === "Backspace") && st.selection.length) {
        e.preventDefault();
        st.exec(deleteObjects(st.selection));
        useEditor.setState({ selection: [] });
      } else if (e.key === "Escape") {
        useEditor.setState({ selection: [], tool: "select" });
      } else if (e.key.startsWith("Arrow") && st.selection.length && !mod) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        const first = st.doc!.objects.filter((o) => st.selection.includes(o.id));
        // one undo step per nudge using per-object patches
        for (const o of first) st.exec(updateObjects([o.id], { x: o.x + dx, y: o.y + dy }, "Nudge"));
      } else if (!mod && !e.altKey) {
        const b = TOOL_BUTTONS.find((x) => x.key.toLowerCase() === e.key.toLowerCase());
        if (b) {
          e.preventDefault();
          pickTool(b.id, document.querySelector<HTMLInputElement>('input[aria-label="Choose image to insert"]'));
        }
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  if (!doc) return null;
  return (
    <div className="flex h-full flex-col">
      <Toolbar />
      <div className="relative flex min-h-0 flex-1">
        <aside className={cn("z-20 h-full w-44 shrink-0 border-r border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900 max-lg:absolute max-lg:shadow-xl sm:w-48", ui.leftOpen ? "" : "hidden")} aria-label="Pages">
          <Thumbnails />
        </aside>
        <main className="min-w-0 flex-1">
          <Viewer />
        </main>
        <aside className={cn("z-20 h-full w-72 shrink-0 overflow-y-auto border-l border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900 max-lg:absolute max-lg:right-0 max-lg:shadow-xl", ui.rightOpen ? "" : "hidden")} aria-label="Properties">
          <div className="flex gap-1 border-b border-slate-200 p-2 dark:border-slate-700" role="tablist">
            {(["props", "forms"] as const).map((t) => (
              <button key={t} role="tab" aria-selected={ui.rightTab === t} className={cn(btn, ui.rightTab === t && "!bg-indigo-100 dark:!bg-indigo-900")} onClick={() => ui.set({ rightTab: t })}>
                {t === "props" ? "Properties" : "Forms"}
              </button>
            ))}
          </div>
          {ui.rightTab === "props" ? <PropertiesPanel /> : <FormsPanel />}
        </aside>
      </div>
      {ui.exportOpen && <ExportDialog onClose={() => ui.set({ exportOpen: false })} />}
      {ui.signatureOpen && <SignatureDialog onClose={() => ui.set({ signatureOpen: false })} />}
      {ui.tourOpen && <Tour onClose={() => ui.set({ tourOpen: false })} />}
      <FindPanel />
      {ui.toolPanel && (
        <Modal title={PANEL_TITLES[ui.toolPanel]} onClose={() => ui.set({ toolPanel: null })} wide>
          <ToolPanel id={ui.toolPanel} host={host} />
        </Modal>
      )}
    </div>
  );
}
