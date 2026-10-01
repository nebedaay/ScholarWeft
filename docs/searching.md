# Searching for references

ScholarWeft's search and autocomplete popup is how you find a work to cite. The **Add Literature Notes from Zotero (search and filter)** uses the same search modes to select Zotero items to import as literature notes. Knowing what the two levels of search cover is the quickest way to get good results.

## The two levels

| Type | Searches | Use it for |
|---|---|---|
| `@` | **citekey, author** (first, last, single name) and **title** | You know the work or who wrote it |
| `@@` | the above **plus abstract, publisher and containing work** (journal or book title) | You only remember what it was about, or where it was published |

**`@@` is the same search as `@` but adds more fields**. The extra fields rank *below* the `@` fields, so adding them widens the list without burying a title or author match.

Type the level. **The popup opens as soon as you type `@`** — leading with the last search you used in this note (within the last five minutes); otherwise the references you recently cited **in this note**, then references you recently cited **anywhere else** (so a fresh note still shows something). So you can pick straight away, and reuse a search to cite several related works without retyping it. One or two characters narrow to citekeys that start with them; three or more runs the full ranked search.

A bare `@` search keeps the popup open **across spaces**, so `@bourdieu dist` searches those words together. A **period, comma, or question mark ends it**, which is how you close the citation and carry on writing — as does pressing **Escape** or moving the cursor off it. Prefer the old behavior, where a space ends the search? Turn off **Allow spaces in @ searches** (Settings → ScholarWeft → Citation and reference searching and formatting). Pushing enter/return or clicking a result inserts the selected reference.

If the popup feels intrusive, raise **Characters after @ before searching** (Settings → ScholarWeft → Citation and reference searching and formatting) to 1 or 2 so it waits for that many characters. At 0 it opens immediately.

Recents and the last search are kept **per note**: notes are about different things, so they never share a history.

**Tab** cycles back through the searches you have run — most recent first, this note's before other notes', wrapping at the end — and fills the search with each one, so a search from a moment ago is one keypress away.

- `@smith` — works by Smith, plus any citekey beginning `smith`.
- `@social critique` — part of a title.
- `@@maghrebian` — finds a work whose *abstract* mentions it, even when the title and author give no clue.

## What counts as a match

**Every word must be present.** `@@bergson memory` finds works containing *both* words, not everything containing either — so a second word always *narrows* a search. This is deliberate: it is how you go from a long list to the work you meant.

**Words may be in different fields.** `@@bourdieu critique` finds a work *by* Bourdieu whose *title* contains "critique" — the words do not need to sit together.

**Word beginnings count, and whole compounds count.** `@@soc cri` finds "**Soc**ial **Cri**tique" and “Society of Crickets”. A word must start with what you typed; a fragment of the middle of a word is ignored. A **hyphenated compound** is one word, matched either way: `@@anti-colonial` finds "anti-colonial" *and* "anticolonial", and `@@anticolonial` finds both too.

**Accents do not matter.** `cesaire` finds "Césaire" and `Césaire` finds "cesaire", in titles, names and abstracts alike.

**Spelling variants are matched.** `color` finds "colour", `colonization` finds "colonisation".

**Creator names are fully searched** — first name, family name, and single-field names like a corporate author or "Aristotle". It also searches **editors**, so a work is findable by the person who compiled it.

## Tips

- **Space your words.** Each term is matched on its own, so `@@bergson memory` finds works with both words. Write abbreviations the same way: `soc crit` for *Soc*ial *Cri*tique.
- **A term matches where a word begins.** `@@soc cri` finds "**Soc**ial **Cri**tique". A fragment from the middle of a word is ignored.
- **A citekey is matched whole, spaces or not.** `@@bourdieudist`, `@@bourdieu dist`, and `@@bourdieu dist 1984` all find `bourdieuDistinctionSocial1984` and put it first.
- **Quote to search a literal string.** `"anti-colonial"` matches that exact string anywhere (case-insensitive), so it will not be split into separate words.
- **Add an author to narrow fast.** A surname plus one title word is the most precise search there is: `@@bourdieu critique` beats `@@critique` by a wide margin.
- **Try `@@` when `@` finds nothing.** If you are sure the work should be there, the word may be in its abstract, or its journal or publisher.
- **`@@` results show an excerpt** of the abstract where your terms were found, so you can see *why* an item matched when the title gives no clue. If your terms appear in different parts of the abstract you get a line for each.
- **The number of results is shown at the bottom** of the popup — useful for judging whether to add another word.
- **Not finding it?** Check the item's *title* and *authors* are what you expect in Zotero. ScholarWeft searches what Zotero holds, and refreshes when Obsidian regains focus, so a change made in Zotero should appear shortly after you switch back.

## Inserting a citation

Type `@` (or `@@`), find the work, then accept it:

- **Enter** inserts a complete citation. From a bare `@` that is a **linked citation** — `[[@citekey]]` — since linked citations are the plugin's default. If you have turned **Process linked citations** off, it inserts a Pandoc citation instead.
- **⌘/Ctrl+Enter** forces the **Pandoc** form — `[@citekey]` — even while linked citations are on.
- If you opened a bracket yourself, the closing mark follows it: `[[@…` completes with `]]`, and `[@…` completes with `]`. When you are adding to a citation that is already open (`[@a; @…`, or a prefixed form like `[see @…`), only the citekey is inserted, so you can keep going.

The footer along the bottom of the popup names exactly what Enter will insert.

## Ranking

Results are ordered by how meaningfully they match, not by a single score:

1. **A citekey** — an exact match, or the query reading onto the key (spaces ignored): `@smithTitleYear`, `@smith title year`, and `@smith title` all put that work first.
2. **An author *and* a title word** — the most precise field match.
3. **The exact phrase in the title** — searching `social critique` finds "A *Social Critique* of …" ahead of a title containing the words apart.
4. **The words in the title**, whole words ahead of partial ones.
5. **The words in the abstract**, journal, or publisher (the `@@` extra).

A word appearing earlier in a title ranks above the same word later in it. **Nothing is ever dropped for appearing late, or for being in a long field** — ranking only affects the order, never whether a work is found.

## Abbreviating

Write each abbreviation as its own word:

- `soc crit` → *soc*ial *cri*tique
- `berg mem` → *Berg*son on *mem*ory

Two letters is usually enough per term; a term matches wherever a word *begins* with it. A hyphenated compound (`anti-colonial`) is matched whole, either spelling.

## If you also use ZotLit

ZotLit is not needed for any of this. The only overlap is `@`: if you have chosen to let ZotLit handle `@` completions, ScholarWeft steps aside for `@`. ScholarWeft's own `@` search covers more, so if you would rather use it, turn on **Settings → ScholarWeft → Prioritize citation completion**.
