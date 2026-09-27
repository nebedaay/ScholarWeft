# Searching for references

ScholarWeft's search and autocomplete function is how you find a work to cite. Knowing what the two levels of search cover is the quickest way to get good results.

## The two levels

| Type | Searches | Use it for |
|---|---|---|
| `@` | **citekey, author** (first, last, single name) and **title** | You know the work or who wrote it |
| `@@` | the above **plus abstract, publisher and containing work** (journal or book title) | You only remember what it was about, or where it was published |

**`@@` is the same search as `@` but adds more fields**. The
extra fields rank *below* the `@` fields, so adding them widens the list without
burying a title or author match.

Type the level, then your words; a **period closes the popup**, so search terms
can include spaces.

- `@smith` — works by Smith, plus any citekey beginning `smith`.
- `@social critique` — part of a title.
- `@@maghrebian` — finds a work whose *abstract* mentions it, even when the
  title and author give no clue.

## What counts as a match

**Every word must be present.** `@@bergson memory` finds works containing
*both* words, not everything containing either — so a second word always
*narrows* a search. This is deliberate: it is how you go from a long list to the
work you meant.

**Words may be in different fields.** `@@bourdieu critique` finds a work *by*
Bourdieu whose *title* contains "critique" — the words do not need to sit
together.

**Word beginnings count, endings do not.** `@@soc cri` finds "**Soc**ial
**Cri**tique" and “Society of Crickets”. A word must start with what you typed; a fragment of the middle of a word is ignored. You can type as little as three letters per word when you are abbreviating.

**Accents do not matter.** `cesaire` finds "Césaire" and `Césaire` finds
"cesaire", in titles, names and abstracts alike.

**Creator names are fully searched** — first name, family name, and single-field
names like a corporate author or "Aristotle". It also searches **editors**, so a
work is findable by the person who compiled it.

## Tips

- **Space your words.** `@@bergson memory` is the same search as
  `@@bergsonmemory` when both words are found: the unspaced form additionally
  tries to read the run as abbreviations, so it can match *more*, never a
  different thing. Typing spaces is still better — it says exactly what you
  mean and is marginally preferred when ranking.
- **Abbreviate by beginnings.** `@@soccri` finds "Social Critique";
  `@@socthe` finds "Social Theory". This works because a person abbreviates
  words by their starts, so `soccri` is understood as *soc*ial *cri*tique.
  Typing the *middle* of words (`oci que`) matches nothing.
- **Add an author to narrow fast.** A surname plus one title word is the most
  precise search there is: `@@bourdieu critique` beats `@@critique` by a wide
  margin.
- **Try `@@` when `@` finds nothing.** If you are sure the work should be
  there, the word may be in its abstract, or its journal or publisher.
- **`@@` results show an excerpt** of the abstract where your terms were found,
  so you can see *why* an item matched when the title gives no clue. If your
  terms appear in different parts of the abstract you get a line for each.
- **The number of results is shown at the bottom** of the popup — useful for
  judging whether to add another word.
- **Not finding it?** Check the item's *title* and *authors* are what you
  expect in Zotero. ScholarWeft searches what Zotero holds, and refreshes when
  Obsidian regains focus, so a change made in Zotero should appear shortly after
  you switch back.

## Ranking

Results are ordered by how meaningfully they match, not by a single score:

1. **An exact citekey**, or the query being the beginning of one — typing
   `@smithTitleYear` puts that work first.
2. **An author *and* a title word** — the most precise field match.
3. **The exact phrase in the title** — searching `social critique` finds
   "A *Social Critique* of …" ahead of a title containing the words apart.
4. **The words in the title**, whole words ahead of abbreviations.
5. **The words in the abstract**, journal, or publisher (the `@@` extra).

A word appearing earlier in a title ranks above the same word later in it.
**Nothing is ever dropped for appearing late, or for being in a long field** —
ranking only affects the order, never whether a work is found.

## Abbreviations

An abbreviation is understood by its beginnings:

- `soccri` → *soc*ial *cri*tique
- `socthe` → *soc*ial *the*ory

Three letters minimum per part, because two are ambiguous (`socr` is as likely
to be Socrates).

A coherent reading is tried **first and ranks highest**: `socialcritique` is
understood as "social critique", never as "**Soc**cer **is** almost
**cri**ing…". When no coherent reading exists, word-prefix readings are tried
instead and rank below real words — so an abbreviation adds possibilities
without displacing a genuine whole-word match.

## Relation to ZotLit

None required. Search uses ScholarWeft's own index.

ZotLit matters for one thing only: `@` is a **contested trigger**, because
ZotLit's own suggester also fires on it, and two suggesters cannot both own the
same popup. If ZotLit is installed and its suggester is active, the
**Prioritize citation completion** setting decides: on (the default) ScholarWeft
handles `@`; off, it yields to ZotLit.

`@@` is uncontested — ZotLit does not use it — so it is always ScholarWeft's.
