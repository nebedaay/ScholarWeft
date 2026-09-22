Install/update via BRAT.

### Endnotes

New **Notes** choices in the export dialogue (saved as the note's `endnotes` property):

- **Footnotes (page-bottom)** — the default; unchanged.
- **Endnotes (native word-processor formatting)** — every note becomes a real Word/LibreOffice endnote object, preceded by a level-1 **Notes** heading (it appears in the TOC).
- **Endnotes (as body paragraphs divided by chapter)** — the notes appear as visible paragraphs after the Notes heading, each group under its chapter (`## <chapter>`), with superscript note numbers in the body, per-chapter numbering, and citations rendered inline (no page-bottom footnotes remain).

In every mode the document is compiled exactly as the footnote path — author notes and in-text citations become one stream — and only then are the notes routed, so nothing is dropped and notes stay in order. (ODT/LibreOffice numbers native endnotes continuously; per-chapter restart isn't available there, and the option is greyed out with a note.)

### More export controls

- **Auto-number headings down to level** (`numbering-levels`) — `0` numbers only `@@` headings; `1` chapters; `2` chapters + sections; …
- **TOC depth** (`toc-levels`) — `1` chapters, `2` chapters + sections.
- **Include a bibliography** (`include-bibliography`) — a boolean, distinct from the `bibliography` source-override key.
- **Reset to note properties** — re-read the note's YAML export settings and forget the per-file remembered values.
- **Skip recompilation** — reuse an existing compiled markdown to make several formats from one compile (not remembered between exports).

### Fixed

- Notes are matched to their references **by name** and grouped by the chapter their reference is in, so citation notes land under the right chapter.
- In-text citations are moved into the Notes section on both the live (Zotero field) and static (citeproc) paths — the body keeps its superscript anchors instead of showing full references.
- DOCX/ODT notes read `N.` + tab + text consistently, robust even when the note text contains brackets, with working jump links.
- DOCX: referenced-but-undefined paragraph styles (e.g. `SourceCode`) are now injected, so Word no longer reports "unreadable content".
- ODT: native endnotes no longer render in reverse order.

### Internal

- The Notes-heading move is a single shared helper (`sw_merge_helpers.move_notes_heading_to_end`) used by both the DOCX and ODT merges.
- Release plumbing: `version-bump.mjs`, CI and release GitHub workflows, a `deploy` script, and the `pandoc-default-odt-styles.xml` asset is now tracked.
- Docs updated for the new options and modes.
