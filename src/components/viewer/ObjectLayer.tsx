import { useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { addObjects, deleteObjects } from "../../lib/model/commands";
import { canvasToPage, pageMatrix, rotateAbout, type PageGeo, type Pt } from "../../lib/model/coords";
import { useEditor, type ToolId } from "../../lib/model/docState";
import { createObject, type ObjType, type PdfObject } from "../../lib/model/objects";
import type { PageModel } from "../../lib/model/commands";
import { fitHeight, fontCss, layoutText } from "./textLayout";

const DRAG_TOOLS: ObjType[] = ["highlight", "underline", "strike", "rect", "ellipse", "line", "arrow", "whiteout", "redact", "field"];
const KEEP_TOOL = new Set<ToolId>(["draw", "highlight", "underline", "strike", "whiteout", "redact", "eraser"]);
type HandleId = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "rot";
const HANDLES: { id: HandleId; hx: number; hy: number }[] = [
  { id: "nw", hx: 0, hy: 0 },
  { id: "n", hx: 0.5, hy: 0 },
  { id: "ne", hx: 1, hy: 0 },
  { id: "e", hx: 1, hy: 0.5 },
  { id: "se", hx: 1, hy: 1 },
  { id: "s", hx: 0.5, hy: 1 },
  { id: "sw", hx: 0, hy: 1 },
  { id: "w", hx: 0, hy: 0.5 },
];

type Drag =
  | { kind: "move"; start: Pt; orig: Map<string, { x: number; y: number }> }
  | { kind: "resize"; id: string; handle: HandleId; orig: PdfObject }
  | { kind: "rotate"; id: string }
  | { kind: "create"; type: ObjType; start: Pt }
  | { kind: "draw"; pts: Pt[] };

export function ObjectLayer({ page, objects, geo, zoom, width, height }: { page: PageModel; objects: PdfObject[]; geo: PageGeo; zoom: number; width: number; height: number }) {
  const tool = useEditor((s) => s.tool);
  const selection = useEditor((s) => s.selection);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const [draft, setDraft] = useState<PdfObject | null>(null);
  const [drawPts, setDrawPts] = useState<Pt[] | null>(null);
  const m = pageMatrix(geo, zoom);
  const st = useEditor.getState;

  const toPage = (e: { clientX: number; clientY: number }): Pt => {
    const r = svgRef.current!.getBoundingClientRect();
    return canvasToPage(geo, zoom, { x: e.clientX - r.left, y: e.clientY - r.top });
  };
  const select = (ids: string[]) => useEditor.setState({ selection: ids });

  // ----- pointer handlers on the svg root -----
  const onDown = (e: RPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 || tool === "hand" || tool === "edittext") return;
    const p = toPage(e);
    const target = e.target as Element;
    const objEl = target.closest("[data-obj]") as SVGElement | null;
    const handleEl = target.closest("[data-handle]") as SVGElement | null;
    useEditor.setState({ currentPage: useEditor.getState().doc!.pages.findIndex((x) => x.id === page.id) });

    if (tool === "select") {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      if (handleEl) {
        const id = selection[0];
        const orig = objects.find((o) => o.id === id);
        if (!orig) return;
        st().beginGesture();
        drag.current = handleEl.dataset.handle === "rot" ? { kind: "rotate", id } : { kind: "resize", id, handle: handleEl.dataset.handle as HandleId, orig };
        return;
      }
      if (objEl) {
        const id = objEl.dataset.obj!;
        let ids = selection;
        if (e.shiftKey) ids = selection.includes(id) ? selection.filter((x) => x !== id) : [...selection, id];
        else if (!selection.includes(id)) ids = [id];
        select(ids);
        if (ids.includes(id)) {
          st().beginGesture();
          const orig = new Map<string, { x: number; y: number }>();
          for (const o of objects) if (ids.includes(o.id)) orig.set(o.id, { x: o.x, y: o.y });
          drag.current = { kind: "move", start: p, orig };
        }
      } else select([]);
      return;
    }
    if (tool === "eraser") {
      if (objEl) st().exec(deleteObjects([objEl.dataset.obj!]));
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      drag.current = null;
      return;
    }
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    if (tool === "text" || tool === "note") {
      const o = createObject(tool, page.id, p.x, p.y, tool === "text" ? 180 : 24, tool === "text" ? 24 : 24);
      if (tool === "text") o.x = Math.max(0, p.x - 4), o.y = Math.max(0, p.y - 8);
      st().exec(addObjects([o]));
      select([o.id]);
      st().set({ tool: "select" });
      setTimeout(() => window.dispatchEvent(new CustomEvent("qf-focus-text")), 50);
      return;
    }
    if (tool === "draw") {
      drag.current = { kind: "draw", pts: [p] };
      setDrawPts([p]);
      return;
    }
    if ((DRAG_TOOLS as string[]).includes(tool)) {
      drag.current = { kind: "create", type: tool as ObjType, start: p };
      setDraft(createObject(tool as ObjType, page.id, p.x, p.y, 1, 1));
    }
  };

  const onMove = (e: RPointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (tool === "eraser" && e.buttons === 1) {
      const el = (document.elementFromPoint(e.clientX, e.clientY) as Element | null)?.closest("[data-obj]") as SVGElement | null;
      if (el && svgRef.current?.contains(el)) st().exec(deleteObjects([el.dataset.obj!]));
      return;
    }
    if (!d) return;
    const p = toPage(e);
    if (d.kind === "move") {
      const dx = p.x - d.start.x;
      const dy = p.y - d.start.y;
      st().liveUpdate((doc) => ({ ...doc, objects: doc.objects.map((o) => (d.orig.has(o.id) ? { ...o, x: d.orig.get(o.id)!.x + dx, y: d.orig.get(o.id)!.y + dy } : o)) }));
    } else if (d.kind === "rotate") {
      st().liveUpdate((doc) => ({
        ...doc,
        objects: doc.objects.map((o) => {
          if (o.id !== d.id) return o;
          const c = { x: o.x + o.w / 2, y: o.y + o.h / 2 };
          let deg = (Math.atan2(p.y - c.y, p.x - c.x) * 180) / Math.PI + 90;
          if (e.shiftKey) deg = Math.round(deg / 15) * 15;
          return { ...o, rotation: ((Math.round(deg) % 360) + 360) % 360 };
        }),
      }));
    } else if (d.kind === "resize") {
      const o0 = d.orig;
      const c0 = { x: o0.x + o0.w / 2, y: o0.y + o0.h / 2 };
      const q = rotateAbout(p, c0, -o0.rotation);
      const h = HANDLES.find((x) => x.id === d.handle)!;
      let left = o0.x;
      let right = o0.x + o0.w;
      let top = o0.y;
      let bottom = o0.y + o0.h;
      if (h.hx === 0) left = Math.min(q.x, right - 4);
      if (h.hx === 1) right = Math.max(q.x, left + 4);
      if (h.hy === 0) top = Math.min(q.y, bottom - 4);
      if (h.hy === 1) bottom = Math.max(q.y, top + 4);
      const keepAspect = (o0.type === "image" ? !e.shiftKey : e.shiftKey) && h.hx !== 0.5 && h.hy !== 0.5;
      if (keepAspect) {
        const ratio = o0.w / o0.h;
        const nw = right - left;
        const nh = bottom - top;
        if (nw / nh > ratio) {
          const adj = nw / ratio;
          if (h.hy === 0) top = bottom - adj;
          else bottom = top + adj;
        } else {
          const adj = nh * ratio;
          if (h.hx === 0) left = right - adj;
          else right = left + adj;
        }
      }
      const nw = right - left;
      const nh = bottom - top;
      const c1 = rotateAbout({ x: (left + right) / 2, y: (top + bottom) / 2 }, c0, o0.rotation);
      st().liveUpdate((doc) => ({
        ...doc,
        objects: doc.objects.map((o) => {
          if (o.id !== d.id) return o;
          const next = { ...o, x: c1.x - nw / 2, y: c1.y - nh / 2, w: nw, h: nh };
          return o.type === "text" ? { ...next, h: Math.max(nh, fitHeight(next)) } : next;
        }),
      }));
    } else if (d.kind === "create") {
      const x = Math.min(d.start.x, p.x);
      const y = Math.min(d.start.y, p.y);
      const w = Math.max(Math.abs(p.x - d.start.x), d.type === "line" || d.type === "arrow" ? 1 : 1);
      const h = Math.max(Math.abs(p.y - d.start.y), 1);
      const base = createObject(d.type, page.id, x, y, w, h);
      if (d.type === "line" || d.type === "arrow") {
        base.pts = [
          { x: (d.start.x - x) / w, y: (d.start.y - y) / h },
          { x: (p.x - x) / w, y: (p.y - y) / h },
        ];
      }
      setDraft(base);
    } else if (d.kind === "draw") {
      d.pts.push(p);
      setDrawPts([...d.pts]);
    }
  };

  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.kind === "move" || d.kind === "resize" || d.kind === "rotate") {
      st().endGesture(d.kind === "move" ? "Move" : d.kind === "resize" ? "Resize" : "Rotate");
      return;
    }
    if (d.kind === "create" && draft) {
      let o = draft;
      const tiny = o.w < 4 && o.h < 4;
      if (tiny) {
        const defaults: Partial<Record<ObjType, [number, number]>> = { highlight: [120, 14], underline: [120, 14], strike: [120, 14], rect: [100, 60], ellipse: [100, 60], line: [100, 0], arrow: [100, 0], whiteout: [100, 24], redact: [100, 24], field: [140, 24] };
        const [w, h] = defaults[o.type] ?? [100, 40];
        o = { ...o, w, h: Math.max(h, 1) };
        if (o.type === "line" || o.type === "arrow") o.pts = [{ x: 0, y: 0 }, { x: 1, y: 0 }];
        o.y -= h / 2;
      }
      if (o.type === "field") {
        const n = st().doc!.objects.filter((x) => x.type === "field").length + 1;
        o = { ...o, fieldName: `field_${n}`, label: "Option 1" };
      }
      st().exec(addObjects([o]));
      select([o.id]);
      if (!KEEP_TOOL.has(st().tool)) st().set({ tool: "select" });
      setDraft(null);
    } else if (d.kind === "draw") {
      setDrawPts(null);
      if (d.pts.length < 2) return;
      const xs = d.pts.map((q) => q.x);
      const ys = d.pts.map((q) => q.y);
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      const w = Math.max(Math.max(...xs) - x, 1);
      const h = Math.max(Math.max(...ys) - y, 1);
      const o = createObject("draw", page.id, x, y, w, h);
      o.pts = simplify(d.pts).map((q) => ({ x: (q.x - x) / w, y: (q.y - y) / h }));
      st().exec(addObjects([o]));
      select([o.id]);
    }
  };

  const cursor = tool === "select" ? "default" : tool === "hand" ? "grab" : tool === "eraser" ? "cell" : tool === "edittext" ? "text" : "crosshair";
  const single = selection.length === 1 ? objects.find((o) => o.id === selection[0]) : undefined;
  const hs = 9 / zoom;
  const interactive = tool !== "hand";

  return (
    <svg
      ref={svgRef}
      className="overlay-svg absolute inset-0 touch-none"
      width={width}
      height={height}
      style={{ cursor, pointerEvents: interactive && tool !== "edittext" ? "auto" : "none", touchAction: tool === "select" && !selection.length ? "pan-x pan-y" : "none" }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      aria-label="Page editing layer"
    >
      <g transform={`matrix(${m.join(" ")})`}>
        {objects.map((o) => (
          <ObjectView key={o.id} o={o} selected={selection.includes(o.id)} />
        ))}
        {draft && <ObjectView o={draft} selected={false} />}
        {drawPts && <polyline points={drawPts.map((q) => `${q.x},${q.y}`).join(" ")} fill="none" stroke="#2563eb" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />}
        {tool === "select" && single && single.type !== "textedit" && (
          <g transform={`rotate(${single.rotation} ${single.x + single.w / 2} ${single.y + single.h / 2})`}>
            <rect x={single.x} y={single.y} width={single.w} height={single.h} fill="none" stroke="#4f46e5" strokeWidth={1.5 / zoom} strokeDasharray={`${4 / zoom}`} pointerEvents="none" />
            {HANDLES.map((h) => (
              <rect
                key={h.id}
                data-handle={h.id}
                x={single.x + single.w * h.hx - hs / 2}
                y={single.y + single.h * h.hy - hs / 2}
                width={hs}
                height={hs}
                fill="#fff"
                stroke="#4f46e5"
                strokeWidth={1.5 / zoom}
                style={{ cursor: `${h.id}-resize` }}
              />
            ))}
            <line x1={single.x + single.w / 2} y1={single.y} x2={single.x + single.w / 2} y2={single.y - 22 / zoom} stroke="#4f46e5" strokeWidth={1.5 / zoom} pointerEvents="none" />
            <circle data-handle="rot" cx={single.x + single.w / 2} cy={single.y - 22 / zoom} r={6 / zoom} fill="#4f46e5" style={{ cursor: "grab" }} />
          </g>
        )}
        {tool === "select" && single?.type === "textedit" && <rect x={single.x} y={single.y} width={single.w} height={single.h} fill="none" stroke="#4f46e5" strokeWidth={1.5 / zoom} strokeDasharray={`${4 / zoom}`} pointerEvents="none" />}
        {tool === "select" &&
          selection.length > 1 &&
          objects
            .filter((o) => selection.includes(o.id))
            .map((o) => <rect key={o.id} x={o.x} y={o.y} width={o.w} height={o.h} fill="none" stroke="#4f46e5" strokeWidth={1.5 / zoom} strokeDasharray={`${4 / zoom}`} pointerEvents="none" transform={`rotate(${o.rotation} ${o.x + o.w / 2} ${o.y + o.h / 2})`} />)}
      </g>
    </svg>
  );
}

/** Ramer-style thinning so freehand strokes don't store thousands of points. */
function simplify(pts: Pt[], tol = 0.35): Pt[] {
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const l = out[out.length - 1];
    if (Math.hypot(pts[i].x - l.x, pts[i].y - l.y) >= tol) out.push(pts[i]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

export function ObjectView({ o, selected }: { o: PdfObject; selected: boolean }) {
  const cx = o.x + o.w / 2;
  const cy = o.y + o.h / 2;
  const tr = o.rotation ? `rotate(${o.rotation} ${cx} ${cy})` : undefined;
  const hit = <rect x={o.x} y={o.y} width={o.w} height={o.h} fill="transparent" />;
  let body: React.ReactNode = null;
  switch (o.type) {
    case "text":
    case "textedit": {
      const { lines, lineHeight, firstBaseline } = layoutText(o);
      const f = fontCss(o);
      body = (
        <>
          {o.type === "textedit" &&
            (o.covers?.length ? o.covers : [{ x: o.x - 1, y: o.y - 1, w: o.w + 2, h: o.h + 2 }]).map((c, k) => <rect key={k} x={c.x} y={c.y} width={c.w} height={c.h} fill={o.bg ?? "#fff"} />)}
          {hit}
          <text fill={o.color} opacity={o.opacity} style={{ fontFamily: f.fontFamily, fontWeight: f.fontWeight, fontStyle: f.fontStyle }} fontSize={f.fontSize}>
            {lines.map((ln, k) => {
              const anchor = o.type === "text" ? o.align : "left";
              const x = anchor === "center" ? o.x + o.w / 2 : anchor === "right" ? o.x + o.w - 2 : o.x + (o.type === "text" ? 2 : 0);
              return (
                <tspan key={k} x={x} y={o.y + firstBaseline + k * lineHeight} textAnchor={anchor === "center" ? "middle" : anchor === "right" ? "end" : "start"} xmlSpace="preserve">
                  {ln || " "}
                </tspan>
              );
            })}
          </text>
          {selected && o.type === "text" && !o.text && <rect x={o.x} y={o.y} width={o.w} height={o.h} fill="none" stroke="#94a3b8" strokeDasharray="3" />}
        </>
      );
      break;
    }
    case "highlight":
      body = <rect x={o.x} y={o.y} width={o.w} height={o.h} fill={o.fill ?? o.color} opacity={o.opacity} style={{ mixBlendMode: "multiply" }} />;
      break;
    case "underline":
    case "strike": {
      const y = o.type === "underline" ? o.y + o.h - o.strokeWidth : o.y + o.h / 2;
      body = (
        <>
          {hit}
          <line x1={o.x} y1={y} x2={o.x + o.w} y2={y} stroke={o.color} strokeWidth={o.strokeWidth} opacity={o.opacity} />
        </>
      );
      break;
    }
    case "whiteout":
      body = <rect x={o.x} y={o.y} width={o.w} height={o.h} fill={o.fill ?? "#fff"} opacity={o.opacity} stroke="#cbd5e1" strokeWidth={0.5} strokeDasharray="2" />;
      break;
    case "redact":
      body = (
        <>
          <rect x={o.x} y={o.y} width={o.w} height={o.h} fill="#000" opacity={0.88} />
          <rect x={o.x} y={o.y} width={o.w} height={o.h} fill="none" stroke="#ef4444" strokeWidth={1} strokeDasharray="4 2" />
        </>
      );
      break;
    case "rect":
      body = <rect x={o.x} y={o.y} width={o.w} height={o.h} fill={o.fill ?? "none"} fillOpacity={o.fill ? o.opacity : 1} stroke={o.strokeWidth ? o.color : "none"} strokeWidth={o.strokeWidth} strokeOpacity={o.opacity} style={o.fill ? undefined : { pointerEvents: "all" }} />;
      break;
    case "ellipse":
      body = <ellipse cx={cx} cy={cy} rx={o.w / 2} ry={o.h / 2} fill={o.fill ?? "none"} fillOpacity={o.fill ? o.opacity : 1} stroke={o.strokeWidth ? o.color : "none"} strokeWidth={o.strokeWidth} strokeOpacity={o.opacity} style={o.fill ? undefined : { pointerEvents: "all" }} />;
      break;
    case "draw":
    case "line":
    case "arrow": {
      const pts = (o.pts ?? []).map((q) => ({ x: o.x + q.x * o.w, y: o.y + q.y * o.h }));
      const str = pts.map((q) => `${q.x},${q.y}`).join(" ");
      let head: React.ReactNode = null;
      if (o.type === "arrow" && pts.length >= 2) {
        const a = pts[pts.length - 2];
        const b = pts[pts.length - 1];
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        const len = Math.max(9, o.strokeWidth * 4.5);
        head = [-1, 1].map((s) => {
          const t = ang + Math.PI - s * 0.5;
          return <line key={s} x1={b.x} y1={b.y} x2={b.x + len * Math.cos(t)} y2={b.y + len * Math.sin(t)} stroke={o.color} strokeWidth={o.strokeWidth} strokeLinecap="round" opacity={o.opacity} />;
        });
      }
      body = (
        <>
          <polyline points={str} fill="none" stroke="transparent" strokeWidth={Math.max(12, o.strokeWidth + 8)} strokeLinecap="round" />
          <polyline points={str} fill="none" stroke={o.color} strokeWidth={o.strokeWidth} strokeLinecap="round" strokeLinejoin="round" opacity={o.opacity} />
          {head}
        </>
      );
      break;
    }
    case "image":
      body = <image href={o.dataUrl} x={o.x} y={o.y} width={o.w} height={o.h} preserveAspectRatio="none" opacity={o.opacity} />;
      break;
    case "note":
      body = (
        <g>
          <rect x={o.x} y={o.y} width={o.w} height={o.h} fill={o.fill ?? "#fde047"} stroke={o.color} />
          {[0.3, 0.5, 0.7].map((f) => (
            <line key={f} x1={o.x + o.w * 0.2} x2={o.x + o.w * 0.8} y1={o.y + o.h * f} y2={o.y + o.h * f} stroke="#854d0e" />
          ))}
          <title>{o.text}</title>
        </g>
      );
      break;
    case "field": {
      const icons: Record<string, string> = { text: "Aa", date: "📅", checkbox: "☑", radio: "◉", dropdown: "▾" };
      body = (
        <>
          <rect x={o.x} y={o.y} width={o.w} height={o.h} fill="#dbeafe" fillOpacity={0.45} stroke="#2563eb" strokeDasharray="4 2" />
          <text x={o.x + 4} y={o.y + Math.min(o.h - 4, 14)} fontSize={Math.min(11, o.h - 4)} fill="#1e3a8a" style={{ fontFamily: "Arial, sans-serif" }}>
            {icons[o.fieldKind ?? "text"]} {o.fieldName}
          </text>
        </>
      );
      break;
    }
  }
  return (
    <g data-obj={o.id} transform={tr}>
      {body}
      {selected && o.type === "highlight" && <rect x={o.x} y={o.y} width={o.w} height={o.h} fill="none" />}
    </g>
  );
}
