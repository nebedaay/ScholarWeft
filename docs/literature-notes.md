# Literature Notes

ScholarWeft treats each source's literature note (normally `@citekey.md`) as the graph node its citations link to. This page covers where those notes live, how they are created and formatted, and how ScholarWeft refreshes them.

## Folder

**Settings → Literature note import → Literature notes folder** sits directly under the **Import literature notes with ScholarWeft** toggle and sets where ScholarWeft creates and finds its literature notes (default `Literature Notes`; leave it blank for the vault root).

The field follows the import path, so there is only ever one answer to "where do my notes go":

- **Import literature notes with ScholarWeft** (the default) — this field decides.
- **ZotLit** — notes go to the folder configured in ZotLit's own settings (read live), so ZotLit's notes and ScholarWeft's stay in one place. To change it, use ZotLit's settings.

Using a dedicated folder keeps citations resolvable and tidy, but any folder works as long as the filename is `@citekey`.

## Finding a note

ScholarWeft identifies a literature note by its stable **`zotero-key`** first — the Zotero item key (`KEY`, or `KEYgGROUPID` for a group library) — and only if that’s missing by the `@citekey` filename. Even if you rename a note or change its citekey in Zotero, ScholarWeft can still find it and update it by its item key rather than creating a duplicate.

If a file already sits at the expected `@citekey.md` name but is *not* that item's note (a different library's copy, another work with a similar title, or one of your own notes), ScholarWeft never overwrites it: it creates a suffixed sibling (`@citekeya.md`, `@citekeyb.md`, …) and tells you. If that happens, you should give that other note a different name and rename the literature note as `@citekey.md` if you want to cite it.

## Creating notes

- **Create literature notes for citations lacking notes (current note)** and **…(vault)** create a note for every cited work that doesn't already have one.
- Individual notes can also be created from the reference sidebar, a citation tooltip, or an entry's "Create literature note" button.

Creating notes needs **Zotero** for citekey and metadata lookup. ZotLit is not required.

## Note template

**Settings → Literature note import → Import literature notes with ScholarWeft** is on by default: notes are rendered with ScholarWeft's bundled template, and no other plugin or template is needed. (Turn it off only if you would rather let ZotLit create your notes, and install ScholarWeft’s ZotLit templates for notes that look similar to what you get with ScholarWeft’s import.)

ScholarWeft’s literature import process uses the Eta Javascript templating language. Although you can still control the intricate details of your literature note output as you can with other Zotero import plugins, ScholarWeft provides some helper functions that handle the details of YAML and markdown syntax so you can set the layout and look of your notes without worrying about syntax errors glitches.

Here’s an example of output using the default template:

<img src="../images/scholarweft-zotero-annotation-example.png" width="100%" alt="Zotero PDF annotation example">

<img src="../images/scholarweft-annotation-example.png" width="80%" alt="ScholarWeft annotation example">

A few things to note in this example:

- The highlighted quote spans two pages, and the second comment (not visible here because it's in a different column) starts with `+`, so it’s appended to the previous quote, and the location information below is a page range including both pages.
- Wikilinks in the Zotero annotation comment — `[[Saussure, Ferdinand de|Saussure]]` — are rendered as links in Obsidian.
- “Tags” added to the Zotero comment are also rendered as `[[wikilinks]]`, including a `@citekey` reference. (Obsidian doesn’t allow rendering citations inside callouts, so it’s presented as a literal citekey.)

The template structures each literature note as follows:

- **Frontmatter** includes metadata provided by Zotero such as document-type, created, added, up, item-type, title, shorttitle, authors, editors, abstract, …), converting any HTML formatting in `abstract` and `title` to Markdown.
- **Two related properties, with clear owners.** `related:` is **yours** — ScholarWeft writes `related: []` when creating a note and never touches it again, so links you add stay. `sw-related:` holds what **Zotero** supplies: the item's Zotero tags and its Related items, as `[[…]]` links. Zotero's list is rebuilt on every import, so a tag or related link you remove in Zotero disappears from the note — no stale entries to prune.
- **Body**: a `## Notes` section (yours) and, when the item has annotations, a managed `## Annotations` region between `%%sw-managed%%` and `%%/sw-managed%%` markers. The region is omitted entirely when the item has no annotations.
- **Annotations** keep Zotero's PDF reading order. A comment that starts with `+` in the annotated PDF merges that annotation into the previous one of the same type on the same attachment — text or images are joined and the page label becomes a range — so a rectangular selection spanning two pages reads as one quote.
- **Excerpt images** are copied into your vault and embedded as `![[…]]`, because Obsidian cannot display Zotero's `file://` cache paths. **Excerpt-image folder** sets where they go (default `Attachments`, relative to the vault root); names are `@<citekey>_p<page>_<annotationKey>.png`.
- **Re-importing** refreshes only the managed frontmatter fields and that region. Your other properties, and any writing above or below the region, are left alone.

If a note was created by ZotLit, ScholarWeft **asks before converting it**, so trying the plugin never silently reworks your existing notes. **Convert** is remembered for the notes you update; **Leave** applies to that note only, and the next ZotLit note asks again. The **ZotLit notes** setting can also be set to *Ask each time* (default), *Always convert*, or *Never touch ZotLit notes*.

## Importing and updating

- **Import literature notes from Zotero…** opens Zotero's own item picker so you can select one or more references and create or refresh their notes. It needs **Better BibTeX**, and Zotero shows one picker at a time.
- **Update this literature note** re-renders the active note from its item (the note must carry a `zotero-key`).
- **Update all literature notes in the vault** re-renders every note that has a `zotero-key` — the middle ground between updating a single note and importing every Zotero item.

All three honour the own-template setting and are non-destructive: only the managed fields and region change. Updating a ZotLit note is subject to the conversion prompt above.

## Bringing your Zotero notes into the literature note

Zotero **child notes** can be brought into a literature note under `## Notes`:

- With ScholarWeft's own template (the default), the item's child notes are rendered inline under `## Notes` when the note is created or updated.
- The ZotLit path needs a separate step, because ZotLit imports a note's child notes as separate files rather than into the literature note. When **Create literature notes with ZotLit** is on, **Settings → Literature note import** shows an **Insert Zotero notes into literature notes** button (the same action is available as a command, but only while ZotLit is the import path). It goes through every literature note, fetches the matching item's child notes from Zotero, and inserts their text as Markdown directly under `## Notes`, above ZotLit's `%%zt-managed%%` region. Nothing inside the managed region is touched, so later updates don't overwrite it.
  - **Only notes with an empty `## Notes` section are filled.** If a section already has content, it is left alone — ScholarWeft never overwrites or appends over what's there. The summary tells you how many were skipped and how many had no Zotero notes; skipped paths are also printed to the developer console (Ctrl/Cmd+Shift+I).
  - After a run, a marker comment (`<!-- sw-zn: KEY … -->`) at the end of the file records which Zotero notes were inserted, so re-running is a no-op.
  - On both paths this also runs automatically while a note is being created, as part of that flow.

## ZotLit (optional)

ScholarWeft does not require [ZotLit](https://github.com/PKM-er/obsidian-zotlit). If you already use it, or prefer its templates, you can opt in: **Settings → Literature note import → Import literature notes with ScholarWeft** off, then **Create literature notes with ZotLit** on. Only then does ScholarWeft hand note creation and annotation formatting to ZotLit. You can also install a curated set of ZotLit templates: **Install and use ScholarWeft's ZotLit import templates** writes them to `sw-zotlit-templates/` and points ZotLit's template folder there, leaving your own templates untouched. See [ZotLit Import Templates](./zotlit-import-templates.md).

With the default own-template path, ZotLit is not needed to render notes at all — and ZotLit-only settings stay hidden.

## Updating citekeys

When a Zotero citekey changes, **Update stale citekeys and literature note filenames (vault)** updates citations across the vault and renames the matching literature notes to the new citekey (after showing a preview of what will change). When the own template is enabled, the renamed notes are also re-rendered, so their excerpt images follow the new citekey. **Purge citekey rename history** clears the stored rename records once you no longer need them.

See [Commands](./commands.md) and [Dependencies](./dependencies.md).
