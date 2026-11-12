ScholarWeft 0.5.9 refines linked citations, literature-note updates, and bibliography search.

### Linked citations

The narrative form no longer needs a space before its dash: `[[@key|@-]]` is now the same as `[[@key|@ -]]`, and it works with a locator (`[[@key|@-, p. 6]]`). A lone `-` is now shorthand for the suppress-author form: `[[@key|-]]` is the same as `[[@key|-@]]`; for a suppressed-author citation with a locator, keep using `[[@key|-@, p. 6]]`. Both forms work in live preview, reading mode, and export. The [linked-citation syntax guide](https://github.com/nebedaay/ScholarWeft/blob/main/docs/linked-citations.md) has the updated table.

### Literature notes

Manual “Update this literature note” now fetches the item’s current children instead of trusting a cached snapshot, so annotations removed in Zotero are actually removed from the note. Automatic updates now ignore Zotero’s `lastRead` attachment marker when a PDF is opened, including when the children snapshot is missing or stale, so viewing a PDF does not rewrite the note.

Literature notes now receive one default alias — `Author - year - Short Title` (or the title when there is no creator) — rather than three. Add further aliases by hand if you want them.

When the “Add literature notes/citations” modal is set to **Citations**, it now honours the same **Insert a literature note whenever a linked citation is inserted** preference as the `@` popup. Missing notes are created quietly; existing notes are left alone.

### Bibliography and search

“Refresh bibliography” now merges Zotero’s delta and rebuilds the citation engine without clearing the loaded library, so search remains available while it runs. If the delta finds no changes, it retries with a full fetch but still keeps the existing cache in place until the replacement is ready. Returning to Obsidian from Zotero now also handles a focus event that arrives before the window reports focus, so the incremental refresh is less likely to be skipped.

### Validation

All 1,163 tests pass, the TypeScript check is clean, and lint reports 0 errors.
