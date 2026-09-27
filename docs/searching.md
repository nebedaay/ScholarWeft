# Searching for references

ScholarWeft's autocomplete is how you find a work to cite. There are three
levels, each searching more than the last, and knowing what each one covers is
the quickest way to get good results.

## The three levels

| Type | Searches | Use it for |
|---|---|---|
| `@` | **citekey** | You know the citekey (`@smithTitleYear`) |
| `@@` | **title** and **creators** | You know the title, or part of it, or the author's name |
| `@@@` | the above **plus abstract, journal/book title, series and publisher** | You only remember what it was about, or where it was published |

Type the level, then your words; a **period closes the popup**, so search terms
can include spaces.

- `@smith` — citekeys.
- `@@bauhaus` — titles and authors.
- `@@@maghrebian` — finds a work whose *abstract* mentions it, even when the
  title and author give no clue.

`@@` and `@@@` return the same results when the match is in the title or
creator; `@@@` returns more, because it searches further.

## What counts as a match

**Every word must be present.** `@@bergson memory` finds works containing
*both* words, not everything containing either — so a second word always
*narrows* a search. This is deliberate: it is how you go from a long list to the
work you meant.

**Words may be in different fields.** `@@bourdieu critique` finds a work *by*
Bourdieu whose *title* contains "critique" — the words do not need to sit
together.

**Word beginnings count, endings do not.** `@@soc cri` finds "**Soc**ial
**Cri**tique". A word must start with what you typed; a fragment of the middle
of a word is ignored. You can type as little as three letters per word when you
are abbreviating.

**Accents do not matter.** `cesaire` finds "Césaire" and `Césaire` finds
"cesaire", in titles, names and abstracts alike.

**Creator names are fully searched** — first name, family name, and single-field
names like a corporate author or "Aristotle". It also searches **editors**, so a
work is findable by the person who compiled it.

## Tips

- **Space your words.** `@@bergson memory` and `@@bergsonmemory` give the same
  results; the space just says "these are two words". Use spaces — they make
  your intent clear and are marginally preferred when ranking.
- **Abbreviate by beginnings.** `@@soccri` finds "Social Critique";
  `@@socthe` finds "Social Theory". This works because a person abbreviates
  words by their starts, so `soccri` is understood as *soc*ial *cri*tique.
  Typing the *middle* of words (`oci que`) matches nothing.
- **Add an author to narrow fast.** A surname plus one title word is the most
  precise search there is: `@@bourdieu critique` beats `@@critique` by a wide
  margin.
- **Try `@@@` when `@@` finds nothing.** If you are sure the work should be
  there, the word may be in its abstract, or its journal or publisher.
- **`@@@` results show an excerpt** of the abstract where your terms were found,
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

1. **An author *and* a title word** — the most precise match.
2. **The exact phrase in the title** — searching `social critique` finds
   "A *Social Critique* of …" ahead of a title containing the words apart.
3. **The words in the title**, whole words ahead of abbreviations.
4. **The words in the abstract**, journal, or publisher (the `@@@` extra).

A word appearing earlier in a title ranks above the same word later in it.
**Nothing is ever dropped for appearing late, or for being in a long field** —
ranking only affects the order, never whether a work is found.

## Abbreviations

An abbreviation is understood by its beginnings:

- `soccri` → *soc*ial *cri*tique
- `socthe` → *soc*ial *the*ory

Three letters minimum per part, because two are ambiguous (`socr` is as likely
to be Socrates). An abbreviation is **only** tried when the run as typed does
not already read as whole words: `socialcritique` is understood as "social
critique", never as "**Soc**cer **is** almost **cri**ing…". Coherent words
always win over a fragment reading.

## Relation to ZotLit

None required. Search uses ScholarWeft's own index. If ZotLit is installed and
its own suggester is active, `prioritizeCiteKeyCompletion` decides whether `@`
inside brackets is handled by ScholarWeft or left to ZotLit; `@@` and `@@@` are
always ScholarWeft's.
