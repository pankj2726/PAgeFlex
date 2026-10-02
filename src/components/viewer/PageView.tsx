import { memo, useEffect, useRef, useState } from "react";
import type { PageModel, SourceDoc } from "../../lib/model/commands";
import { displaySize } from "../../lib/model/coords";
import { useEditor } from "../../lib/model/docState";
import type { PdfObject } from "../../lib/model/objects";
import { renderPage } from "../../lib/pdf/render";
import { FindHighlights } from "./FindHighlights";
import { ObjectLayer } from "./ObjectLayer";
import { TextEditLayer } from "./TextEditLayer";

const MAX_PIXELS = 16_000_000;

function PageViewInner({ page, index, zoom, viewRotation, source, objects, scrollRoot }: { page: PageModel; index: number; zoom: number; viewRotation: number; source: SourceDoc | null; objects: PdfObject[]; scrollRoot: HTMLElement | null }) {
  const tool = useEditor((s) => s.tool);
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [near, setNear] = useState(index < 3);
  const [state, setState] = useState<"idle" | "rendering" | "done" | "error">("idle");
  const [err, setErr] = useState("");
  const rotation = (page.rotation + viewRotation) % 360;
  const geo = { cropBox: page.cropBox, rotation };
  const { w, h } = displaySize(geo, zoom);

  // lazy rendering window: only pages near the viewport hold a bitmap (page raster cache with eviction)
  useEffect(() => {
    const el = rootRef.current;
    if (!el || !scrollRoot) return;
    const io = new IntersectionObserver((entries) => entries.forEach((e) => setNear(e.isIntersecting)), { root: scrollRoot, rootMargin: "1400px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [scrollRoot]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!near || !source) {
      if (!near && canvas.width > 1) {
        canvas.width = 1;
        canvas.height = 1;
        setState("idle");
      }
      return;
    }
    let handle: ReturnType<typeof renderPage> | null = null;
    const timer = setTimeout(() => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const scale = Math.min(zoom * dpr, Math.sqrt(MAX_PIXELS / Math.max(1, (w / zoom) * (h / zoom))));
      setState("rendering");
      handle = renderPage(source, page.srcIndex, canvas, scale, rotation);
      handle.promise
        .then(() => setState("done"))
        .catch((e) => {
          setErr(String(e?.message ?? e));
          setState("error");
        });
    }, 90);
    return () => {
      clearTimeout(timer);
      handle?.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [near, source?.id, page.srcIndex, zoom, rotation, page.cropBox]);

  return (
    <div ref={rootRef} data-page-index={index} className="page-shadow relative mx-auto mb-4 bg-white" style={{ width: w, height: h }} aria-label={`Page ${index + 1}`}>
      {source && <canvas ref={canvasRef} className="page-canvas" style={{ width: w, height: h, display: "block" }} aria-hidden="true" />}
      {state === "rendering" && <div className="pointer-events-none absolute right-2 top-2 rounded bg-slate-900/70 px-2 py-0.5 text-xs text-white">Rendering…</div>}
      {state === "error" && <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-red-600">Couldn't render this page.<br />{err}</div>}
      {near && <ObjectLayer page={page} objects={objects} geo={geo} zoom={zoom} width={w} height={h} />}
      {near && <FindHighlights pageId={page.id} geo={geo} zoom={zoom} width={w} height={h} />}
      {near && tool === "edittext" && <TextEditLayer page={page} objects={objects} geo={geo} zoom={zoom} width={w} height={h} canvasRef={canvasRef} />}
      <span className="pointer-events-none absolute -bottom-4 right-0 text-[10px] text-slate-400">{index + 1}</span>
    </div>
  );
}

export const PageView = memo(PageViewInner);
