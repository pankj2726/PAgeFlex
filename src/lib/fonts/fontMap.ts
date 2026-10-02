import type { FontFamily } from "../model/objects";

export interface FontInfo {
  family: FontFamily;
  bold: boolean;
  italic: boolean;
}

/** Map a PDF font name (e.g. "ABCDEF+Arial-BoldMT") and/or pdf.js generic family to a standard-14 family. */
export function classifyFont(name = "", generic = ""): FontInfo {
  const n = name.replace(/^[A-Z]{6}\+/, "").toLowerCase();
  const g = generic.toLowerCase();
  const bold = /bold|black|heavy|semibold|demi/.test(n);
  const italic = /italic|oblique|ital\b|-it\b/.test(n);
  let family: FontFamily = "sans";
  if (/courier|mono|consolas|menlo|typewriter|fixed/.test(n) || g.includes("mono")) family = "mono";
  else if (/times|serif(?!.*sans)|georgia|garamond|palatino|minion|cambria|book|roman|century/.test(n) && !/sans/.test(n)) family = "serif";
  else if (g === "serif") family = "serif";
  return { family, bold, italic };
}

/** Value of pdf-lib's StandardFonts enum for a family/style combination. */
export function standardFontName(family: FontFamily = "sans", bold = false, italic = false): string {
  if (family === "serif") {
    if (bold && italic) return "Times-BoldItalic";
    if (bold) return "Times-Bold";
    if (italic) return "Times-Italic";
    return "Times-Roman";
  }
  if (family === "mono") {
    if (bold && italic) return "Courier-BoldOblique";
    if (bold) return "Courier-Bold";
    if (italic) return "Courier-Oblique";
    return "Courier";
  }
  if (bold && italic) return "Helvetica-BoldOblique";
  if (bold) return "Helvetica-Bold";
  if (italic) return "Helvetica-Oblique";
  return "Helvetica";
}

/** CSS font stack with metrics compatible with the standard-14 fonts (Arial≈Helvetica etc.). */
export function cssFont(family: FontFamily = "sans", bold = false, italic = false, size = 12): string {
  const stack =
    family === "serif"
      ? '"Times New Roman", Times, serif'
      : family === "mono"
        ? '"Courier New", Courier, monospace'
        : 'Helvetica, Arial, "Liberation Sans", sans-serif';
  return `${italic ? "italic " : ""}${bold ? "bold " : ""}${size}px ${stack}`;
}

const CP1252_EXTRA = new Set(
  "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ".split("").map((c) => c.codePointAt(0)!)
);

export function isWinAnsi(ch: string): boolean {
  const cp = ch.codePointAt(0)!;
  if (cp === 9 || cp === 10 || cp === 13) return true;
  if (cp >= 0x20 && cp <= 0x7e) return true;
  if (cp >= 0xa0 && cp <= 0xff) return true;
  return CP1252_EXTRA.has(cp);
}

/** Returns the characters that the standard fonts cannot encode (drives the missing-glyph warning). */
export function unsupportedChars(text: string): string[] {
  const bad = new Set<string>();
  for (const ch of text) if (!isWinAnsi(ch)) bad.add(ch);
  return [...bad];
}
