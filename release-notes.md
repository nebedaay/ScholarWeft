ScholarWeft 0.5.0: literature notes now stand on their own, and the plugin no longer depends on ZotLit in any way.

### ScholarWeft's notes are its own

Literature notes carry a new identity property, **`sw-zotero-id`**, instead of the `zotero-key` that ScholarWeft inherited from ZotLit. This matters because ZotLit treats *any* note carrying `zotero-key` as one of its own and reserves the name — so the two plugins were claiming the same notes. With `sw-zotero-id`, ZotLit no longer sees, adopts, or rewrites ScholarWeft's notes, and the two can coexist without interfering.

**Your existing notes migrate automatically.** On first load, ScholarWeft renames the property on every note it owns — silently, with no prompt, because the test is exact: ZotLit always writes its managed region, while ScholarWeft omits its own when an item has no annotations. A note with `zotero-key` and no ZotLit region is ScholarWeft's. A note never keeps both properties: once ScholarWeft manages a note it writes `sw-zotero-id` and drops `zotero-key`, so the two plugins can never both claim it.

### ZotLit integration removed

ScholarWeft no longer hands note creation to ZotLit, installs ZotLit templates, or reads ZotLit's settings and folder. Everything ScholarWeft needs, it does itself. The ZotLit-only settings and the "Insert Zotero notes" command are gone with it.

**Notes ZotLit created are still handled.** ScholarWeft recognises them and, when you update one, asks whether to **convert** it (ScholarWeft takes over; ZotLit stops managing it) or **leave** it alone (it stays ZotLit's — ScholarWeft still links to it for citations, it just does not update it). If you keep using both plugins, they now stay out of each other's way.

**You are asked once, on first load.** Because the automatic update never opens a dialog mid-batch, it skips notes from another plugin rather than interrupting you. So ScholarWeft finds them on startup and asks once — convert them all, leave them alone, or ask each time — and records your answer. If you later import more, it asks again, since those notes are still unconverted. Change your mind any time under **Settings → ScholarWeft → Literature note import → Literature notes from other plugins**.

### Crossed note names are now fixed

If two notes' names are swapped relative to their items — `@foo1987` holding the item whose citekey is `foo1987a`, and vice versa — ScholarWeft exchanges them through temporary names so each note's name matches its item again. Previously it reported the pair as "name already in use" and left them crossed. A successful exchange is silent, like any other citekey update.

**Two items sharing one citekey are reported, not skipped.** A citekey must be unique; Better BibTeX adds a trailing letter automatically, but a hand-edited citekey can collide. When that happens no rename can fix it, so ScholarWeft says so plainly and points at the notes, instead of failing quietly. That, and notes not found in the loaded library, are the only citekey cases that ask for your attention.

### Notes found under a different name

When a note is found under a name that is not its `@citekey` — another plugin's scheme, or an obsolete citekey — you are asked how to merge it, and that answer can be remembered so it is asked once. A name that is simply the citekey without its `@` is not treated as foreign at all: ScholarWeft just adds the `@`.

Likewise, a file already sitting at `@citekey.md` but carrying no `sw-zotero-id` is no longer silently duplicated beside: ScholarWeft asks whether to adopt it as this reference's note, and can remember that too.

### Smaller things

- Fixed a startup bug where the note migration and the citation-index rebuild ran only when the reference-list sidebar was first created — which meant neither ran on a normal restart, once the sidebar was restored. They now run on every launch.
- Removed two vault-maintenance tools (`tools/add-page-locators.ts`, `tools/convert-citations.ts`) that duplicated functionality the plugin already provides and could not run outside one vault.
- The markdown style checkers are now part of the repo (`tools/md/`), so `npm run check-md` and the pre-commit hook work for anyone who clones it.
