/**
 * The ONLY place coordinate maths lives (rule R2).
 *
 * Three spaces:
 *  - PDF space:    points, origin bottom-left, y up (what PDF content streams use).
 *  - Page space:   points, origin top-left of the CROP BOX, y down, page /Rotate ignored.
 *                  Editor objects are stored here, so rotating a page is just one matrix.
 *  - Canvas space: CSS px of the displayed page (after rotation and zoom), origin top-left.
 *
 * `rotation` is the TOTAL clockwise display rotation (page /Rotate + view rotation), multiple of 90.
 */
export type Box = [number, number, number, number]; // [x0, y0, x1, y1] in PDF space
export interface Pt {
  x: number;
  y: number;
}
export interface PageGeo {
  cropBox: Box;
  rotation: number;
}

export function normRot(r: number): 0 | 90 | 180 | 270 {
  return ((((Math.round(r / 90) * 90) % 360) + 360) % 360) as 0 | 90 | 180 | 270;
}

/** Unrotated crop-box size in points. */
export function pageSize(g: PageGeo): { w: number; h: number } {
  return { w: Math.abs(g.cropBox[2] - g.cropBox[0]), h: Math.abs(g.cropBox[3] - g.cropBox[1]) };
}

/** Size of the displayed page in CSS px. */
export function displaySize(g: PageGeo, zoom = 1): { w: number; h: number } {
  const { w, h } = pageSize(g);
  const r = normRot(g.rotation);
  return r === 90 || r === 270 ? { w: h * zoom, h: w * zoom } : { w: w * zoom, h: h * zoom };
}

/** Affine matrix [a,b,c,d,e,f] mapping page space -> canvas space (SVG/CSS matrix order). */
export function pageMatrix(g: PageGeo, zoom: number): [number, number, number, number, number, number] {
  const { w: W, h: H } = pageSize(g);
  switch (normRot(g.rotation)) {
    case 90:
      return [0, zoom, -zoom, 0, H * zoom, 0];
    case 180:
      return [-zoom, 0, 0, -zoom, W * zoom, H * zoom];
    case 270:
      return [0, -zoom, zoom, 0, 0, W * zoom];
    default:
      return [zoom, 0, 0, zoom, 0, 0];
  }
}

export function pageToCanvas(g: PageGeo, zoom: number, p: Pt): Pt {
  const [a, b, c, d, e, f] = pageMatrix(g, zoom);
  return { x: a * p.x + c * p.y + e, y: b * p.x + d * p.y + f };
}

export function canvasToPage(g: PageGeo, zoom: number, p: Pt): Pt {
  const [a, b, c, d, e, f] = pageMatrix(g, zoom);
  const det = a * d - b * c;
  const x = p.x - e;
  const y = p.y - f;
  return { x: (d * x - c * y) / det, y: (-b * x + a * y) / det };
}

export function pdfToPage(g: PageGeo, p: Pt): Pt {
  return { x: p.x - Math.min(g.cropBox[0], g.cropBox[2]), y: Math.max(g.cropBox[1], g.cropBox[3]) - p.y };
}

export function pageToPdf(g: PageGeo, p: Pt): Pt {
  return { x: p.x + Math.min(g.cropBox[0], g.cropBox[2]), y: Math.max(g.cropBox[1], g.cropBox[3]) - p.y };
}

export function pdfToCanvas(g: PageGeo, zoom: number, p: Pt): Pt {
  return pageToCanvas(g, zoom, pdfToPage(g, p));
}

export function canvasToPdf(g: PageGeo, zoom: number, p: Pt): Pt {
  return pageToPdf(g, canvasToPage(g, zoom, p));
}

/** Rotate point `p` about `c` by `deg` degrees clockwise on screen (page space has y down). */
export function rotateAbout(p: Pt, c: Pt, deg: number): Pt {
  const t = (deg * Math.PI) / 180;
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: c.x + dx * Math.cos(t) - dy * Math.sin(t), y: c.y + dx * Math.sin(t) + dy * Math.cos(t) };
}
