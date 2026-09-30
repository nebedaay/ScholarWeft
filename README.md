# ScholarWeft

<img src="./images/scholarweft-illustration.png" width="300" alt="ScholarWeft logo">

**ScholarWeft** weaves your ideas, references, and finished scholarly output into a connected workflow. Its purpose is to allow you to incubate and finish complex academic writing projects — even long books — organically inside manageable, interlinked Obsidian notes. It integrates four processes:

- Creating automatically synced literature notes from your Zotero references, notes, and annotations using a rich import template.
- Finding the most relevant works to cite and import using a ranked search of Zotero items by citekey, title, author, abstract, and publisher
- Connecting your works cited to your universe of thoughts, treating them as Zotero links while also rendering them as formatted citations
- Importing and exporting your scholarly writing while keeping active Zotero citations, producing publication-ready academic articles and books with sophisticated provided and customized templates

ScholarWeft's unique **linked citations** weave every work you cite into your interconnected Obsidian thought universe. The citation `[[@sanchez2009|see @, p. 25]]` is simultaneously a formatted inline citation — "(see Sanchez 2009, 25)" — *and* an Obsidian wikilink to that source’s literature note. Other citation plugins can either link to a literature note (`[[@sanchez2009]]`) or render pandoc-formatted citations (`[see @sanchez2009, p. 25]`) but don’t allow you to integrate publication-ready citations as nodes in Obsidian's note network visualized in backlinks and graphs.

Beyond linking your scholarly notes and references, ScholarWeft links your writing process inside Obsidian to and from the world beyond Obsidian. Move previous writing into Obsidian’s link network by importing DOCX and ODT documents as Obsidian notes with linked citations and literature notes for each cited work. Export an Obsidian note or compile a series of notes as a publication-ready DOCX, ODT, or PDF document with formatted, live Zotero citations.

## Documentation

- [Setup](./docs/setup.md) — install and first steps
- [Dependencies](./docs/dependencies.md) — what each feature needs, and where to get it
- [Zotero](./docs/zotero.md) — connection modes, port, libraries
- [Bibliography files](./docs/bibliography.md) — `.bib`/CSL sources, per-note overrides independent of Zotero
- [Linked Citations](./docs/linked-citations.md) — the citation syntax
- [Citations and References](./docs/citations.md) — formatting, tooltips, the reference sidebar
- [Searching for References](./docs/searching.md) — two search levels, how results are matched and ranked, and search tips
- [Creating Literature Notes from Zotero](./docs/literature-notes.md) — where notes live and how to create them from Zotero items
- [Document Import and Export](./docs/import-export.md) — compile a longer document from a series of notes, export to markdown, DOCX, ODT, PDF
- [Commands](./docs/commands.md) — the full command list
- [ZotLit Import Templates](./docs/zotlit-import-templates.md) — rich annotation templates that replicate ScholarWeft’s internal template
- [Mobile](./docs/mobile.md) — iOS/Android behaviour

## Features

Most features work with **no external tools** (no Pandoc, no Zotero) when you use a bibliography file. The ones that don't note it inline; see [Dependencies](./docs/dependencies.md) for details.

### Citations

- **Linked citations** — `[[@smith1992|see @, p. 6]]` → (see Smith 1992, 6): real Obsidian wikilinks *and* publication-ready formatted citations. Cite several works by placing them together — `[[@a]] [[@b]]` → (Author A Year; Author B Year). See [Linked Citations](./docs/linked-citations.md).

- **Full references in the text** — `[[@key|reference]]` (place several such links together for a list), or a container like `[ [[@a|reference]] [[@b]] [[@c]] ]`, inserts the formatted bibliography entry (or a list of them) — for reading lists and syllabi. They render live in Obsidian and export as plain formatted text. See [Inserting full references](./docs/linked-citations.md#inserting-full-references).

- **Conventional pandoc citations** — `[@key]`, `[see @key, p. 25]` render too, and commands convert between formats losslessly.
- **Live reference sidebar** — a searchable list of every citation in the current note, with copy and jump buttons.
- **Insert bibliography at cursor** and **bibliography snapshot** (save a note's citations as a `.bib`, colour-coded by sync status).
- **Search that finds the work, ranked by meaning** — `@` searches citekey, author and title; `@@` adds abstracts, publisher and containing work. Every word must be present, words may sit in different fields, word *beginnings* count (`soccri` → *soc*ial *cri*tique), and accents are ignored. Results are ordered by how meaningfully they match — an exact citekey, then author-with-title, then an exact title phrase, then title words, then the `@@` fields — so a title match is never buried by an abstract one. The popup shows the result count and, for `@@`, an excerpt of the abstract where your terms were found. See [Searching for References](./docs/searching.md).
- **Quick insertion** — in the search popup, **Enter** inserts a linked citation (`[[@key]]`) and **⌘/Ctrl+Enter** a Pandoc one (`[@key]`); inside an open bracket only the closer you still need is added.
- **Citation decoration and tooltips** — colour-coded status; hover for a formatted preview, literature-note link, and Zotero link.
- **Mobile support** — tap citations in reading mode, long-press in the editor. See [Mobile](./docs/mobile.md).

### References and literature notes

- **Import and update from Zotero** — **Add Literature Notes from Zotero (search and filter)** opens a search-and-filter window over your whole library inside Obsidian (item types, collections, child presence, ordering), or pick items in Zotero's own dialog; then create or refresh their notes. Update the current note, or every note in the vault, in place. Re-imports update only the managed annotations region and metadata, leaving your own writing untouched. See [Literature Notes](./docs/literature-notes.md#importing-and-updating).
- **Literature note creation** — create notes for cited works from the sidebar, tooltip, or command palette. ScholarWeft's default template provides comprehensive bibliographic data in the note’s frontmatter (every item type's own fields, its Zotero collections) and rich annotation callouts. See [Literature Notes](./docs/literature-notes.md).
- **Multiple bibliography sources** — any number of `.bib`/CSL-JSON/CSL-YAML files plus Zotero, merged; Zotero wins on conflicts. See [Bibliography](./docs/bibliography.md).
- **Native Zotero 7/8 API** — no Better BibTeX needed to resolve and format citations (BBT still required for Zotero 6, and still the easiest way to auto-generate citekeys). See [Zotero](./docs/zotero.md).
- **Citekey sync** — update citations and literature notes across the vault if your citekeys change; images attached from annotations are also renamed.

### Document import and export (desktop only)

- **Compile and export** a note or a multi-note outline as markdown, DOCX, ODT, or PDF with one command, with fine-grained options (TOC, footnotes or endnotes, figure captions, custom styles). See [Document Import and Export](./docs/import-export.md).
- **Import DOCX/ODT** documents as markdown notes, converting their Zotero citation fields to linked citations.
- **Standard Obsidian and custom callouts and markdown → DOCX/ODT/PDF styles** — Markdown Attributes / Extended Markdown Syntax styles are converted automatically; styles undefined in the template get a highlighted sentinel style so you can easily locate and define them.

### Requirements at a glance

Basic citation work needs nothing installed. Document import/export and live Zotero fields require installing some combination of Python 3, Pandoc, Zotero/Better BibTeX, LibreOffice, and/or a LaTeX distribution — see **[Dependencies](./docs/dependencies.md)** for the exact mapping and download links. The plugin detects what is installed and greys out options that can't run.

## Install via BRAT

1. Disable Restricted Mode, then install and enable [BRAT](https://github.com/TfTHacker/obsidian42-brat) from the Community Plugins list.
2. In BRAT's settings, add `nebedaay/ScholarWeft` to the **Beta plugin list**.
3. Enable **ScholarWeft** in Community Plugins. BRAT keeps it updated.

**New to all of this?** **[Setup](./docs/setup.md)** is a complete, click-by-click walkthrough, and it opens with a **setup script** that can do the whole thing for you — install/update the Obsidian and Zotero apps, add ScholarWeft to Obsidian and Better BibTeX to Zotero, switch on Zotero's local connection, and install the document tools (Python, Pandoc, LibreOffice, LaTeX, fonts). It is interactive (asks before each step), safe to re-run, and prints a summary of what succeeded/failed/was skipped. Copy the one-line command for your OS from the top of [Setup](./docs/setup.md#the-easy-way-run-the-setup-script).

## Network use and file access

ScholarWeft works offline for its core features (bibliography files you supply, citation rendering, the reference sidebar, and literature notes from `.bib` files). Some features contact services. Each is listed here in full; nothing is sent anywhere else, and the plugin collects **no telemetry** of any kind.

| Feature | Contacts | Why |
| --- | --- | --- |
| Zotero integration | `http://127.0.0.1:<port>` (your own computer) | Reads your local Zotero library, items, annotations and attachments. Nothing leaves your machine. |
| Import literature notes from Zotero | `http://127.0.0.1:<port>/better-bibtex/cayw` | Opens Zotero's own picker dialog (needs Better BibTeX). Local only. |
| Citation style/locale download | `raw.githubusercontent.com` (CSL locales), `www.zotero.org/styles/`, the Citation Style Language repository | Downloads the one CSL style or locale file your note asks for, then caches it in `.scholar-weft/`. Only when the style isn't already installed locally. |
| "Open in Zotero" / DOI links | `doi.org`, your system's default browser | Opens the item's page when you click a link. Nothing is sent automatically. |

**Files outside your vault:** the desktop-only document import/export features run external programs (Python, Pandoc, LibreOffice, LuaLaTeX) and read or write the source and output files you choose, including absolute paths you enter. This is required to compile and export DOCX/ODT/PDF documents. On mobile, these features are unavailable.

## Companion plugins

ScholarWeft creates and refreshes literature notes itself — no companion plugin is required, and **ScholarWeft never downloads or installs another plugin**. If a feature benefits from a companion plugin, the settings page links you to **Settings → Community plugins** so you can install it yourself the normal way. If you already use [ZotLit](https://github.com/PKM-er/obsidian-zotlit), you can switch the import path to ZotLit under **Settings → ScholarWeft → Literature note import**. Autocomplete (`@` for citekey, author and title; `@@` to add abstracts and publication details) uses ScholarWeft's own index either way. Neither plugin requires the other.

**ZotLit import templates (optional):** If you select ZotLit, *Settings → ScholarWeft → "Install and use ScholarWeft's ZotLit import templates"* copies ScholarWeft’s Zotero import templates into `sw-zotlit-templates/` to yield literature notes similar to those generated when using ScholarWeft’s own import path. This leaves your own templates untouched. It also applies ScholarWeft's **frontmatter field mappings** to your ZotLit settings, since ZotLit builds note frontmatter from its settings, not from the templates. See [ZotLit Import Templates](./docs/zotlit-import-templates.md).

## Plugin API

```ts
const plugin = app.plugins.plugins["scholar-weft"] as { api?: ScholarWeftApi } | undefined;
if (plugin?.api?.version === 1) {
  await plugin.api.focusReferenceListView();
  const citekeys = await plugin.api.getCitekeysForFile(app.workspace.getActiveFile() ?? undefined);
}
```

## Credits and lineage

ScholarWeft is a **fork** of **Bripey Citation Suite** by [112345brian](https://github.com/112345brian) (which is itself a fork of [Pandoc Reference List](https://github.com/community-archive/obsidian-pandoc-reference-list) by [mgmeyers](https://github.com/mgmeyers/obsidian-pandoc-reference-list), maintained by [obsidian-community](https://github.com/obsidian-community/obsidian-pandoc-reference-list)). The upstream authors are credited as contributors to this project.

- **Bripey Citation Suite** by [112345brian](https://github.com/112345brian) — the direct upstream fork
- Original [Pandoc Reference List](https://github.com/community-archive/obsidian-pandoc-reference-list) plugin by [mgmeyers](https://github.com/mgmeyers/obsidian-pandoc-reference-list), maintained by [obsidian-community](https://github.com/obsidian-community/obsidian-pandoc-reference-list)

Both are licensed under the GNU GPL; ScholarWeft is distributed under the same license, as required.

This fork incorporates changes from:

- [astroHaoPeng/alp-obsidian-pandoc-reference-list](https://github.com/astroHaoPeng/alp-obsidian-pandoc-reference-list) — file-relative bib paths, multiple bibliography files, auto-update on rename
- [wjvg-gif/obsidian-pandoc-reference-list-zotero8](https://github.com/wjvg-gif/obsidian-pandoc-reference-list-zotero8) — native Zotero 7/8 API mode
- [sjelms/obsidian-pandoc-inline-citations](https://github.com/sjelms/obsidian-pandoc-inline-citations) — DOM fallback fixes, wikilink alias parsing

Diacritic normalization approach credited to [akhmialeuski/obsidian-citation-extended](https://github.com/akhmialeuski/obsidian-citation-extended) (MIT).

See [NOTICE.md](NOTICE.md) for full license attributions.
