Install/update via BRAT.

### Citations and search work immediately on a fresh install

The first run no longer makes you wait for your whole Zotero library before anything formats.

- **Citations render in seconds.** While the full library loads in the background, ScholarWeft fetches just the entries the open note cites, so its citations format almost immediately instead of after several minutes on a large library.
- **Citekey search works right away.** Typing `@key` now falls through to a live Zotero search while the local index is still building, instead of showing nothing. Search uses Better BibTeX's field search, so citekeys are found reliably (the previous fallback could miss them). If the index is still warming up and nothing matches, a short "still loading" line explains why.
- **A progress notice** stays up for the duration of the first load, so it's clear why formatting is still in progress.
- **Interrupted loads recover.** If fetching the library is cut short, ScholarWeft now retries the affected pages and re-fetches, instead of silently keeping a partial library until the next restart.

Later starts were already fast; this fixes the first one.

### Housekeeping

- The cache folder was renamed from the inherited `.pandoc` to `.scholar-weft`; existing caches are migrated automatically on first load.
- Internal identifiers left over from the plugin's ancestry (the `lc-` CSS prefix and `pandoc-*` class names) are now consistently `sw-`, and the plugin's settings strings read "ScholarWeft".
