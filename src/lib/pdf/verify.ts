/**
 * Output verification (rule 6): every produced PDF is re-parsed with pdf.js – a *different* parser from the pdf-lib
 * that wrote it – and compared against what we expected.
 */
import { extractPlainText, openPdfjs } from "./render";

export interface VerifyResult {
  ok: boolean;
  pages: number;
  encrypted: boolean;
  messages: string[];
  text?: string[];
  title?: string;
}

export async function verifyPdf(
  bytes: Uint8Array,
  opts: { expectedPages?: number; password?: string; mustNotContain?: string[]; mustContain?: string[]; withText?: boolean } = {}
): Promise<VerifyResult> {
  const messages: string[] = [];
  let ok = true;
  if (!(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) {
    return { ok: false, pages: 0, encrypted: false, messages: ["Missing %PDF header"] };
  }
  let doc;
  let encrypted = false;
  try {
    doc = await openPdfjs(bytes, opts.password);
  } catch (e) {
    const err = e as { name?: string };
    if (err?.name === "PasswordException" && !opts.password) {
      return { ok: true, pages: 0, encrypted: true, messages: ["File is encrypted and prompts for a password (expected for protected output)."] };
    }
    return { ok: false, pages: 0, encrypted: false, messages: [`Second parser (pdf.js) rejected the file: ${String(err?.name ?? e)}`] };
  }
  if (opts.password) encrypted = true;
  try {
    const pages = doc.numPages;
    if (opts.expectedPages !== undefined && pages !== opts.expectedPages) {
      ok = false;
      messages.push(`Page count mismatch: expected ${opts.expectedPages}, parsed ${pages}.`);
    } else messages.push(`Re-parsed with pdf.js: ${pages} page${pages === 1 ? "" : "s"}.`);
    let text: string[] | undefined;
    if (opts.withText || opts.mustContain || opts.mustNotContain) {
      text = await extractPlainText(doc);
      const all = text.join("\n");
      for (const s of opts.mustNotContain ?? []) {
        if (s && all.toLowerCase().includes(s.toLowerCase())) {
          ok = false;
          messages.push(`Redaction FAILED: "${s}" is still extractable.`);
        } else if (s) messages.push(`Redaction verified: "${s}" is not extractable.`);
      }
      for (const s of opts.mustContain ?? []) {
        if (!all.toLowerCase().includes(s.toLowerCase())) {
          ok = false;
          messages.push(`Expected text "${s}" was not found.`);
        }
      }
    }
    const meta = await doc.getMetadata().catch(() => null);
    return { ok, pages, encrypted, messages, text, title: (meta?.info as Record<string, string> | undefined)?.Title };
  } finally {
    doc.destroy().catch(() => undefined);
  }
}
