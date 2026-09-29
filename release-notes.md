Install/update via BRAT.

### Add Literature Notes from Zotero — a new search-and-filter window

Finding the references to import is now a proper dialogue inside Obsidian, not
just Zotero's own picker. **ScholarWeft: Add Literature Notes from Zotero
(search and filter)** opens a search box over your whole library with the
results rendered as full references — the same formatted entry the sidebar
shows, so book and journal titles are italicised, not asterisked.

**Narrow it down with filters that fit in one column:**

- **Show items with** — *No literature note* (on by default), *Zotero notes*,
  *PDF/snapshot*, *Annotations*. These read a library-wide index, so they are
  accurate for every item, not just the ones you have opened.
- **Show item types** — *All*, or any of *Books*, *Articles*, *Book sections*,
  *Newspaper/magazine articles*, *Web pages*, *Other*.
- **Collections** — a tree of your collections, one heading per library (so a
  shared library's collections are not confused with your own), subcollections
  nested under their parents. Everything is on to begin with; turning a
  collection off turns its whole branch off, and **All / None** plus a clickable
  library heading let you isolate a single collection in one step.

**Order the results** by *Ranked search* (the query's own ranking), *Author,
title, year*, or *Date added*, ascending or descending. The last search and
ordering are remembered, so reopening the dialogue resumes where you left off.

Results are checked off individually or **Select all shown**, then **Add notes**
imports them (non-destructive: re-importing merges into the existing note). When
exactly one note is imported it opens — turn that off with **Open a single
imported note** on the Literature note import page.

### Collection membership on your notes

Literature notes now record the Zotero collections their item belongs to:

```yaml
zotero-collections: ["[[Economics]]", "[[Microeconomics]]"]
```

The template helper is `collection_links()`. Zotero owns this field, so it is
kept in step on every update — moving an item out of a collection removes the
link here.

### Every item type's own fields

Not every Zotero item has a *title*. A legal case has a **case name**, a statute
a **name of act**, an email a **subject** — and before, those arrived untitled,
so they were hidden from search, sorted oddly, and rendered blank. Each type's
name now maps to the reference's title, and the fields that make a reference
readable are imported too: **number** (docket, report, patent, public-law…),
**authority** (court, issuing body), **genre** (thesis, report, manuscript
type…), **jurisdiction**, **medium**, **section**, **event**, and **pages**.
Empty fields are simply left out.

**A one-time rebuild updates the items already in your library.** The library
cache is normally refreshed by delta, which never revisits an item that has not
changed in Zotero — so these fields needed one full pass to appear on existing
items. You will see it once after this update.

### Smaller things

- The **Update all literature notes** pass is much faster now that unchanged
  items are re-rendered from cache instead of re-fetched — its time estimate
  says a minute where it used to say twelve.
- Import summaries name what was imported — *"Imported 3 literature notes:
  @a, @b, @c"* — listing up to twenty and then *"and N other notes"*.
- Modal titles sit in the title bar beside the close button, and the
  search-and-filter window fits the screen without scrolling the main window.

### Everything already in ScholarWeft still works

The reference sidebar, linked citations, `@`/`@@` autocomplete, document import
and export, and the ZotLit import path (when ZotLit is selected) are unchanged.
