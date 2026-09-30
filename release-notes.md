Install/update via BRAT.

### Reverting to pandoc citations now matches what you see

Reverting linked citations produced one bracketed citation per link, so a run of contiguous citations exported as `[@a] [@b]` — which pandoc reads as two unrelated citations, not the compound your note displayed. Reverting now forms the same compound export does, so contiguous citations and containers both come out as `[@a; @b]`. Full-reference insertions and code are left untouched, and a test pins the two directions together so they cannot drift again.

### Smaller fixes

- **Vault-wide conversion can skip folders.** The two commands that convert citations across the whole vault used to rewrite *every* markdown file — documentation and archived notes included — and leave a `.bk` backup beside each. They now always skip `docs`, `src` and `node_modules`, and **Settings → Citation and reference searching and formatting → Folders excluded from vault-wide conversion** takes any others you name.
- **Collections refresh.** A collection you renamed or deleted in Zotero stayed in the Add Literature Notes pane for the rest of the session. The collection list is now refreshed on every Zotero refresh.
- **"Select all results"** replaces "Select all shown" in that dialogue — the old label read as "whatever is on screen right now".
- The time estimate for a bulk template update is **learned from your own passes** rather than fixed, so it reflects your library and machine.

### Notes now keep themselves up to date

ScholarWeft can watch Zotero and refresh a literature note whenever its item changes — a corrected title, a new annotation, an added tag, a new child note. Your own writing is never touched: only the managed frontmatter fields and the annotations region are rewritten.

- **Nothing changes until you say so.** The first time a change is detected you are asked, and your answer becomes the setting. There is no after-the-fact notice and nothing is modified before you agree.
- **It also updates when the template changes.** Update the note template and ScholarWeft offers to re-render the notes that were made with the older one. Notes carry an `updated` stamp, so it can tell which are stale, and the affected count is shown before anything runs.
- All of this is **non-destructive** — a re-import reconciles the managed fields and the region between `%%sw-managed%%` and `%%/sw-managed%%`, and leaves everything else exactly as you wrote it.

### Citekey changes update every citation

Rename a citekey in Zotero — change your Better BibTeX formula, or pin a cleaner key — and ScholarWeft now updates **every citation of that work across your vault**, including works you cite but never imported as literature notes.

- **Notes and their citations.** A literature note is matched to its item by its stable `zotero-key`, so it is renamed to the new citekey and re-rendered; Obsidian rewrites its resolved `[[@old]]` links, and ScholarWeft rewrites the rest — plain `[@old]` citations and any link that could not follow the rename.
- **Citations with no literature note.** These have no note to record the old key, so ScholarWeft detects the change by comparing its saved database against a Zotero refresh (matched by the same stable item key) and rewrites those citations too. The change is remembered until it is applied, so deferring, or quitting and reopening Obsidian, does not lose it.
- **Citations are rewritten before any file is renamed**, so Obsidian never briefly sees a citation pointing at a name that no longer exists.
- **Keys are matched whole.** A key with internal punctuation (`smith.2005`, `al-Bakr_2020`) is recognised in full, `@smith2005` never matches inside `@smith2005a`, and an `@` inside an email address is left alone. (The recommended Better BibTeX formula still produces plain alphanumeric keys.)

One caveat: a citekey that changed **before** this update cannot be recovered automatically, because the old key is no longer recorded anywhere — fix those by hand.

Nothing is changed until you confirm: the first time a citekey change is detected ScholarWeft asks, and your answer becomes the **Update citekeys automatically** setting on the Literature note import page. **Review and update citekeys from Zotero** applies it on demand.

### Add Literature Notes from Zotero — a search-and-filter window

Finding the references to import is now a proper dialogue inside Obsidian, not just Zotero's own picker. **ScholarWeft: Add Literature Notes from Zotero (search and filter)** opens a search box over your whole library with the results rendered as full references — the same formatted entry the sidebar shows, so book and journal titles are italicised, not asterisked.

**Narrow it down with filters that fit in one column:**

- **Show items with** — *No literature note* (on by default), *Zotero notes*, *PDF/snapshot*, *Annotations*.
- **Show item types** — *All*, or any of *Books*, *Articles*, *Book sections*, *Newspaper/magazine articles*, *Web pages*, *Other*.
- **Collections** — a tree of your collections, one heading per library (so a shared library's collections are not confused with your own), subcollections nested under their parents. Everything is on to begin with; turning a collection off turns its whole branch off, and **All / None** plus a clickable library heading let you isolate a single collection in one step.

**Order** by *Ranked search*, *Author, title, year*, or *Date added*, ascending or descending. The last search and ordering are remembered, so reopening the dialogue resumes where you left off. Imported notes can be re-imported safely — an existing note is merged into, not duplicated — and a single imported note opens (**Open a single imported note** on the Literature note import page).

### Collection membership on your notes

Literature notes now record the Zotero collections their item belongs to:

```yaml
zotero-collections: ["[[Economics]]", "[[Microeconomics]]"]
```

The template helper is `collection_links()`. Zotero owns this field, so it is kept in step on every update — moving an item out of a collection removes the link here.

### Every item type's own fields

Not every Zotero item has a *title*. A legal case has a **case name**, a statute a **name of act**, an email a **subject** — and before, those arrived untitled, so they were hidden from search, sorted oddly, and rendered blank. Each type's name now maps to the reference's title, and the fields that make a reference readable are imported too: **number** (docket, report, patent, public-law…), **authority** (court, issuing body), **genre** (thesis, report, manuscript type…), **jurisdiction**, **medium**, **section**, **event**, and **pages**. Empty fields are simply left out.

**A one-time rebuild updates the items already in your library.** The library cache is normally refreshed by delta, which never revisits an item that has not changed in Zotero — so these fields needed one full pass to appear on existing items. You will see it once after this update.

### Searching is richer, and the popup behaves

`@` and `@@` were reworked and no longer depend on ZotLit in any way:

- **`@` searches citekeys, authors and titles** (not just citekeys), and `@@` adds abstracts, publishers and containing works on top — the same search with more fields, so widening never buries a title or author match. (The brief `@@@` level is gone; `@@` covers it.)
- **The list is useful before you type.** An empty `@` leads with the search you last ran in this note, then the references you recently cited — here, then anywhere else. **Tab** cycles back through your recent searches.
- **Underscore stands in for a space** in a single word (`@social_theory`).
- Matched terms are **bolded** in every field and in the abstract excerpt, and the popup shows an honest count (*"20 of 137"*).
- Untitled, unattributed junk items are kept out of the list, and trashed items are pruned.

### A home for multi-library vaults

If you use Zotero group libraries, their notes now live in **their own subfolder** named after the library, so two libraries holding the same work (which share a citekey) become two distinct notes instead of colliding. The filing is automatic on refresh and at startup, follows a **rename** of a Zotero library, and is also available as a command.

### Smaller things

- **Updating notes is much faster.** An unchanged item is re-rendered from cache instead of re-fetched, so a template-wide update of a few hundred notes takes about a minute instead of ten. Batch summaries name the notes they updated, and any that were skipped, with the reason.
- **Time estimates are learned, not fixed.** ScholarWeft assumes a fast cached pass to start, then refines the figure the first time it actually runs a batch — so the estimate reflects your library and machine, not a guess.
- Import summaries name what was imported — *"Imported 3 literature notes: @a, @b, @c"* — listing up to twenty and then *"and N other notes"*.
- **Code is not a citation** — a citekey inside an inline code span or a fenced block is ignored.
- Modal titles sit in the title bar beside the close button, and the new search-and-filter window fits the screen without scrolling the main window.

### Everything already in ScholarWeft still works

The reference sidebar, linked citations, document import and export, and the ZotLit import path (when ZotLit is selected) are unchanged.
