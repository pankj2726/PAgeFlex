import { useEffect, useRef, useState } from "react";
import { deletePages, duplicatePages, insertBlankPage, insertPagesFromSource, movePages, rotatePages } from "../../lib/model/commands";
import { displaySize } from "../../lib/model/coords";
import { useEditor } from "../../lib/model/docState";
import { openBytes, readFileBytes, withBusy, localJob, downloadBlob } from "../../lib/pdf/session";
import { renderPage } from "../../lib/pdf/render";
import { runJob } from "../../lib/workers/client";
import { exportJob } from "../../lib/pdf/session";
import type { PageModel, SourceDoc } from "../../lib/model/commands";
import { sanitizeFilename } from "../../lib/pdf/range";
import { cn } from "../../utils/cn";
import { btn } from "../ui";

const THUMB_W = 120;

function Thumb({ page, source, scrollRoot }: { page: PageModel; source: SourceDoc | null; scrollRoot: HTMLElement | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [near, setNear] = useState(false);
  const { w, h } = displaySize({ cropBox: page.cropBox, rotation: page.rotation }, 1);
  const scale = THUMB_W / w;
  useEffect(() => {
    const el = ref.current;
    if (!el || !scrollRoot) return;
    const io = new IntersectionObserver((es) => es.forEach((e) => setNear(e.isIntersecting)), { root: scrollRoot, rootMargin: "300px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [scrollRoot]);
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !source || !near) return;
    const hnd = renderPage(source, page.srcIndex, c, scale * Math.min(window.devicePixelRatio || 1, 2), page.rotation);
    hnd.promise.catch(() => undefined);
    return () => hnd.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [near, source?.id, page.srcIndex, page.rotation]);
  return (
    <div ref={ref} className="relative bg-white shadow" style={{ width: THUMB_W, height: h * scale }}>
      {source && <canvas ref={canvasRef} style={{ width: THUMB_W, height: h * scale }} aria-hidden="true" />}
    </div>
  );
}

export function Thumbnails() {
  const doc = useEditor((s) => s.doc)!;
  const selected = useEditor((s) => s.selectedPages);
  const current = useEditor((s) => s.currentPage);
  const fileName = useEditor((s) => s.fileName);
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const dragIds = useRef<string[]>([]);
  const last = useRef(0);
  const pickRef = useRef<HTMLInputElement>(null);
  const st = useEditor.getState;

  const ids = selected.length ? selected : doc.pages[current] ? [doc.pages[current].id] : [];
  const indexOf = (id: string) => doc.pages.findIndex((p) => p.id === id);
  const jump = (i: number) => window.dispatchEvent(new CustomEvent("qf-jump", { detail: i }));

  const click = (e: React.MouseEvent, i: number) => {
    const id = doc.pages[i].id;
    if (e.shiftKey) {
      const [a, b] = [Math.min(last.current, i), Math.max(last.current, i)];
      useEditor.setState({ selectedPages: doc.pages.slice(a, b + 1).map((p) => p.id) });
    } else if (e.metaKey || e.ctrlKey) {
      useEditor.setState({ selectedPages: selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id] });
    } else useEditor.setState({ selectedPages: [id] });
    last.current = i;
    jump(i);
  };

  const move = (dir: -1 | 1) => {
    const idx = ids.map(indexOf).sort((a, b) => a - b);
    const rest = doc.pages.length - ids.length;
    const firstIdx = idx[0];
    const to = dir === -1 ? Math.max(0, firstIdx - 1) : Math.min(rest, firstIdx + 1);
    st().exec(movePages(ids, to));
  };

  const del = () => {
    if (ids.length >= doc.pages.length) return st().toast("error", "A document needs at least one page.");
    st().exec(deletePages(ids));
    useEditor.setState({ selectedPages: [] });
  };

  const insertFromPdf = async (file: File) => {
    try {
      const res = await openBytes(await readFileBytes(file), file.name);
      if (!res) return;
      const src = res.doc.sources[res.doc.primaryId];
      const at = Math.max(...ids.map(indexOf), -1) + 1 || doc.pages.length;
      st().exec(
        insertPagesFromSource(
          src,
          res.doc.pages.map((p) => ({ cropBox: p.cropBox, rotation: p.rotation, srcIndex: p.srcIndex })),
          at
        )
      );
      st().toast("success", `Inserted ${res.doc.pages.length} page(s) from ${file.name}.`);
    } catch (e) {
      st().toast("error", e instanceof Error ? e.message : "Couldn't read that PDF.");
    }
  };

  const extract = async () => {
    // Extract selected pages as a new PDF without disturbing the document (export → split in the worker)
    const idx = ids.map(indexOf).sort((a, b) => a - b);
    const out = await withBusy("Extracting pages", (p) =>
      localJob(async () => {
        const e = await exportJob(doc, (v, l) => p(v * 0.5, l)).promise;
        const parts = await runJob<{ bytes: Uint8Array }[]>("split", { bytes: e.bytes, groups: [idx] }, (v, l) => p(0.5 + v * 0.5, l)).promise;
        return parts[0].bytes;
      })
    );
    if (out) downloadBlob(out, sanitizeFilename(fileName.replace(/\.pdf$/i, "") + "-extract"));
  };

  const onDrop = (to: number) => {
    const moving = dragIds.current;
    if (!moving.length) return;
    const rest = doc.pages.filter((p) => !moving.includes(p.id));
    const beforeCount = doc.pages.slice(0, to).filter((p) => !moving.includes(p.id)).length;
    st().exec(movePages(moving, Math.min(beforeCount, rest.length)));
    dragIds.current = [];
    setDropAt(null);
  };

  const iconBtn = cn(btn, "!px-2 !py-1 text-xs");
  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap gap-1 border-b border-slate-200 p-2 dark:border-slate-700" role="toolbar" aria-label="Page actions">
        <button className={iconBtn} title="Rotate left" aria-label="Rotate selected pages left" onClick={() => st().exec(rotatePages(ids, -90))}>⟲</button>
        <button className={iconBtn} title="Rotate right" aria-label="Rotate selected pages right" onClick={() => st().exec(rotatePages(ids, 90))}>⟳</button>
        <button className={iconBtn} title="Duplicate" aria-label="Duplicate selected pages" onClick={() => st().exec(duplicatePages(ids))}>⧉</button>
        <button className={iconBtn} title="Delete" aria-label="Delete selected pages" onClick={del}>🗑</button>
        <button className={iconBtn} title="Move up" aria-label="Move selected pages earlier" onClick={() => move(-1)}>↑</button>
        <button className={iconBtn} title="Move down" aria-label="Move selected pages later" onClick={() => move(1)}>↓</button>
        <button className={iconBtn} title="Insert blank page after selection" aria-label="Insert blank page" onClick={() => {
          const at = Math.max(...ids.map(indexOf), -1) + 1;
          const ref = doc.pages[Math.max(0, at - 1)];
          const w = Math.abs(ref.cropBox[2] - ref.cropBox[0]);
          const h = Math.abs(ref.cropBox[3] - ref.cropBox[1]);
          st().exec(insertBlankPage(at, w, h));
        }}>＋□</button>
        <button className={iconBtn} title="Insert pages from another PDF" aria-label="Insert pages from another PDF" onClick={() => pickRef.current?.click()}>＋PDF</button>
        <button className={iconBtn} title="Download selected pages as a new PDF" aria-label="Extract selected pages" onClick={extract}>⇩</button>
        <input ref={pickRef} type="file" accept="application/pdf,.pdf" className="sr-only" tabIndex={-1} aria-label="Choose PDF to insert" onChange={(e) => { const f = e.target.files?.[0]; if (f) insertFromPdf(f); e.target.value = ""; }} />
      </div>
      <div ref={setRoot} className="flex-1 overflow-y-auto p-2" onDragLeave={() => setDropAt(null)}>
        <ol className="flex flex-col items-center gap-3">
          {doc.pages.map((p, i) => {
            const sel = selected.includes(p.id);
            return (
              <li
                key={p.id}
                draggable
                onDragStart={(e) => {
                  dragIds.current = sel ? selected : [p.id];
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", "page");
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  const r = e.currentTarget.getBoundingClientRect();
                  setDropAt(e.clientY < r.top + r.height / 2 ? i : i + 1);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  onDrop(dropAt ?? i);
                }}
                className="relative"
              >
                {dropAt === i && <div className="absolute -top-2 left-0 right-0 h-1 rounded bg-indigo-500" />}
                {dropAt === i + 1 && i === doc.pages.length - 1 && <div className="absolute -bottom-2 left-0 right-0 h-1 rounded bg-indigo-500" />}
                <button
                  type="button"
                  onClick={(e) => click(e, i)}
                  aria-label={`Page ${i + 1}${sel ? ", selected" : ""}`}
                  aria-pressed={sel}
                  className={cn("block rounded-sm outline-offset-2 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg", sel ? "scale-[1.03] outline-2 outline-indigo-600 ring-2 ring-indigo-500" : current === i ? "ring-2 ring-slate-400" : "")}
                >
                  <Thumb page={p} source={p.sourceId ? doc.sources[p.sourceId] : null} scrollRoot={root} />
                </button>
                <div className="mt-1 text-center text-xs text-slate-500">{i + 1}</div>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
