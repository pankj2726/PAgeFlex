import SearchWorker from "../workers/search.worker?worker&inline";
import { findAll, type FindOptions, type Span } from "./matcher";

/**
 * Match every page text. Literal queries are escaped, so they are always safe on the main thread.
 * Regex mode runs the whole `findAll` in a worker that is terminated after `timeoutMs`
 * (catastrophic-backtracking guard, spec §3.1) – the UI thread never executes a user-supplied pattern.
 */
export async function matchTexts(texts: string[], query: string, opts: FindOptions, timeoutMs = 4000): Promise<Span[][]> {
  if (!opts.regex) return texts.map((t) => findAll(t, query, opts));
  return new Promise((resolve, reject) => {
    const w = new SearchWorker();
    const timer = setTimeout(() => {
      w.terminate();
      reject(new Error("That regular expression is taking too long (possible catastrophic backtracking) and was stopped."));
    }, timeoutMs);
    w.onmessage = (e: MessageEvent<{ ok: boolean; result?: Span[][]; error?: string }>) => {
      clearTimeout(timer);
      w.terminate();
      if (e.data.ok) resolve(e.data.result!);
      else reject(new Error(e.data.error || "Invalid pattern"));
    };
    w.onerror = (ev) => {
      clearTimeout(timer);
      w.terminate();
      reject(new Error(ev.message || "Search failed"));
    };
    w.postMessage({ texts, query, opts });
  });
}
