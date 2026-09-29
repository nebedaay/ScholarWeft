# Commands

Open the command palette with `Cmd/Ctrl+P` and type "ScholarWeft". The names below are the command names; Obsidian shows them grouped under the plugin name.

## Citations and references

| Command | Scope | Notes |
|---|---|---|
| Show reference list | — | Open the reference sidebar |
| Open Zotero data explorer | — | Open the sidebar that lists your Zotero library and previews an item through the real render pipeline — see [Literature Notes](./literature-notes.md#previewing-your-output-the-zotero-data-explorer) |
| Insert bibliography at cursor | Current note | Insert the formatted reference list |
| Save bibliography snapshot for this note | Current note | Save the note's citations as a `.bib` file |
| Convert pandoc citations to linked citations (current note) | Current note | `[@key]` → `[[@key]]` |
| Convert pandoc citations to linked citations (vault) | Vault | For every note |
| Revert linked citations to pandoc-style citations (current note) | Current note | `[[@key]]` → `[@key]` |
| Revert linked citations to pandoc-style citations (vault) | Vault | For every note |

See [Citations](./citations.md) and [Linked Citations](./linked-citations.md).

> The two **vault-wide** conversion commands skip `docs`, `src` and
> `node_modules`, plus any folders you name under **Settings → Citation and
> reference searching and formatting → Folders excluded from vault-wide
> conversion**, so documentation and archived material are never rewritten.

## Literature notes

| Command | Scope | Notes |
|---|---|---|
| Add Literature Notes from Zotero (search and filter) | — | Search and filter your whole library inside Obsidian, then create or refresh the selected notes — no Zotero window, no Better BibTeX. See [Literature Notes](./literature-notes.md#importing-and-updating) |
| Import literature notes from Zotero… | — | Open Zotero's own item picker and import what you select (needs Better BibTeX). The same import, driven from Zotero's side |
| Create literature notes for citations lacking notes (current note) | Current note | Create a note for every cited work in this note that has none |
| Create literature notes for citations lacking notes (vault) | Vault | The same, for every note in the vault |
| Update this literature note | Current note | Re-render the active note from its Zotero item — only the managed fields and annotations region change (needs a `zotero-key`) |
| Insert Zotero notes into literature notes (vault) | Vault | Copy a source's Zotero child notes into its literature note. ZotLit-only: the command is listed only while ZotLit is the import path — see [Literature Notes](./literature-notes.md#bringing-your-zotero-notes-into-the-literature-note) |
| File literature notes into their library folders | Vault | Put each literature note in the subfolder named after its Zotero library (runs automatically on refresh too) — see [Literature Notes](./literature-notes.md#group-libraries-one-folder-each) |
| Review and update citekeys from Zotero | Vault | Match notes to items by `zotero-key` and rename those whose citekey changed (also offered automatically after a Zotero refresh) |
| List citekey discrepancies | Vault | Report-only: pending renames, notes whose new name is taken, and notes whose `zotero-key` is not in the loaded library (each linked) |

**Update all literature notes** is a button on the **Literature note import** settings page rather than a command. It re-renders every note that has a `zotero-key`.

See [Literature Notes](./literature-notes.md).

## Document import and export (desktop only)

| Command | Notes |
|---|---|
| Import a Word or ODT document with Zotero citations | Opens the import dialogue — see [Document Import and Export](./import-export.md) |
| Compile / Export Document (DOCX, ODT, PDF, LaTeX) | Opens the export dialogue |

These call external tools; see [Dependencies](./dependencies.md) for what each requires.
