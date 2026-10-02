/** i18n scaffolding (F37/Stage 9): message catalogue + t(). Add a locale by adding a dictionary here. */
import { useSyncExternalStore } from "react";

export type Locale = "en" | "es";

const dict: Record<Locale, Record<string, string>> = {
  en: {
    "nav.tools": "All tools",
    "nav.editor": "Editor",
    "nav.privacy": "Privacy",
    "nav.about": "About",
    "upload.title": "Drop a PDF here",
    "upload.cta": "Choose a PDF",
    "upload.hint": "or drag and drop. Your file never leaves this device.",
    "editor.download": "Download",
    "editor.undo": "Undo",
    "editor.redo": "Redo",
    "theme.toggle": "Toggle dark mode",
    "data.clear": "Clear my data",
  },
  es: {
    "nav.tools": "Todas las herramientas",
    "nav.editor": "Editor",
    "nav.privacy": "Privacidad",
    "nav.about": "Acerca de",
    "upload.title": "Suelta un PDF aquí",
    "upload.cta": "Elegir un PDF",
    "upload.hint": "o arrástralo. Tu archivo nunca sale de este dispositivo.",
    "editor.download": "Descargar",
    "editor.undo": "Deshacer",
    "editor.redo": "Rehacer",
    "theme.toggle": "Cambiar modo oscuro",
    "data.clear": "Borrar mis datos",
  },
};

let locale: Locale = (() => {
  try {
    const saved = localStorage.getItem("qf-locale") as Locale | null;
    if (saved && saved in dict) return saved;
  } catch {
    /* ignore */
  }
  return navigator.language?.toLowerCase().startsWith("es") ? "es" : "en";
})();
const listeners = new Set<() => void>();

export function setLocale(l: Locale) {
  locale = l;
  try {
    localStorage.setItem("qf-locale", l);
  } catch {
    /* ignore */
  }
  document.documentElement.lang = l;
  listeners.forEach((f) => f());
}
export function t(key: string): string {
  return dict[locale][key] ?? dict.en[key] ?? key;
}
export function useLocale(): Locale {
  return useSyncExternalStore(
    (cb) => (listeners.add(cb), () => listeners.delete(cb)),
    () => locale
  );
}
