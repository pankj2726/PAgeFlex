import { useMemo, useState } from "react";
import { SiteLayout } from "../components/Layout";
import { UploadZone, type UploadError } from "../components/UploadZone";
import { PANEL_TITLES, ToolPanel, probe, type ToolHost, type ToolInput, type ToolResult } from "../components/tools/ToolPanels";
import { Tick, btn, btnPrimary } from "../components/ui";
import { ToolGrid } from "./Home";
import { downloadBlob, commitBytes } from "../lib/pdf/session";
import { openPdfFile } from "../lib/pdf/openFile";
import { sanitizeFilename } from "../lib/pdf/range";
import { verifyPdf, type VerifyResult } from "../lib/pdf/verify";
import { PdfError } from "../lib/pdf/load";
import { toolBySlug, TOOLS } from "../lib/tools";
import { useSeo } from "../lib/seo";
import { useEditor } from "../lib/model/docState";
import { useUi } from "../lib/model/ui";
import { navigate } from "../lib/router";
import { friendlyError } from "../lib/pdf/session";
import { SITE } from "../lib/config";

const SELF_CONTAINED = new Set(["merge", "fromImage"]);

export function ToolsIndex() {
  useSeo({ title: `All PDF tools – ${SITE.name}`, description: "Edit, merge, split, compress, protect, OCR and convert PDFs privately in your browser.", path: "/tools" });
  return (
    <SiteLayout>
      <div className="mx-auto max-w-6xl px-4 py-10">
        <h1 className="mb-6 text-3xl font-bold">All PDF tools</h1>
        <ToolGrid />
      </div>
    </SiteLayout>
  );
}

export default function ToolPage({ slug }: { slug: string }) {
  const tool = toolBySlug(slug);
  const [file, setFile] = useState<ToolInput | null>(null);
  const [error, setError] = useState<UploadError | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ r: ToolResult; verify?: VerifyResult } | null>(null);

  useSeo({
    title: tool?.title ?? `Tool not found – ${SITE.name}`,
    description: tool?.description ?? "",
    path: `/tools/${slug}`,
    jsonLd: tool
      ? [
          { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: tool.faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) },
          { "@context": "https://schema.org", "@type": "WebApplication", name: `${tool.name} – ${SITE.name}`, applicationCategory: "UtilitiesApplication", operatingSystem: "Any (modern browser)", offers: { "@type": "Offer", price: "0", priceCurrency: "USD" } },
          { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "Tools", item: `${window.location.origin}${window.location.pathname}#/tools` }, { "@type": "ListItem", position: 2, name: tool.name }] },
        ]
      : undefined,
  });

  const host = useMemo<ToolHost>(
    () => ({
      hasDoc: false,
      selectedPages: [],
      getInput: async () => file ?? undefined,
      async deliver(r) {
        const verify = r.kind === "pdf" ? await verifyPdf(r.bytes).catch(() => undefined) : undefined;
        setResult({ r, verify });
        if (r.kind === "file") downloadBlob(r.data, r.name, r.mime);
      },
    }),
    [file]
  );

  if (!tool) {
    return (
      <SiteLayout>
        <div className="mx-auto max-w-xl px-4 py-16 text-center">
          <h1 className="text-2xl font-bold">We don't have that tool</h1>
          <p className="mt-2">Try one of these instead:</p>
          <div className="mt-6 text-left"><ToolGrid /></div>
        </div>
      </SiteLayout>
    );
  }

  const takeFile = async (files: File[]) => {
    setBusy(true);
    setError(null);
    try {
      const f = files[0];
      if (f.type && f.type !== "application/pdf" && !/\.pdf$/i.test(f.name)) throw new PdfError("NotPdf", "That file isn't a PDF.");
      const p = await probe(f);
      if (p) setFile({ bytes: p.bytes, password: p.password, pageCount: p.pages, name: f.name });
    } catch (e) {
      setError({ message: friendlyError(e), code: e instanceof PdfError ? e.code : undefined });
    }
    setBusy(false);
  };

  const openInEditor = async (files: File[]) => {
    setBusy(true);
    setError(null);
    const r = await openPdfFile(files[0]);
    setBusy(false);
    if (!r.ok) {
      if (r.message !== "Cancelled.") setError({ message: r.message, code: r.code });
      return;
    }
    if (tool.editorTool === "signature") useUi.getState().set({ signatureOpen: true });
    else if (tool.editorTool) useEditor.setState({ tool: tool.editorTool });
    if (tool.panel === "forms") useUi.getState().set({ rightTab: "forms", rightOpen: true });
  };

  const goEditor = async () => {
    if (result?.r.kind === "pdf") {
      if (await commitBytes(result.r.label, result.r.bytes, result.r.name, true)) navigate("/edit");
    }
  };
  const chain = () => {
    if (result?.r.kind !== "pdf") return;
    const r = result.r;
    probe(new File([r.bytes as BlobPart], r.name, { type: "application/pdf" })).then((p) => {
      if (p) {
        setFile({ bytes: p.bytes, pageCount: p.pages, name: r.name });
        setResult(null);
        window.scrollTo?.(0, 0);
      }
    });
  };

  const editorOnly = !tool.panel || tool.panel === "forms";
  const self = tool.panel ? SELF_CONTAINED.has(tool.panel) : false;

  return (
    <SiteLayout>
      <article className="mx-auto max-w-3xl px-4 py-10">
        <nav aria-label="Breadcrumb" className="mb-3 text-sm text-slate-500">
          <a className="hover:underline" href="#/tools">Tools</a> › {tool.name}
        </nav>
        <h1 className="text-3xl font-extrabold tracking-tight">
          <span aria-hidden="true">{tool.icon} </span>
          {tool.name}
        </h1>
        <p className="mt-3 text-slate-600 dark:text-slate-300">{tool.intro}</p>

        <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900" aria-label={`${tool.name} tool`}>
          {result ? (
            <div aria-live="polite" className="space-y-3">
              <h2 className="animate-pop flex items-center gap-2 text-lg font-semibold text-emerald-700 dark:text-emerald-400"><Tick className="h-7 w-7" /> Done: {result.r.name}</h2>
              {result.r.note && <p className="text-sm">{result.r.note}</p>}
              {result.verify && (
                <ul className="text-sm text-slate-600 dark:text-slate-300">
                  {result.verify.messages.map((m) => (
                    <li key={m}>✔ {m}</li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap gap-2">
                <button className={btnPrimary} onClick={() => downloadBlob(result.r.kind === "pdf" ? result.r.bytes : result.r.data, result.r.kind === "pdf" ? sanitizeFilename(result.r.name) : result.r.name, result.r.kind === "pdf" ? "application/pdf" : result.r.mime)}>
                  Download
                </button>
                {result.r.kind === "pdf" && (
                  <>
                    <button className={btn} onClick={goEditor}>Continue in the editor</button>
                    {tool.panel && !SELF_CONTAINED.has(tool.panel) && <button className={btn} onClick={chain}>Run this tool again</button>}
                  </>
                )}
                <button className={btn} onClick={() => { setResult(null); setFile(null); }}>Start over</button>
              </div>
              {result.r.kind === "pdf" && (
                <p className="text-sm text-slate-500">
                  Chain another tool without re-uploading:{" "}
                  {TOOLS.filter((x) => x.panel && !SELF_CONTAINED.has(x.panel) && x.panel !== "forms" && x.slug !== tool.slug)
                    .slice(0, 6)
                    .map((x, i) => (
                      <button key={x.slug} className="mr-2 text-indigo-600 underline" onClick={async () => { if (await commitBytes(result.r.kind === "pdf" ? result.r.label : "", result.r.kind === "pdf" ? result.r.bytes : new Uint8Array(), result.r.name, true)) { useUi.getState().set({ toolPanel: x.panel! }); navigate("/edit"); } }}>
                        {x.name}{i < 5 ? "," : ""}
                      </button>
                    ))}
                </p>
              )}
            </div>
          ) : editorOnly ? (
            <UploadZone compact onFiles={openInEditor} error={error} busy={busy} label={`Drop a PDF to ${tool.panel === "forms" ? "fill" : tool.name.toLowerCase()}`} />
          ) : self || file ? (
            <div className="space-y-4">
              {file && (
                <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800">
                  <span className="truncate"><strong>{file.name}</strong> · {file.pageCount} page{file.pageCount === 1 ? "" : "s"}</span>
                  <button className="text-indigo-600 underline" onClick={() => setFile(null)}>Change file</button>
                </div>
              )}
              <h2 className="text-lg font-semibold">{PANEL_TITLES[tool.panel!]}</h2>
              <ToolPanel id={tool.panel!} host={host} />
            </div>
          ) : (
            <UploadZone compact onFiles={takeFile} error={error} busy={busy} />
          )}
        </section>

        <section className="mt-10" aria-labelledby="how">
          <h2 id="how" className="mb-3 text-xl font-bold">How it works</h2>
          <ol className="list-decimal space-y-1.5 pl-5">
            {tool.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </section>

        <section className="mt-10" aria-labelledby="faq">
          <h2 id="faq" className="mb-3 text-xl font-bold">Frequently asked questions</h2>
          <div className="space-y-2">
            {tool.faq.map((f) => (
              <details key={f.q} className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                <summary className="cursor-pointer font-medium">{f.q}</summary>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="mt-10" aria-labelledby="rel">
          <h2 id="rel" className="mb-3 text-xl font-bold">Related tools</h2>
          <ul className="flex flex-wrap gap-2">
            {tool.related.map((r) => {
              const t = toolBySlug(r);
              return t ? (
                <li key={r}>
                  <a className="inline-flex items-center gap-1 rounded-full border border-slate-300 px-3 py-1 text-sm hover:border-indigo-500 dark:border-slate-600" href={`#/tools/${r}`}>
                    <span aria-hidden="true">{t.icon}</span> {t.name}
                  </a>
                </li>
              ) : null;
            })}
          </ul>
        </section>
        <p className="mt-10 text-xs text-slate-500">Everything runs on your device. Output isn't watermarked. Limitations of this tool are listed in the FAQ above and on the home page.</p>
      </article>
    </SiteLayout>
  );
}
