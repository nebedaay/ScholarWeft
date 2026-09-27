Install/update via BRAT.

### Write literature notes with your own template

ScholarWeft's Zotero import now renders each note from a template you control,
with helpers that take care of the fiddly parts.

- **Use the default template** (on by default) keeps the bundled template.
- Turn it off to pick a **Template file** anywhere in your vault — with
  type-ahead, or the **Browse…** button.
- **Copy the default template to your vault** writes an editable copy into a
  folder you choose and selects it, so you can start from something that already
  works. Your copy is an ordinary vault file; plugin updates never touch it.

Templates use the Eta language (`.eta.md`), and helper functions handle YAML and
Markdown for you — you write what you want
(`add_property('title', item.title)`) instead of indentation you have to debug.
[Literature Notes](docs/literature-notes.md) documents every helper, the `item`
data behind them, and how a re-import keeps only the managed frontmatter fields
and annotations region up to date.

Want consistent citekeys? The Literature note import page now points to **Better
BibTeX** and the citation-key formula that keeps keys short and free of
punctuation (Zotero → Settings → Better BibTeX).

### Addons for displaying and linking notes

Optional add-ons now have their own settings page — always visible, whether you
import with ScholarWeft or ZotLit:

- **Basic note template** — installs the Basic note template and has Templater
  apply it to new notes. It used to live with the ZotLit settings and vanished
  whenever ScholarWeft's own import (the default) was on; now it is always
  reachable.
- **Format YAML properties** — makes `title`, `short-title`, `up` and `related`
  stand out in the Properties view, with a colour picker for the title
  background and a size slider. It writes and enables the CSS snippet for you.

### Citekey reconciliation

When a Better BibTeX citekey changes, **Review and update citekeys from Zotero**
matches notes to items by the stable `zotero-key`, shows a preview, and renames
only what actually changed — the literature note, its derived transcriptions and
translations, and citations across the vault. **List citekey discrepancies** is a
report-only command for pending renames, names that are already taken, and notes
whose item has left your library.

### Zotero child notes

- When ScholarWeft inserts a source's Zotero child notes, a note's short first
  line now renders as a heading at the configured level, and multiple notes are
  separated by a horizontal rule — the same shape ScholarWeft's own template
  produces.
- Re-importing a literature note refills the generated `## Notes` section **only
  when it is empty**, so notes you cleared come back, but your own writing there
  is never overwritten.

### Everything already in ScholarWeft still works

The reference sidebar, linked citations, search, document import and export, and
ZotLit import templates (when ZotLit is selected) are unchanged.
