/**
 * Find & Replace controller (TASKS-02 Task 3). Replacement goes through the SAME guarded edit pipeline as click-to-edit
 * (`makeEditObject`: guards 1–3, tight covers, real text), one glyph range per match, so neighbours stay untouched.
 * Replace All is ONE undoable command.
 */
import { create } from "zustand";
import { addObjects, type DocData } from "../model/commands";
import { useEditor } from "../model/docState";
import type { PdfObject } from "../model/objects";
import { getSourceDoc, sampleColorsForRects } from "../pdf/render";
import { CancelledError } from "../workers/client";
import { measure } from "../../components/viewer/textLayout";
import { makeEditObject } from "./editObject";
import { inkCenter, type Glyph, type GlyphMap, type Rect } from "./glyphMap";
import { applyCase, compileQuery, DEFAULT_FIND, type FindOptions } from "./matcher";
import { matchTexts } from "./matchTexts";
import { getGlyphMap, pruneTextCache } from "./pageText";
import { buildSearchIndex, spanGlyphIds } from "./searchIndex";

export type Scope = "page" | "selected" | "all";
export type Overflow = "shrink" | "overflow" | "skip";

export interface Match {
  pageId: string;
  pageIndex: number;
  glyphIds: number[];
  text: string;
  /** one highlight rectangle per line (page space) */
  rects: Rect[];
}
export interface SkippedItem {
  page: number;
  text: string;
  reason: string;
}

interface FindState {
  open: boolean;
  mode: "find" | "replace";
  query: string;
  replacement: string;
  opts: FindOptions;
  scope: Scope;
  overflow: Overflow;
  matches: Match[];
  current: number;
  busy: boolean;
  progress: number;
  label: string;
  error: string | null;
  summary: string | null;
  skipped: SkippedItem[];
  noTextPages: number;
  set(p: Partial<FindState>): void;
}

export const useFind = create<FindState>((set) => ({
  open: false,
  mode: "find",
  query: "",
  replacement: "",
  opts: DEFAULT_FIND,
  scope: "all",
  overflow: "shrink",
  matches: [],
  current: -1,
  busy: false,
  progress: 0,
  label: "",
  error: null,
  summary: null,
  skipped: [],
  noTextPages: 0,
  set: (p) => set(p),
}));

let token = 0;
let cancelRequested = false;
export const cancelFind = () => {
  cancelRequested = true;
};

function deadFor(objs: PdfObject[]): (g: Glyph) => boolean {
  const rects = objs.filter((o) => o.type === "textedit").flatMap((o) => (o.covers?.length ? o.covers : [{ x: o.x - 1, y: o.y - 1, w: o.w + 2, h: o.h + 2 }]));
  if (!rects.length) return () => false;
  return (g) => {
    const c = inkCenter(g);
    return rects.some((r) => c.x >= r.x && c.x <= r.x + r.w && c.y >= r.y && c.y <= r.y + r.h);
  };
}

function scopePages(doc: DocData, scope: Scope, current: number, selectedIds: string[]) {
  const all = doc.pages.map((page, index) => ({ page, index }));
  if (scope === "all") return all;
  if (scope === "selected" && selectedIds.length) return all.filter((x) => selectedIds.includes(x.page.id));
  return all.filter((x) => x.index === Math.min(current, all.length - 1));
}

function lineRects(map: GlyphMap, ids: number[]): Rect[] {
  const by = new Map<number, Glyph[]>();
  for (const id of ids) {
    const g = map.glyphs[id];
    if (g.space) continue;
    by.set(g.lineId, [...(by.get(g.lineId) ?? []), g]);
  }
  return [...by.values()].map((gs) => {
    const x0 = Math.min(...gs.map((g) => g.ink.x));
    const y0 = Math.min(...gs.map((g) => g.ink.y));
    return { x: x0, y: y0, w: Math.max(...gs.map((g) => g.ink.x + g.ink.w)) - x0, h: Math.max(...gs.map((g) => g.ink.y + g.ink.h)) - y0 };
  });
}

/** Search the chosen scope. Progress + cancel; returns the match list (also stored for highlighting). */
export async function runSearch(o: { keepCurrent?: boolean; keepSummary?: boolean } = {}): Promise<Match[]> {
  const f = useFind.getState();
  const st = useEditor.getState();
  const doc = st.doc;
  const clear = (error: string | null) => useFind.setState({ matches: [], current: -1, error, busy: false, noTextPages: 0, ...(o.keepSummary ? {} : { summary: null, skipped: [] }) });
  if (!doc) return [];
  if (!f.query.trim()) {
    clear(null);
    return [];
  }
  const c = compileQuery(f.query, f.opts);
  if (!c.ok) {
    clear(c.error || null);
    return [];
  }
  const id = ++token;
  cancelRequested = false;
  pruneTextCache(Object.keys(doc.sources));
  useFind.setState({ busy: true, progress: 0, label: "Reading text", error: null, ...(o.keepSummary ? {} : { summary: null, skipped: [] }) });
  try {
    const pages = scopePages(doc, f.scope, st.currentPage, st.selectedPages);
    const per: { index: number; pageId: string; map: GlyphMap; idx: ReturnType<typeof buildSearchIndex>; dead: (g: Glyph) => boolean }[] = [];
    let noText = 0;
    for (let k = 0; k < pages.length; k++) {
      if (cancelRequested || id !== token) throw new CancelledError();
      const { page, index } = pages[k];
      if (!page.sourceId) {
        noText++;
        continue;
      }
      const map = await getGlyphMap(doc.sources[page.sourceId], page.srcIndex, page.cropBox);
      if (!map.glyphs.length) {
        noText++;
        continue;
      }
      const dead = deadFor(doc.objects.filter((x) => x.pageId === page.id));
      per.push({ index, pageId: page.id, map, idx: buildSearchIndex(map, dead), dead });
      if (k % 4 === 0) useFind.setState({ progress: ((k + 1) / pages.length) * 0.85, label: `Reading page ${k + 1} of ${pages.length}` });
    }
    useFind.setState({ progress: 0.9, label: "Matching" });
    const spans = await matchTexts(per.map((p) => p.idx.text), f.query, f.opts);
    if (cancelRequested || id !== token) throw new CancelledError();
    const matches: Match[] = [];
    per.forEach((p, i) => {
      for (const sp of spans[i]) {
        const ids = spanGlyphIds(p.idx, p.map, sp, p.dead);
        if (ids.length) matches.push({ pageId: p.pageId, pageIndex: p.index, glyphIds: ids, text: p.idx.text.slice(sp.start, sp.end), rects: lineRects(p.map, ids) });
      }
    });
    const cur = useFind.getState().current;
    useFind.setState({ matches, current: matches.length ? (o.keepCurrent && cur >= 0 ? Math.min(cur, matches.length - 1) : 0) : -1, noTextPages: noText, busy: false, progress: 1 });
    return matches;
  } catch (e) {
    if (id !== token && !(e instanceof CancelledError)) return [];
    useFind.setState({ busy: false, matches: [], current: -1, error: e instanceof CancelledError ? null : e instanceof Error ? e.message : "Search failed", summary: e instanceof CancelledError ? "Search cancelled." : null });
    return [];
  }
}

export function goTo(i: number) {
  const { matches } = useFind.getState();
  if (!matches.length) return;
  const k = ((i % matches.length) + matches.length) % matches.length; // wrap-around
  useFind.setState({ current: k });
  if (matches[k].pageIndex !== useEditor.getState().currentPage) window.dispatchEvent(new CustomEvent("qf-jump", { detail: matches[k].pageIndex }));
}
export const next = () => goTo(useFind.getState().current + 1);
export const prev = () => goTo(useFind.getState().current - 1);

// ---------------------------------------------------------------- replace
interface Plan {
  objects: PdfObject[];
  skipped: SkippedItem[];
  unchanged: number;
  shrunk: number;
  overflowed: number;
}

function availableWidth(map: GlyphMap, ids: number[], originX: number, size: number, pageW: number): number {
  const first = map.glyphs[ids[0]];
  const onFirst = ids.filter((i) => map.glyphs[i].lineId === first.lineId);
  const lastOnLine = onFirst[onFirst.length - 1];
  const target = new Set(ids);
  let nextInk: number | undefined;
  for (const gid of map.lines[first.lineId].glyphIds) {
    const g = map.glyphs[gid];
    if (gid > lastOnLine && !target.has(gid) && !g.space && !g.mark) {
      nextInk = g.ink.x;
      break;
    }
  }
  return nextInk !== undefined ? nextInk - originX - 0.28 * size : pageW - 24 - originX;
}

async function planReplace(doc: DocData, matches: Match[], replacement: string, onPage: (k: number, n: number) => void): Promise<Plan> {
  const f = useFind.getState();
  const plan: Plan = { objects: [], skipped: [], unchanged: 0, shrunk: 0, overflowed: 0 };
  const byPage = new Map<string, Match[]>();
  for (const m of matches) byPage.set(m.pageId, [...(byPage.get(m.pageId) ?? []), m]);
  let k = 0;
  for (const [pageId, group] of byPage) {
    if (cancelRequested) throw new CancelledError();
    onPage(k++, byPage.size);
    const page = doc.pages.find((p) => p.id === pageId);
    if (!page?.sourceId) continue;
    const src = doc.sources[page.sourceId];
    const map = await getGlyphMap(src, page.srcIndex, page.cropBox);
    const pageW = Math.abs(page.cropBox[2] - page.cropBox[0]);
    const made: { o: PdfObject; first: Glyph }[] = [];
    for (const m of group) {
      const newText = f.opts.caseAware ? applyCase(m.text, replacement) : replacement;
      const res = makeEditObject(map, m.glyphIds, pageId, { newText });
      if (!res.ok) {
        plan.skipped.push({ page: m.pageIndex + 1, text: m.text, reason: res.error });
        continue;
      }
      if (res.unchanged) {
        plan.unchanged++;
        continue;
      }
      const o = res.obj;
      const need = Math.max(...newText.split("\n").map((s) => measure(o, s)));
      const avail = availableWidth(map, m.glyphIds, o.x, o.fontSize ?? 12, pageW);
      if (need > avail + 0.5) {
        if (f.overflow === "skip") {
          plan.skipped.push({ page: m.pageIndex + 1, text: m.text, reason: "No space for the longer text (skipped as chosen)." });
          continue;
        }
        if (f.overflow === "shrink") {
          const scale = avail / need;
          if (!(scale >= 0.6)) {
            plan.skipped.push({ page: m.pageIndex + 1, text: m.text, reason: "No space: the text would have to shrink below 60%." });
            continue;
          }
          o.fontSize = Math.round((o.fontSize ?? 12) * scale * 10) / 10;
          plan.shrunk++;
        } else plan.overflowed++;
      }
      made.push({ o, first: map.glyphs[m.glyphIds[0]] });
    }
    if (made.length) {
      try {
        const colors = await sampleColorsForRects(await getSourceDoc(src), page.srcIndex, made.map(({ first }) => ({ x: first.ink.x - 1, y: first.ink.y - 1, w: first.ink.w + 2, h: first.ink.h + 2 })));
        made.forEach(({ o }, i) => Object.assign(o, { bg: colors[i].bg, color: colors[i].fg }));
      } catch {
        /* keep white / black defaults */
      }
      plan.objects.push(...made.map((x) => x.o));
    }
  }
  return plan;
}

async function applyReplace(matches: Match[], all: boolean) {
  const st = useEditor.getState();
  const doc = st.doc;
  const f = useFind.getState();
  if (!doc || !matches.length) return;
  cancelRequested = false;
  useFind.setState({ busy: true, progress: 0, label: "Replacing", summary: null, skipped: [] });
  let summary: string;
  let skipped: SkippedItem[] = [];
  try {
    const plan = await planReplace(doc, matches, f.replacement, (k, n) => useFind.setState({ progress: (k + 1) / n, label: `Replacing on page group ${k + 1} of ${n}` }));
    if (cancelRequested) throw new CancelledError();
    if (plan.objects.length) st.exec({ ...addObjects(plan.objects), label: all ? "Replace all" : "Replace" });
    skipped = plan.skipped;
    const extras = [plan.unchanged ? `${plan.unchanged} already identical` : "", plan.shrunk ? `${plan.shrunk} shrunk to fit` : "", plan.overflowed ? `${plan.overflowed} overflow their space` : ""].filter(Boolean);
    summary = `Replaced ${plan.objects.length}, skipped ${plan.skipped.length} (no space or blocked), 0 errors.${extras.length ? ` ${extras.join(", ")}.` : ""} One undo reverts all.`;
  } catch (e) {
    summary = e instanceof CancelledError ? "Cancelled – nothing was changed." : `Replace failed, nothing was changed: ${e instanceof Error ? e.message : "unknown error"}`;
  }
  useFind.setState({ busy: false, summary, skipped });
  await runSearch({ keepCurrent: true, keepSummary: true });
}

export async function replaceCurrent() {
  const { matches, current } = useFind.getState();
  if (current < 0 || !matches[current]) return;
  await applyReplace([matches[current]], false);
}

export async function replaceAll() {
  const ms = await runSearch({ keepSummary: true }); // always plan from a fresh match list
  await applyReplace(ms, true);
}
