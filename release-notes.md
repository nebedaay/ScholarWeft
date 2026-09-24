Install/update via BRAT.

### Imported Zotero notes now arrive automatically

When a literature note is created — including an export from the Zotero–ZotLit companion — the item's Zotero child notes are inserted into its **Notes** section automatically, instead of waiting for you to run **Insert Zotero notes into literature notes (vault)**.

This covers notes ScholarWeft creates *and* notes ZotLit creates on its own. Notes that already contain them are left untouched, so it never duplicates or overwrites.

There's a new setting for it on the **Literature note import** page: **"If a Zotero reference contains notes, insert them into all literature notes created."** On by default.

### Annotation callouts are readable again

Imported Zotero annotations (`[!ann-highlight-text-blue]` and friends) lost their background under Obsidian's **default theme** — the colours looked washed out, and highlights were nearly impossible to read. Cause: Obsidian composites callout backgrounds with `mix-blend-mode: darken`, which discards the deliberately light annotation colours. (A theme that overrides the blend, such as AnuPpuccin, hid the problem.) Annotation callouts now opt out of blending, so they look as designed in any theme.

### Template setup is now a checkbox with a real undo

**Settings → ScholarWeft → Literature note import**:

- ScholarWeft's ZotLit import templates
- The Basic note template (Templater)

Both are now checkboxes rather than one-way install buttons:

- **Checked** installs them **and keeps them up to date** with plugin updates.
- **Unchecked** removes them and **restores the companion plugin's own settings** — ZotLit's template folder returns to what it was, and if the Basic note template had replaced your own `/` template rule, yours is restored.
- If you never install them, nothing is created. If you delete them, they stay deleted.

Also on that page: **"Use ZotLit's literature note folder"** now follows **"Create literature notes with ZotLit"** (and comes on with it), since creating notes with ZotLit but storing them elsewhere rarely makes sense.

### Fixes

- A literature note's Zotero notes are also inserted when ZotLit exports a note itself, and on re-exports.
- Reading a note's Zotero item key now accepts `citekey` as well as `zotero-key`, so notes from other import paths are recognised.
