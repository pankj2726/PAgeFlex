import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { addObjects } from "../../lib/model/commands";
import type { PageModel } from "../../lib/model/commands";
import { canvasToPage, pageMatrix, pageToCanvas, type PageGeo } from "../../lib/model/coords";
import { useEditor } from "../../lib/model/docState";
import type { PdfObject } from "../../lib/model/objects";
import { sampleRunColors } from "../../lib/pdf/render";
import { makeEditObject } from "../../lib/text/editObject";
import {
  extendSelection,
  hitTest,
  inkCenter,
  nudgeSelection,
  selectLine,
  selectRange,
  selectRect,
  selectWord,
  targetString,
  type Glyph,
  type GlyphMap,
  type Pt,
  type Rect,
} from "../../lib/text/glyphMap";
import { getGlyphMap } from "../../lib/text/pageText";
import { btn } from "../ui";

const union = (gs: Glyph[]): Rect => {
  const x0 = Math.min(...gs.map((g) => g.ink.x));
  const y0 = Math.min(...gs.map((g) => g.ink.y));
  return { x: x0, y: y0, w: Math.max(...gs.map((g) => g.ink.x + g.ink.w)) - x0, h: Math.max(...gs.map((g) => g.ink.y + g.ink.h)) - y0 };
};
const inside = (r: Rect, p: Pt) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
const coversOf = (o: PdfObject): Rect[] => (o.covers?.length ? o.covers : [{ x: o.x - 1, y: o.y - 1, w: o.w + 2, h: o.h + 2 }]);

/**
 * Click-to-edit (Task 2). The editor only ever touches the exact characters the user indicated:
 * click = one word · double-click = the word · triple-click = the line (own column only) · drag = exact range ·
 * shift+click extends · alt+drag = rectangle of glyph ink centres · handles nudge start/end by one character.
 * The captured string is shown BEFORE editing, and `data-testid="captured-text"` exposes it to tests.
 */
export function TextEditLayer({ page, objects, geo, zoom, width, height, canvasRef }: { page: PageModel; objects: PdfObject[]; geo: PageGeo; zoom: number; width: number; height: number; canvasRef: RefObject<HTMLCanvasElement | null> }) {
  const doc = useEditor((s) => s.doc);
  const [map, setMap] = useState<GlyphMap | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "none">("loading");
  const [sel, setSel] = useState<number[]>([]);
  const [hoverWord, setHoverWord] = useState<number | null>(null);
  const [probe, setProbe] = useState<{ p: Pt; id: number | null } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ anchor: number | null; start: Pt; alt: boolean } | null>(null);
  const clicks = useRef({ t: 0, x: 0, y: 0, n: 0 });
  const debug = useMemo(() => /[?&]debug=text/.test(window.location.href), []);
  const m = pageMatrix(geo, zoom);

  useEffect(() => {
    let alive = true;
    setState("loading");
    if (!page.sourceId || !doc) {
      setMap(null);
      setState("none");
      return;
    }
    getGlyphMap(doc.sources[page.sourceId], page.srcIndex, page.cropBox)
      .then((g) => {
        if (!alive) return;
        setMap(g);
        setState(g.glyphs.length ? "ready" : "none");
      })
      .catch(() => alive && (setMap(null), setState("none")));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.id, page.sourceId, page.srcIndex]);

  // glyphs hidden under earlier cover rectangles must never be captured again
  const edits = useMemo(() => objects.filter((o) => o.type === "textedit"), [objects]);
  const dead = useCallback(
    (g: Glyph) => {
      const c = inkCenter(g);
      return edits.some((o) => coversOf(o).some((r) => inside(r, c)));
    },
    [edits]
  );

  const toPage = (e: { clientX: number; clientY: number }): Pt => {
    const r = svgRef.current!.getBoundingClientRect();
    return canvasToPage(geo, zoom, { x: e.clientX - r.left, y: e.clientY - r.top });
  };

  const focusText = () => setTimeout(() => window.dispatchEvent(new CustomEvent("qf-focus-text")), 50);

  const commit = useCallback(
    (ids: number[]) => {
      if (!map || !ids.length) return;
      let colors: { bg: string; fg: string } | undefined;
      const canvas = canvasRef.current;
      const first = map.glyphs[ids[0]];
      if (canvas && canvas.width > 1) {
        const a = pageToCanvas(geo, zoom, { x: first.ink.x - 1, y: first.ink.y - 1 });
        const b = pageToCanvas(geo, zoom, { x: first.ink.x + first.ink.w + 1, y: first.ink.y + first.ink.h + 1 });
        const k = canvas.width / width;
        // sample ONLY the pixels immediately around the first target glyph
        colors = sampleRunColors(canvas, Math.min(a.x, b.x) * k, Math.min(a.y, b.y) * k, Math.abs(b.x - a.x) * k, Math.abs(b.y - a.y) * k);
      }
      const r = makeEditObject(map, ids, page.id, { colors });
      const st = useEditor.getState();
      if (!r.ok) return st.toast("error", r.error);
      st.exec(addObjects([r.obj]));
      useEditor.setState({ selection: [r.obj.id] });
      setSel([]);
      focusText();
    },
    [map, page.id, canvasRef, geo, zoom, width]
  );

  useEffect(() => {
    if (!sel.length) return;
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return;
      if (e.key === "Enter") {
        e.preventDefault();
        commit(sel);
      } else if (e.key === "Escape") setSel([]);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [sel, commit]);

  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 || !map) return;
    const p = toPage(e);
    // an earlier edit under the pointer is edited again instead of capturing the (hidden) original glyphs
    const existing = [...edits].reverse().find((o) => coversOf(o).some((r) => inside(r, p)));
    if (existing) {
      useEditor.setState({ selection: [existing.id] });
      setSel([]);
      focusText();
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    const now = Date.now();
    const c = clicks.current;
    c.n = now - c.t < 450 && Math.hypot(e.clientX - c.x, e.clientY - c.y) < 5 ? c.n + 1 : 1;
    c.t = now;
    c.x = e.clientX;
    c.y = e.clientY;
    const hit = hitTest(map, p, { dead });
    setProbe({ p, id: hit?.id ?? null });
    if (e.altKey) {
      drag.current = { anchor: null, start: p, alt: true };
      setSel([]);
      return;
    }
    if (!hit) {
      drag.current = null;
      setSel([]);
      return;
    }
    drag.current = { anchor: hit.id, start: p, alt: false };
    if (e.shiftKey) setSel(extendSelection(map, sel, hit.id));
    else setSel(c.n >= 3 ? selectLine(map, hit.id) : selectWord(map, hit.id));
  };

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!map) return;
    const p = toPage(e);
    const d = drag.current;
    if (d && e.buttons === 1) {
      if (d.alt) {
        const r = { x: Math.min(d.start.x, p.x), y: Math.min(d.start.y, p.y), w: Math.abs(p.x - d.start.x), h: Math.abs(p.y - d.start.y) };
        setSel(selectRect(map, r).filter((id) => !dead(map.glyphs[id])));
      } else if (d.anchor !== null && Math.hypot(p.x - d.start.x, p.y - d.start.y) > 1.5) {
        const h = hitTest(map, p, { dead });
        if (h) setSel(selectRange(map, d.anchor, h.id));
      }
      return;
    }
    const h = hitTest(map, p, { dead });
    setHoverWord(h && h.wordId >= 0 ? h.wordId : null);
    if (debug) setProbe({ p, id: h?.id ?? null });
  };

  const captured = map && sel.length ? targetString(map, sel) : "";
  const selGlyphs = map ? sel.map((i) => map.glyphs[i]) : [];
  const selLines = useMemo(() => {
    const by = new Map<number, Glyph[]>();
    for (const g of selGlyphs) by.set(g.lineId, [...(by.get(g.lineId) ?? []), g]);
    return [...by.values()].map(union);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, map]);

  let bar: { left: number; top: number } | null = null;
  if (selGlyphs.length) {
    const u = union(selGlyphs);
    const a = pageToCanvas(geo, zoom, { x: u.x, y: u.y });
    const b = pageToCanvas(geo, zoom, { x: u.x + u.w, y: u.y + u.h });
    bar = { left: Math.max(2, Math.min(Math.min(a.x, b.x), Math.max(2, width - 330))), top: Math.max(2, Math.min(a.y, b.y) - 42) };
  }
  const chars = [...captured.replace(/\n/g, "")].length;

  return (
    <>
      <svg ref={svgRef} className="absolute inset-0 touch-none" width={width} height={height} style={{ cursor: "text" }} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={() => (drag.current = null)} onPointerLeave={() => setHoverWord(null)} aria-label="Click a word to edit it">
        <g transform={`matrix(${m.join(" ")})`}>
          {map && hoverWord !== null && !sel.length && <rect {...rectProps(union(map.words[hoverWord].map((i) => map.glyphs[i])))} fill="rgba(79,70,229,0.14)" stroke="#4f46e5" strokeWidth={0.6} />}
          {selLines.map((r, i) => (
            <rect key={i} {...rectProps(r)} fill="rgba(79,70,229,0.28)" stroke="#4f46e5" strokeWidth={0.8} />
          ))}
          {debug && map && (
            <g pointerEvents="none" data-testid="debug-overlay">
              {map.glyphs.map((g) => (
                <polygon key={g.id} points={g.quad.map((q) => `${q.x},${q.y}`).join(" ")} fill="none" stroke="#94a3b8" strokeWidth={0.25} />
              ))}
              {map.words.map((w, i) => (
                <rect key={`w${i}`} {...rectProps(union(w.map((id) => map.glyphs[id])))} fill="none" stroke="#16a34a" strokeWidth={0.4} strokeDasharray="1.5 1" />
              ))}
              {map.lines.map((l) => (
                <rect key={`l${l.id}`} {...rectProps(l.bbox)} fill="none" stroke="#f97316" strokeWidth={0.5} />
              ))}
              {probe && (
                <>
                  <line x1={probe.p.x - 4} x2={probe.p.x + 4} y1={probe.p.y} y2={probe.p.y} stroke="#dc2626" strokeWidth={0.6} />
                  <line y1={probe.p.y - 4} y2={probe.p.y + 4} x1={probe.p.x} x2={probe.p.x} stroke="#dc2626" strokeWidth={0.6} />
                  {probe.id !== null && <rect {...rectProps(map.glyphs[probe.id].ink)} fill="rgba(220,38,38,0.35)" />}
                </>
              )}
            </g>
          )}
        </g>
      </svg>
      <div data-testid="captured-text" data-count={chars} className="sr-only" aria-live="polite">
        {captured}
      </div>
      {state === "loading" && <div className="pointer-events-none absolute left-2 top-2 rounded bg-slate-900/70 px-2 py-0.5 text-xs text-white">Reading text…</div>}
      {state === "none" && <div className="pointer-events-none absolute left-2 top-2 rounded bg-amber-600 px-2 py-0.5 text-xs text-white">No selectable text on this page (scan?). Run OCR first.</div>}
      {bar && map && (
        <div className="absolute z-10 flex max-w-[min(96%,22rem)] items-center gap-1 rounded-lg border border-indigo-300 bg-white p-1 text-xs shadow-lg dark:border-indigo-700 dark:bg-slate-900" style={{ left: bar.left, top: bar.top }} role="group" aria-label="Captured text">
          <span className="max-w-40 truncate px-1 font-mono" title={captured}>
            “{captured.replace(/\n/g, " ⏎ ")}” · {chars} char{chars === 1 ? "" : "s"}
          </span>
          <button className={`${btn} !px-1.5 !py-0.5`} aria-label="Start one character earlier" onClick={() => setSel(nudgeSelection(map, sel, "start", -1))}>⇤−</button>
          <button className={`${btn} !px-1.5 !py-0.5`} aria-label="Start one character later" onClick={() => setSel(nudgeSelection(map, sel, "start", 1))}>⇤+</button>
          <button className={`${btn} !px-1.5 !py-0.5`} aria-label="End one character earlier" onClick={() => setSel(nudgeSelection(map, sel, "end", -1))}>−⇥</button>
          <button className={`${btn} !px-1.5 !py-0.5`} aria-label="End one character later" onClick={() => setSel(nudgeSelection(map, sel, "end", 1))}>+⇥</button>
          <button className="rounded bg-indigo-600 px-2 py-0.5 font-semibold text-white" onClick={() => commit(sel)}>Edit ⏎</button>
          <button className={`${btn} !px-1.5 !py-0.5`} aria-label="Clear selection" onClick={() => setSel([])}>✕</button>
        </div>
      )}
    </>
  );
}

const rectProps = (r: Rect) => ({ x: r.x, y: r.y, width: r.w, height: r.h });
