import EditWorker from "./edit.worker?worker&inline";

export class CancelledError extends Error {
  constructor() {
    super("Cancelled");
    this.name = "CancelledError";
  }
}

export type JobErrorCode = "timeout" | "crash" | "unclonable" | "failed";

/** Typed worker failure so the UI can always show a plain message (Task 1.3: no silent failure). */
export class JobError extends Error {
  code: JobErrorCode;
  constructor(code: JobErrorCode, message: string) {
    super(message);
    this.name = "JobError";
    this.code = code;
  }
}

export interface Job<T> {
  promise: Promise<T>;
  cancel(): void;
}

const DEFAULT_IDLE_MS = 180_000;

/**
 * Every long operation returns {promise, cancel()} (blueprint §8). A fresh worker per job means
 * cancel() can simply terminate it, which also releases all memory the job used.
 * The idle timeout restarts on every progress message, so a slow-but-alive job is never killed, while a job that
 * never answers (hypothesis d) fails with a typed error instead of waiting forever.
 */
export function runJob<T>(
  op: string,
  payload: unknown,
  onProgress?: (value: number, label?: string) => void,
  opts: { idleTimeoutMs?: number } = {}
): Job<T> {
  const idle = opts.idleTimeoutMs ?? DEFAULT_IDLE_MS;
  const worker = new EditWorker();
  let reject!: (e: Error) => void;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const finish = () => {
    clearTimeout(timer);
    worker.terminate();
  };
  const promise = new Promise<T>((res, rej) => {
    reject = rej;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        worker.terminate();
        rej(new JobError("timeout", "This is taking far too long, so it was stopped. Try fewer pages or a smaller file."));
      }, idle);
    };
    arm();
    worker.onmessage = (e: MessageEvent) => {
      const m = e.data;
      if (m.type === "progress") {
        arm();
        onProgress?.(m.value, m.label);
      } else if (m.type === "done") {
        finish();
        res(m.result as T);
      } else if (m.type === "error") {
        finish();
        const err = new JobError("failed", m.message || "The PDF operation failed.");
        err.name = m.name && m.name !== "Error" ? m.name : "JobError";
        rej(err);
      }
    };
    worker.onmessageerror = () => {
      finish();
      rej(new JobError("crash", "The result could not be passed back from the PDF worker."));
    };
    worker.onerror = (ev) => {
      finish();
      rej(new JobError("crash", ev.message || "The PDF worker crashed (possibly out of memory)."));
    };
    try {
      worker.postMessage({ op, payload });
    } catch (e) {
      finish();
      rej(new JobError("unclonable", `Some data in this document could not be sent to the PDF worker: ${e instanceof Error ? e.message : String(e)}`));
    }
  });
  return {
    promise,
    cancel() {
      finish();
      reject(new CancelledError());
    },
  };
}
