import { useRef, useState } from "react";
import { cn } from "../utils/cn";
import { ERROR_TITLES } from "../lib/pdf/openFile";
import { t } from "../lib/i18n";
import { Spinner } from "./ui";

export interface UploadError {
  message: string;
  code?: string;
}

function UploadIcon({ over, image }: { over: boolean; image: boolean }) {
  return (
    <svg viewBox="0 0 64 64" className={cn("h-16 w-16 transition-transform duration-300", over ? "-translate-y-1 scale-110" : "animate-float")} fill="none" aria-hidden="true">
      <path d="M16 6h22l12 12v36a4 4 0 0 1-4 4H16a4 4 0 0 1-4-4V10a4 4 0 0 1 4-4z" fill="#FAF9F5" stroke="#C15F3C" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M38 6v12h12z" fill="#EBDBBC" stroke="#C15F3C" strokeWidth="2.5" strokeLinejoin="round" />
      {image ? (
        <>
          <circle cx="25" cy="33" r="3.5" fill="#D97757" />
          <path d="M16 50l10-10 7 7 5-5 9 8" stroke="#C15F3C" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : (
        <>
          <path d="M32 50V32m0 0l-7 7m7-7l7 7" stroke="#C15F3C" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
    </svg>
  );
}

export function UploadZone({
  onFiles,
  multiple,
  accept = "pdf",
  error,
  busy,
  label,
  compact,
}: {
  onFiles: (files: File[]) => void;
  multiple?: boolean;
  accept?: "pdf" | "image";
  error?: UploadError | null;
  busy?: boolean;
  label?: string;
  compact?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const acceptAttr = accept === "pdf" ? "application/pdf,.pdf" : "image/*";
  const handle = (list: FileList | null) => {
    if (!list || !list.length) return;
    onFiles(multiple ? [...list] : [list[0]]);
    if (inputRef.current) inputRef.current.value = "";
  };
  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          handle(e.dataTransfer.files);
        }}
        className={cn(
          "flex flex-col items-center justify-center rounded-3xl border-2 border-dashed text-center transition-all duration-300",
          compact ? "px-4 py-8" : "px-6 py-14",
          over ? "animate-pulse-ring scale-[1.015] border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40" : "border-slate-300 bg-white/70 hover:border-indigo-300 dark:border-slate-600 dark:bg-slate-900/70"
        )}
      >
        <UploadIcon over={over} image={accept === "image"} />
        <p className="mt-3 text-lg font-semibold">{over ? "Release to open" : (label ?? (accept === "pdf" ? t("upload.title") : "Drop images here"))}</p>
        <p className="mt-1 max-w-sm text-sm text-slate-500 dark:text-slate-400">{t("upload.hint")}</p>
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="mt-5 inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-indigo-600/25 hover:-translate-y-0.5 hover:bg-indigo-500 hover:shadow-lg hover:shadow-indigo-600/35 disabled:opacity-70"
        >
          {busy && <Spinner />}
          {busy ? "Opening…" : accept === "pdf" ? t("upload.cta") : "Choose images"}
        </button>
        <input ref={inputRef} type="file" className="sr-only" accept={acceptAttr} multiple={multiple} onChange={(e) => handle(e.target.files)} aria-label={accept === "pdf" ? "Choose a PDF file" : "Choose image files"} tabIndex={-1} />
      </div>
      {error && (
        <div role="alert" className="animate-pop mt-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          <p className="font-semibold">{(error.code && ERROR_TITLES[error.code]) || "Couldn't open that file"}</p>
          <p className="mt-0.5">{error.message}</p>
        </div>
      )}
    </div>
  );
}
