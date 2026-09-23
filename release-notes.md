Install/update via BRAT.

### Much faster startup on large vaults

ScholarWeft no longer re-reads your whole vault on launch. The citation index — which powers "create literature notes for cited works", vault-wide citekey lookups, and citation warm-up — is now updated **incrementally**: on startup it reads only the notes that changed since it last ran, and trusts the rest from its persisted index. Previously any single note added or removed triggered a full re-scan, which on a vault with 10,000+ notes meant a minute or more of disk work on nearly every launch. (After this update the index migrates once, then ordinary restarts read only what changed.)

Bundled scripts and templates are also extracted only when their contents actually change, instead of being rewritten on every load.

### Document language (hyphenation and DOCX/ODT language)

A new note property and setting control the export's language:

- **`lang`** (or `language`) in a note's frontmatter, e.g. `lang: de-DE`.
- **Default document language** in *Settings → ScholarWeft → Document import/export*, used when a note has no `lang` (initially `en-US`).

The language sets the LaTeX/babel main language — and therefore **hyphenation for justified text** — and the document language for DOCX/ODT. LaTeX now always gets a language, so justified text hyphenates instead of being stretched across the line.

### In-body full references are set apart from the text

`[[@key|reference]]` insertions (a formatted bibliography entry inside the body, for reading lists and syllabi) now render as a distinct reference block rather than plain paragraphs:

- In Obsidian: a hanging indent and slightly smaller type.
- In DOCX/ODT: the **Bibliographic reference - body** paragraph style (1 cm first line, 0.75 cm hanging indent).
- In LaTeX: the equivalent `swrefbody` environment.

### ZotLit: shared literature-note folder and frontmatter mappings

- New setting **Use ZotLit's literature note folder** (*Settings → Literature note import*). When on, ScholarWeft creates its notes in whatever folder ZotLit is configured with — read live, so it follows a change there — and hides its own folder field. No need to set the same folder in both plugins.
- **Install and use ScholarWeft's ZotLit import templates** now also writes ScholarWeft's **frontmatter field mappings** into ZotLit's settings. ZotLit builds each note's frontmatter from its *settings*, not from the templates, so a template folder alone did not reproduce the imported properties — the mappings are what turn Zotero fields into `title`, `authors`, `up`, `related`, and the rest. ZotLit's previous settings are backed up as `data.json.scholarweft.bak` first.

### Obsidian installer warning

A recurring support issue: a plugin (ZotLit especially) won't enable or errors on enable because Obsidian's **installer** is older than the app. The app updates itself, but the installer only updates when you reinstall Obsidian from a fresh download. The setup scripts, the in-app settings, and the [setup guide](https://github.com/nebedaay/ScholarWeft/blob/main/docs/setup.md) now say so — check **Settings → About → Installer version**, then reinstall from <https://obsidian.md/download> (your vault and settings are untouched).

### Fixed

- **Static/PDF bibliography styling.** ODT exports now set the bibliography in the template's own bibliography style, so a PDF export matches the live Zotero path.
- **Spurious `ENOENT` log noise.** The transient citation-conversion file is now written with a leading dot, so Obsidian's file indexer ignores it while it is rewritten and deleted.

### Internal

- `esbuild` embeds a content hash per bundled asset; `src/assetSetup.ts` keeps a `.sw-assets.json` stamp and rewrites an asset only when its hash changed or the file is missing.
- The citation index is now reconciled from a persisted scan watermark (`citedKeysBuiltAt`); the old "rebuild when the file count changed" path is gone.
- Bundled `book`/`article`/`document` templates carry the in-body reference style (see `tools/add-bibref-body-style.py`).
