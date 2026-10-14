ScholarWeft 0.5.2 is a smaller, tidier build.

### The Zotero picker is gone

The **Import literature notes from Zotero…** command has been removed.

It opened Zotero's own item picker, which searches *every* library in Zotero — including ones you have not enabled in ScholarWeft. Importing from those produced citations nothing could resolve, so the command could quietly create broken references. **Add Literature Notes/Citations** searches and filters the libraries you actually load, inside Obsidian, and does the same job without that trap — and without needing Better BibTeX.

Nothing else changes: the same command still creates or refreshes literature notes, inserts citations, or both.

### A much smaller download

The plugin is now **3.4 MB instead of 10.5 MB**, comfortably under the 5 MB line that matters for syncing. Release builds are minified, and the bundled export templates and documentation screenshots are stored at sensible sizes rather than at full resolution. The export templates keep small placeholder images, so it stays clear how images are handled in a compiled document.

### Tidy-ups

- The **Add Literature Notes/Citations** and **Import a Word/ODT document** dialogs now remember their last search, folder and destination in the plugin's own settings file rather than in browser storage.
- Release assets carry a **build-provenance attestation**, so you can verify cryptographically that they were built from this repository by its release workflow.
- The plugin description no longer names Obsidian (redundant in the plugin directory), and the author link points at the author's profile rather than the plugin's own repository.
- Dead code left behind by earlier changes has been removed, and the codebase now passes the community directory's own linter with no errors.
