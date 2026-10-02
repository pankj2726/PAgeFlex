import { useEffect, useState, type ReactNode } from "react";
import JSZip from "jszip";
import { cn } from "../../utils/cn";
import { PdfError, loadPdf } from "../../lib/pdf/load";
import { askPassword, localJob, readFileBytes, withBusy } from "../../lib/pdf/session";
import { everyN, parseRanges, sanitizeFilename } from "../../lib/pdf/range";
import { extractPlainText, openPdfjs, rasterizePage } from "../../lib/pdf/render";
import { runJob } from "../../lib/workers/client";
import { fileToImage } from "../../lib/pdf/images";
import { verifyPdf } from "../../lib/pdf/verify";
import type { PanelId } from "../../lib/tools";
import type { CompressResult } from "../../lib/pdf/compress";
import type { SplitResult } from "../../lib/pdf/split";
import type { Zone } from "../../lib/pdf/pageTools";
import { UploadZone } from "../UploadZone";
import { Label, btn, btnPrimary, input } from "../ui";

export interface ToolInput {
  bytes: Uint8Array;
  password?: string;
  pageCount: number;
  name: string;
}
export type ToolResult =
  | { kind: "pdf"; bytes: Uint8Array; name: string; label: string; note?: string }
  | { kind: "file"; data: Uint8Array | Blob; name: string; mime: string; note?: string };

export interface ToolHost {
  hasDoc: boolean;
  getInput(): Promise<ToolInput | undefined>;
  deliver(r: ToolResult): void;
  selectedPages: number[];
}

const base = (n: string) => n.replace(/\.[a-z0-9]+$/i, "");
const mb = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(2)} MB` : `${(n / 1024).toFixed(0)} KB`);

function Row({ children, cols = 2 }: { children: ReactNode; cols?: number }) {
  return <div className={cn("grid gap-3", cols === 2 ? "grid-cols-2" : cols === 3 ? "grid-cols-3" : "grid-cols-1")}>{children}</div>;
}
function Note({ children }: { children: ReactNode }) {
  return <p className="rounded-md bg-slate-100 p-2 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">{children}</p>;
}
function Run({ onClick, children, disabled }: { onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <button className={btnPrimary} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

export async function probe(file: File): Promise<{ bytes: Uint8Array; password?: string; pages: number } | null> {
  const bytes = await readFileBytes(file);
  let pw: string | undefined;
  for (;;) {
    try {
      const h = await loadPdf(bytes, pw);
      const pages = h.pageCount;
      h.pdfjs.destroy().catch(() => undefined);
      return { bytes, password: pw, pages };
    } catch (e) {
      if (e instanceof PdfError && (e.code === "PasswordRequired" || e.code === "WrongPassword")) {
        const a = await askPassword(file.name, e.code === "WrongPassword");
        if (a === null) return null;
        pw = a;
        continue;
      }
      throw e;
    }
  }
}

// ---------------------------------------------------------------- merge
interface MergeItem {
  id: string;
  name: string;
  pages?: number;
  bytes?: Uint8Array;
  password?: string;
  current?: boolean;
}
function MergePanel({ host }: { host: ToolHost }) {
  const [items, setItems] = useState<MergeItem[]>(host.hasDoc ? [{ id: "current", name: "Current document", current: true }] : []);
  const [err, setErr] = useState<{ message: string } | null>(null);
  const add = async (files: File[]) => {
    setErr(null);
    for (const f of files) {
      try {
        const p = await probe(f);
        if (p) setItems((prev) => [...prev, { id: `${f.name}-${Math.random()}`, name: f.name, bytes: p.bytes, password: p.password, pages: p.pages }]);
      } catch (e) {
        setErr({ message: `${f.name}: ${e instanceof Error ? e.message : "could not be read"}` });
      }
    }
  };
  const move = (i: number, d: number) =>
    setItems((a) => {
      const b = [...a];
      const j = i + d;
      if (j < 0 || j >= b.length) return a;
      [b[i], b[j]] = [b[j], b[i]];
      return b;
    });
  const run = async () => {
    const inputs: { name: string; bytes: Uint8Array; password?: string }[] = [];
    for (const it of items) {
      if (it.current) {
        const inp = await host.getInput();
        if (!inp) return;
        inputs.push({ name: inp.name, bytes: inp.bytes, password: inp.password });
      } else inputs.push({ name: it.name, bytes: it.bytes!, password: it.password });
    }
    const res = await withBusy("Merging", (p) => runJob<{ bytes: Uint8Array; pageCount: number }>("merge", { inputs }, p));
    if (res) host.deliver({ kind: "pdf", bytes: res.bytes, name: "merged.pdf", label: "Merge PDFs", note: `Merged ${inputs.length} files into ${res.pageCount} pages.` });
  };
  return (
    <div className="space-y-3">
      <UploadZone compact multiple onFiles={add} error={err} label="Add PDFs to merge" />
      {items.length > 0 && (
        <ol className="space-y-1">
          {items.map((it, i) => (
            <li key={it.id} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700">
              <span className="w-5 text-slate-400">{i + 1}</span>
              <span className="flex-1 truncate">{it.name}</span>
              {it.pages && <span className="text-xs text-slate-500">{it.pages} p</span>}
              <button className={btn} aria-label={`Move ${it.name} up`} onClick={() => move(i, -1)} disabled={i === 0}>↑</button>
              <button className={btn} aria-label={`Move ${it.name} down`} onClick={() => move(i, 1)} disabled={i === items.length - 1}>↓</button>
              <button className={btn} aria-label={`Remove ${it.name}`} onClick={() => setItems((a) => a.filter((x) => x.id !== it.id))}>✕</button>
            </li>
          ))}
        </ol>
      )}
      <Note>Form fields and bookmarks of the inputs are not carried over. Password-protected files ask for their password when added.</Note>
      <Run onClick={run} disabled={items.length < (host.hasDoc ? 2 : 2)}>Merge {items.length || ""} files</Run>
    </div>
  );
}

// ---------------------------------------------------------------- split
function SplitPanel({ host }: { host: ToolHost }) {
  const [mode, setMode] = useState<"ranges" | "every" | "selection">(host.selectedPages.length ? "selection" : "ranges");
  const [ranges, setRanges] = useState("1-3");
  const [separate, setSeparate] = useState(true);
  const [n, setN] = useState(1);
  const [error, setError] = useState("");
  const run = async () => {
    const inp = await host.getInput();
    if (!inp) return;
    let groups: number[][] = [];
    setError("");
    if (mode === "every") groups = everyN(inp.pageCount, n);
    else if (mode === "selection") groups = [host.selectedPages];
    else {
      if (separate) {
        for (const part of ranges.split(",")) {
          if (!part.trim()) continue;
          const r = parseRanges(part, inp.pageCount);
          if (!r.ok) return setError(r.error);
          groups.push(r.pages);
        }
      } else {
        const r = parseRanges(ranges, inp.pageCount);
        if (!r.ok) return setError(r.error);
        groups = [r.pages];
      }
    }
    if (!groups.length) return setError("Nothing to split.");
    const res = await withBusy("Splitting", (p) => runJob<SplitResult[]>("split", { bytes: inp.bytes, password: inp.password, groups }, p));
    if (!res) return;
    if (res.length === 1) {
      host.deliver({ kind: "pdf", bytes: res[0].bytes, name: `${base(inp.name)}-${res[0].label}.pdf`, label: "Split", note: `Extracted ${res[0].pages.length} page(s).` });
      return;
    }
    const zip = new JSZip();
    res.forEach((r, i) => zip.file(`${base(inp.name)}-${String(i + 1).padStart(2, "0")}-${r.label}.pdf`, r.bytes));
    const data = await zip.generateAsync({ type: "uint8array" });
    host.deliver({ kind: "file", data, name: `${base(inp.name)}-split.zip`, mime: "application/zip", note: `Created ${res.length} PDFs in a ZIP.` });
  };
  return (
    <div className="space-y-3">
      <div role="radiogroup" className="flex flex-wrap gap-3 text-sm">
        {(["ranges", "every", ...(host.selectedPages.length ? ["selection"] : [])] as const).map((m) => (
          <label key={m} className="flex items-center gap-1.5">
            <input type="radio" checked={mode === m} onChange={() => setMode(m as typeof mode)} /> {m === "ranges" ? "By page ranges" : m === "every" ? "Every N pages" : `Selected pages (${host.selectedPages.length})`}
          </label>
        ))}
      </div>
      {mode === "ranges" && (
        <>
          <div>
            <Label hint="Example: 1-3, 5, 8-  (8- means page 8 to the end)">Pages</Label>
            <input className={input} value={ranges} onChange={(e) => setRanges(e.target.value)} aria-label="Page ranges" />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={separate} onChange={(e) => setSeparate(e.target.checked)} /> Each range becomes its own file
          </label>
        </>
      )}
      {mode === "every" && (
        <div>
          <Label>Pages per file</Label>
          <input className={input} type="number" min={1} value={n} onChange={(e) => setN(Math.max(1, Number(e.target.value) || 1))} />
        </div>
      )}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <Run onClick={run}>Split</Run>
    </div>
  );
}

// ---------------------------------------------------------------- compress
function CompressPanel({ host }: { host: ToolHost }) {
  const [preset, setPreset] = useState<"light" | "balanced" | "strong">("balanced");
  const [last, setLast] = useState("");
  const run = async () => {
    const inp = await host.getInput();
    if (!inp) return;
    const res = await withBusy("Compressing", (p) => runJob<CompressResult>("compress", { bytes: inp.bytes, password: inp.password, preset }, p));
    if (!res) return;
    const pct = Math.round((1 - res.newSize / res.originalSize) * 100);
    const note = res.smaller ? `Before ${mb(res.originalSize)} → after ${mb(res.newSize)} (−${pct}%). ${res.imagesRecompressed} image(s) recompressed.` : `This file is already well optimised (${mb(res.originalSize)}); the original was kept.`;
    setLast(note);
    host.deliver({ kind: "pdf", bytes: res.bytes, name: `${base(inp.name)}-compressed.pdf`, label: "Compress", note });
  };
  const opts = [
    ["light", "Light", "Strip metadata and clean up objects. No image changes."],
    ["balanced", "Balanced", "JPEG images ≤ 1800 px at 72% quality. Good for most files."],
    ["strong", "Strong", "JPEG images ≤ 1100 px at 50% quality. Smallest size."],
  ] as const;
  return (
    <div className="space-y-3">
      {opts.map(([id, t, d]) => (
        <label key={id} className={cn("flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm", preset === id ? "border-indigo-600 bg-indigo-50 dark:bg-indigo-950/40" : "border-slate-300 dark:border-slate-600")}>
          <input type="radio" checked={preset === id} onChange={() => setPreset(id)} className="mt-1" />
          <span>
            <strong>{t}</strong>
            <br />
            <span className="text-slate-500">{d}</span>
          </span>
        </label>
      ))}
      <Note>Only JPEG images are recompressed; vector art and text stay sharp. If the result isn't smaller you keep the original.</Note>
      {last && <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">{last}</p>}
      <Run onClick={run}>Compress</Run>
    </div>
  );
}

// ---------------------------------------------------------------- protect / unlock
function ProtectPanel({ host }: { host: ToolHost }) {
  const [pw, setPw] = useState("");
  const [owner, setOwner] = useState("");
  const [perm, setPerm] = useState({ printing: true, copying: true, modifying: false, annotating: true, fillingForms: true });
  const run = async () => {
    const inp = await host.getInput();
    if (!inp) return;
    const bytes = await withBusy("Encrypting (AES-256)", (p) => runJob<Uint8Array>("protect", { bytes: inp.bytes, password: inp.password, options: { userPassword: pw, ownerPassword: owner, permissions: perm } }, p));
    if (!bytes) return;
    const prompt = await verifyPdf(bytes);
    const open = await verifyPdf(bytes, { password: pw || undefined, expectedPages: inp.pageCount });
    host.deliver({ kind: "file", data: bytes, name: `${base(inp.name)}-protected.pdf`, mime: "application/pdf", note: `${prompt.encrypted ? "✔ Re-parse: file prompts for a password." : pw ? "✖ File did not prompt for a password!" : "No open password set (permissions only)."} ${open.ok ? `✔ Opens with the password (${open.pages} pages).` : "✖ Could not re-open with the password."}` });
  };
  return (
    <div className="space-y-3">
      <div>
        <Label hint="Required to open the file. Leave empty to only restrict permissions.">Open password</Label>
        <input className={input} type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
      </div>
      <div>
        <Label hint="Optional. Lets you change permissions later. Random if empty.">Owner password</Label>
        <input className={input} type="password" value={owner} onChange={(e) => setOwner(e.target.value)} autoComplete="new-password" />
      </div>
      <fieldset className="grid grid-cols-2 gap-1 text-sm">
        <legend className="mb-1 font-medium">Allow</legend>
        {(Object.keys(perm) as (keyof typeof perm)[]).map((k) => (
          <label key={k} className="flex items-center gap-2">
            <input type="checkbox" checked={perm[k]} onChange={(e) => setPerm({ ...perm, [k]: e.target.checked })} /> {k === "fillingForms" ? "filling forms" : k}
          </label>
        ))}
      </fieldset>
      <Note>AES-256. We can't recover a lost password. Permission flags are advisory in some viewers; the open password is the real protection.</Note>
      <Run onClick={run} disabled={!pw && !owner}>Protect &amp; download</Run>
    </div>
  );
}

function UnlockPanel({ host }: { host: ToolHost }) {
  const run = async () => {
    const inp = await host.getInput();
    if (!inp) return;
    if (!inp.password && !host.hasDoc) {
      const probeRes = await verifyPdf(inp.bytes);
      if (!probeRes.encrypted) return host.deliver({ kind: "file", data: inp.bytes, name: inp.name, mime: "application/pdf", note: "This PDF isn't password protected – nothing to remove." });
    }
    const bytes = await withBusy("Removing password", (p) => runJob<Uint8Array>("unlock", { bytes: inp.bytes, password: inp.password ?? "" }, p));
    if (!bytes) return;
    const v = await verifyPdf(bytes, { expectedPages: inp.pageCount });
    host.deliver({ kind: "pdf", bytes, name: `${base(inp.name)}-unlocked.pdf`, label: "Unlock", note: v.encrypted ? "✖ The result still asks for a password." : `✔ Re-parsed without a password: ${v.pages} pages.` });
  };
  return (
    <div className="space-y-3">
      <Note>You must know the password – it was requested when you opened the file. This tool never guesses or cracks passwords.</Note>
      <Run onClick={run}>Remove password</Run>
    </div>
  );
}

// ---------------------------------------------------------------- crop / resize
const UNITS = { pt: 1, mm: 72 / 25.4, in: 72 } as const;
const SIZES: Record<string, [number, number]> = { A4: [595.28, 841.89], A5: [419.53, 595.28], Letter: [612, 792], Legal: [612, 1008] };
function CropPanel({ host }: { host: ToolHost }) {
  const [tab, setTab] = useState<"crop" | "resize">("crop");
  const [unit, setUnit] = useState<keyof typeof UNITS>("mm");
  const [m, setM] = useState({ top: 10, right: 10, bottom: 10, left: 10 });
  const [size, setSize] = useState("A4");
  const [orient, setOrient] = useState<"portrait" | "landscape">("portrait");
  const [scope, setScope] = useState<"all" | "selected">(host.selectedPages.length ? "selected" : "all");
  const run = async () => {
    const inp = await host.getInput();
    if (!inp) return;
    const pages = scope === "selected" && host.selectedPages.length ? host.selectedPages : undefined;
    let bytes: Uint8Array | undefined;
    if (tab === "crop") {
      const k = UNITS[unit];
      bytes = await withBusy("Cropping", () => runJob<Uint8Array>("crop", { bytes: inp.bytes, password: inp.password, options: { pages, top: m.top * k, right: m.right * k, bottom: m.bottom * k, left: m.left * k } }));
    } else {
      let [w, h] = SIZES[size];
      if (orient === "landscape") [w, h] = [h, w];
      bytes = await withBusy("Resizing", () => runJob<Uint8Array>("resize", { bytes: inp.bytes, password: inp.password, options: { pages, width: w, height: h } }));
    }
    if (bytes) host.deliver({ kind: "pdf", bytes, name: `${base(inp.name)}-${tab === "crop" ? "cropped" : "resized"}.pdf`, label: tab === "crop" ? "Crop pages" : "Resize pages" });
  };
  return (
    <div className="space-y-3">
      <div role="tablist" className="flex gap-2">
        {(["crop", "resize"] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={cn(btn, tab === t && "!bg-indigo-100 dark:!bg-indigo-900")} onClick={() => setTab(t)}>
            {t === "crop" ? "Crop margins" : "Resize to paper size"}
          </button>
        ))}
      </div>
      {tab === "crop" ? (
        <>
          <Row>
            {(["top", "right", "bottom", "left"] as const).map((s) => (
              <div key={s}>
                <Label>Trim {s}</Label>
                <input className={input} type="number" min={0} step={1} value={m[s]} onChange={(e) => setM({ ...m, [s]: Math.max(0, Number(e.target.value) || 0) })} />
              </div>
            ))}
          </Row>
          <div>
            <Label>Unit</Label>
            <select className={input} value={unit} onChange={(e) => setUnit(e.target.value as keyof typeof UNITS)}>
              <option value="mm">millimetres</option>
              <option value="in">inches</option>
              <option value="pt">points</option>
            </select>
          </div>
        </>
      ) : (
        <Row>
          <div>
            <Label>Paper size</Label>
            <select className={input} value={size} onChange={(e) => setSize(e.target.value)}>
              {Object.keys(SIZES).map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <Label>Orientation</Label>
            <select className={input} value={orient} onChange={(e) => setOrient(e.target.value as typeof orient)}>
              <option value="portrait">Portrait</option>
              <option value="landscape">Landscape</option>
            </select>
          </div>
        </Row>
      )}
      <div className="flex gap-4 text-sm">
        <label className="flex items-center gap-1.5">
          <input type="radio" checked={scope === "all"} onChange={() => setScope("all")} /> All pages
        </label>
        <label className="flex items-center gap-1.5">
          <input type="radio" checked={scope === "selected"} disabled={!host.selectedPages.length} onChange={() => setScope("selected")} /> Selected pages ({host.selectedPages.length})
        </label>
      </div>
      <Note>Margins are applied as the page looks on screen, even for rotated pages. Cropping hides content; it does not delete it – use Redact for that.</Note>
      <Run onClick={run}>{tab === "crop" ? "Crop" : "Resize"}</Run>
    </div>
  );
}

// ---------------------------------------------------------------- watermark
function WatermarkPanel({ host }: { host: ToolHost }) {
  const [kind, setKind] = useState<"text" | "image">("text");
  const [text, setText] = useState("CONFIDENTIAL");
  const [img, setImg] = useState<string | null>(null);
  const [size, setSize] = useState(64);
  const [opacity, setOpacity] = useState(0.25);
  const [angle, setAngle] = useState(45);
  const [color, setColor] = useState("#dc2626");
  const [tile, setTile] = useState(false);
  const run = async () => {
    const inp = await host.getInput();
    if (!inp) return;
    const options = { pages: host.selectedPages.length ? host.selectedPages : undefined, text: kind === "text" ? text : undefined, imageDataUrl: kind === "image" ? (img ?? undefined) : undefined, opacity, angle, size: kind === "image" ? Math.min(size, 100) : size, color, tile };
    const bytes = await withBusy("Adding watermark", (p) => runJob<Uint8Array>("watermark", { bytes: inp.bytes, password: inp.password, options }, p));
    if (bytes) host.deliver({ kind: "pdf", bytes, name: `${base(inp.name)}-watermarked.pdf`, label: "Watermark" });
  };
  return (
    <div className="space-y-3">
      <div className="flex gap-2" role="tablist">
        {(["text", "image"] as const).map((k) => (
          <button key={k} role="tab" aria-selected={kind === k} className={cn(btn, kind === k && "!bg-indigo-100 dark:!bg-indigo-900")} onClick={() => setKind(k)}>
            {k === "text" ? "Text" : "Image"}
          </button>
        ))}
      </div>
      {kind === "text" ? (
        <Row>
          <div>
            <Label>Text</Label>
            <input className={input} value={text} onChange={(e) => setText(e.target.value)} />
          </div>
          <div>
            <Label>Colour</Label>
            <input type="color" className="h-9 w-full rounded border" value={color} onChange={(e) => setColor(e.target.value)} />
          </div>
        </Row>
      ) : (
        <div>
          <Label>Image (PNG or JPG)</Label>
          <input type="file" accept="image/*" aria-label="Watermark image" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setImg((await fileToImage(f, 1600)).dataUrl); }} />
          {img && <img src={img} alt="Watermark preview" className="mt-2 max-h-20 rounded border" />}
        </div>
      )}
      <Row>
        <div>
          <Label>{kind === "text" ? "Font size (pt)" : "Width (% of page)"}</Label>
          <input className={input} type="number" min={kind === "text" ? 8 : 5} max={kind === "text" ? 400 : 100} value={kind === "image" ? Math.min(size, 100) : size} onChange={(e) => setSize(Number(e.target.value) || 40)} />
        </div>
        <div>
          <Label>Rotation (° counter-clockwise)</Label>
          <input className={input} type="number" value={angle} onChange={(e) => setAngle(Number(e.target.value) || 0)} />
        </div>
      </Row>
      <div>
        <Label>Opacity: {Math.round(opacity * 100)}%</Label>
        <input type="range" className="w-full" min={0.05} max={1} step={0.05} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={tile} onChange={(e) => setTile(e.target.checked)} /> Repeat across page
      </label>
      <Run onClick={run} disabled={kind === "text" ? !text.trim() : !img}>Add watermark{host.selectedPages.length ? ` to ${host.selectedPages.length} selected page(s)` : ""}</Run>
    </div>
  );
}

// ---------------------------------------------------------------- page numbers / header / footer / bates
function StampPanel({ host }: { host: ToolHost }) {
  const [zones, setZones] = useState<Record<Zone, string>>({ "header-left": "", "header-center": "", "header-right": "", "footer-left": "", "footer-center": "Page {n} of {total}", "footer-right": "" });
  const [start, setStart] = useState(1);
  const [size, setSize] = useState(10);
  const [margin, setMargin] = useState(28);
  const [color, setColor] = useState("#334155");
  const [bates, setBates] = useState(false);
  const [b, setB] = useState({ prefix: "DOC-", start: 1, digits: 6, suffix: "" });
  const labels: Zone[] = ["header-left", "header-center", "header-right", "footer-left", "footer-center", "footer-right"];
  const run = async () => {
    const inp = await host.getInput();
    if (!inp) return;
    const z = { ...zones };
    if (bates && !Object.values(z).some((v) => v.includes("{bates}"))) z["footer-right"] = (z["footer-right"] + " {bates}").trim();
    const options = { pages: host.selectedPages.length ? host.selectedPages : undefined, zones: z, startNumber: start, size, color, margin, bates: bates ? b : undefined };
    const bytes = await withBusy("Adding text to pages", (p) => runJob<Uint8Array>("stamp", { bytes: inp.bytes, password: inp.password, options }, p));
    if (bytes) host.deliver({ kind: "pdf", bytes, name: `${base(inp.name)}-numbered.pdf`, label: "Page numbers / header / footer" });
  };
  return (
    <div className="space-y-3">
      <Note>Use {"{n}"} for the page number, {"{total}"} for the page count and {"{bates}"} for the Bates number.</Note>
      <Row cols={3}>
        {labels.map((l) => (
          <div key={l}>
            <Label>{l.replace("-", " ")}</Label>
            <input className={input} value={zones[l]} onChange={(e) => setZones({ ...zones, [l]: e.target.value })} aria-label={l} />
          </div>
        ))}
      </Row>
      <Row cols={3}>
        <div>
          <Label>First number</Label>
          <input className={input} type="number" value={start} onChange={(e) => setStart(Number(e.target.value) || 1)} />
        </div>
        <div>
          <Label>Size (pt)</Label>
          <input className={input} type="number" min={6} value={size} onChange={(e) => setSize(Number(e.target.value) || 10)} />
        </div>
        <div>
          <Label>Margin (pt)</Label>
          <input className={input} type="number" min={0} value={margin} onChange={(e) => setMargin(Number(e.target.value) || 0)} />
        </div>
      </Row>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={bates} onChange={(e) => setBates(e.target.checked)} /> Add Bates numbering
      </label>
      {bates && (
        <Row cols={2}>
          <div>
            <Label>Prefix</Label>
            <input className={input} value={b.prefix} onChange={(e) => setB({ ...b, prefix: e.target.value })} />
          </div>
          <div>
            <Label>Suffix</Label>
            <input className={input} value={b.suffix} onChange={(e) => setB({ ...b, suffix: e.target.value })} />
          </div>
          <div>
            <Label>Start at</Label>
            <input className={input} type="number" value={b.start} onChange={(e) => setB({ ...b, start: Number(e.target.value) || 1 })} />
          </div>
          <div>
            <Label>Digits</Label>
            <input className={input} type="number" min={1} max={12} value={b.digits} onChange={(e) => setB({ ...b, digits: Math.min(12, Math.max(1, Number(e.target.value) || 6)) })} />
          </div>
        </Row>
      )}
      <label className="flex items-center gap-2 text-sm">
        Colour <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
      </label>
      <Run onClick={run}>Apply</Run>
    </div>
  );
}

// ---------------------------------------------------------------- metadata
function MetadataPanel({ host }: { host: ToolHost }) {
  const [m, setM] = useState({ title: "", author: "", subject: "", keywords: "", creator: "", producer: "" });
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    host.getInput().then(async (inp) => {
      if (!inp || !alive) return;
      try {
        const doc = await openPdfjs(inp.bytes, inp.password);
        const info = ((await doc.getMetadata()).info ?? {}) as Record<string, string>;
        doc.destroy().catch(() => undefined);
        if (alive) setM({ title: info.Title ?? "", author: info.Author ?? "", subject: info.Subject ?? "", keywords: info.Keywords ?? "", creator: info.Creator ?? "", producer: info.Producer ?? "" });
      } finally {
        if (alive) setLoaded(true);
      }
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const run = async (clearAll: boolean) => {
    const inp = await host.getInput();
    if (!inp) return;
    const bytes = await withBusy("Updating metadata", () => runJob<Uint8Array>("metadata", { bytes: inp.bytes, password: inp.password, metadata: m, clearAll }));
    if (!bytes) return;
    const v = await verifyPdf(bytes, { expectedPages: inp.pageCount });
    host.deliver({ kind: "pdf", bytes, name: `${base(inp.name)}-metadata.pdf`, label: "Edit metadata", note: clearAll ? `All metadata cleared. ${v.messages[0]}` : `Metadata saved. Re-parsed title: “${v.title ?? ""}”.` });
  };
  const keys = Object.keys(m) as (keyof typeof m)[];
  return (
    <div className="space-y-3">
      {!loaded && <p className="text-sm text-slate-500">Reading document properties…</p>}
      <Row>
        {keys.map((k) => (
          <div key={k}>
            <Label>{k[0].toUpperCase() + k.slice(1)}</Label>
            <input className={input} value={m[k]} onChange={(e) => setM({ ...m, [k]: e.target.value })} />
          </div>
        ))}
      </Row>
      <div className="flex gap-2">
        <Run onClick={() => run(false)}>Save metadata</Run>
        <button className={btn} onClick={() => run(true)}>Clear all metadata</button>
      </div>
      <Note>Empty fields are removed. This changes document properties only, not page content.</Note>
    </div>
  );
}

// ---------------------------------------------------------------- PDF → image
function ToImagePanel({ host }: { host: ToolHost }) {
  const [fmt, setFmt] = useState<"png" | "jpg">("png");
  const [dpi, setDpi] = useState(150);
  const [range, setRange] = useState("");
  const [error, setError] = useState("");
  const run = async () => {
    const inp = await host.getInput();
    if (!inp) return;
    setError("");
    let pages = Array.from({ length: inp.pageCount }, (_, i) => i);
    if (range.trim()) {
      const r = parseRanges(range, inp.pageCount);
      if (!r.ok) return setError(r.error);
      pages = r.pages;
    }
    const res = await withBusy("Rendering pages", (p) =>
      localJob(async (c) => {
        const doc = await openPdfjs(inp.bytes, inp.password);
        try {
          const files: { name: string; bytes: Uint8Array }[] = [];
          for (let k = 0; k < pages.length; k++) {
            if (c.cancelled()) break;
            p(k / pages.length, `Rendering page ${pages[k] + 1} (${k + 1}/${pages.length})`);
            const pg = await doc.getPage(pages[k] + 1);
            const vp = pg.getViewport({ scale: dpi / 72 });
            if (vp.width * vp.height > 60_000_000) throw new RangeError("That page is too large at this DPI for your device's memory. Lower the DPI.");
            const r = await rasterizePage(doc, pages[k], dpi / 72, { rotation: pg.rotate, mime: fmt === "png" ? "image/png" : "image/jpeg", quality: 0.92 });
            files.push({ name: `${base(inp.name)}-page-${String(pages[k] + 1).padStart(3, "0")}.${fmt}`, bytes: r.bytes });
          }
          return files;
        } finally {
          doc.destroy().catch(() => undefined);
        }
      })
    );
    if (!res) return;
    if (res.length === 1) return host.deliver({ kind: "file", data: res[0].bytes, name: res[0].name, mime: fmt === "png" ? "image/png" : "image/jpeg", note: "Image created." });
    const zip = new JSZip();
    res.forEach((f) => zip.file(f.name, f.bytes));
    host.deliver({ kind: "file", data: await zip.generateAsync({ type: "uint8array" }), name: `${base(inp.name)}-images.zip`, mime: "application/zip", note: `${res.length} images in a ZIP.` });
  };
  return (
    <div className="space-y-3">
      <Row cols={3}>
        <div>
          <Label>Format</Label>
          <select className={input} value={fmt} onChange={(e) => setFmt(e.target.value as "png" | "jpg")}>
            <option value="png">PNG (lossless)</option>
            <option value="jpg">JPG (smaller)</option>
          </select>
        </div>
        <div>
          <Label>Resolution</Label>
          <select className={input} value={dpi} onChange={(e) => setDpi(Number(e.target.value))}>
            {[72, 96, 150, 200, 300].map((d) => (
              <option key={d} value={d}>{d} DPI</option>
            ))}
          </select>
        </div>
        <div>
          <Label>Pages (blank = all)</Label>
          <input className={input} value={range} onChange={(e) => setRange(e.target.value)} placeholder="1-3, 7" />
        </div>
      </Row>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <Run onClick={run}>Convert</Run>
    </div>
  );
}

// ---------------------------------------------------------------- image → PDF
interface Img {
  id: string;
  file: File;
}
function FromImagePanel({ host }: { host: ToolHost }) {
  const [imgs, setImgs] = useState<Img[]>([]);
  const [pageSize, setPageSize] = useState<"fit" | "a4" | "letter">("a4");
  const [margin, setMargin] = useState(24);
  const [orientation, setOrientation] = useState<"auto" | "portrait" | "landscape">("auto");
  const move = (i: number, d: number) =>
    setImgs((a) => {
      const b = [...a];
      const j = i + d;
      if (j < 0 || j >= b.length) return a;
      [b[i], b[j]] = [b[j], b[i]];
      return b;
    });
  const run = async () => {
    const images: { name: string; bytes: Uint8Array; mime: string }[] = [];
    for (const it of imgs) images.push({ name: it.file.name, bytes: await readFileBytes(it.file), mime: it.file.type || "image/png" });
    const bytes = await withBusy("Creating PDF", (p) => runJob<Uint8Array>("imagesToPdf", { images, options: { pageSize, margin, orientation } }, p));
    if (bytes) host.deliver({ kind: "pdf", bytes, name: "images.pdf", label: "Images to PDF", note: `${imgs.length} image(s) → ${imgs.length} page(s).` });
  };
  return (
    <div className="space-y-3">
      <UploadZone compact multiple accept="image" onFiles={(f) => setImgs((a) => [...a, ...f.map((file) => ({ id: `${file.name}-${Math.random()}`, file }))])} />
      {imgs.length > 0 && (
        <ol className="space-y-1">
          {imgs.map((it, i) => (
            <li key={it.id} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-sm dark:border-slate-700">
              <span className="w-5 text-slate-400">{i + 1}</span>
              <span className="flex-1 truncate">{it.file.name}</span>
              <button className={btn} aria-label="Move up" onClick={() => move(i, -1)} disabled={i === 0}>↑</button>
              <button className={btn} aria-label="Move down" onClick={() => move(i, 1)} disabled={i === imgs.length - 1}>↓</button>
              <button className={btn} aria-label={`Remove ${it.file.name}`} onClick={() => setImgs((a) => a.filter((x) => x.id !== it.id))}>✕</button>
            </li>
          ))}
        </ol>
      )}
      <Row cols={3}>
        <div>
          <Label>Page size</Label>
          <select className={input} value={pageSize} onChange={(e) => setPageSize(e.target.value as typeof pageSize)}>
            <option value="a4">A4</option>
            <option value="letter">US Letter</option>
            <option value="fit">Fit to image</option>
          </select>
        </div>
        <div>
          <Label>Orientation</Label>
          <select className={input} value={orientation} onChange={(e) => setOrientation(e.target.value as typeof orientation)} disabled={pageSize === "fit"}>
            <option value="auto">Auto</option>
            <option value="portrait">Portrait</option>
            <option value="landscape">Landscape</option>
          </select>
        </div>
        <div>
          <Label>Margin (pt)</Label>
          <input className={input} type="number" min={0} value={margin} onChange={(e) => setMargin(Math.max(0, Number(e.target.value) || 0))} />
        </div>
      </Row>
      <Run onClick={run} disabled={!imgs.length}>Create PDF</Run>
    </div>
  );
}

// ---------------------------------------------------------------- PDF → text
function ToTextPanel({ host }: { host: ToolHost }) {
  const [text, setText] = useState<string | null>(null);
  const [name, setName] = useState("document");
  const run = async () => {
    const inp = await host.getInput();
    if (!inp) return;
    const res = await withBusy("Extracting text", (p) =>
      localJob(async (c) => {
        const doc = await openPdfjs(inp.bytes, inp.password);
        try {
          const out: string[] = [];
          for (let i = 0; i < doc.numPages; i++) {
            if (c.cancelled()) break;
            p(i / doc.numPages, `Page ${i + 1} of ${doc.numPages}`);
            out.push(...(await extractPlainText(doc, [i])));
          }
          return out;
        } finally {
          doc.destroy().catch(() => undefined);
        }
      })
    );
    if (!res) return;
    setName(base(inp.name));
    setText(res.map((t, i) => `--- Page ${i + 1} ---\n${t.trim()}`).join("\n\n"));
  };
  const empty = text !== null && text.replace(/--- Page \d+ ---/g, "").trim() === "";
  return (
    <div className="space-y-3">
      <Run onClick={run}>Extract text</Run>
      {text !== null && (
        <>
          {empty ? (
            <p role="alert" className="rounded-md bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">No selectable text was found. This PDF is probably a scan – run the OCR tool first.</p>
          ) : (
            <textarea readOnly className={cn(input, "h-48 font-mono text-xs")} value={text.slice(0, 20000) + (text.length > 20000 ? "\n… (preview truncated – the download has everything)" : "")} aria-label="Extracted text preview" />
          )}
          <div className="flex gap-2">
            <button className={btnPrimary} disabled={empty} onClick={() => host.deliver({ kind: "file", data: new Blob([text], { type: "text/plain;charset=utf-8" }), name: `${name}.txt`, mime: "text/plain", note: `${text.length.toLocaleString()} characters.` })}>
              Download .txt
            </button>
            <button className={btn} disabled={empty} onClick={() => navigator.clipboard?.writeText(text)}>Copy</button>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- OCR
const LANGS: [string, string][] = [["eng", "English"], ["spa", "Spanish"], ["fra", "French"], ["deu", "German"], ["ita", "Italian"], ["por", "Portuguese"], ["nld", "Dutch"], ["rus", "Russian"], ["hin", "Hindi"], ["ara", "Arabic"], ["chi_sim", "Chinese (Simplified)"], ["jpn", "Japanese"], ["kor", "Korean"]];
function OcrPanel({ host }: { host: ToolHost }) {
  const [lang, setLang] = useState("eng");
  const [range, setRange] = useState("");
  const [error, setError] = useState("");
  const run = async () => {
    const inp = await host.getInput();
    if (!inp) return;
    setError("");
    let pages = Array.from({ length: inp.pageCount }, (_, i) => i);
    if (range.trim()) {
      const r = parseRanges(range, inp.pageCount);
      if (!r.ok) return setError(r.error);
      pages = r.pages;
    }
    const SCALE = 200 / 72;
    const result = await withBusy("Loading OCR engine and language data", (p) =>
      localJob(async (c) => {
        const { createWorker } = await import("tesseract.js");
        const worker = await createWorker(lang, 1, { logger: (m: { status?: string; progress?: number }) => m.status === "loading language traineddata" && p(0.02 + (m.progress ?? 0) * 0.08, "Downloading language data") });
        const doc = await openPdfjs(inp.bytes, inp.password);
        const layers: { pageIndex: number; scale: number; words: { text: string; x0: number; y0: number; x1: number; y1: number }[] }[] = [];
        try {
          for (let k = 0; k < pages.length; k++) {
            if (c.cancelled()) throw new Error("cancelled");
            p(0.1 + (k / pages.length) * 0.8, `Recognising page ${pages[k] + 1} (${k + 1}/${pages.length})`);
            const pg = await doc.getPage(pages[k] + 1);
            const img = await rasterizePage(doc, pages[k], SCALE, { rotation: pg.rotate, mime: "image/png" });
            const { data } = await worker.recognize(new Blob([img.bytes as BlobPart], { type: "image/png" }), {}, { blocks: true });
            const words: { text: string; x0: number; y0: number; x1: number; y1: number }[] = [];
            for (const b of data.blocks ?? []) for (const para of b.paragraphs) for (const line of para.lines) for (const w of line.words) if (w.text.trim() && w.confidence > 20) words.push({ text: w.text, ...w.bbox });
            layers.push({ pageIndex: pages[k], scale: SCALE, words });
          }
        } finally {
          await worker.terminate();
          doc.destroy().catch(() => undefined);
        }
        p(0.92, "Writing searchable text layer");
        const total = layers.reduce((n, l) => n + l.words.length, 0);
        const bytes = await runJob<Uint8Array>("textLayer", { bytes: inp.bytes, password: inp.password, pages: layers }).promise;
        return { bytes, total };
      })
    );
    if (!result) return;
    const v = await verifyPdf(result.bytes, { expectedPages: inp.pageCount, withText: true });
    const chars = (v.text ?? []).join("").trim().length;
    host.deliver({ kind: "pdf", bytes: result.bytes, name: `${base(inp.name)}-ocr.pdf`, label: "OCR", note: `Recognised ${result.total} words. Re-extracted ${chars.toLocaleString()} characters of selectable text from the output with a second parser.${chars === 0 ? " ✖ No text found – try a clearer scan or another language." : " ✔"}` });
  };
  return (
    <div className="space-y-3">
      <Row>
        <div>
          <Label>Language</Label>
          <select className={input} value={lang} onChange={(e) => setLang(e.target.value)}>
            {LANGS.map(([c, n]) => (
              <option key={c} value={c}>{n}</option>
            ))}
          </select>
        </div>
        <div>
          <Label>Pages (blank = all)</Label>
          <input className={input} value={range} onChange={(e) => setRange(e.target.value)} placeholder="1-5" />
        </div>
      </Row>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <Note>Recognition runs in your browser (in a worker). Only the public language data file is downloaded from a CDN – never your document. You can cancel at any time. Accuracy depends on scan quality.</Note>
      <Run onClick={run}>Run OCR</Run>
    </div>
  );
}

export const PANEL_TITLES: Record<PanelId, string> = {
  merge: "Merge PDFs",
  split: "Split PDF",
  compress: "Compress PDF",
  protect: "Protect with a password",
  unlock: "Unlock PDF",
  crop: "Crop or resize pages",
  resize: "Resize pages",
  watermark: "Add watermark",
  stamp: "Page numbers, header, footer & Bates",
  metadata: "Edit metadata",
  toImage: "PDF to image",
  fromImage: "Image to PDF",
  toText: "PDF to text",
  ocr: "OCR – make searchable",
  forms: "Fill & flatten forms",
};

export function ToolPanel({ id, host }: { id: PanelId; host: ToolHost }) {
  switch (id) {
    case "merge":
      return <MergePanel host={host} />;
    case "split":
      return <SplitPanel host={host} />;
    case "compress":
      return <CompressPanel host={host} />;
    case "protect":
      return <ProtectPanel host={host} />;
    case "unlock":
      return <UnlockPanel host={host} />;
    case "crop":
    case "resize":
      return <CropPanel host={host} />;
    case "watermark":
      return <WatermarkPanel host={host} />;
    case "stamp":
      return <StampPanel host={host} />;
    case "metadata":
      return <MetadataPanel host={host} />;
    case "toImage":
      return <ToImagePanel host={host} />;
    case "fromImage":
      return <FromImagePanel host={host} />;
    case "toText":
      return <ToTextPanel host={host} />;
    case "ocr":
      return <OcrPanel host={host} />;
    default:
      return <p className="text-sm">Open the editor to use this tool.</p>;
  }
}

export { sanitizeFilename };
