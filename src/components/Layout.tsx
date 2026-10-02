import type { ReactNode } from "react";
import { navigate } from "../lib/router";
import { setLocale, t, useLocale } from "../lib/i18n";
import { useTheme } from "../lib/theme";
import { SITE } from "../lib/config";
import { LogoMark, Wordmark } from "./Logo";

const link = "rounded-lg px-2.5 py-1.5 text-sm text-slate-600 hover:bg-slate-200/70 hover:text-indigo-700 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-indigo-300";

export function SiteLayout({ children }: { children: ReactNode }) {
  const [dark, toggle] = useTheme();
  const locale = useLocale();
  return (
    <div className="flex min-h-full flex-col">
      <a href="#main" className="sr-only-focusable rounded bg-indigo-600 px-3 py-2 text-white" onClick={(e) => { e.preventDefault(); document.getElementById("main")?.focus(); }}>
        Skip to content
      </a>
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-slate-100/80 backdrop-blur-md dark:border-slate-800 dark:bg-slate-950/70">
        <nav className="mx-auto flex max-w-6xl items-center gap-1.5 px-4 py-2.5" aria-label="Main">
          <a href="#/" className="group mr-auto flex items-center gap-2.5 text-lg" aria-label={`${SITE.name} home`}>
            <LogoMark size={32} className="transition-transform duration-500 group-hover:rotate-[-8deg] group-hover:scale-110" />
            <Wordmark />
          </a>
          <a className={link} href="#/tools">{t("nav.tools")}</a>
          <a className={`${link} hidden sm:inline`} href="#/privacy">{t("nav.privacy")}</a>
          <a className={`${link} hidden sm:inline`} href="#/about">{t("nav.about")}</a>
          <select aria-label="Language" value={locale} onChange={(e) => setLocale(e.target.value as "en" | "es")} className="rounded-lg border border-slate-300 bg-transparent px-1.5 py-1.5 text-sm dark:border-slate-600">
            <option value="en">EN</option>
            <option value="es">ES</option>
          </select>
          <button onClick={toggle} className="grid h-9 w-9 place-items-center rounded-xl border border-slate-300 text-base hover:bg-slate-200/70 dark:border-slate-600 dark:hover:bg-slate-800" aria-label={t("theme.toggle")} aria-pressed={dark}>
            <span key={String(dark)} className="animate-pop inline-block">{dark ? "☀" : "☾"}</span>
          </button>
        </nav>
      </header>
      <main id="main" tabIndex={-1} className="animate-fade-in flex-1 outline-none">
        {children}
      </main>
      <footer className="border-t border-slate-200 bg-slate-100/60 py-8 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-400">
        <div className="mx-auto max-w-6xl px-4">
          <div className="flex items-center gap-2.5">
            <LogoMark size={22} />
            <Wordmark className="text-base" />
            <span className="hidden text-slate-500 sm:inline">· {SITE.tagline}</span>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2">
            <span>🔒 Your files never leave your device.</span>
            <a className="hover:text-indigo-600 hover:underline" href="#/privacy">Privacy</a>
            <a className="hover:text-indigo-600 hover:underline" href="#/terms">Terms</a>
            <a className="hover:text-indigo-600 hover:underline" href="#/about">About</a>
            <a className="hover:text-indigo-600 hover:underline" href="#/contact">Contact</a>
            <button className="hover:text-indigo-600 hover:underline" onClick={() => navigate("/tools")}>All tools</button>
          </div>
        </div>
      </footer>
    </div>
  );
}
