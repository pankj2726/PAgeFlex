/**
 * Brand + operator settings. Single source of truth: every page title, heading and meta tag reads from here, so the
 * tagline is one string (no JSX line-break can swallow the space in "and adapt PDFs").
 * Replace the placeholder contact/domain before going live (docs/KNOWN_LIMITATIONS.md KL-OPS).
 */
export const SITE = {
  name: "PageFlex",
  tagline: "Edit, merge, and adapt PDFs instantly.",
  description:
    "A modern PDF editor that respects your time and your data. Drop your files into a secure, frictionless environment to split, convert, and format documents exactly the way you need them.",
  domain: "pageflex.example",
  contactEmail: "hello@pageflex.example",
  operator: "the PageFlex maintainers",
  updated: "2026-01-01",
};

/** "Edit, merge, and adapt PDFs instantly." → the highlighted phrase inside the hero heading. */
export const TAGLINE_HIGHLIGHT = "adapt PDFs";
