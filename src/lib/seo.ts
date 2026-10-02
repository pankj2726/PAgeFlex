import { useEffect } from "react";

function setMeta(name: string, content: string, attr: "name" | "property" = "name") {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${name}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, name);
    document.head.appendChild(el);
  }
  el.content = content;
}

export interface SeoInput {
  title: string;
  description: string;
  path: string;
  jsonLd?: object[];
  noindex?: boolean;
}

/** Runtime SEO (see KL-SEO: no SSR in the single-file build). */
export function useSeo(s: SeoInput) {
  useEffect(() => {
    document.title = s.title;
    setMeta("description", s.description);
    setMeta("og:title", s.title, "property");
    setMeta("og:description", s.description, "property");
    setMeta("og:type", "website", "property");
    setMeta("robots", s.noindex ? "noindex" : "index,follow");
    let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!link) {
      link = document.createElement("link");
      link.rel = "canonical";
      document.head.appendChild(link);
    }
    link.href = `${window.location.origin}${window.location.pathname}#${s.path}`;
    document.head.querySelectorAll("script[data-seo]").forEach((n) => n.remove());
    for (const ld of s.jsonLd ?? []) {
      const sc = document.createElement("script");
      sc.type = "application/ld+json";
      sc.dataset.seo = "1";
      sc.textContent = JSON.stringify(ld);
      document.head.appendChild(sc);
    }
    return () => document.head.querySelectorAll("script[data-seo]").forEach((n) => n.remove());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.title, s.description, s.path]);
}
