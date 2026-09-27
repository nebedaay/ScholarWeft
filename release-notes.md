Install/update via BRAT.

### Search is rebuilt, and no longer needs ZotLit

Autocomplete now runs entirely on ScholarWeft's own index. ZotLit's search was
only an item lookup — it never searched PDF text — so nothing is lost, and the
ranking is now ours to tune.

**Two levels, and the wider one is the same search with more fields:**

- `@` — **citekey, author and title**. A citekey is no longer the only thing it
  finds: type an author or part of a title and it will find the work.
- `@@` — the above **plus abstract, publisher and the containing work** (journal
  or book title).

Because `@@` only *adds* fields, it never hides a `@` match: results are ranked
by how meaningfully they match, so an exact citekey comes first, then an author
with a title word, then an exact title phrase, then title words, and the added
fields last. (The brief `@@@` level is gone — `@@` covers it.)

**It understands how people actually search:**

- Every word must be present, so a second word always narrows.
- Words may sit in **different fields** — `bourdieu critique` finds a work *by*
  Bourdieu whose *title* contains "critique".
- **Word beginnings count**: `soccri` finds *Soc*ial *Cri*tique. A fragment from
  the middle of a word is ignored.
- **Accents do not matter**, in titles, names and abstracts alike.
- **All creator names are searched** — first name, family name, single-field
  names like a corporate author, and editors.
- **Coherent words win over abbreviations**: `socialcritique` is read as "social
  critique", never as "**Soc**cer **is** almost **cri**ing…".

`@@` results show an **excerpt of the abstract** where your terms were found, so
you can see *why* an item matched when the title gives no clue, and the popup
shows how many results there are ("Showing 20 of 137") so you can tell when to
add another word. Matched terms are bolded in the title, author and excerpt.

### Fresher data from Zotero

- **Tags are read live when a note is imported**, rather than from the cached
  library, so a tag just added in Zotero is there immediately.
- **The library refreshes when Obsidian regains focus** — leave for Zotero, come
  back, and your edits are picked up. Switching panes inside Obsidian does not
  trigger it.

### Fixes

- Accepting a suggestion inside a wikilink now closes it correctly: `[[@key]]`
  rather than the broken `[[@key]`.
- Matched terms are bold only, leaving surrounding formatting — including
  italics in an excerpt — untouched.
- Diacritic matches are highlighted correctly, rather than located and then
  emphasised in the wrong place.

### Everything already in ScholarWeft still works

The reference sidebar, linked citations, literature-note import and update,
ZotLit import templates (when ZotLit is selected), and document import/export
are unchanged. See [Searching for References](docs/searching.md) for the full
rules and tips.
