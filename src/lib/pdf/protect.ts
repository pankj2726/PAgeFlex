import { gcDocument } from "./gc";
import { loadForEdit } from "./export";

export interface ProtectOptions {
  userPassword?: string;
  ownerPassword?: string;
  permissions: {
    printing: boolean;
    copying: boolean;
    modifying: boolean;
    annotating: boolean;
    fillingForms: boolean;
  };
}

function randomPassword(): string {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** AES-256 encryption (pdf-lib `encrypt`). Always the LAST step of the export pipeline. */
export async function protectPdf(bytes: Uint8Array, password: string | undefined, o: ProtectOptions): Promise<Uint8Array> {
  const doc = await loadForEdit(bytes, password);
  gcDocument(doc);
  doc.encrypt({
    userPassword: o.userPassword || undefined,
    ownerPassword: o.ownerPassword || randomPassword(),
    permissions: {
      printing: o.permissions.printing ? "highResolution" : false,
      copying: o.permissions.copying,
      modifying: o.permissions.modifying,
      annotating: o.permissions.annotating,
      fillingForms: o.permissions.fillingForms,
      contentAccessibility: true,
      documentAssembly: o.permissions.modifying,
    },
  });
  return doc.save({ useObjectStreams: false });
}

/** Unlock with a known password: write the document back without an /Encrypt dictionary. */
export async function unlockPdf(bytes: Uint8Array, password: string): Promise<Uint8Array> {
  const doc = await loadForEdit(bytes, password);
  (doc.context.trailerInfo as { Encrypt?: unknown }).Encrypt = undefined;
  gcDocument(doc);
  return doc.save({ useObjectStreams: true });
}
