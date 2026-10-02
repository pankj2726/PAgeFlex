import { useCallback, useEffect, useState } from "react";
import { useEditor } from "../../lib/model/docState";
import type { FormFieldInfo, FormValues } from "../../lib/pdf/forms";
import { commitBytes, exportJob, withBusy } from "../../lib/pdf/session";
import { runJob } from "../../lib/workers/client";
import { btn, btnPrimary, input } from "../ui";

/** Fill existing AcroForm fields (F23) and flatten (F25). Values are written back with pdf-lib, then the result becomes the new base. */
export function FormsPanel() {
  const doc = useEditor((s) => s.doc)!;
  const [fields, setFields] = useState<FormFieldInfo[] | null>(null);
  const [values, setValues] = useState<FormValues>({});
  const [flatten, setFlatten] = useState(false);
  const primary = doc.sources[doc.primaryId];

  const load = useCallback(() => {
    setFields(null);
    const job = runJob<FormFieldInfo[]>("listFields", { bytes: primary.bytes, password: primary.password });
    job.promise
      .then((f) => {
        setFields(f);
        setValues(Object.fromEntries(f.map((x) => [x.name, x.value])));
      })
      .catch(() => setFields([]));
    return job;
  }, [primary.bytes, primary.password]);

  useEffect(() => {
    const j = load();
    return () => j.cancel();
  }, [load]);

  const apply = async (flat: boolean) => {
    const exported = await withBusy("Preparing document", (p) => exportJob(doc, p));
    if (!exported) return;
    const res = await withBusy(flat ? "Flattening form" : "Writing form values", () => runJob<{ bytes: Uint8Array; errors: string[] }>("fillFields", { bytes: exported.bytes, values: flat && !Object.keys(values).length ? {} : values, flatten: flat }));
    if (!res) return;
    if (await commitBytes(flat ? "Flatten form" : "Fill form", res.bytes)) {
      useEditor.getState().toast(res.errors.length ? "error" : "success", res.errors.length ? `Some fields could not be set: ${res.errors.slice(0, 2).join("; ")}` : flat ? "Form flattened – values are now part of the page." : "Form values saved into the PDF.");
    }
  };

  if (fields === null) return <div className="p-4 text-sm text-slate-500">Looking for form fields…</div>;
  const editable = fields.filter((f) => f.type !== "button" && f.type !== "signature" && f.type !== "unknown");

  return (
    <div className="space-y-3 p-4 text-sm">
      <h3 className="font-semibold">Form fields</h3>
      {editable.length === 0 && (
        <p className="text-slate-600 dark:text-slate-300">
          No fillable fields were found in this PDF. Use the <strong>Field</strong> tool in the toolbar to add text, checkbox, radio, dropdown or date fields.
        </p>
      )}
      {editable.map((f) => (
        <div key={f.name}>
          <label className="mb-1 block truncate text-xs font-medium text-slate-600 dark:text-slate-300" title={f.name}>
            {f.name} <span className="text-slate-400">({f.type})</span>
          </label>
          {f.type === "text" &&
            (f.multiline ? (
              <textarea className={input} disabled={f.readOnly} value={String(values[f.name] ?? "")} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })} />
            ) : (
              <input className={input} disabled={f.readOnly} value={String(values[f.name] ?? "")} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })} />
            ))}
          {f.type === "checkbox" && (
            <label className="flex items-center gap-2">
              <input type="checkbox" disabled={f.readOnly} checked={!!values[f.name]} onChange={(e) => setValues({ ...values, [f.name]: e.target.checked })} /> Checked
            </label>
          )}
          {(f.type === "dropdown" || f.type === "radio") && (
            <select className={input} disabled={f.readOnly} value={String(values[f.name] ?? "")} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}>
              <option value="">—</option>
              {f.options?.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          )}
          {f.type === "list" && (
            <select multiple className={input} disabled={f.readOnly} value={(values[f.name] as string[]) ?? []} onChange={(e) => setValues({ ...values, [f.name]: [...e.target.selectedOptions].map((o) => o.value) })}>
              {f.options?.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          )}
        </div>
      ))}
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={flatten} onChange={(e) => setFlatten(e.target.checked)} /> Flatten after filling (lock answers into the page)
      </label>
      <div className="flex flex-wrap gap-2">
        <button className={btnPrimary} onClick={() => apply(flatten)} disabled={editable.length === 0 && !flatten}>
          Apply values
        </button>
        <button className={btn} onClick={() => apply(true)}>
          Flatten now
        </button>
      </div>
      <p className="text-xs text-slate-500">Apply bakes your edits so far into the document, then writes the values. You can undo it. PDF JavaScript is never run.</p>
    </div>
  );
}
