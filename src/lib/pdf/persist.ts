/** Session recovery in IndexedDB (F36). Opt-out, user-clearable, never leaves the device. */
import type { DocData, SourceDoc } from "../model/commands";

const DB = "pageflex";
const STORE = "session";
const KEY = "current";
const OPT_KEY = "qf-autosave";

export interface SavedSession {
  fileName: string;
  savedAt: number;
  doc: DocData;
}

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export function autosaveEnabled(): boolean {
  try {
    return localStorage.getItem(OPT_KEY) !== "off";
  } catch {
    return true;
  }
}
export function setAutosave(on: boolean) {
  try {
    localStorage.setItem(OPT_KEY, on ? "on" : "off");
  } catch {
    /* storage disabled */
  }
}

export async function saveSession(doc: DocData, fileName: string): Promise<void> {
  if (!autosaveEnabled() || typeof indexedDB === "undefined") return;
  // Passwords are never persisted: encrypted sources prompt again on recovery.
  const sources: Record<string, SourceDoc> = {};
  for (const [id, s] of Object.entries(doc.sources)) sources[id] = { id: s.id, name: s.name, bytes: s.bytes };
  const db = await open();
  await new Promise<void>((res, rej) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({ fileName, savedAt: Date.now(), doc: { ...doc, sources } } satisfies SavedSession, KEY);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
  db.close();
}

export async function loadSession(): Promise<SavedSession | null> {
  if (typeof indexedDB === "undefined") return null;
  try {
    const db = await open();
    const out = await new Promise<SavedSession | null>((res, rej) => {
      const r = db.transaction(STORE).objectStore(STORE).get(KEY);
      r.onsuccess = () => res((r.result as SavedSession) ?? null);
      r.onerror = () => rej(r.error);
    });
    db.close();
    return out;
  } catch {
    return null;
  }
}

/** Wipe IndexedDB + our localStorage keys. Returns true only if nothing is left afterwards. */
export async function clearAllData(): Promise<boolean> {
  try {
    if (typeof indexedDB !== "undefined") {
      await new Promise<void>((res) => {
        const r = indexedDB.deleteDatabase(DB);
        r.onsuccess = () => res();
        r.onerror = () => res();
        r.onblocked = () => res();
      });
    }
    for (const k of Object.keys(localStorage)) if (k.startsWith("qf-")) localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
  return (await loadSession()) === null;
}
