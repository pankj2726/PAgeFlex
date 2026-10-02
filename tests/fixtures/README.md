# Fixture corpus

Generate the synthetic fixtures (simple, 300-page, rotated 90/180/270, mixed sizes, CropBox, encrypted `user123`/`owner123`,
AcroForm, truncated/corrupt, not-a-PDF) with:

```
node scripts/make-fixtures.mjs
```

Add these **by hand** (license-safe samples only – e.g. self-made or public-domain); they can't be generated with pdf-lib alone:

| Fixture | Why it matters |
| --- | --- |
| scanned image-only | OCR (F34), PDF→text empty-state |
| multi-column | text-run merging (F13) |
| non-Latin text (Devanagari, Arabic, CJK) with embedded fonts | round-trip + missing-glyph path |
| embedded subset fonts | cover-and-replace fidelity |
| large images | compress (F30), memory |
| attachments | GC must not drop `/EmbeddedFiles` |
| linearized | loads/saves cleanly |
