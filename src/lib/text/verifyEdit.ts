/**
 * Post-edit verification (Task 2 §2.2 D): "text outside the target range must be unchanged".
 * Compared as multisets of non-whitespace characters, because pdf.js inserts/omits spaces differently for text that
 * pdf-lib wrote than for the original producer's text, so word-level comparison would give false alarms.
 */
const norm = (s: string) => s.normalize("NFC").replace(/\s+/gu, "");

export function charCounts(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const ch of norm(s)) m.set(ch, (m.get(ch) ?? 0) + 1);
  return m;
}

const sub = (a: Map<string, number>, b: Map<string, number>) => {
  const out = new Map<string, number>();
  for (const [k, v] of a) {
    const d = v - (b.get(k) ?? 0);
    if (d > 0) out.set(k, d);
  }
  return out;
};
const str = (m: Map<string, number>) => [...m].map(([k, v]) => k.repeat(v)).join("");

export interface EditVerification {
  ok: boolean;
  /** characters that should still be on the page but are gone */
  missing: string;
  /** characters that appeared although nobody asked for them */
  extra: string;
  /** the replaced original text is still extractable under the cover (cover-and-replace limitation, KL-EDIT-2) */
  hiddenOriginalsPresent: boolean;
}

/**
 * expected = before − removed + added.
 * FAIL if something expected is missing, or if there is extra text beyond the (hidden) removed originals.
 */
export function verifyEditedText(before: string, after: string, removed: string[], added: string[]): EditVerification {
  const B = charCounts(before);
  const rem = charCounts(removed.join(""));
  const add = charCounts(added.join(""));
  const expected = new Map(sub(B, rem));
  for (const [k, v] of add) expected.set(k, (expected.get(k) ?? 0) + v);
  const A = charCounts(after);
  const missing = sub(expected, A);
  const unexpected = sub(A, expected);
  const extra = sub(unexpected, rem); // leftovers up to the removed originals are the hidden covered text
  const hiddenOriginalsPresent = rem.size > 0 && [...rem].every(([k, v]) => (unexpected.get(k) ?? 0) >= v);
  return { ok: missing.size === 0 && extra.size === 0, missing: str(missing), extra: str(extra), hiddenOriginalsPresent };
}
