import { describe, expect, it } from "vitest";
import { canvasToPage, canvasToPdf, displaySize, pageMatrix, pageToCanvas, pdfToCanvas, pdfToPage, pageToPdf, normRot, rotateAbout, type PageGeo } from "../lib/model/coords";

const W = 200;
const H = 100;
const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

describe("coords – rotations 0/90/180/270 (uncropped 200×100 page)", () => {
  const z = 2;
  const geo = (rotation: number): PageGeo => ({ cropBox: [0, 0, W, H], rotation });

  it("maps the page-space top-left corner to the right canvas corner", () => {
    const tl = (r: number) => pageToCanvas(geo(r), z, { x: 0, y: 0 });
    expect(tl(0)).toEqual({ x: 0, y: 0 });
    expect(tl(90)).toEqual({ x: H * z, y: 0 }); // top-left goes to top-right
    expect(tl(180)).toEqual({ x: W * z, y: H * z });
    expect(tl(270)).toEqual({ x: 0, y: W * z });
  });

  it("swaps display size for 90/270", () => {
    expect(displaySize(geo(0), z)).toEqual({ w: W * z, h: H * z });
    expect(displaySize(geo(90), z)).toEqual({ w: H * z, h: W * z });
    expect(displaySize(geo(180), z)).toEqual({ w: W * z, h: H * z });
    expect(displaySize(geo(270), z)).toEqual({ w: H * z, h: W * z });
  });

  for (const r of [0, 90, 180, 270]) {
    it(`round-trips page↔canvas and pdf↔canvas at ${r}°`, () => {
      const g = geo(r);
      for (const p of [{ x: 0, y: 0 }, { x: 37.5, y: 12.25 }, { x: W, y: H }]) {
        const c = pageToCanvas(g, z, p);
        const back = canvasToPage(g, z, c);
        near(back.x, p.x);
        near(back.y, p.y);
        const pdf = { x: p.x, y: H - p.y };
        const c2 = pdfToCanvas(g, z, pdf);
        const b2 = canvasToPdf(g, z, c2);
        near(b2.x, pdf.x);
        near(b2.y, pdf.y);
      }
    });

    it(`keeps canvas points inside the displayed page at ${r}°`, () => {
      const g = geo(r);
      const { w, h } = displaySize(g, z);
      for (const p of [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }]) {
        const c = pageToCanvas(g, z, p);
        expect(c.x).toBeGreaterThanOrEqual(-1e-9);
        expect(c.y).toBeGreaterThanOrEqual(-1e-9);
        expect(c.x).toBeLessThanOrEqual(w + 1e-9);
        expect(c.y).toBeLessThanOrEqual(h + 1e-9);
      }
    });
  }

  it("matrix matches pageToCanvas", () => {
    const g = geo(270);
    const [a, b, c, d, e, f] = pageMatrix(g, z);
    const p = { x: 10, y: 20 };
    expect(pageToCanvas(g, z, p)).toEqual({ x: a * p.x + c * p.y + e, y: b * p.x + d * p.y + f });
  });
});

describe("coords – cropped pages (CropBox with non-zero origin)", () => {
  const cropped: PageGeo = { cropBox: [50, 40, 250, 140], rotation: 0 };
  it("page-space origin is the TOP-LEFT of the crop box", () => {
    expect(pdfToPage(cropped, { x: 50, y: 140 })).toEqual({ x: 0, y: 0 });
    expect(pdfToPage(cropped, { x: 250, y: 40 })).toEqual({ x: 200, y: 100 });
    expect(pageToPdf(cropped, { x: 0, y: 0 })).toEqual({ x: 50, y: 140 });
  });
  it("round-trips through every rotation", () => {
    for (const r of [0, 90, 180, 270]) {
      const g = { ...cropped, rotation: r };
      const p = { x: 123, y: 77 };
      const back = canvasToPdf(g, 1.5, pdfToCanvas(g, 1.5, p));
      near(back.x, p.x);
      near(back.y, p.y);
    }
  });
});

describe("helpers", () => {
  it("normRot wraps and rounds to multiples of 90", () => {
    expect(normRot(-90)).toBe(270);
    expect(normRot(450)).toBe(90);
    expect(normRot(89)).toBe(90);
  });
  it("rotateAbout rotates clockwise on a y-down page", () => {
    const p = rotateAbout({ x: 1, y: 0 }, { x: 0, y: 0 }, 90);
    near(p.x, 0);
    near(p.y, 1);
  });
});
