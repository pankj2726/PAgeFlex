/**
 * TASKS-02 Task 3 – matcher + search-index tests (NOT YET RUN: no shell in the authoring environment).
 * Section 3.5 of the task is reproduced row by row. The PDF-level checks (highlight count == replaced count, neighbour
 * pixels, 300-page search, exact undo) need a browser and live in tests/e2e/findreplace.spec.ts.
 */
import { describe, expect, it } from "vitest";
import { applyCase, compileQuery, DEFAULT_FIND, findAll, replaceAllInString, type FindOptions } from "../lib/text/matcher";
import { buildSearchIndex, spanGlyphIds } from "../lib/text/searchIndex";
import { buildGlyphMap, type RawItem } from "../lib/text/glyphMap";

const O = (p: Partial<FindOptions> = {}): FindOptions => ({ ...DEFAULT_FIND, ...p });
const rep = (text: string, q: string, r: string, p: Partial<FindOptions> = {}) => replaceAllInString(text, q, r, O(p));

describe("§3.5 mandatory cases", () => {
  it("the→she, whole word ON: 'the theft of the other' → 'she theft of she other'", () => {
    expect(rep("the theft of the other", "the", "she", { wholeWord: true })).toBe("she theft of she other");
  });
  it("the→she, whole word OFF: 'the theft' → 'she sheft' (documented)", () => {
    expect(rep("the theft", "the", "she")).toBe("she sheft");
  });
  it("match case ON + whole word ON: 'The the' → 'The she'", () => {
    expect(rep("The the", "the", "she", { matchCase: true, wholeWord: true })).toBe("The she");
  });
  it("match case OFF + whole word ON: 'she she' unless case-aware, then 'She she'", () => {
    expect(rep("The the", "the", "she", { wholeWord: true })).toBe("she she");
    expect(rep("The the", "the", "she", { wholeWord: true, caseAware: true })).toBe("She she");
    expect(rep("THE the", "the", "she", { wholeWord: true, caseAware: true })).toBe("SHE she");
  });
  it("phrase ON: 'red apple' ≠ 'apple red'", () => {
    expect(rep("red apple / apple red", "red apple", "green pear")).toBe("green pear / apple red");
  });
  it("phrase OFF: every word is searched on its own", () => {
    expect(findAll("red apple pear", "red apple", O({ phrase: false }))).toHaveLength(2);
  });
  it("whitespace-tolerant: a line break between the words still matches", () => {
    expect(findAll("a red\napple b", "red apple", O())).toHaveLength(1);
    expect(findAll("a red   apple b", "red apple", O())).toHaveLength(1);
  });
  it("cat→dog, whole word: punctuation and possessive 's end a word, 'concatenate' is untouched", () => {
    expect(rep("cat, cat. (cat) cat's concatenate", "cat", "dog", { wholeWord: true })).toBe("dog, dog. (dog) dog's concatenate");
  });
  it("don't and well-known are single words", () => {
    expect(findAll("don't stop", "don", O({ wholeWord: true }))).toHaveLength(0);
    expect(findAll("don't stop", "don't", O({ wholeWord: true }))).toHaveLength(1);
    expect(findAll("a well-known fact", "well", O({ wholeWord: true }))).toHaveLength(0);
    expect(findAll("a well-known fact", "known", O({ wholeWord: true }))).toHaveLength(0);
    expect(findAll("a well-known fact", "well-known", O({ wholeWord: true }))).toHaveLength(1);
  });
  it("Devanagari: combining marks are word characters, so boundaries are respected", () => {
    expect(rep("पुस्तक पुस्तकें पुस्तक", "पुस्तक", "X", { wholeWord: true })).toBe("X पुस्तकें X");
  });
  it("a.b with regex OFF matches only the literal", () => {
    expect(rep("a.b axb", "a.b", "Z")).toBe("Z axb");
    expect(findAll("a.b axb", "a.b", O({ regex: true }))).toHaveLength(2);
  });
});

describe("options", () => {
  it("accented letters: \\b would fail, our boundaries do not", () => {
    expect(findAll("café cafés", "café", O({ wholeWord: true }))).toHaveLength(1);
    expect(findAll("été", "t", O({ wholeWord: true }))).toHaveLength(0);
  });
  it("ignore diacritics maps spans back to the original text", () => {
    const t = "Café cafe";
    const spans = findAll(t, "cafe", O({ ignoreDiacritics: true }));
    expect(spans.map((s) => t.slice(s.start, s.end))).toEqual(["Café", "cafe"]);
    expect(findAll(t, "cafe", O())).toHaveLength(1);
  });
  it("CJK uses Intl.Segmenter for whole-word", () => {
    expect(findAll("我喜欢苹果", "苹果", O({ wholeWord: true }))).toHaveLength(1);
  });
  it("regex validity indicator and empty-match safety", () => {
    expect(compileQuery("(", O({ regex: true })).ok).toBe(false);
    expect(compileQuery("a+", O({ regex: true })).ok).toBe(true);
    expect(findAll("aaa", "x*", O({ regex: true }))).toEqual([]); // zero-length matches never loop
  });
  it("applyCase", () => {
    expect(applyCase("The", "she")).toBe("She");
    expect(applyCase("THE", "she")).toBe("SHE");
    expect(applyCase("the", "she")).toBe("she");
    expect(applyCase("123", "she")).toBe("she");
  });
  it("replacements are never re-matched (no infinite loop): 'a'→'aa'", () => {
    expect(rep("a a a", "a", "aa", { wholeWord: true })).toBe("aa aa aa");
  });
  it("property: replacing X→X leaves the text unchanged under every option combination", () => {
    const text = "The theft of the other cat's café, Café and CAFÉ. a.b axb red\napple";
    for (const matchCase of [false, true]) for (const wholeWord of [false, true]) for (const phrase of [false, true]) for (const ignoreDiacritics of [false, true]) for (const q of ["the", "cat", "café", "red apple", "a.b"]) {
      const o = O({ matchCase, wholeWord, phrase, ignoreDiacritics });
      const spans = findAll(text, q, o);
      let out = text;
      for (let i = spans.length - 1; i >= 0; i--) out = out.slice(0, spans[i].start) + text.slice(spans[i].start, spans[i].end) + out.slice(spans[i].end);
      expect(out).toBe(text);
    }
  });
});

const item = (str: string, x: number, baseline: number, size = 10, w?: number): RawItem => ({ str, x, baseline, w: w ?? str.length * size * 0.5, size, angle: 0, fontName: "f", family: "sans", bold: false, italic: false });

describe("search index (§3.3)", () => {
  it("joins a hyphenated line break; the match spans both lines and includes the hyphen glyph", () => {
    const map = buildGlyphMap([item("infor-", 50, 100, 10, 30), item("mation", 50, 112, 10, 30)]);
    const idx = buildSearchIndex(map);
    expect(idx.text).toBe("information");
    const [span] = findAll(idx.text, "information", O());
    const ids = spanGlyphIds(idx, map, span);
    expect(ids.map((i) => map.glyphs[i].char).join("")).toBe("infor-mation");
    expect(new Set(ids.map((i) => map.glyphs[i].lineId)).size).toBe(2); // one highlight rectangle per line
  });
  it("does not join a hyphen when the next line starts with a capital", () => {
    const map = buildGlyphMap([item("see page 3-", 50, 100, 10, 55), item("Next part", 50, 112, 10, 45)]);
    expect(buildSearchIndex(map).text).toContain("3- Next");
  });
  it("a phrase can span lines of one column but never two columns", () => {
    const sameColumn = buildGlyphMap([item("red", 50, 100, 10, 30), item("apple", 50, 112, 10, 50)]);
    expect(findAll(buildSearchIndex(sameColumn).text, "red apple", O())).toHaveLength(1);
    const twoColumns = buildGlyphMap([item("red", 50, 100, 10, 30), item("apple", 250, 100, 10, 50)]);
    expect(findAll(buildSearchIndex(twoColumns).text, "red apple", O())).toHaveLength(0);
  });
  it("expands ligatures and normalises to NFC", () => {
    expect(buildSearchIndex(buildGlyphMap([item("\ufb01nd caf\u0065\u0301", 50, 100, 10, 50)])).text).toBe("find café");
  });
  it("glyphs under earlier covers are excluded, so replaced text is not found again", () => {
    const map = buildGlyphMap([item("the cat", 50, 100, 10, 35)]);
    const idx = buildSearchIndex(map, (g) => g.wordId === 0);
    expect(idx.text).toBe("cat");
  });
});
