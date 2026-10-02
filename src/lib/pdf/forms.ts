import {
  PDFButton,
  PDFCheckBox,
  PDFDropdown,
  PDFOptionList,
  PDFRadioGroup,
  PDFSignature,
  PDFTextField,
  StandardFonts,
} from "@cantoo/pdf-lib";
import { loadForEdit, safeText } from "./export";
import { gcDocument } from "./gc";

export type FieldType = "text" | "checkbox" | "radio" | "dropdown" | "list" | "button" | "signature" | "unknown";
export interface FormFieldInfo {
  name: string;
  type: FieldType;
  value: string | boolean | string[];
  options?: string[];
  readOnly: boolean;
  multiline?: boolean;
}
export type FormValues = Record<string, string | boolean | string[]>;

export async function listFields(bytes: Uint8Array, password?: string): Promise<FormFieldInfo[]> {
  const doc = await loadForEdit(bytes, password);
  let form;
  try {
    form = doc.getForm();
  } catch {
    return [];
  }
  const out: FormFieldInfo[] = [];
  for (const f of form.getFields()) {
    const name = f.getName();
    const readOnly = f.isReadOnly();
    if (f instanceof PDFTextField) out.push({ name, type: "text", value: f.getText() ?? "", readOnly, multiline: f.isMultiline() });
    else if (f instanceof PDFCheckBox) out.push({ name, type: "checkbox", value: f.isChecked(), readOnly });
    else if (f instanceof PDFRadioGroup) out.push({ name, type: "radio", value: f.getSelected() ?? "", options: f.getOptions(), readOnly });
    else if (f instanceof PDFDropdown) out.push({ name, type: "dropdown", value: f.getSelected()[0] ?? "", options: f.getOptions(), readOnly });
    else if (f instanceof PDFOptionList) out.push({ name, type: "list", value: f.getSelected(), options: f.getOptions(), readOnly });
    else if (f instanceof PDFButton) out.push({ name, type: "button", value: "", readOnly });
    else if (f instanceof PDFSignature) out.push({ name, type: "signature", value: "", readOnly });
    else out.push({ name, type: "unknown", value: "", readOnly });
  }
  return out;
}

export async function fillFields(
  bytes: Uint8Array,
  password: string | undefined,
  values: FormValues,
  flatten: boolean
): Promise<{ bytes: Uint8Array; errors: string[] }> {
  const doc = await loadForEdit(bytes, password);
  const form = doc.getForm();
  const errors: string[] = [];
  for (const [name, v] of Object.entries(values)) {
    try {
      const f = form.getField(name);
      if (f instanceof PDFTextField) f.setText(safeText(String(v)) || undefined);
      else if (f instanceof PDFCheckBox) (v ? f.check() : f.uncheck());
      else if (f instanceof PDFRadioGroup) {
        if (v) f.select(String(v));
      } else if (f instanceof PDFDropdown) {
        if (v) f.select(String(v));
      } else if (f instanceof PDFOptionList) f.select(Array.isArray(v) ? v : [String(v)]);
    } catch (e) {
      errors.push(`${name}: ${(e as Error).message}`);
    }
  }
  const font = await doc.embedFont(StandardFonts.Helvetica);
  form.updateFieldAppearances(font);
  if (flatten) form.flatten({ updateFieldAppearances: false });
  gcDocument(doc);
  return { bytes: await doc.save({ useObjectStreams: true }), errors };
}

export async function flattenForm(bytes: Uint8Array, password?: string): Promise<Uint8Array> {
  return (await fillFields(bytes, password, {}, true)).bytes;
}
