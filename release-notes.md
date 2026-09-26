Install/update via BRAT.

### ScholarWeft now imports literature notes itself — ZotLit is optional

Literature notes are created and refreshed from ScholarWeft's own bundled template, and that is now the **default**. Nothing else needs to be installed.

- **Import literature notes from Zotero…** opens Zotero's own item picker, so you can select one or more references and create or refresh their notes in one go. (This one command needs Better BibTeX.)
- **Update this literature note** re-renders the active note from its Zotero item.
- **Update all literature notes in the vault** re-renders every note that carries a `zotero-key` — the middle ground between updating a single note and importing every reference.

Notes are found by their stable Zotero item key, so renaming a note (or changing a citekey) updates that same note instead of creating a duplicate, and a filename already taken by a different note is never overwritten.

ZotLit is no longer installed or required by the setup script. If you prefer it, turn **Import literature notes with ScholarWeft** off under **Settings → ScholarWeft → Literature note import** and choose ZotLit; the ZotLit options (including installing ScholarWeft's ZotLit import templates) appear only then.

### Where notes go now follows the import path

The **Literature notes folder** setting sits directly under **Import literature notes with ScholarWeft** and is shown whenever ScholarWeft is importing (the default). The default folder is now the generic **Literature Notes**, and clearing the field still means the vault root.

Choosing ZotLit instead puts notes in **ZotLit's own folder** (read live, so it follows a change made in ZotLit's settings), keeping all literature notes in one place. The old separate "Use ZotLit's literature note folder" toggle is gone — there is now only one answer to where notes go.

### Annotations, images, and your own writing

- **Annotations** keep Zotero's PDF reading order, and a `+` comment merges into the previous annotation — including rectangular image selections — with the pages shown as a range.
- **Excerpt images** are copied into your vault (folder configurable, default `Attachments`) and embedded so they actually display in Obsidian, with a "view image" link that opens inside Obsidian rather than the system viewer.
- **Re-importing refreshes only the managed region** (between `%%sw-managed%%` markers) and the template's own frontmatter fields. Everything you write, above or below the region, is left alone.
- Frontmatter mirrors the ZotLit field set, with `abstract` and `title` kept as Markdown and `related` always present.

### Two related properties, with clear owners

`related:` is **yours**. ScholarWeft writes `related: []` when it creates a note and never touches it again, so any links you add stay put.

`sw-related:` is **Zotero's**. It holds the item's Zotero tags and Related items as `[[…]]` links, and is rebuilt on every import — so a tag or related link you remove in Zotero disappears from the note on the next update, with no stale entries to prune by hand.

**Upgrading?** Notes created before `sw-related` existed have Zotero's tags and related links sitting in `related:`. Updating such a note tidies that up automatically: entries Zotero still supplies are removed from `related:` (they now live in `sw-related:`), and your own links stay. Entries Zotero no longer has are left alone rather than deleted — they're your only remaining record of them.

### ZotLit notes are handled carefully

If a note was created by ZotLit, ScholarWeft **asks before converting it**: convert it (remembered for the notes you update) or leave ZotLit's area as it is (you will be asked again next time). The preference can also be pinned in the **ZotLit notes** setting. Converting removes an empty ZotLit annotation region; ScholarWeft never writes an empty region of its own.

### ZotLit users: notes are folded in only when you ask

ZotLit imports a reference's Zotero child notes as separate files rather than into the literature note, so the old automatic watcher is gone. When ZotLit is the selected import path, **Settings → Literature note import** shows an **Insert Zotero notes into literature notes** button (and the matching command), which folds each item's Zotero notes into notes whose `## Notes` section is still empty. With ScholarWeft's own template the notes are rendered inline as part of the normal create/update flow, so no separate step is needed.

### Everything already in ScholarWeft still works

The reference sidebar, linked citations, ZotLit import templates (when ZotLit is selected), and document import/export are unchanged.

### Fixes

- Wikilinks (`[[note]]`) and Markdown links (`[text](url)`) written in Zotero notes and annotations are no longer escaped; only a stray `[` is.
- Ink annotations are styled like rectangular image annotations.
