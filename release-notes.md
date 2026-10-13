ScholarWeft 0.5.1 fixes how a literature note is taken over when its identity is missing, and tidies the settings.

### A renamed note is adopted, not duplicated

If you rename one of ScholarWeft's notes — or remove its `sw-zotero-id` — ScholarWeft now recognises it by its own `citekey` and takes it over **in place**, renaming it back to `@citekey.md` and restoring its identity property. It no longer writes a second note beside it.

This was a wiring bug: the note was looked up only by its Zotero item key, which the note no longer carried, so the conventional `@citekey.md` looked free and was created. Notes that another plugin made under its own naming (Zotero Integration writes a `citekey` property) are handled the same way — adopted and renamed rather than duplicated.

### Two notes can never share one identity

A note's `sw-zotero-id` must be unique. If two files claim the same item, later lookups would reach only the first, so updates and citation links would split between them. ScholarWeft now refuses to stamp a second file with an identity an existing note already holds: it reports the collision and leaves both files alone. The background review also skips such duplicates rather than offering to adopt them.

### Unmanaged notes are re-checked during the session

The review that offers to take over notes from other plugins used to run once, just after startup — so a note that lost its identity later in the session sat unnoticed until the next launch. It now re-checks every couple of minutes, acting silently when you have already chosen "Always adopt". A new command, **Review literature notes from other plugins**, runs it on demand and tells you how many notes remain.

### One control shape for on/off settings

The three automatic-update settings — **Update literature notes automatically**, **Update citekeys automatically**, and **Update notes when the template changes** — used Yes/No radio buttons while everything else used a toggle. They are now the same slider toggle as the rest of the settings.

### Notes made from an older template keep their identity

If your literature-note template was copied before the identity property was renamed, it still writes `zotero-key` — the property ZotLit reserves and claims. ScholarWeft rewrites that field to `sw-zotero-id` as it renders, so such a template keeps working instead of silently stripping the note's identity on every update.
