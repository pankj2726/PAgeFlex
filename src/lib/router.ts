import { useEffect, useState } from "react";

export function currentPath(): string {
  const h = window.location.hash.replace(/^#/, "");
  return h === "" ? "/" : h.split("?")[0];
}

export function navigate(path: string) {
  if (currentPath() !== path) window.location.hash = path;
  window.scrollTo?.(0, 0);
}

export function useRoute(): string {
  const [path, setPath] = useState(currentPath());
  useEffect(() => {
    const on = () => setPath(currentPath());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return path;
}
