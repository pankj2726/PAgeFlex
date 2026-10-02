import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "../utils/cn";
import { useEditor } from "../lib/model/docState";
import { useBusy, usePasswordPrompt } from "../lib/pdf/session";
import { useState } from "react";

export const btn =
  "inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 shadow-sm hover:-translate-y-px hover:border-indigo-300 hover:bg-indigo-50 hover:shadow focus-visible:outline-2 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:border-indigo-500 dark:hover:bg-slate-700";
export const btnPrimary =
  "inline-flex items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:-translate-y-px hover:bg-indigo-500 hover:shadow-lg hover:shadow-indigo-600/25 focus-visible:outline-2 disabled:cursor-not-allowed disabled:opacity-50";
export const input =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 placeholder-slate-400 transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/25 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100";

/** Success tick that draws itself (feedback for completed actions). */
export function Tick({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("h-5 w-5", className)} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" strokeWidth="1.8" opacity="0.35" />
      <path d="M7 12.5l3.5 3.5L17 9" className="tick-draw" />
    </svg>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("h-4 w-4 animate-spin", className)} fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Modal({ title, onClose, children, wide, footer }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("input,textarea,select,button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
      if (e.key === "Tab" && ref.current) {
        const f = [...ref.current.querySelectorAll<HTMLElement>('button,input,textarea,select,a[href],[tabindex]:not([tabindex="-1"])')].filter((el) => !el.hasAttribute("disabled"));
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) (e.preventDefault(), last.focus());
        else if (!e.shiftKey && document.activeElement === last) (e.preventDefault(), first.focus());
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      prev?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="animate-fade-in fixed inset-0 z-50 flex items-end justify-center bg-slate-950/55 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn("animate-pop flex max-h-[92vh] w-full flex-col rounded-t-3xl border border-slate-200 bg-slate-50 shadow-2xl shadow-slate-950/20 dark:border-slate-700 dark:bg-slate-900 sm:rounded-3xl", wide ? "sm:max-w-3xl" : "sm:max-w-lg")}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5 dark:border-slate-700">
          <h2 className="text-base font-semibold">{title}</h2>
          <button className="rounded-lg p-1.5 text-slate-500 hover:rotate-90 hover:bg-slate-200 dark:hover:bg-slate-800" onClick={onClose} aria-label="Close dialog">
            ✕
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 px-5 py-3 dark:border-slate-700">{footer}</div>}
      </div>
    </div>
  );
}

export function Label({ children, hint, className }: { children: ReactNode; hint?: string; className?: string }) {
  return (
    <label className={cn("block text-sm", className)}>
      <span className="mb-1 block font-medium text-slate-700 dark:text-slate-200">{children}</span>
      {hint && <span className="mb-1 block text-xs text-slate-500 dark:text-slate-400">{hint}</span>}
    </label>
  );
}

export function BusyOverlay() {
  const b = useBusy();
  if (!b.active) return null;
  const pct = Math.max(4, Math.round(b.progress * 100));
  return (
    <div className="animate-fade-in fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm" role="alertdialog" aria-live="assertive" aria-label="Working">
      <div className="animate-pop w-full max-w-sm rounded-3xl border border-slate-200 bg-slate-50 p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center gap-2.5">
          <Spinner className="h-5 w-5 text-indigo-600" />
          <p className="text-sm font-medium">{b.label || "Working…"}</p>
          <span className="ml-auto text-xs tabular-nums text-slate-500">{pct}%</span>
        </div>
        <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(b.progress * 100)}>
          <div className="bar-shimmer h-full rounded-full bg-indigo-600 transition-[width] duration-500 ease-out" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-2.5 text-xs text-slate-500 dark:text-slate-400">Processing happens on your device. Large files can take a moment.</p>
        {b.cancel && (
          <button className={cn(btn, "mt-4")} onClick={() => b.cancel?.()}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

export function Toasts() {
  const toasts = useEditor((s) => s.toasts);
  const dismiss = useEditor((s) => s.dismissToast);
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[70] flex w-full max-w-sm flex-col gap-2 px-3 sm:px-0" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.kind === "error" ? "alert" : "status"}
          className={cn(
            "animate-slide-in pointer-events-auto flex items-start gap-2.5 rounded-2xl px-4 py-3 text-sm shadow-xl",
            t.kind === "error" ? "bg-red-700 text-white" : t.kind === "success" ? "bg-slate-900 text-slate-50 dark:bg-slate-100 dark:text-slate-900" : "bg-slate-800 text-white"
          )}
        >
          {t.kind === "success" && <Tick className="mt-0.5 shrink-0 text-indigo-400" />}
          {t.kind === "error" && <span aria-hidden="true">⚠</span>}
          <span className="flex-1">{t.text}</span>
          <button onClick={() => dismiss(t.id)} aria-label="Dismiss message" className="opacity-70 hover:opacity-100">
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

export function PasswordDialog() {
  const req = usePasswordPrompt((s) => s.req);
  const [pw, setPw] = useState("");
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (req) setPw("");
  }, [req]);
  if (!req) return null;
  const submit = () => req.resolve(pw);
  return (
    <Modal
      title="Password required"
      onClose={() => req.resolve(null)}
      footer={
        <>
          <button className={btn} onClick={() => req.resolve(null)}>
            Cancel
          </button>
          <button className={btnPrimary} onClick={submit} disabled={!pw}>
            Open
          </button>
        </>
      }
    >
      <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">
        <strong>{req.name}</strong> is protected. The password is only used inside this browser tab.
      </p>
      {req.wrong && (
        <p role="alert" className="animate-pop mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          That password is incorrect. Try again.
        </p>
      )}
      <Label>Password</Label>
      <div className="flex gap-2">
        <input
          className={input}
          type={show ? "text" : "password"}
          value={pw}
          autoComplete="off"
          onChange={(e) => setPw(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && pw && submit()}
          aria-label="PDF password"
        />
        <button className={btn} onClick={() => setShow((s) => !s)} type="button">
          {show ? "Hide" : "Show"}
        </button>
      </div>
    </Modal>
  );
}
