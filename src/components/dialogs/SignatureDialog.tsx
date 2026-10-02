import { useEffect, useRef, useState } from "react";
import { addObjects } from "../../lib/model/commands";
import { useEditor } from "../../lib/model/docState";
import { createObject } from "../../lib/model/objects";
import { fileToImage, trimCanvas, type LoadedImage } from "../../lib/pdf/images";
import { Modal, btn, btnPrimary, input, Label } from "../ui";
import { cn } from "../../utils/cn";

const FONTS = ['"Brush Script MT", "Segoe Script", "Snell Roundhand", cursive', '"Segoe Script", "Apple Chancery", cursive', '"Lucida Handwriting", "Bradley Hand", cursive', 'Georgia, "Times New Roman", serif'];

export function SignatureDialog({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<"draw" | "type" | "upload">("draw");
  const [typed, setTyped] = useState("");
  const [font, setFont] = useState(0);
  const [color, setColor] = useState("#111827");
  const [uploaded, setUploaded] = useState<LoadedImage | null>(null);
  const [empty, setEmpty] = useState(true);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }, [tab]);

  const pos = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * canvas.current!.width, y: ((e.clientY - r.top) / r.height) * canvas.current!.height };
  };
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const ctx = canvas.current!.getContext("2d")!;
    const p = pos(e);
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + 0.01, p.y + 0.01);
    ctx.stroke();
    setEmpty(false);
  };
  const move = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    const ctx = canvas.current!.getContext("2d")!;
    const p = pos(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  };
  const clear = () => {
    const c = canvas.current;
    c?.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    setEmpty(true);
  };

  const build = (): LoadedImage | null => {
    if (tab === "draw" && canvas.current) return empty ? null : trimCanvas(canvas.current);
    if (tab === "type") {
      if (!typed.trim()) return null;
      const c = document.createElement("canvas");
      c.width = 1200;
      c.height = 300;
      const ctx = c.getContext("2d")!;
      ctx.font = `120px ${FONTS[font]}`;
      ctx.fillStyle = color;
      ctx.textBaseline = "middle";
      const w = Math.min(1150, ctx.measureText(typed).width);
      ctx.fillText(typed, 20, 150, w);
      return trimCanvas(c);
    }
    return uploaded;
  };

  const use = () => {
    const img = build();
    if (!img) return;
    const st = useEditor.getState();
    const page = st.doc!.pages[st.currentPage] ?? st.doc!.pages[0];
    const pw = Math.abs(page.cropBox[2] - page.cropBox[0]);
    const ph = Math.abs(page.cropBox[3] - page.cropBox[1]);
    const w = Math.min(170, pw * 0.4);
    const h = (w * img.height) / img.width;
    const o = createObject("image", page.id, (pw - w) / 2, (ph - h) / 2, w, h);
    o.dataUrl = img.dataUrl;
    o.label = "signature";
    st.exec(addObjects([o]));
    useEditor.setState({ selection: [o.id], tool: "select" });
    onClose();
  };

  const tabBtn = (id: typeof tab, label: string) => (
    <button role="tab" aria-selected={tab === id} className={cn(btn, tab === id && "!bg-indigo-100 dark:!bg-indigo-900")} onClick={() => setTab(id)}>
      {label}
    </button>
  );

  return (
    <Modal
      title="Add your signature"
      onClose={onClose}
      footer={
        <>
          <button className={btn} onClick={onClose}>
            Cancel
          </button>
          <button className={btnPrimary} onClick={use} disabled={tab === "draw" ? empty : tab === "type" ? !typed.trim() : !uploaded}>
            Place on page
          </button>
        </>
      }
    >
      <p className="mb-3 rounded-md bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">This adds a <strong>visual signature</strong> (an image). It is not a certified digital signature (no certificate or PKI).</p>
      <div role="tablist" className="mb-3 flex gap-2">
        {tabBtn("draw", "Draw")}
        {tabBtn("type", "Type")}
        {tabBtn("upload", "Upload")}
      </div>
      {tab === "draw" && (
        <div>
          <canvas ref={canvas} width={900} height={300} className="w-full touch-none rounded-lg border border-dashed border-slate-400 bg-white" onPointerDown={down} onPointerMove={move} onPointerUp={() => (drawing.current = false)} aria-label="Signature drawing area" />
          <div className="mt-2 flex items-center gap-3">
            <button className={btn} onClick={clear}>
              Clear
            </button>
            <label className="flex items-center gap-2 text-sm">
              Ink <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Ink colour" />
            </label>
          </div>
        </div>
      )}
      {tab === "type" && (
        <div className="space-y-3">
          <div>
            <Label>Your name</Label>
            <input className={input} value={typed} onChange={(e) => setTyped(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            {FONTS.map((f, i) => (
              <button key={i} onClick={() => setFont(i)} aria-pressed={font === i} className={cn("rounded-lg border p-3 text-2xl", font === i ? "border-indigo-600 bg-indigo-50 dark:bg-indigo-950" : "border-slate-300 dark:border-slate-600")} style={{ fontFamily: f, color }}>
                {typed || "Signature"}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm">
            Ink <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Ink colour" />
          </label>
        </div>
      )}
      {tab === "upload" && (
        <div>
          <input
            type="file"
            accept="image/*"
            aria-label="Signature image"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) setUploaded(await fileToImage(f, 1200));
            }}
          />
          {uploaded && <img src={uploaded.dataUrl} alt="Uploaded signature preview" className="mt-3 max-h-32 rounded border bg-white p-2" />}
        </div>
      )}
    </Modal>
  );
}
