import { useRef, useState } from "react";
import { addObjects } from "../../lib/model/commands";
import { useEditor, type ToolId } from "../../lib/model/docState";
import { useUi } from "../../lib/model/ui";
import { createObject } from "../../lib/model/objects";
import { fileToImage } from "../../lib/pdf/images";
import { clearAllData, autosaveEnabled, setAutosave } from "../../lib/pdf/persist";
import { TOOLS } from "../../lib/tools";
import { navigate } from "../../lib/router";
import { t } from "../../lib/i18n";
import { useFind } from "../../lib/text/find";
import { LogoMark, Wordmark } from "../Logo";
import { cn } from "../../utils/cn";
import { btn, btnPrimary } from "../ui";

export const TOOL_BUTTONS: { id: ToolId | "image"; label: string; icon: string; key: string }[] = [
  { id: "select", label: "Select", icon: "➤", key: "V" },
  { id: "hand", label: "Pan", icon: "✋", key: "H" },
  { id: "edittext", label: "Edit text", icon: "✎", key: "E" },
  { id: "text", label: "Text", icon: "T", key: "T" },
  { id: "highlight", label: "Highlight", icon: "▮", key: "M" },
  { id: "underline", label: "Underline", icon: "U̲", key: "U" },
  { id: "strike", label: "Strike", icon: "S̶", key: "S" },
  { id: "draw", label: "Draw", icon: "✍", key: "D" },
  { id: "rect", label: "Rectangle", icon: "▭", key: "R" },
  { id: "ellipse", label: "Ellipse", icon: "◯", key: "O" },
  { id: "line", label: "Line", icon: "╱", key: "L" },
  { id: "arrow", label: "Arrow", icon: "→", key: "A" },
  { id: "image", label: "Image", icon: "🖼", key: "I" },
  { id: "note", label: "Note", icon: "🗒", key: "N" },
  { id: "signature", label: "Sign", icon: "🖊", key: "G" },
  { id: "field", label: "Field", icon: "☐", key: "F" },
  { id: "whiteout", label: "Whiteout", icon: "▯", key: "W" },
  { id: "redact", label: "Redact", icon: "⬛", key: "K" },
  { id: "eraser", label: "Eraser", icon: "⌫", key: "X" },
];

export function pickTool(id: ToolId | "image", imageInput: HTMLInputElement | null) {
  if (id === "image") return imageInput?.click();
  if (id === "signature") return useUi.getState().set({ signatureOpen: true });
  useEditor.setState({ tool: id });
}

export function Toolbar() {
  const doc = useEditor((s) => s.doc)!;
  const tool = useEditor((s) => s.tool);
  const zoom = useEditor((s) => s.zoom);
  const fit = useEditor((s) => s.fitWidth);
  const cur = useEditor((s) => s.currentPage);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const fileName = useEditor((s) => s.fileName);
  const ui = useUi();
  const st = useEditor.getState;
  const imageRef = useRef<HTMLInputElement>(null);
  const [menu, setMenu] = useState<"tools" | "more" | null>(null);
  const [dark, setDark] = useState(document.documentElement.classList.contains("dark"));
  const [auto, setAuto] = useState(autosaveEnabled());

  const addImage = async (f: File) => {
    try {
      const img = await fileToImage(f);
      const s = st();
      const page = s.doc!.pages[s.currentPage] ?? s.doc!.pages[0];
      const pw = Math.abs(page.cropBox[2] - page.cropBox[0]);
      const ph = Math.abs(page.cropBox[3] - page.cropBox[1]);
      const w = Math.min(img.width * 0.75, pw * 0.5);
      const h = (w * img.height) / img.width;
      const o = createObject("image", page.id, (pw - w) / 2, (ph - h) / 2, w, h);
      o.dataUrl = img.dataUrl;
      s.exec(addObjects([o]));
      useEditor.setState({ selection: [o.id], tool: "select" });
    } catch {
      st().toast("error", "That image couldn't be read. Try a PNG or JPG.");
    }
  };

  const zoomBy = (f: number) => useEditor.setState({ fitWidth: false, zoom: Math.max(0.2, Math.min(5, zoom * f)) });
  const toggleTheme = () => {
    const d = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", d);
    try {
      localStorage.setItem("qf-theme", d ? "dark" : "light");
    } catch {
      /* ignore */
    }
    setDark(d);
  };
  const small = "!px-2.5";

  return (
    <header className="border-b border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <button className="group flex items-center gap-2 rounded-md" onClick={() => navigate("/")} aria-label="PageFlex home">
          <LogoMark size={28} className="transition-transform duration-500 group-hover:rotate-[-8deg] group-hover:scale-110" />
          <Wordmark className="hidden sm:inline" />
        </button>
        <button className={cn(btn, small, "lg:hidden")} onClick={() => ui.set({ leftOpen: !ui.leftOpen })} aria-label="Toggle page thumbnails" aria-pressed={ui.leftOpen}>☰</button>
        <span className="max-w-40 truncate text-sm text-slate-500" title={fileName}>{fileName}</span>
        <div className="mx-1 h-6 w-px bg-slate-200 dark:bg-slate-700" />
        <button className={cn(btn, small)} onClick={() => st().undo()} disabled={!canUndo} aria-label={t("editor.undo")} title="Undo (Ctrl+Z)">↶</button>
        <button className={cn(btn, small)} onClick={() => st().redo()} disabled={!canRedo} aria-label={t("editor.redo")} title="Redo (Ctrl+Shift+Z)">↷</button>
        <div className="mx-1 hidden h-6 w-px bg-slate-200 dark:bg-slate-700 sm:block" />
        <div className="flex items-center gap-1 text-sm">
          <input
            key={cur}
            className="w-12 rounded border border-slate-300 bg-white px-1.5 py-1 text-center dark:border-slate-600 dark:bg-slate-900"
            defaultValue={cur + 1}
            aria-label="Go to page"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const n = Math.max(1, Math.min(doc.pages.length, parseInt((e.target as HTMLInputElement).value, 10) || 1));
                window.dispatchEvent(new CustomEvent("qf-jump", { detail: n - 1 }));
              }
            }}
          />
          <span className="text-slate-500">/ {doc.pages.length}</span>
        </div>
        <div className="flex items-center gap-1">
          <button className={cn(btn, small)} onClick={() => zoomBy(1 / 1.2)} aria-label="Zoom out">−</button>
          <button className={cn(btn, "min-w-14", fit && "!bg-indigo-100 dark:!bg-indigo-900")} onClick={() => useEditor.setState({ fitWidth: true })} title="Fit width" aria-pressed={fit}>{Math.round(zoom * 100)}%</button>
          <button className={cn(btn, small)} onClick={() => zoomBy(1.2)} aria-label="Zoom in">＋</button>
          <button className={cn(btn, small)} onClick={() => useEditor.setState({ viewRotation: (st().viewRotation + 90) % 360 })} aria-label="Rotate view (does not change the file)" title="Rotate view (view only)">⟳</button>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button className={btn} onClick={() => useFind.getState().set({ open: true, mode: "find" })} aria-label="Find and replace (Ctrl+F)" title="Find (Ctrl/Cmd+F) · Replace (Ctrl/Cmd+H)">🔍 Find</button>
          <div className="relative">
            <button className={btn} onClick={() => setMenu(menu === "tools" ? null : "tools")} aria-haspopup="menu" aria-expanded={menu === "tools"}>Tools ▾</button>
            {menu === "tools" && (
              <div role="menu" className="absolute right-0 z-40 mt-1 max-h-[70vh] w-64 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl dark:border-slate-700 dark:bg-slate-900">
                {TOOLS.filter((x) => x.panel).map((x) => (
                  <button
                    key={x.slug}
                    role="menuitem"
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
                    onClick={() => {
                      setMenu(null);
                      if (x.panel === "forms") ui.set({ rightTab: "forms", rightOpen: true });
                      else ui.set({ toolPanel: x.panel! });
                    }}
                  >
                    <span aria-hidden="true">{x.icon}</span> {x.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="relative">
            <button className={cn(btn, small)} onClick={() => setMenu(menu === "more" ? null : "more")} aria-haspopup="menu" aria-expanded={menu === "more"} aria-label="Settings and privacy">⚙</button>
            {menu === "more" && (
              <div role="menu" className="absolute right-0 z-40 mt-1 w-64 rounded-xl border border-slate-200 bg-white p-2 text-sm shadow-xl dark:border-slate-700 dark:bg-slate-900">
                <button role="menuitem" className="w-full rounded-lg px-3 py-2 text-left hover:bg-slate-100 dark:hover:bg-slate-800" onClick={toggleTheme}>{dark ? "☀ Light mode" : "🌙 Dark mode"}</button>
                <label className="flex items-center gap-2 px-3 py-2">
                  <input type="checkbox" checked={auto} onChange={(e) => { setAuto(e.target.checked); setAutosave(e.target.checked); }} /> Autosave to this device
                </label>
                <button
                  role="menuitem"
                  className="w-full rounded-lg px-3 py-2 text-left hover:bg-slate-100 dark:hover:bg-slate-800"
                  onClick={async () => {
                    const ok = await clearAllData();
                    st().toast(ok ? "success" : "error", ok ? "All saved data on this device was erased." : "Couldn't confirm that data was cleared.");
                    setMenu(null);
                  }}
                >
                  🗑 {t("data.clear")}
                </button>
                <button role="menuitem" className="w-full rounded-lg px-3 py-2 text-left hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => { setMenu(null); ui.set({ tourOpen: true }); }}>❓ Show the tour</button>
                <button
                  role="menuitem"
                  className="w-full rounded-lg px-3 py-2 text-left hover:bg-slate-100 dark:hover:bg-slate-800"
                  onClick={() => {
                    if (st().past.length === 0 || window.confirm("Close this document? Unsaved changes will be lost.")) {
                      st().close();
                      navigate("/");
                    }
                  }}
                >
                  ✕ Close document
                </button>
              </div>
            )}
          </div>
          <button className={cn(btn, small, "lg:hidden")} onClick={() => ui.set({ rightOpen: !ui.rightOpen })} aria-label="Toggle properties panel" aria-pressed={ui.rightOpen}>☷</button>
          <button className={btnPrimary} onClick={() => ui.set({ exportOpen: true })}>⇩ {t("editor.download")}</button>
        </div>
      </div>
      <div className="flex gap-1 overflow-x-auto border-t border-slate-100 px-3 py-1.5 dark:border-slate-800" role="toolbar" aria-label="Editing tools">
        {TOOL_BUTTONS.map((b) => {
          const active = b.id === tool;
          return (
            <button
              key={b.id}
              onClick={() => pickTool(b.id, imageRef.current)}
              aria-pressed={active}
              aria-label={`${b.label} (${b.key})`}
              title={`${b.label} (${b.key})`}
              className={cn("flex min-w-12 shrink-0 flex-col items-center rounded-lg px-2 py-1 text-xs transition", active ? "bg-indigo-600 text-white" : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800")}
            >
              <span className="text-base leading-5" aria-hidden="true">{b.icon}</span>
              <span>{b.label}</span>
            </button>
          );
        })}
        <input ref={imageRef} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-label="Choose image to insert" onChange={(e) => { const f = e.target.files?.[0]; if (f) addImage(f); e.target.value = ""; }} />
      </div>
    </header>
  );
}
