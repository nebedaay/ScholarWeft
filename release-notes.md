ScholarWeft 0.5.7 adds author-note pages and optional AI overviews, plus literature-note and reference improvements.

### Author notes

Creator links in literature notes can now become real author pages. Clicking an unresolved `[[Last, First]]` link fills an empty note from the author template; existing notes can be merged into the Authors folder with **Merge existing author notes**. Author pages now use a `title: "First Last"` property instead of an H1 author-name heading, and their managed bibliography section is `# Publications`. Entries in that section link to their literature notes while keeping the note's normal text formatting rather than the theme's link colour and underline.

**Link author name as a variant** connects an alternate creator name to a main author page. It adds the name to the main note's plain-text `variants`, generates convenient aliases, rewrites creator links to `[[Main|Variant]]`, and moves the old author note to the trash. Variants and creator names are matched with punctuation, spacing, case, diacritics and ʿayn/hamza normalization; name order remains significant. New Zotero items update author `related` properties, while imported literature notes update the Publications list, without replacing existing related material. A main author page no longer needs to match a Zotero creator name if its variants do, so existing people notes such as `BN` can be promoted with `up: "[[Authors]]"`.

### AI overviews

A new **AI overviews** settings page holds the shared OpenAI-compatible LLM configuration: base URL, model (default `gemini-3.1-flash-lite`), API key, and independent enable/prompt settings for author and work overviews. The default author prompt asks for an 80-word scholarly blurb plus relevant links; the default work prompt asks for a 50-word overview and builds its reference through ScholarWeft's existing CSL reference renderer. Both commands open a modal containing the entire editable prompt, including the author/works or work reference, and insert an unmanaged `# Overview (AI generated)` section at the top of the note.

### Literature notes and references

Clicking an unresolved `[[@citekey]]` now imports the matching item and replaces the empty link stub, when the citekey exists in the loaded Zotero cache. Literature-note updates can recover when a Zotero item was re-created and its stable item key changed, by falling back to the note's own citekey. Numeric `volumes` values are written as numbers rather than quoted strings, avoiding Obsidian's property warning.

### Settings

The new **AI overviews** page sits alongside **Author notes** and **Literature note import**. Author-note link creation, the author folder, template, merge, and variant controls remain on **Author notes**; literature-note import, the new unresolved-citekey import toggle, and automatic update controls remain on **Literature note import**.

The documentation and release notes have been updated for the new pages, commands, and template output.
