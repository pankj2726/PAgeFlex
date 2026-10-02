import { describe, expect, it } from "vitest";
import { classifyFont, standardFontName, unsupportedChars } from "../lib/fonts/fontMap";
import { wrapText } from "../lib/model/objects";

describe("font mapping (F13)", () => {
  it("classifies common PDF font names", () => {
    expect(classifyFont("ABCDEF+Arial-BoldMT")).toEqual({ family: "sans", bold: true, italic: false });
    expect(classifyFont("TimesNewRomanPS-ItalicMT")).toEqual({ family: "serif", bold: false, italic: true });
    expect(classifyFont("CourierNewPSMT")).toEqual({ family: "mono", bold: false, italic: false });
    expect(classifyFont("", "monospace").family).toBe("mono");
    expect(classifyFont("", "serif").family).toBe("serif");
    expect(classifyFont("Calibri").family).toBe("sans");
  });
  it("maps to standard-14 names", () => {
    expect(standardFontName("sans", true, true)).toBe("Helvetica-BoldOblique");
    expect(standardFontName("serif", false, false)).toBe("Times-Roman");
    expect(standardFontName("mono", true, false)).toBe("Courier-Bold");
  });
  it("reports glyphs the standard fonts cannot encode (missing-glyph warning)", () => {
    expect(unsupportedChars("Hello café – “quoted” €5")).toEqual([]);
    expect(unsupportedChars("नमस्ते")).not.toHaveLength(0);
    expect(unsupportedChars("مرحبا")).not.toHaveLength(0);
    expect(unsupportedChars("你好")).toEqual(["你", "好"]);
  });
});

describe("wrapText (shared by screen and export)", () => {
  const measure = (s: string) => s.length * 10;
  it("wraps on word boundaries and keeps blank lines", () => {
    expect(wrapText("aaa bbb ccc", 70, measure)).toEqual(["aaa bbb", "ccc"]);
    expect(wrapText("a\n\nb", 100, measure)).toEqual(["a", "", "b"]);
  });
});
