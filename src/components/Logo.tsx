import { cn } from "../utils/cn";

/** PageFlex mark: a page with a folded corner and a flexing wave – original artwork, Crail/Ivory/Manilla palette. */
export function LogoMark({ size = 32, className, animated }: { size?: number; className?: string; animated?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={cn(animated && "animate-float", className)} role="img" aria-label="PageFlex logo">
      <rect width="32" height="32" rx="9" fill="#C15F3C" />
      <path d="M9.5 6.5h9L23.5 11.5V25.5h-14z" fill="#FAF9F5" />
      <path d="M18.5 6.5v5h5z" fill="#EBDBBC" />
      <path d="M12 18.4c1.5-2 3-2 4.5 0s3 2 4.5 0" fill="none" stroke="#C15F3C" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M12 21.6c1.5-2 3-2 4.5 0s3 2 4.5 0" fill="none" stroke="#D97757" strokeWidth="1.7" strokeLinecap="round" opacity="0.6" />
    </svg>
  );
}

/** "PageFlex" wordmark – "Flex" in the accent colour. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("font-bold tracking-tight", className)}>
      Page<span className="text-indigo-600 dark:text-indigo-400">Flex</span>
    </span>
  );
}
