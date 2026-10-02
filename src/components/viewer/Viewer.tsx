import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { displaySize } from "../../lib/model/coords";
import { useEditor } from "../../lib/model/docState";
import type { PdfObject } from "../../lib/model/objects";
import { PageView } from "./PageView";

export function Viewer() {
  const doc = useEditor((s) => s.doc)!;
  const zoom = useEditor((s) => s.zoom);
  const fitWidth = useEditor((s) => s.fitWidth);
  const viewRotation = useEditor((s) => s.viewRotation);
  const tool = useEditor((s) => s.tool);
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(800);
  const raf = useRef(0);

  useEffect(() => {
    if (!root) return;
    const ro = new ResizeObserver(() => setWidth(root.clientWidth));
    ro.observe(root);
    setWidth(root.clientWidth);
    return () => ro.disconnect();
  }, [root]);

  // fit-width: derive zoom from the widest displayed page
  const widest = useMemo(() => Math.max(...doc.pages.map((p) => displaySize({ cropBox: p.cropBox, rotation: (p.rotation + viewRotation) % 360 }, 1).w)), [doc.pages, viewRotation]);
  useEffect(() => {
    if (fitWidth) {
      const z = Math.max(0.2, Math.min(4, (width - 32) / widest));
      if (Math.abs(z - zoom) > 0.002) useEditor.setState({ zoom: z });
    }
  }, [fitWidth, width, widest, zoom]);

  const byPage = useMemo(() => {
    const m = new Map<string, PdfObject[]>();
    for (const o of doc.objects) {
      const a = m.get(o.pageId);
      if (a) a.push(o);
      else m.set(o.pageId, [o]);
    }
    return m;
  }, [doc.objects]);

  const updateCurrent = useCallback(() => {
    if (!root) return;
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      const target = root.scrollTop + root.clientHeight * 0.35;
      const els = root.querySelectorAll<HTMLElement>("[data-page-index]");
      let best = 0;
      for (const el of els) {
        if (el.offsetTop - 16 <= target) best = Number(el.dataset.pageIndex);
        else break;
      }
      if (best !== useEditor.getState().currentPage) useEditor.setState({ currentPage: best });
    });
  }, [root]);

  useEffect(() => {
    const jump = (e: Event) => {
      const i = (e as CustomEvent<number>).detail;
      const el = root?.querySelector<HTMLElement>(`[data-page-index="${i}"]`);
      if (el && root) root.scrollTo({ top: el.offsetTop - 12, behavior: "auto" });
      useEditor.setState({ currentPage: i });
    };
    window.addEventListener("qf-jump", jump);
    return () => window.removeEventListener("qf-jump", jump);
  }, [root]);

  // ctrl/cmd + wheel and pinch zoom
  useEffect(() => {
    if (!root) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const z = useEditor.getState().zoom;
      useEditor.setState({ fitWidth: false, zoom: Math.max(0.2, Math.min(5, z * (e.deltaY < 0 ? 1.1 : 0.9))) });
    };
    root.addEventListener("wheel", onWheel, { passive: false });
    return () => root.removeEventListener("wheel", onWheel);
  }, [root]);

  // hand tool: drag to pan
  const pan = useRef<{ x: number; y: number; l: number; t: number } | null>(null);

  return (
    <div
      ref={setRoot}
      onScroll={updateCurrent}
      onPointerDown={(e) => {
        if (tool === "hand" && root) {
          pan.current = { x: e.clientX, y: e.clientY, l: root.scrollLeft, t: root.scrollTop };
          (e.currentTarget as Element).setPointerCapture(e.pointerId);
        }
      }}
      onPointerMove={(e) => {
        if (pan.current && root) {
          root.scrollLeft = pan.current.l - (e.clientX - pan.current.x);
          root.scrollTop = pan.current.t - (e.clientY - pan.current.y);
        }
      }}
      onPointerUp={() => (pan.current = null)}
      className="h-full overflow-auto bg-slate-200 px-4 py-4 dark:bg-slate-800"
      style={{ cursor: tool === "hand" ? "grab" : undefined }}
      tabIndex={0}
      role="document"
      aria-label={`PDF pages, ${doc.pages.length} total`}
    >
      <div style={{ width: "max-content", minWidth: "100%" }}>
        {doc.pages.map((p, i) => (
          <PageView key={p.id} page={p} index={i} zoom={zoom} viewRotation={viewRotation} source={p.sourceId ? doc.sources[p.sourceId] : null} objects={byPage.get(p.id) ?? EMPTY} scrollRoot={root} />
        ))}
      </div>
    </div>
  );
}

const EMPTY: PdfObject[] = [];
