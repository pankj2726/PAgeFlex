/**
 * TASKS-02 Task 2 – selection model tests on SYNTHETIC layouts (NOT YET RUN: no shell in the authoring environment).
 * Real-PDF fixtures (dense paragraph, tables, scans with OCR, ligatures, earlier edits…) are listed in
 * tests/fixtures/README.md and covered by tests/e2e/selection.spec.ts; they still have to be created.
 */
import { describe, expect, it } from "vitest";
import {
  buildGlyphMap,
  computeCovers,
  guardTarget,
  hitTest,
  nudgeSelection,
  selectLine,
  selectRange,
  selectRect,
  selectWord,
  extendSelection,
  targetString,
  inkCenter,
  type GlyphMap,
  type RawItem,
} from "../lib/text/glyphMap";
import { makeEditObject } from "../lib/text/editObject";
import { verifyEditedText } from "../lib/text/verifyEdit";
import { canvasToPage, pageToCanvas, type PageGeo } from "../lib/model/coords";

const item = (str: string, x: number, baseline: number, size = 10, w?: number, angle = 0): RawItem => ({
  str,
  x,
  baseline,
  w: w ?? str.length * size * 0.5,
  size,
  angle,
  fontName: "f",
  family: "sans",
  bold: false,
  italic: false,
});
const wordStr = (m: GlyphMap, ids: number[]) => ids.map((i) => m.glyphs[i].char).join("");
const allWords = (m: GlyphMap) => m.words.map((w) => wordStr(m, w));

const LINES = ["The quick brown fox jumps over", "the lazy dog and then keeps going", "fi ligature naïve café Straße end", "tight leading keeps lines close together"];
const paragraph = () => buildGlyphMap(LINES.map((l, i) => item(l, 50, 100 + i * 12, 10, l.length * 4.6)));

describe("selection sweep – click every word, capture exactly that word", () => {
  const map = paragraph();
  const expected = LINES.flatMap((l) => l.split(" "));

  it("splits the page into exactly the expected words, in reading order", () => {
    expect(allWords(map)).toEqual(expected);
  });

  it("click at glyph centres, first glyph, last glyph and the baseline edge → exactly the word, zero extra characters", () => {
    for (const ids of map.words) {
      const word = wordStr(map, ids);
      for (const gid of ids) {
        const g = map.glyphs[gid];
        if (g.mark || g.advance <= 0) continue;
        const c = inkCenter(g);
        for (const p of [c, { x: g.ink.x + 0.3, y: g.baseline - 2 }, { x: g.ink.x + g.ink.w - 0.3, y: g.baseline - 2 }, { x: c.x, y: g.baseline + 0.5 }]) {
          const hit = hitTest(map, p);
          expect(hit, `${word}@${p.x},${p.y}`).not.toBeNull();
          const got = wordStr(map, selectWord(map, hit!.id));
          expect(got).toBe(word);
        }
      }
    }
  });

  it("triple click captures the line only", () => {
    const g = hitTest(map, inkCenter(map.glyphs[map.words[2][0]]))!;
    expect(wordStr(map, selectLine(map, g.id))).toBe(LINES[0]);
  });

  it("drag selects an exact character range, trimmed, in reading order", () => {
    const a = map.words[1][0]; // 'q'
    const b = map.words[2][map.words[2].length - 1]; // last char of 'brown'
    expect(targetString(map, selectRange(map, a, b))).toBe("quick brown");
  });

  it("shift+click extends; handles move one character at a time", () => {
    const q = selectWord(map, map.words[1][0]);
    expect(targetString(map, extendSelection(map, q, map.words[3][0]))).toBe("quick brown f");
    expect(targetString(map, nudgeSelection(map, q, "end", -1))).toBe("quic");
    expect(targetString(map, nudgeSelection(map, q, "start", 1))).toBe("uick");
  });
});

describe("negative tests – nothing is captured", () => {
  const map = paragraph();
  it("blank margins and the gap between lines capture nothing", () => {
    expect(hitTest(map, { x: 5, y: 100 })).toBeNull();
    expect(hitTest(map, { x: 600, y: 100 })).toBeNull();
    expect(hitTest(map, { x: 80, y: 20 })).toBeNull();
    // exactly between line 0 and line 1 (quads are ascent 0.8 / descent 0.2: 2 pt dead band)
    expect(hitTest(map, { x: 80, y: 103 })).toBeNull();
  });
  it("tolerance never exceeds 2 pt", () => {
    const g = map.glyphs[0];
    expect(hitTest(map, { x: g.ink.x - 1.5, y: g.baseline - 3 }, { tol: 50 })).not.toBeNull();
    expect(hitTest(map, { x: g.ink.x - 2.6, y: g.baseline - 3 }, { tol: 50 })).toBeNull();
  });
  it("clicking the gap between two touching words captures ONE word, never both", () => {
    const m = buildGlyphMap([item("Hello ", 50, 100, 10, 30), item("World", 80, 100, 10, 25)]);
    expect(allWords(m)).toEqual(["Hello", "World"]);
    const space = m.glyphs.find((g) => g.space)!;
    const hit = hitTest(m, inkCenter(space));
    expect(hit).not.toBeNull();
    expect(["Hello", "World"]).toContain(wordStr(m, selectWord(m, hit!.id)));
  });
  it("glyphs under earlier cover rectangles can be excluded (dead)", () => {
    const g = map.glyphs[5];
    const hit = hitTest(map, inkCenter(g), { dead: (x) => x.id === g.id });
    expect(hit?.id).not.toBe(g.id);
  });
});

describe("two columns, gutters, spanning headings", () => {
  const map = buildGlyphMap([
    item("Page Heading Spans Both", 50, 60, 14, 400),
    item("left one", 50, 100, 10, 140),
    item("right one", 250, 100, 10, 140),
    item("left two", 50, 112, 10, 140),
    item("right two", 250, 112, 10, 140),
  ]);
  it("never merges across the gutter; reads the whole left column before the right", () => {
    expect(map.lines.map((l) => wordStr(map, l.glyphIds))).toEqual(["Page Heading Spans Both", "left one", "left two", "right one", "right two"]);
    // the heading overlaps the left column's first line, so they share a column id; the right column is a new one
    expect(new Set(map.lines.map((l) => l.columnId)).size).toBe(2);
    expect(map.lines[3].columnId).not.toBe(map.lines[2].columnId);
  });
  it("the gutter and words next to it behave", () => {
    expect(hitTest(map, { x: 220, y: 97 })).toBeNull();
    const nearGutter = hitTest(map, { x: 189, y: 97 })!;
    expect(wordStr(map, selectWord(map, nearGutter.id))).toBe("one");
    expect(map.glyphs[nearGutter.id].columnId).not.toBe(map.glyphs[hitTest(map, { x: 252, y: 97 })!.id].columnId);
  });
  it("dragging from the left column into the right is clamped to the left column", () => {
    const a = map.lines[1].glyphIds[0];
    const b = map.lines[4].glyphIds[0];
    expect(targetString(map, selectRange(map, a, b))).toBe("left one\nleft two");
  });
  it("alt+drag rectangle uses ink CENTRES, not box contact", () => {
    const one = map.lines[1].glyphIds.filter((i) => !map.glyphs[i].space);
    const first = map.glyphs[one[0]];
    const last = map.glyphs[one[one.length - 1]];
    const r = { x: first.ink.x - 0.2, y: first.baseline - 12, w: last.ink.x + last.ink.w - first.ink.x + 0.4 + 0.9, h: 14 };
    expect(wordStr(map, selectRect(map, r))).toBe("left one");
  });
});

describe("mixed sizes, duplicates, non-Latin", () => {
  it("superscripts stay on the same line and in the same word", () => {
    const m = buildGlyphMap([item("E=mc", 50, 100, 10, 20), item("2", 70, 96.5, 6.5, 3.25)]);
    expect(m.lines).toHaveLength(1);
    expect(allWords(m)).toEqual(["E=mc2"]);
  });
  it("fake-bold double strikes do not create duplicate glyphs", () => {
    const m = buildGlyphMap([item("Bold", 50, 100, 10, 20), item("Bold", 50.2, 100, 10, 20)]);
    expect(m.glyphs).toHaveLength(4);
  });
  it("legitimate double letters are kept", () => {
    expect(buildGlyphMap([item("ll", 50, 100, 10, 5.4)]).glyphs).toHaveLength(2);
  });
  it("Devanagari with combining marks is one word and selects whole", () => {
    const m = buildGlyphMap([item("नमस्ते", 50, 100, 10, 40)]);
    expect(allWords(m)).toEqual(["नमस्ते"]);
    const hit = hitTest(m, inkCenter(m.glyphs[0]))!;
    expect(wordStr(m, selectWord(m, hit.id))).toBe("नमस्ते");
  });
});

describe("rotations 0/90/180/270 (CropBox offset): same word via coords.ts", () => {
  const map = paragraph();
  for (const rotation of [0, 90, 180, 270]) {
    it(`every word centre → canvas → page → same word at ${rotation}°`, () => {
      const geo: PageGeo = { cropBox: [20, 30, 420, 530], rotation };
      for (const ids of map.words) {
        const g = map.glyphs[ids[Math.floor(ids.length / 2)]];
        const canvas = pageToCanvas(geo, 1.5, inkCenter(g));
        const page = canvasToPage(geo, 1.5, canvas);
        const hit = hitTest(map, page)!;
        expect(wordStr(map, selectWord(map, hit.id))).toBe(wordStr(map, ids));
      }
    });
  }
});

describe("rotated text is excluded from in-place editing", () => {
  it("makeEditObject refuses skewed runs with an explanation", () => {
    const m = buildGlyphMap([item("tilted", 50, 100, 10, 30, 0.5)]);
    const r = makeEditObject(m, m.words[0], "p1");
    expect(r.ok).toBe(false);
  });
});

describe("guards (2.2 D)", () => {
  it("guard 1: edit buffer must equal the captured glyphs", () => {
    const m = paragraph();
    expect(guardTarget(m, m.words[1], "quick").ok).toBe(true);
    const bad = guardTarget(m, m.words[1], "quick brown");
    expect(bad.ok).toBe(false);
  });

  it("guards 2+3: cover is clipped away from a neighbour (forced overlap of the padding)", () => {
    const m = buildGlyphMap([item("alpha", 50, 100, 10, 30), item("beta", 80.5, 100, 10, 20)]);
    const target = m.glyphs.filter((g) => g.itemIndex === 0).map((g) => g.id);
    const r = computeCovers(m, target);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const right = r.covers[0].x + r.covers[0].w;
      expect(right).toBeLessThanOrEqual(80.5 + 1e-6); // never reaches the neighbour
      expect(right).toBeGreaterThanOrEqual(80 - 1e-6); // still covers the whole target
    }
  });

  it("guards 2+3: if a neighbour overlaps the target's own ink the edit is BLOCKED, never applied wrongly", () => {
    const m = buildGlyphMap([item("alpha", 50, 100, 10, 30), item("beta", 78, 100, 10, 20)]);
    const target = m.glyphs.filter((g) => g.itemIndex === 0).map((g) => g.id);
    const r = computeCovers(m, target);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/overlaps/);
    expect(makeEditObject(m, target, "p1").ok).toBe(false);
  });

  it("cover rectangles are TIGHT (cap/x-height based) and clamped to ≤ 1 pt padding", () => {
    const m = buildGlyphMap([item("xxx", 50, 100, 10, 15)]);
    const r = computeCovers(m, m.words[0]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const c = r.covers[0];
      expect(c.h).toBeLessThan(10 * 0.54 + 0.02 * 10 + 2 + 1e-6); // x-height ink + 2×1 pt pad, not the 12 pt line height
      expect(c.x).toBeGreaterThanOrEqual(49 - 1e-6);
    }
  });

  it("makeEditObject builds a textedit with covers, original text and unchanged flag", () => {
    const m = paragraph();
    const r = makeEditObject(m, m.words[1], "p1", { newText: "slow", colors: { bg: "#eeeeee", fg: "#112233" } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.obj.origText).toBe("quick");
      expect(r.obj.text).toBe("slow");
      expect(r.obj.covers?.length).toBe(1);
      expect(r.unchanged).toBe(false);
      expect(makeEditObject(m, m.words[1], "p1").ok && (makeEditObject(m, m.words[1], "p1") as { unchanged: boolean }).unchanged).toBe(true);
    }
  });
});

describe("post-edit verification (text outside the target is byte-identical)", () => {
  const before = "The quick brown fox";
  it("passes when only the target changed, even though the hidden original is still extractable", () => {
    const v = verifyEditedText(before, "The quick brown fox slow", ["quick"], ["slow"]);
    expect(v.ok).toBe(true);
    expect(v.hiddenOriginalsPresent).toBe(true);
  });
  it("passes when the original text was truly removed", () => {
    const v = verifyEditedText(before, "The brown fox slow", ["quick"], ["slow"]);
    expect(v.ok).toBe(true);
    expect(v.hiddenOriginalsPresent).toBe(false);
  });
  it("FAILS (→ auto-rollback) when a neighbour was lost", () => {
    const v = verifyEditedText(before, "The slow fox", ["quick"], ["slow"]);
    expect(v.ok).toBe(false);
    expect(v.missing).toContain("b");
  });
  it("FAILS when unexpected extra text appeared", () => {
    expect(verifyEditedText(before, "The quick brown fox slow oops", ["quick"], ["slow"]).ok).toBe(false);
  });
  it("ignores whitespace differences between producers", () => {
    expect(verifyEditedText(before, "Thequickbrownfox slow", ["quick"], ["slow"]).ok).toBe(true);
  });
});
