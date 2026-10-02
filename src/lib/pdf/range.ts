export type RangeResult = { ok: true; pages: number[] } | { ok: false; error: string };

/**
 * Parse "1-3, 5, 8-" into sorted unique 0-based page indexes.
 * Open ranges: "8-" means 8..max, "-3" means 1..3.
 */
export function parseRanges(input: string, max: number): RangeResult {
  const text = input.trim();
  if (!text) return { ok: false, error: "Enter at least one page or range." };
  const out = new Set<number>();
  for (const part of text.split(",")) {
    const p = part.trim();
    if (!p) continue;
    const m = /^(\d*)\s*(-)?\s*(\d*)$/.exec(p);
    if (!m || (!m[1] && !m[3])) return { ok: false, error: `Can't read "${p}".` };
    let a: number;
    let b: number;
    if (!m[2]) {
      a = b = parseInt(m[1], 10);
    } else {
      a = m[1] ? parseInt(m[1], 10) : 1;
      b = m[3] ? parseInt(m[3], 10) : max;
    }
    if (a < 1 || b < 1 || a > max || b > max) return { ok: false, error: `"${p}" is outside 1–${max}.` };
    if (a > b) return { ok: false, error: `"${p}" runs backwards.` };
    for (let i = a; i <= b; i++) out.add(i - 1);
  }
  return { ok: true, pages: [...out].sort((x, y) => x - y) };
}

/** Split `count` pages into consecutive chunks of `n` pages (0-based indexes). */
export function everyN(count: number, n: number): number[][] {
  const size = Math.max(1, Math.floor(n));
  const out: number[][] = [];
  for (let i = 0; i < count; i += size) out.push(Array.from({ length: Math.min(size, count - i) }, (_, k) => i + k));
  return out;
}

export function formatRanges(pages: number[]): string {
  const s = [...pages].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < s.length; ) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
    parts.push(j > i ? `${s[i] + 1}-${s[j] + 1}` : `${s[i] + 1}`);
    i = j + 1;
  }
  return parts.join(", ");
}

/** Remove path separators / control chars and force a .pdf extension (blueprint: sanitize filenames). */
export function sanitizeFilename(name: string, ext = "pdf"): string {
  let base = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/^\.+/, "").trim();
  const re = new RegExp(`\\.${ext}$`, "i");
  base = base.replace(re, "");
  if (!base) base = "document";
  return `${base.slice(0, 120)}.${ext}`;
}
