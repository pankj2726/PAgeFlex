# Changelog

## TASKS-02 (unreleased – nothing in this entry has been run in a browser or deployed)

### Fixed
- **Download produced a broken file.** Export removed all pages and re-added them, but the PDF library deletes a page's object when it is removed, so every export wrote dangling page references. Pages are now restored under their original references (root cause identified from the library source; see `docs/DECISIONS.md` D14).
- A failure while verifying the output could stop the download silently. Verification no longer gates the download (except for redactions), and every failure now shows a plain message.

### Changed
- Export keeps going when one object is bad: invalid objects (NaN/negative geometry, unreadable image…) are skipped and listed in the dialog; the PDF is still produced. An invalid **redaction** box aborts instead, so nothing is left unredacted by accident.
- Worker jobs have an idle timeout, handle `onmessageerror` and un-cloneable payloads, and raise a typed `JobError`.
- The download dialog always offers a "Download didn't start? Click here" link, a native "Save as…" where the browser supports it, and a working "Download again".
- **Text editing is now glyph-exact.** Clicking selects one word; double-click the word; triple-click the line (within its column); drag an exact character range; Shift+click extends; Alt+drag selects a rectangle; handles nudge by one character. The captured text and character count are shown before editing, and only those glyphs are covered (tight, clipped away from neighbours). After export the text outside each edit is re-checked and failing edits are rolled back.
- `?debug=text` draws glyph quads, word boxes, line groups, the hit point and the winning glyph.

### Added
- **Find & Replace** (Ctrl/Cmd+F, Ctrl/Cmd+H): match case, whole word (Unicode-aware), exact phrase, regex (validity indicator, 4 s timeout), ignore accents; page / selected / document scope; next/previous with wrap-around; highlight all; match counter; Replace, Skip, Replace All (one undo step, summary with skipped pages), shrink-to-fit / allow overflow / skip, case-aware replace.
- Tests written but **not yet executed**: `export-robustness.test.ts`, `glyphMap.test.ts`, `matcher.test.ts`, `tests/e2e/{download,selection,findreplace}.spec.ts`.

### Known gaps
See `docs/KNOWN_LIMITATIONS.md` → "TASKS-02 additions" (notably KL-T2-GATES: no gate has passed; KL-EDIT-2: replaced text is covered, not removed, and the OCR layer is not updated).
