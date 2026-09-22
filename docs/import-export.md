# Document Import and Export

Two desktop-only commands move documents between the outside world and your vault:

- **Import a Word or ODT document with Zotero citations** — turn a `.docx`/`.odt` into a markdown note.
- **Compile and export the current document (DOCX, ODT, PDF, LaTeX)** — compile a note or a bullet-list outline of notes into markdown, DOCX, ODT, or PDF.

Both call external tools. The plugin probes for them when the dialogue opens and greys out options that can't run, with an explanation and a link to [Dependencies](./dependencies.md). The short version:

| | Python 3 | Pandoc | LibreOffice | LaTeX | Zotero |
|---|---|---|---|---|---|
| Compile to Markdown | ✓ | | | | |
| Export DOCX / ODT | ✓ | ✓ | | | optional |
| PDF via ODT/DOCX template | ✓ | ✓ | ✓ | | optional |
| PDF via `.tex` template | ✓ | ✓ | | ✓ | optional |
| Import DOCX / ODT | ✓ | ✓ | | | ✓ |

“Zotero optional” means static citations can be rendered from a bibliography file; live, refreshable fields still need Zotero. See [Dependencies](./dependencies.md) for download links.

## Document importer

Command: **Import a Word or ODT document with Zotero citations**.

Converts a Word/ODT document — including its Zotero citation fields — into a markdown note, turning the citations into linked (or plain pandoc) citations and optionally creating literature notes for cited works that lack them. Citations inside **footnotes and endnotes** are converted too (Word stores those in separate parts of the file, which ScholarWeft processes alongside the body).

Requires **Python 3, Pandoc, and Zotero** (running).

Every imported note gets frontmatter drawn from the document (mirroring the *Basic note template*), which you can edit afterwards:

| Key | Filled from |
|---|---|
| `created` | the note's creation date and time |
| `up` | `[[sw imports]]` |
| `related` | left empty |
| `aliases` | the document title, plus the short title before its first `:` |
| `title` | the document's Title/Subtitle paragraph(s) — max two, joined with `:`; else the first paragraph |
| `author` | the document's Author-styled paragraph(s), blank-line separated |
| `abstract` | up to three paragraphs after an `Abstract` line, stopping at a heading (omitted when the document has none) |
| `original-created` | the document's own creation date from its metadata (`meta:creation-date`, else the last-modified `dc:date`), omitted when unavailable |
| `original-filename` | the imported file's name |

`title`, `author` and `abstract` are **moved out of the body** into the frontmatter (keeping them in both would duplicate them if the note is exported again); every other paragraph is preserved. Two other generated elements are dropped:

- **Zotero's generated bibliography** (the `CSL_BIBLIOGRAPHY` field/section) and its `Bibliography` heading — the citations are already converted, so the list is regenerated on export. A hand-written bibliography has no such field and is left untouched.
- **Date/time fields** (`DATE`, `CREATEDATE`, `<text:modification-date>`, …) — they render today's date, which `created` already records, and a date is never part of an author's name.

ODT and DOCX share this one flow (a format-specific walker supplies each paragraph's text and style chain; everything else is common), so a Word document and its ODT twin import to the same note.

## Document compiler and exporter

Command: **Compile and export the current document (DOCX, ODT, PDF, LaTeX)**.

Accepts a single markdown note or a bullet-list *outline* of notes, and outputs:

- **Markdown** — the compiled document only (no Pandoc needed).
- **DOCX / ODT** — a document built on a template, with live, refreshable Zotero citation fields.
- **PDF** — via an intermediate ODT/DOCX (LibreOffice) or `.tex` (LuaLaTeX), with citations rendered statically.

### Which input is an outline?

A note is treated as an **outline** (and compiled) only when its body is made up **entirely of list items** — no ordinary prose paragraphs — and it contains **at least one note include**: a bullet that is a single `[[wikilink]]`, possibly nested beneath plain-text heading bullets. A plain topic/task bullet list inside an ordinary note is rendered as-is, not compiled.

Put `compile-` before the template name (`template: compile-book`) to mark an outline explicitly, even when it doesn't match the structural rule.

### Outline grammar

Outline notes contain only frontmatter and bullets; nesting follows bullet depth:

| Bullet form | Output |
|---|---|
| `- Heading text` | Heading at that level |
| `- [[Note]]` | Heading (note title / filename) + note contents |
| `- @@ Heading text` | Numbered heading ("Chapter N: Heading") |
| `- @@[[Note]]` | Numbered heading + note contents |
| `- x [[Note]]` | Note contents only, no heading |
| `- * Heading text` | Unnumbered heading — only when `numbering-levels` is above `0` |

With `numbering-levels: 0` (the default) only `@@` bullets are numbered. Setting it to `1`, `2`, … auto-numbers every heading down to that depth (chapters, then sections, …), ignores `@@`, and treats a `* ` prefix as an unnumbered exception.

The heading text for a linked note comes from the note's `title:` property, else the filename with leading ordering numbers stripped (`1 Introduction` → `Introduction`). A linked note's own headings are demoted so its shallowest heading sits one level below the note's position in the outline.

### Export dialogue

- **Output format** — Markdown, DOCX, ODT, PDF.
- **Template** — auto-selected from the note's `template:` property; changeable per export.
- **Document type** — Book, Article, or Custom; sets the other checkboxes (TOC, per-chapter footnotes, new-page headings, roman frontmatter), which can then be customised.
- **Output filename and folder.**
- **Table of contents / table of figures**, **restart footnote and figure numbering per chapter**, **top-level headings start on a new page**. The per-chapter restart is greyed out for ODT exports with native endnotes, which LibreOffice numbers continuously (the setting is kept, so it still applies to DOCX/LaTeX).
- **Auto-number headings down to level** — `0` (default) numbers only `@@`-marked headings; `1` numbers chapters; `2` chapters and sections; and so on. When set above `0`, `@@` is ignored and a `* ` prefix on a bullet marks an unnumbered exception. Numbering is applied to the **final** document, so a heading is numbered by where it ends up — including headings inside an included note. Set by the note's `numbering-levels` property. (A numbered single note is written to a separate `… - numbered.md` copy; the original is never overwritten.)
- **TOC depth** — `1` lists chapters only, `2` (default) chapters and sections. Set by the note's `toc-levels` property.
- **Notes** — three choices, set by the note's `endnotes` property. Both endnote choices compile the document exactly as the footnote path does — author notes and in-text citations all become real notes — then route them:
  - **Footnotes (page-bottom)** — the default; notes render as native footnotes in every format.
  - **Endnotes (native word-processor formatting)** — **DOCX/ODT only**: every footnote is converted to a real endnote object, preceded by a level-1 **Notes** heading (it appears in the TOC). The word processor owns that stream and it cannot be divided by chapter: in **DOCX** its numbering restarts per chapter (per-chapter section breaks), while **ODT/LibreOffice numbers it continuously** — that format has no per-chapter endnote numbering.
  - **Endnotes (as body paragraphs divided by chapter)** — the notes appear as visible paragraphs after the Notes heading, each group under its chapter (`## <chapter>`), with superscript note numbers in the body, per-chapter numbering, and no native note objects. Each note's citations are rendered inline within it (no page-bottom footnotes remain). **Markdown and LaTeX always use this form** (a `# Notes` section) — they have no native endnote objects. Shown only when per-chapter (discontinuous) numbering is selected; with continuous numbering the option is hidden.
  - In all cases the notes keep their original order, and nothing is left as a page-bottom footnote.

  A PDF follows whatever its intermediate format supports (DOCX/ODT endnote objects, or a `.tex` Notes section).

- **Include a bibliography** — on by default. On, a bibliography is emitted whenever the document has references; off, it is kept only for author-date citation styles (a note/footnote style omits it, since each citation already carries the reference in its note). A document with no references never gets a bibliography. Set by the note's `include-bibliography` property (default `true`).

The settings the note can specify in YAML — `template`, `csl`/`citation-style`, `toc-levels`, `numbering-levels`, `endnotes`, `include-bibliography` — are **remembered per file** between exports; nothing is written back to the note. Each is resolved in this order:

1. The note's YAML property, when it is new or has changed since the last export (so editing the property in the note takes effect).
2. The value last used for this file (stored in the plugin's settings).
3. The built-in default above.

**Reset to note properties** (a button in the dialogue) re-reads the note's YAML for those settings and forgets the value remembered from the last export for each one it finds, leaving any setting with no such property at its current value. Use it to discard a last-used override and go back to what the note's frontmatter says.
- **Apply a citation style, overriding the template's** — pick an installed Zotero style; used for PDF and written into the exported DOCX/ODT's Zotero document preferences so a later "Refresh" in Word/LibreOffice uses it.
- **Keep intermediate files** — the compiled markdown and, for PDF, the intermediate ODT/DOCX/TeX.
- **Skip recompilation and use the already compiled markdown** — shown only when a compiled markdown (`<note> - compiled.md`) already exists in the output folder. When checked, the export runs from that file instead of recompiling the outline, so several formats (e.g. DOCX and ODT) can be produced from one compile. Not remembered between exports.

### Citation style resolution (export)

Highest priority first: the dialogue's style override → the note's `csl:`/`citation-style:` frontmatter → the template's stored Zotero document preferences → the plugin's configured style (see [Citations](./citations.md)) → Chicago author-date.

### Templates

| Template | Description |
|---|---|
| `book` | Book: TOC, chapter headings, per-chapter footnotes |
| `article` | Article: continuous footnotes, no TOC |
| `document` | General-purpose document |

Lookup order: your configured templates directory → `<vault>/Export Templates/` → the templates bundled with the plugin (extracted automatically on load). Bundled templates are a starting point you can override by placing your own copy earlier in that order.

**Running heads** (even/odd pages) are consistent across DOCX, ODT, and LaTeX: `book` shows *Author – Short Title* on the left and the current **chapter title** on the right; `article` and `document` show the **author** on the left and the **short title** on the right. The author shown in a running head is only the first line of a multi-line `author:` property (the title block still prints the whole block).

### YAML frontmatter properties

| Key | Purpose |
|---|---|
| `template` | Template name (`book`, `article`, `document`, or your own); `compile-<name>` marks an outline |
| `title` | Cover title (markdown formatting supported) |
| `subtitle` | Cover subtitle |
| `shorttitle` | Even-page header (falls back to `title` before `:`, then the filename) |
| `abstract` | Cover/near-cover abstract block |
| `note` | Cover/near-cover note block |
| `author` | Author — a string, a `- Name` list (joined with `, `), or a `\|-` block scalar. The title block prints the **whole block** (line breaks preserved: name / affiliation / date); the running header ("Author — Short Title") uses only its **first line** |
| `csl` / `citation-style` | Citation style for this note (a Zotero style name, `.csl` path, or URL) |
| `bibliography` | Override the bibliography source(s) for this note |
| `numbering-levels` | Levels to auto-number: `0` (default) = only `@@` headings; `1` = chapters; `2` = chapters + sections. Above `0`, `@@` is ignored and `* ` marks an unnumbered exception |
| `toc-levels` | TOC depth: `1` = chapters, `2` (default) = chapters + sections |
| `endnotes` | Note rendering: `none` (default, footnotes), `native` (real endnote objects — **DOCX/ODT only**), or `body` (a visible `# Notes` section divided by chapter; DOCX/ODT need per-chapter numbering). Markdown and LaTeX have no native endnote objects, so they always use the `body` form (a `# Notes` section) |
| `include-bibliography` | Include a generated bibliography in exports: `true` (default) or `false` |

All of these accept the usual YAML forms: an inline value, a `- item` list (joined with `, `), or a `|`/`>` **block scalar**. A `title` written over **two lines** is read as `Title: Subtitle` (so it fills both the title and subtitle slots); a `title:` containing a `:` is likewise split into title/subtitle unless you also set `subtitle:` explicitly.

### Images and figures

- Transcluded images (`![[image|400]]`) are inserted, with the alias used as a width. A following `Figure. …` paragraph becomes a numbered caption.
- **Excalidraw** drawings (`![[Drawing.excalidraw]]`) use the drawing's auto-exported sidecar image (enable *Auto-export PNG* in Excalidraw) so they render consistently.

### Automatic style conversion

ScholarWeft converts Obsidian-specific markdown into DOCX/ODT styles rather than dropping it.

**Callouts** (`> [!note]`) can be mapped to named paragraph styles in Settings; poetry callouts (`[!poetry]`, `[!arabic-poetry]`) are handled automatically.

**Markdown Attributes** and **Extended Markdown Syntax** are recognised without configuration:

| Syntax | Plugin | Becomes |
|---|---|---|
| `*text{.cls}*`, `**text{.cls}**`, `***text{.cls}***` | Markdown Attributes | `cls` character style |
| `` `text{.cls}` `` | Markdown Attributes | `cls` character style |
| `==text{.cls}==` | Markdown Attributes | `cls` character style |
| `!!{cls}text!!` | Extended Markdown Syntax | `cls` character style |
| `++text++` | Extended Markdown Syntax | `Inserted` character style |
| `=={color}text==` | Extended Markdown Syntax | `Highlight color` character style |

Style names come from the CSS class or callout type (first letter capitalised, hyphens → spaces, so `.arabic-poetry` → "Arabic poetry"); override with an explicit mapping in Settings.

**Undefined styles:** when the output references a style the template doesn't define, ScholarWeft injects a sentinel copy with a distinctive highlighted background (cycling colours) so you can spot it and define the style in your template; defining it removes the highlight on future exports.

### PDF export

PDF goes through an intermediate chosen by the selected template:

- **ODT/DOCX template → LibreOffice**, which must be installed. ODT usually handles footnote numbering and figure references more reliably than DOCX.
- **`.tex` template → LuaLaTeX**, from a LaTeX distribution.

Because a PDF is final, citations, the bibliography, the TOC/ToF, figure numbers, and captions are all rendered to fixed values at export time — no "update fields" pass is needed. TOC/ToF entries are clickable links.

### Fonts and unusual characters (LaTeX)

LuaLaTeX renders a character only if the current font has a glyph for it, so anything the main font (Noto Serif/Sans) lacks — arrows (`→`), symbols (`⚙ ✓ ∞`), emoji, or non-Latin scripts — would otherwise appear as a tofu box (`□`). The `.tex` templates therefore define a **glyph fallback chain** (`luaotfload.add_fallback`): for any glyph the main font lacks, the first installed font in the chain that has it is used. The chain is ordered serif-first for the serif templates (`article`, `book`) and sans-first for the sans template (`document`), then monochrome emoji, CJK, and broad script catch-alls (Arial Unicode MS, Noto Sans, …). All entries are optional — each is guarded by `\IfFontExistsTF`, so compile is unaffected by what isn't installed.

To add coverage, install fonts and the chain picks them up automatically. In particular:

- **Emoji:** install the **monochrome** *Noto Emoji* (`brew install --cask font-noto-emoji`, or the font from <https://github.com/googlefonts/noto-emoji>). Colour emoji fonts (Apple Color Emoji, Segoe UI Emoji) **cannot** be used — LaTeX has no colour-bitmap support — so raw emoji render only with a monochrome emoji font; for *colour* emoji use the CTAN `twemojis` package (image-based, per-emoji commands).
- **Other scripts** (CJK, Hebrew, Devanagari, …): install the relevant Noto font; already installed scripts (e.g. the macOS CJK and Arial Unicode MS fonts) are covered out of the box.

DOCX/ODT output has no such limitation — Word and LibreOffice do their own font fallback and handle colour emoji.

### How paths and tools are resolved

All scripts and templates are bundled in the plugin and extracted automatically on load — nothing is downloaded from GitHub by hand. The plugin resolves each external tool's path itself and passes it to the script via environment variables, so it works even though Obsidian's Electron process doesn't inherit your shell `PATH`.

See [Dependencies](./dependencies.md) and [Commands](./commands.md).
