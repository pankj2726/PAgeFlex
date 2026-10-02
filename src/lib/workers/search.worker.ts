/// <reference lib="webworker" />
/** Runs user-supplied regular expressions off the UI thread so a catastrophic pattern can be killed by a timeout. */
import { findAll, type FindOptions, type Span } from "../text/matcher";

self.onmessage = (e: MessageEvent<{ texts: string[]; query: string; opts: FindOptions }>) => {
  try {
    const { texts, query, opts } = e.data;
    const result: Span[][] = texts.map((t) => findAll(t, query, opts));
    self.postMessage({ ok: true, result });
  } catch (err) {
    self.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
