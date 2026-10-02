import { useEditor } from "../model/docState";
import { navigate } from "../router";
import { MAX_BYTES, PdfError, WARN_BYTES } from "./load";
import { askPassword, friendlyError, openBytes, readFileBytes } from "./session";
import { loadPdf } from "./load";
import type { SavedSession } from "./persist";

/** Re-open an autosaved session (F36). Encrypted sources prompt for their password again. */
export async function recoverSavedSession(saved: SavedSession): Promise<OpenOutcome> {
  try {
    const sources: SavedSession["doc"]["sources"] = {};
    for (const [id, s] of Object.entries(saved.doc.sources)) {
      let pw: string | undefined;
      for (;;) {
        try {
          const h = await loadPdf(s.bytes, pw);
          h.pdfjs.destroy().catch(() => undefined);
          break;
        } catch (e) {
          if (e instanceof PdfError && (e.code === "PasswordRequired" || e.code === "WrongPassword")) {
            const a = await askPassword(s.name, e.code === "WrongPassword");
            if (a === null) return { ok: false, message: "Cancelled." };
            pw = a;
            continue;
          }
          throw e;
        }
      }
      sources[id] = { ...s, password: pw };
    }
    useEditor.getState().open({ ...saved.doc, sources }, saved.fileName);
    navigate("/edit");
    return { ok: true };
  } catch (e) {
    return { ok: false, message: friendlyError(e) };
  }
}

export type OpenOutcome = { ok: true } | { ok: false; message: string; code?: string };

export const ERROR_TITLES: Record<string, string> = {
  NotPdf: "That doesn't look like a PDF",
  Corrupt: "This PDF is damaged",
  WrongPassword: "Wrong password",
  PasswordRequired: "Password required",
  TooLarge: "This file is too large for your device",
};

/** Upload flow shared by the landing page and the editor: validate → (password) → open in editor. */
export async function openPdfFile(file: File): Promise<OpenOutcome> {
  if (file.size > MAX_BYTES) return { ok: false, code: "TooLarge", message: `${(file.size / 1048576).toFixed(0)} MB is over the 400 MB limit of this browser editor.` };
  if (file.size > WARN_BYTES && !window.confirm(`This file is ${(file.size / 1048576).toFixed(0)} MB. Large PDFs can be slow and may exhaust memory on phones. Continue?`)) {
    return { ok: false, message: "Cancelled." };
  }
  try {
    const bytes = await readFileBytes(file);
    const res = await openBytes(bytes, file.name);
    if (!res) return { ok: false, message: "Cancelled." };
    useEditor.getState().open(res.doc, file.name);
    navigate("/edit");
    return { ok: true };
  } catch (e) {
    if (e instanceof PdfError) return { ok: false, code: e.code, message: e.message };
    return { ok: false, code: e instanceof RangeError ? "TooLarge" : undefined, message: friendlyError(e) };
  }
}
