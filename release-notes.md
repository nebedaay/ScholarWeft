Install/update via BRAT.

### LaTeX / PDF endnotes

Endnote exports (`endnotes: native` or `body`) rendered through a `.tex` template now produce a proper endnote apparatus:

- **Per-chapter group headings are correct** — *Notes for Preface*, *Notes for Introduction*, *Notes for Chapter 1*, *Notes for Chapter 2*, *Notes for Conclusion*. Previously an unnumbered chapter (`\chapter*`) shared its counter with the next one, so Preface and Introduction collided and Chapter 2's notes were mislabelled "Notes for Conclusion".
- **Notes now come before the Bibliography** — the usual academic order, and what the DOCX/ODT body-endnote pipeline already did.
- **The *Notes* TOC entry points to the first page of the notes**, not the last, and the per-chapter group headings stay out of the TOC.
- **Notes are set at body size (10pt, was 8pt)** with a small (~6pt) gap between notes instead of a full blank line; **bibliography entries are spaced to match**.

### Notes headings out of the TOC (DOCX/ODT)

The per-chapter group headings in body-endnote exports now use a dedicated **Heading 2 - exclude from TOC** style — they still look like headings but no longer appear in the table of contents. The style ships in the bundled templates and is borrowed automatically for older user templates.

### Templates: consistent fonts and headings

- **One font root per role.** The `book` and `article` templates now declare **Noto Serif** as the heading *and* body font; `document` declares **Noto Sans**; **Scheherazade New** is the complex-script (Arabic) font in every template. Fonts are declared once at the style root and inherited, instead of being repeated (and drifting) across styles.
- **Heading 3–10 styles are aligned** across the book/article templates — black, consistent sizes, and hierarchical indents — with Heading 1/2 left as each format needs them (chapter numbering and page breaks).

### Fixed

- The export dialogue now always offers the **body-Notes** endnote form (it was hidden when continuous numbering was selected).
- Endnote content is no longer misassigned when note names collide.
- `sync-plugin.sh` no longer copies editor lock files into the plugin folder.

### Internal

- LaTeX endnotes use the `enotez` package (`split=chapter` + `reset`); the group-label lookup is keyed on enotez's own per-chapter counter, and `\printendnotes` runs before pandoc's bibliography.
- Template fonts normalised and heading styles synced from `article.odt`; docs updated for the new endnote behaviour.
