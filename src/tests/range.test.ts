import { describe, expect, it } from "vitest";
import { everyN, formatRanges, parseRanges, sanitizeFilename } from "../lib/pdf/range";

describe("page-range parser (F19)", () => {
  it("parses singles, ranges and open ranges", () => {
    expect(parseRanges("1-3, 5, 8-", 10)).toEqual({ ok: true, pages: [0, 1, 2, 4, 7, 8, 9] });
    expect(parseRanges("-2", 5)).toEqual({ ok: true, pages: [0, 1] });
    expect(parseRanges("3,1,3", 5)).toEqual({ ok: true, pages: [0, 2] });
  });
  it("rejects bad input with a message", () => {
    for (const bad of ["", "abc", "0", "11", "5-2", "1--3"]) {
      const r = parseRanges(bad, 10);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.length).toBeGreaterThan(3);
    }
  });
  it("everyN chunks consecutively", () => {
    expect(everyN(7, 3)).toEqual([[0, 1, 2], [3, 4, 5], [6]]);
    expect(everyN(2, 0)).toEqual([[0], [1]]);
  });
  it("formatRanges is the inverse for contiguous runs", () => {
    expect(formatRanges([0, 1, 2, 4, 7, 8])).toBe("1-3, 5, 8-9");
  });
  it("sanitizeFilename strips path tricks and forces .pdf", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("_.._etc_passwd.pdf");
    expect(sanitizeFilename("../../etc/passwd")).not.toContain("/");
    expect(sanitizeFilename("a/b\\c:d.pdf")).toBe("a_b_c_d.pdf");
    expect(sanitizeFilename("   ")).toBe("document.pdf");
    expect(sanitizeFilename("report.PDF")).toBe("report.pdf");
    expect(sanitizeFilename("x\u0000y")).toBe("x_y.pdf");
  });
});
