import { useEffect, useRef, useState } from "react";
import { useEditor } from "../../lib/model/docState";
import { canUseSavePicker, createDownloadUrl, downloadBlob, exportJob, saveWithPicker, withBusy } from "../../lib/pdf/session";
import { sanitizeFilename } from "../../lib/pdf/range";
import { verifyPdf, type VerifyResult } from "../../lib/pdf/verify";
import { verifyTextEdits } from "../../lib/pdf/editVerify";
import { unsupportedChars } from "../../lib/fonts/fontMap";
import { Modal, Tick, btn, btnPrimary, input, Label } from "../ui";

interface Report {
  bytes: Uint8Array;
  verify: VerifyResult;
  blocked: boolean;
  /** objects that had to be skipped – the PDF was still produced */
  warnings: string[];
  notes: string[];
  url: string;
  downloadError?: string;
}

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const doc = useEditor((s) => s.doc)!;
  const fileName = useEditor((s) => s.fileName);
  const [name, setName] = useState(fileName.replace(/\.pdf$/i, ""));
  const [report, setReport] = useState<Report | null>(null);
  const urlRef = useRef<string | null>(null);
  const hasRedact = doc.objects.some((o) => o.type === "redact");
  const encrypted = Object.values(doc.sources).some((s) => s.password);
  const rasterText = doc.objects.filter((o) => (o.type === "text" || o.type === "textedit") && unsupportedChars(o.text ?? "").length).length;
  const hasSignature = doc.objects.some((o) => o.label === "signature");
  const edited = doc.objects.filter((o) => o.type === "textedit" && o.text !== o.origText).length;

  useEffect(() => () => void (urlRef.current && URL.revokeObjectURL(urlRef.current)), []);

  const run = async () => {
    const out = await withBusy("Building your PDF", (p) => exportJob(doc, p));
    if (!out) return; // withBusy already showed the plain-language error (or "Cancelled")
    let final = out;
    const notes: string[] = [];

    // Post-edit verification + auto-rollback (Task 2): text outside the edit must be unchanged.
    if (edited > 0) {
      try {
        const chk = await verifyTextEdits(doc, out.bytes);
        notes.push(...chk.notes);
        if (chk.failedPageIds.length) {
          const safe = { ...doc, objects: doc.objects.filter((o) => !(o.type === "textedit" && chk.failedPageIds.includes(o.pageId))) };
          const again = await withBusy("Rolling back edits that failed verification", (p) => exportJob(safe, p));
          if (!again) return;
          final = again;
        }
      } catch (e) {
        notes.push(`Edit verification could not run (${e instanceof Error ? e.message : "unknown error"}); the file was still built.`);
      }
    }

    const redactionRequested = doc.objects.some((o) => o.type === "redact");
    let verify: VerifyResult;
    try {
      verify = await verifyPdf(final.bytes, { expectedPages: final.pageCount, mustNotContain: final.redactedStrings });
    } catch (e) {
      // Verification is a safety net, not a gate: if it cannot run, still deliver the file (except for redactions,
      // whose removal we could not prove).
      verify = { ok: !redactionRequested, pages: 0, encrypted: false, messages: [`Verification step could not run (${e instanceof Error ? e.message : "unknown error"}). The file was still built.`] };
      if (redactionRequested) verify.messages.push("Redaction FAILED: could not verify that covered text was removed.");
    }
    const blocked = redactionRequested && verify.messages.some((m) => m.startsWith("Redaction FAILED"));
    const clean = sanitizeFilename(name);
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    const url = createDownloadUrl(final.bytes);
    urlRef.current = url;
    let downloadError: string | undefined;
    if (!blocked) {
      try {
        downloadBlob(final.bytes, clean);
        useEditor.setState({ fileName: clean });
      } catch (e) {
        downloadError = e instanceof Error ? e.message : "unknown error";
        useEditor.getState().toast("error", `The browser blocked the download (${downloadError}). Use the link in the dialog.`);
      }
    }
    setReport({ bytes: final.bytes, verify, blocked, warnings: final.warnings, notes, url, downloadError });
  };

  const [savedVia, setSavedVia] = useState("");
  const saveAs = async () => {
    if (!report) return;
    try {
      if (await saveWithPicker(report.bytes, sanitizeFilename(name))) setSavedVia("Saved with Save as…");
    } catch (e) {
      useEditor.getState().toast("error", `Save as… failed: ${e instanceof Error ? e.message : "unknown error"}`);
    }
  };

  return (
    <Modal
      title="Download your PDF"
      onClose={onClose}
      footer={
        report ? (
          <>
            {!report.blocked && (
              <button className={btn} onClick={() => downloadBlob(report.bytes, sanitizeFilename(name))}>
                Download again
              </button>
            )}
            <button className={btnPrimary} onClick={onClose}>
              Done
            </button>
          </>
        ) : (
          <>
            <button className={btn} onClick={onClose}>
              Cancel
            </button>
            <button className={btnPrimary} onClick={run}>
              Export &amp; download
            </button>
          </>
        )
      }
    >
      {!report ? (
        <div className="space-y-3 text-sm">
          <div>
            <Label>File name</Label>
            <div className="flex items-center gap-2">
              <input className={input} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && run()} aria-label="File name" />
              <span className="text-slate-500">.pdf</span>
            </div>
          </div>
          <ul className="list-disc space-y-1 pl-5 text-slate-600 dark:text-slate-300">
            <li>
              {doc.pages.length} page{doc.pages.length === 1 ? "" : "s"}, {doc.objects.length} edit{doc.objects.length === 1 ? "" : "s"}. Everything is built on your device; nothing is uploaded.
            </li>
            {encrypted && <li>The original was password protected. The download is <strong>not</strong> protected – use the Protect tool afterwards if you need that.</li>}
            {hasRedact && <li>Redacted pages will be rebuilt as images so the covered text and images are truly removed. The result is re-checked after export.</li>}
            {edited > 0 && <li>{edited} edited text item(s) use cover-and-replace: the original words are covered, not removed. Text outside each edit is re-checked after export. Use Redact for sensitive text.</li>}
            {rasterText > 0 && <li>{rasterText} text item(s) contain characters the built-in fonts lack, so they'll be saved as images.</li>}
            {hasSignature && <li>Signatures are images of your signature, not certified digital signatures.</li>}
          </ul>
        </div>
      ) : (
        <div className="space-y-3 text-sm" aria-live="polite">
          <p className={report.blocked ? "font-semibold text-red-600" : "flex items-center gap-2 font-semibold text-emerald-600"}>
            {!report.blocked && <Tick className="h-6 w-6 shrink-0" />}{report.blocked ? "Download blocked: redaction could not be verified." : `Built ${sanitizeFilename(name)} (${(report.bytes.length / 1024).toFixed(0)} KB)`}</p>
          {!report.blocked && (
            <div className="rounded-lg bg-slate-100 p-3 dark:bg-slate-800">
              <p className="mb-1">{report.downloadError ? "The browser blocked the automatic download." : "Download didn't start?"}</p>
              <div className="flex flex-wrap items-center gap-3">
                <a className="font-medium text-indigo-600 underline" href={report.url} download={sanitizeFilename(name)} data-testid="download-fallback">
                  Click here to download
                </a>
                {canUseSavePicker() && (
                  <button className={btn} onClick={saveAs}>
                    Save as…
                  </button>
                )}
                {savedVia && <span className="text-emerald-700">{savedVia}</span>}
              </div>
            </div>
          )}
          {report.warnings.length > 0 && (
            <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
              <p className="font-semibold">Your PDF was created, but {report.warnings.length} item{report.warnings.length === 1 ? " was" : "s were"} skipped:</p>
              <ul className="mt-1 list-disc pl-5">
                {report.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}
          {report.notes.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 text-slate-700 dark:text-slate-300">
              {report.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          )}
          <p className="text-slate-600 dark:text-slate-300">Verification with a second parser (pdf.js):</p>
          <ul className="space-y-1">
            {report.verify.messages.map((m, i) => (
              <li key={i} className={m.includes("FAILED") || m.includes("mismatch") || m.includes("rejected") ? "text-red-600" : "text-emerald-700 dark:text-emerald-400"}>
                {m.includes("FAILED") || m.includes("mismatch") || m.includes("rejected") ? "✖" : "✔"} {m}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  );
}
