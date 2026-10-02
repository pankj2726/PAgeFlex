import { cssFont } from "../../lib/fonts/fontMap";
import { wrapText, type PdfObject } from "../../lib/model/objects";

let ctx: CanvasRenderingContext2D | null = null;
function measureCtx() {
  if (!ctx) ctx = document.createElement("canvas").getContext("2d")!;
  return ctx;
}

export function measure(o: Pick<PdfObject, "family" | "bold" | "italic" | "fontSize">, s: string): number {
  const c = measureCtx();
  c.font = cssFont(o.family, o.bold, o.italic, o.fontSize ?? 12);
  return c.measureText(s).width;
}

export interface TextLayout {
  lines: string[];
  lineHeight: number;
  firstBaseline: number; // from box top
}

/** Same wrapping algorithm as export (shared wrapText); metrics from Arial/Times/Courier ≈ Helvetica/Times/Courier. */
export function layoutText(o: PdfObject): TextLayout {
  const size = o.fontSize ?? 12;
  const text = o.text ?? "";
  const lines = o.type === "text" ? wrapText(text, Math.max(10, o.w - 4), (s) => measure(o, s)) : text.split(/\r?\n/);
  return { lines, lineHeight: size * 1.2, firstBaseline: o.type === "textedit" ? (o.baseline ?? size * 0.9) : 2 + size * 0.88 };
}

/** Height a text box needs to show all its lines. */
export function fitHeight(o: PdfObject): number {
  const { lines, lineHeight } = layoutText(o);
  return Math.max(lineHeight + 4, lines.length * lineHeight + 4);
}

export function fontCss(o: PdfObject) {
  const stack = o.family === "serif" ? '"Times New Roman", Times, serif' : o.family === "mono" ? '"Courier New", Courier, monospace' : 'Helvetica, Arial, "Liberation Sans", sans-serif';
  return { fontFamily: stack, fontWeight: o.bold ? 700 : 400, fontStyle: o.italic ? "italic" : "normal", fontSize: o.fontSize ?? 12 } as const;
}
