Install/update via BRAT.

### Insert full references in the text

For reading lists and syllabi, the linked-citation alias can now insert a formatted bibliography entry instead of an in-text citation.

- `[[@key|reference]]` — or the short form `[[@key|ref]]` — renders the **full reference** for that work in your configured citation style.
- Containers insert a list: `[ [[@a|reference]] [[@b]] [[@c]] ]` or `⟦[[@a|reference]]; [[@b]]⟧`. Mark any one member and the whole container becomes a reference list; the enclosing brackets and anything written between the links is discarded.
- References are still citations — the works appear in the reference sidebar alongside the rest — and they render live in both reading mode and live preview.

Pandoc and Zotero have no equivalent for a full reference in the body of a document, so on export the entries are pre-rendered as plain formatted text. That is exactly what is wanted for a reading list or syllabus: the exported file contains the references themselves, not Zotero fields.

### Callouts render like Obsidian (DOCX, ODT, LaTeX)

Standard Obsidian callouts now come through the export pipeline as they look in Obsidian: a box in the type's colour with a Lucide icon, the callout title (its own text, or the type name), and the content.

- Every standard type and alias (`summary`, `hint`, `check`, `faq`, …) is recognised.
- DOCX/ODT use `Callout <Type>` paragraph styles (children of the base `callout` style); LaTeX uses a `tcolorbox`.
- Poetry callouts are still handled separately, and custom callout types can still be mapped to named paragraph styles in Settings.
- Fixed: a callout written with its title on the marker line and no blank line before the content (`> [!note] Title` followed directly by the body) was dropped from the output entirely.

### Clickable citations in exported documents

- In-text citations now link to their bibliography entry (pandoc's `link-citations`).
- Internal links — citations, note numbers, cross-references and TOC/ToF entries — are set as plain **black** body text, while external web links keep the template's link colour. These are print documents; only real URLs should look like links.
- In DOCX, hovering a citation shows the **full reference** as a tooltip, instead of Word's default "Go to page N".
- Fixed citation links being silently dropped by the **LibreOffice PDF** route — the bibliography bookmarks pandoc emits are now made resolvable for LibreOffice.

### Fixed

- **Phantom bibliography entries.** A citation in YAML navigation metadata (`up: [[@key|Alias]]`, `related:`) was picked up by pandoc's `--citeproc` and added a "cited but never in the text" bibliography entry. Citation syntax is now stripped from the frontmatter block before export; the note body is untouched.
- **Heading-less notes no longer export an empty body.** When a note has no `#` heading the DOCX merge treated the cover and the body as one section and skipped both; it now drops only the leading cover paragraphs and keeps the body.
- **Exported titles no longer inherit working-file suffixes.** An untitled note is titled by the note's own name, not the intermediate "… - export" / "… - compiled" file.
- **Multi-citation and multi-reference containers** with adjacent links or stray text between members now merge correctly. Container parsing for the bracket `[ … ]` and multi-work `⟦…⟧` forms is unified into one parser, so both forms behave identically.

### Internal

- Container parsing is now a single function (`mergeContainerExpression`) shared by the document parser, reading mode, and the export converter.
- Callout icons are bundled by esbuild and referenced by the Lua filters via `SW_ICONS_DIR`.
- `RENDER_CACHE_VERSION` bumped, so notes re-render once after upgrading.
