import type { Pt } from "./coords";

export type ObjType =
  | "text"
  | "highlight"
  | "underline"
  | "strike"
  | "draw"
  | "rect"
  | "ellipse"
  | "line"
  | "arrow"
  | "image"
  | "note"
  | "whiteout"
  | "redact"
  | "textedit"
  | "field";

export type FontFamily = "sans" | "serif" | "mono";
export type FieldKind = "text" | "checkbox" | "radio" | "dropdown" | "date";

/** One flat shape for every editor object; `type` decides which optional props are used. Geometry is PAGE SPACE (pt). */
export interface PdfObject {
  id: string;
  pageId: string;
  type: ObjType;
  x: number;
  y: number;
  w: number;
  h: number;
  /** clockwise degrees about the box centre */
  rotation: number;
  opacity: number;
  // appearance
  color: string; // stroke / text colour (#rrggbb)
  fill: string | null; // fill colour or null
  strokeWidth: number;
  // text-ish
  text?: string;
  fontSize?: number;
  family?: FontFamily;
  bold?: boolean;
  italic?: boolean;
  align?: "left" | "center" | "right";
  // freehand / line / arrow: points normalised 0..1 inside the box
  pts?: Pt[];
  // image / signature
  dataUrl?: string;
  // textedit
  origText?: string;
  /** exact cover rectangles (page space) for the target glyphs of an edit, one per line */
  covers?: { x: number; y: number; w: number; h: number }[];
  bg?: string;
  baseline?: number; // baseline offset from box top (pt)
  // form field
  fieldKind?: FieldKind;
  fieldName?: string;
  options?: string[];
  // metadata
  label?: string;
}

let counter = 0;
export function uid(prefix = "o"): string {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function baseObject(type: ObjType, pageId: string, x: number, y: number, w: number, h: number): PdfObject {
  return {
    id: uid("o"),
    pageId,
    type,
    x,
    y,
    w,
    h,
    rotation: 0,
    opacity: 1,
    color: "#111827",
    fill: null,
    strokeWidth: 2,
  };
}

/** Defaults for each tool when an object is first created. */
export function createObject(type: ObjType, pageId: string, x: number, y: number, w: number, h: number): PdfObject {
  const o = baseObject(type, pageId, x, y, w, h);
  switch (type) {
    case "text":
      return { ...o, text: "Text", fontSize: 16, family: "sans", bold: false, italic: false, align: "left" };
    case "highlight":
      return { ...o, color: "#facc15", fill: "#facc15", opacity: 0.4 };
    case "underline":
      return { ...o, color: "#dc2626", strokeWidth: 1.5 };
    case "strike":
      return { ...o, color: "#dc2626", strokeWidth: 1.5 };
    case "draw":
      return { ...o, color: "#2563eb", strokeWidth: 2.5, pts: [] };
    case "rect":
      return { ...o, color: "#dc2626", strokeWidth: 2 };
    case "ellipse":
      return { ...o, color: "#2563eb", strokeWidth: 2 };
    case "line":
      return { ...o, color: "#111827", strokeWidth: 2.5, pts: [{ x: 0, y: 0 }, { x: 1, y: 1 }] };
    case "arrow":
      return { ...o, color: "#111827", strokeWidth: 2.5, pts: [{ x: 0, y: 0 }, { x: 1, y: 1 }] };
    case "note":
      return { ...o, w: 24, h: 24, color: "#eab308", fill: "#fde047", text: "Note" };
    case "whiteout":
      return { ...o, color: "#ffffff", fill: "#ffffff", strokeWidth: 0 };
    case "redact":
      return { ...o, color: "#000000", fill: "#000000", strokeWidth: 0 };
    case "field":
      return { ...o, fieldKind: "text", fieldName: "field", options: [], strokeWidth: 1, color: "#2563eb" };
    default:
      return o;
  }
}

export function hexToRgb01(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function boxesIntersect(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number }
): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Object kinds that can carry readable text / image data and therefore must not survive under a redaction. */
export const CONTENT_BEARING: ObjType[] = ["text", "textedit", "note", "image", "field"];

/** Word-wrap with an injected measure function so screen (canvas) and export (pdf-lib) share one algorithm. */
export function wrapText(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const out: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    if (para === "") {
      out.push("");
      continue;
    }
    let line = "";
    for (const word of para.split(/(\s+)/)) {
      const test = line + word;
      if (line !== "" && measure(test.trimEnd()) > maxWidth) {
        out.push(line.trimEnd());
        line = word.trimStart();
      } else {
        line = test;
      }
    }
    out.push(line.trimEnd());
  }
  return out;
}
