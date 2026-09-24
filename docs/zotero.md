# Zotero Integration

ScholarWeft can use Zotero as a reference source, resolve and refresh citations, and read citation fields on import. It can also blend Zotero with one or more bibliography files (see [Bibliography](./bibliography.md)).

Zotero is optional if you keep your references in a bibliography file: those citations are rendered statically and need nothing running. Live, refreshable citation fields in exported DOCX/ODT do require Zotero.

## Connection modes

**Native API (Zotero 7/8) — recommended.** Enable **Use native Zotero API** to query Zotero directly through its built-in local API, with no Better BibTeX required.

**Better BibTeX (Zotero 6, or 7/8 with BBT).** With the native API off, the plugin talks to Better BibTeX's JSON-RPC endpoint; BBT must be installed in Zotero.

## Pull from Zotero

**Pull from Zotero** controls whether Zotero entries are loaded at all (leave it on to include them).

## If ScholarWeft can't connect

Three causes, in order of likelihood:

1. **Zotero isn't running.** Start it. ScholarWeft shows a banner and a status-bar message while it's waiting, and loads the library on its own as soon as Zotero appears — no manual refresh needed.
2. **Another vault is connected to Zotero.** Zotero accepts **one local connection at a time**, so a second vault (or a second Obsidian window on a different vault) can't reach it while another holds the connection. **Close the other vault** and click **Retry**. If you work across several vaults, close whichever one is holding the connection; you don't need to give the others up.
3. **Zotero's local connection is switched off.** In Zotero: Settings → **Advanced** → tick **“Allow other applications on this computer to communicate with Zotero”**.

## Port

The default port is **23119**. Change **Zotero port** if you use Juris-M (24119) or a custom port.

## Libraries

When connected, you can choose which Zotero libraries (personal and group) to include. If a citekey appears in several, the most recently modified version wins.

## Merging with bibliography files

Zotero and `.bib` files load together. If a citekey exists in both, **Zotero wins**; entries found in multiple sources show a conflict indicator (⚠) in the sidebar. If Zotero is unavailable, the files cover what they can, so you can keep a `.bib` export as a fallback.

## Mobile

The native API works on mobile when Zotero is running and reachable by IP on the local network. Better BibTeX is not supported on mobile. See [Mobile](./mobile.md).

## Searching

`@` gives citekey autocomplete; `@@` gives full-text title/author search (via ZotLit's database when ZotLit is installed, otherwise the plugin's own index). See [Citations](./citations.md).

## Styles and refreshing

The reference list refreshes when you switch notes; you can also force a refresh from the sidebar menu. The **Zotero data folder** (used to resolve installed citation styles for a note's `csl:` frontmatter and for the export dialogue) defaults to `~/Zotero` when left blank.

See [Dependencies](./dependencies.md).
