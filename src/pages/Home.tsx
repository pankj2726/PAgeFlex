import { useEffect, useState } from "react";
import { SiteLayout } from "../components/Layout";
import { UploadZone, type UploadError } from "../components/UploadZone";
import { LogoMark } from "../components/Logo";
import { btn, btnPrimary } from "../components/ui";
import { openPdfFile, recoverSavedSession } from "../lib/pdf/openFile";
import { clearAllData, loadSession, type SavedSession } from "../lib/pdf/persist";
import { TOOLS } from "../lib/tools";
import { useSeo } from "../lib/seo";
import { useEditor } from "../lib/model/docState";
import { SITE, TAGLINE_HIGHLIGHT } from "../lib/config";

/** `--i` drives the staggered entrance (see .animate-fade-up). */
const stagger = (i: number, step = 55) => ({ animationDelay: `${i * step}ms` });

export function ToolGrid() {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {TOOLS.map((t, i) => (
        <li key={t.slug} className="animate-fade-up" style={stagger(i, 40)}>
          <a href={`#/tools/${t.slug}`} className="lift group flex h-full gap-3 rounded-2xl border border-slate-200 bg-white p-4 hover:border-indigo-300 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-indigo-500">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-indigo-50 text-2xl transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-6 dark:bg-slate-800" aria-hidden="true">{t.icon}</span>
            <span>
              <span className="block font-semibold">{t.name}</span>
              <span className="mt-0.5 block text-sm text-slate-500 dark:text-slate-400">{t.description.split(". ")[0]}.</span>
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}

export default function Home() {
  const [error, setError] = useState<UploadError | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<SavedSession | null>(null);
  const hasDoc = useEditor((s) => s.doc !== null);
  useSeo({
    title: `${SITE.name} – ${SITE.tagline}`,
    description: SITE.description,
    path: "/",
    jsonLd: [{ "@context": "https://schema.org", "@type": "WebApplication", name: SITE.name, applicationCategory: "BusinessApplication", operatingSystem: "Any (modern browser)", offers: { "@type": "Offer", price: "0", priceCurrency: "USD" }, description: SITE.description }],
  });
  useEffect(() => {
    loadSession().then(setSaved);
  }, []);

  const onFiles = async (files: File[]) => {
    setBusy(true);
    setError(null);
    const r = await openPdfFile(files[0]);
    setBusy(false);
    if (!r.ok && r.message !== "Cancelled.") setError({ message: r.message, code: r.code });
  };

  // The tagline is split around the highlighted phrase from ONE string, so the spaces in "Edit, merge, and adapt PDFs instantly." can never be lost.
  const [lead, tail] = SITE.tagline.split(TAGLINE_HIGHLIGHT);

  return (
    <SiteLayout>
      <div className="relative overflow-hidden">
        <div className="hero-blob animate-drift -left-24 top-0 h-80 w-80 bg-indigo-300" aria-hidden="true" />
        <div className="hero-blob animate-drift -right-20 top-40 h-72 w-72 bg-[#EBDBBC]" style={{ animationDelay: "-6s" }} aria-hidden="true" />
        <section className="relative mx-auto max-w-4xl px-4 pb-10 pt-14 text-center">
          <div className="animate-fade-up mx-auto mb-5 inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-white/80 px-3.5 py-1.5 text-xs font-medium text-indigo-700 backdrop-blur dark:border-indigo-900 dark:bg-slate-900/70 dark:text-indigo-300">
            <LogoMark size={18} />
            {SITE.name} · free · private · no sign-up
          </div>
          <h1 className="animate-fade-up text-4xl font-extrabold leading-[1.1] sm:text-6xl" style={stagger(1, 90)}>
            {lead}
            <span className="whitespace-nowrap text-indigo-600 dark:text-indigo-400">{TAGLINE_HIGHLIGHT}</span>
            {tail}
            <span className="animate-blink ml-1 inline-block text-indigo-500" aria-hidden="true">▍</span>
          </h1>
          <p className="animate-fade-up mx-auto mt-5 max-w-2xl text-base leading-relaxed text-slate-600 dark:text-slate-300 sm:text-lg" style={stagger(2, 90)}>
            {SITE.description}
          </p>
          <div className="animate-fade-up mt-9 text-left" style={stagger(3, 90)}>
            <UploadZone onFiles={onFiles} error={error} busy={busy} />
          </div>
          {hasDoc && (
            <p className="animate-fade-in mt-3 text-sm">
              <a className="font-medium text-indigo-600 underline underline-offset-4" href="#/edit">Return to the document you were editing →</a>
            </p>
          )}
          {saved && (
            <div role="region" aria-label="Recover previous session" className="animate-pop mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-indigo-200 bg-indigo-50 p-4 text-left text-sm dark:border-indigo-900 dark:bg-indigo-950/40">
              <span>
                Recover <strong>{saved.fileName}</strong> – autosaved {new Date(saved.savedAt).toLocaleString()} on this device.
              </span>
              <span className="flex gap-2">
                <button
                  className={btnPrimary}
                  onClick={async () => {
                    const r = await recoverSavedSession(saved);
                    if (!r.ok && r.message !== "Cancelled.") setError({ message: r.message });
                  }}
                >
                  Recover
                </button>
                <button className={btn} onClick={async () => { await clearAllData(); setSaved(null); }}>
                  Discard &amp; clear data
                </button>
              </span>
            </div>
          )}
          <ul className="mt-9 grid gap-3 text-left text-sm sm:grid-cols-3">
            {[
              ["🔒", "Private by design", "Parsing, editing and saving run in Web Workers on your device. Nothing is uploaded."],
              ["⚡", "Free, no strings", "No sign-up, no email gate, no watermark on your output."],
              ["✅", "Verified output", "Every download is re-parsed with a second PDF reader and checked before you get it."],
            ].map(([i, t, d], k) => (
              <li key={t} className="lift animate-fade-up rounded-2xl border border-slate-200 bg-white/80 p-4 backdrop-blur dark:border-slate-700 dark:bg-slate-900/80" style={stagger(4 + k, 90)}>
                <div className="text-xl" aria-hidden="true">{i}</div>
                <div className="mt-1 font-semibold">{t}</div>
                <p className="mt-1 text-slate-600 dark:text-slate-300">{d}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <section className="mx-auto max-w-6xl px-4 pb-12 pt-4" aria-labelledby="tools-h">
        <h2 id="tools-h" className="mb-4 text-2xl font-bold">Every PDF tool you need</h2>
        <ToolGrid />
      </section>
      <section className="mx-auto max-w-4xl px-4 pb-16" aria-labelledby="limits-h">
        <h2 id="limits-h" className="mb-3 text-xl font-bold">What to know before you start</h2>
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-slate-600 dark:text-slate-300">
          <li><strong>Text editing replaces, it doesn't reflow.</strong> Clicking existing text covers it and writes new text on top; complex layouts and some subset fonts may not match exactly.</li>
          <li><strong>Signatures are images</strong>, not cryptographic certificates (no PKI signing).</li>
          <li><strong>No Office conversion.</strong> Word/Excel/PowerPoint ↔ PDF needs a server, which this private tool deliberately doesn't use.</li>
          <li><strong>Very large PDFs</strong> are limited by your device's memory.</li>
          <li><strong>OCR accuracy</strong> depends on scan quality and language pack.</li>
        </ul>
      </section>
    </SiteLayout>
  );
}
