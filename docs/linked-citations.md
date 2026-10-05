# Linked Citations

The heart of this plugin is its linked citation syntax, which allows you to integrate all citations as nodes in your Obsidian thought universe while also formatting them for display and export in publication-ready documents. This syntax simply takes pandoc’s citation syntax (see [the pandoc manual](https://pandoc.org/demo/example33/8.20-citation-syntax.html)), places it in the link’s alias (the displayed text component after |), and shortens the citekey to @ so yo don’t have to write it again. (You can write it again, but the parser only sees the @ and expands it back into `@citekey`, so anything beyond the @ is redundant.)

A special alias, `reference` (or `ref`), inserts the **full formatted reference** for a work instead of an in-text citation — the linked-citation way to build a reading list or syllabus. Putting `reference`/`ref` in the alias of any citation link in a list of links makes all citations in that list into references. See [Inserting full references](#inserting-full-references).

This plugin can parse conventional pandoc `[@citekey]` citations, and it provides commands to convert citations in a note or the whole vault between the two formats: `Convert pandoc citations to linked citations (current note)` / `… (vault)` and `Revert linked citations to pandoc-style citations (current note)` / `… (vault)`. See [Commands](./commands.md).

None of this needs external tools — linked citations work without Pandoc or Zotero. (Zotero or a bibliography file is only needed to *resolve* the references; see [Dependencies](./dependencies.md).)

## Linked citation syntax

```text
Linked citation        Rendered as              Pandoc equivalent
[[@key]]               (Author Year)            [@key]
[[@key|@]]             (Author Year)            [@key]
[[@key|@ -]]           Author (Year)            @key (narrative)
[[@key|-@]]            (Year)                   [-@key] (no author)
[[@key|see @, p. 6]]   (see Author Year, p. 6)  [see @key, p. 6]
[[@key|-@, p. 6]]      (Year, p. 6)             [-@key, p. 6]
[[@a]] [[@b]]          (A Year; B Year)         [@a; @b] (several)
[ [[@a]]; [[@b]] ]     (A Year; B Year)         [@a; @b] (several)
```

Inside an alias, `@` is a proxy for the link’s own citekey. The convert commands translate between linked and pandoc forms losslessly.

See the [pandoc citation syntax](https://pandoc.org/demo/example33/8.20-citation-syntax.html#citation-syntax) for the underlying format.

### Citekeys that need braces

Pandoc reads a citekey as the longest run of key characters after `@` and strips any trailing punctuation, so when it encounters `@smith2005.`, it interprets the key as `smith2005`. In a conventional (non-linked) pandoc citation, to cite a key that really ends in punctuation — or contains a character the bare grammar would split — wrap it in Pandoc’s explicit braces `@{…}`:

```text
Citation                Linked form
@{smith2005.}           [[@smith2005.]]
[@{smith2005.}, p. 6]   [[@smith2005.|@, p. 6]]
```

A **wikilink target is a filename**, so it is taken verbatim and needs no braces: `[[@smith2005.]]` links to the note named `@smith2005.` (i.e. `@smith2005..md`) and cites that exact key. The `@` popup inserts the braced form automatically when a Pandoc citation needs it, and leaves a wikilink target brace-free. On import to a literature note using ScholarWeft, the filename and frontmatter keep the key verbatim; nothing is sanitised.

## Locators

A locator points at the specific place inside a work — a page, a chapter, a volume, a verse, and so on. Write it after `@` (or after the author-suppression marker), exactly as in pandoc:

```markdown
[[@key|@, p. 6]]          →  (Author Year, 6)
[[@key|@, chap. 3]]       →  (Author Year, chap. 3)
[[@key|@, pp. 30–40]]     →  (Author Year, 30–40)
```

The label and the value may be separated by a comma or a space; the comma is the conventional and unambiguous form. The **value** is the number that follows the label. A bare number with no label is treated as a **page**, following pandoc’s default: `[[@key|@, 6]]` is the same as `[[@key|@, p. 6]]`.

Unlike conventional pandoc syntax, which treats anything after a single locator as a literal suffix, ScholarWeft allows 2 locators (such as `vol. 2, p. 27`), which it parses using the active citation style (for example, as page `2:27` if using Chicago style).

### Locator labels and their abbreviations

The table below lists the common CSL locator types with the English forms this plugin recognizes. **Full names and abbreviations are equivalent** — `vol. 2` and `volume 2` (and `vols. 2`) are all parsed and rendered the same. This matters because pandoc’s own documentation groups the abbreviations together and makes some of the distinctions easy to miss, especially `v.` (verse) versus `vol.` (volume).

| Locator type | Full form | Common abbreviations | Example |
| --- | --- | --- | --- |
| page | `page`, `pages` | `p.`, `pp.` | `p. 6`, `pp. 30–40` |
| volume | `volume`, `volumes` | `vol.`, `vols.`, `vo.`, `v.`, `vv.` | `vol. 2`, `v. 2` |
| chapter | `chapter`, `chapters` | `chap.`, `chaps.`, `ch.` | `chap. 3` |
| verse | `verse`, `verses` | `v.`, `vv.` | `v. 1` |
| section | `section`, `sections` | `sec.`, `secs.`, `§`, `§§` | `§ 3` |
| paragraph | `paragraph`, `paragraphs` | `para.`, `paras.`, `¶`, `¶¶` | `¶ 12` |
| part | `part`, `parts` | `pt.`, `pts.` | `pt. 2` |
| line | `line`, `lines` | `l.`, `ll.` | `l. 5` |
| note | `note`, `notes` | `n.`, `nn.` | `n. 4` |
| figure | `figure`, `figures` | `fig.`, `figs.` | `fig. 7` |
| book | `book`, `books` | `bk.`, `bks.` | `bk. 2` |
| column | `column`, `columns` | `col.`, `cols.` | `col. 2` |
| issue | `number`, `numbers` | `no.`, `nos.` | `no. 3` |
| folio | `folio`, `folios` | `fol.`, `fols.` | `fol. 12` |
| appendix | `appendix`, `appendices` | `app.`, `apps.` | `app. A` |
| sub verbo | `sub verbo`, `sub verbis` | `s.v.`, `s.vv.` | `s.v. “majāz”` |
| opus | `opus`, `opera` | `op.`, `opp.` | `op. 9` |

Localized labels are recognized too, so a citation can use the terminology of its own language (for example `m.` or `ج` for volume in Arabic, `جلد` in Persian, `Bd.` for `Band` in German, `t.` for `tomo`/`tome` in Italian/French). The complete mapping lives in the plugin’s `locatorToTerm` table, which covers every CSL locale.

### `v.`: verse or volume?

`v.` is genuinely ambiguous: CSL defines `v.` as **verse**, but it is also a common short form of **volume**. Pandoc and the CSL styles resolve a bare `v.` to verse. This plugin follows CSL for a lone `v.`, **but when `v.` is immediately followed by a page locator it is read as a volume**, because a verse reference is not usually given with a page:

```markdown
[[@key|@, v. 2]]
   →  (Author Year, v. 2)               (verse, per CSL)

[[@key|@, v. 2, p. 200–201]]
   →  (Author Year, 2:200–201)       (volume + page, below)
```

If you want to be unambiguous, write `vol.` for a volume and reserve `v.` for a verse.

### Combined locators

Some locators naturally pair up — a page inside a volume, a verse inside a chapter, a section inside a volume. CSL, Zotero, and pandoc recognize **one** locator per citation item, so the plugin combines such a pair into a single colon-joined locator, using the **smaller** unit’s value and the larger unit’s meaning:

| Written             | Combined locator         | Rendered (Chicago)     |
| ------------------- | ------------------------ | ---------------------- |
| `vol. 2, p. 69`     | `2:69`                   | (Author Year, 2:69)    |
| `vol. 2, pp. 69–70` | `2:69–70`                | (Author Year, 2:69–70) |
| `vol. I, p. 113`    | `1:113` (roman → arabic) | (Author Year, 1:113)   |

The colon form is how Chicago expresses a volume and a page. **Only volume + page is combined** — other chains are written out explicitly, because e.g. `2:4` for volume + chapter would be indistinguishable from volume + page. Every volume spelling listed above combines identically — `volume 2, p. 69`, `vols. 2, p. 69`, and `v. 2, p. 69` all become `2:69`.

Volume and page are combined **only when they sit next to each other**. For **three or more locators**, the adjacent volume+page pair becomes the single locator and every other division is named explicitly in the suffix, in the order written — but if something comes between them, nothing is combined (a volume+chapter shown as `2:4` would look like a volume+page):

```markdown
[[@key|@, vol. 2, p. 69, line 35]]
   →  (Author Year, 2:69, line 35)

[[@key|@, p. 15, line 10]]
   →  (Author Year, 15, line 10)

[[@key|@, vol. 2, chap. 4, p. 69]]
   →  (Author Year, vol. 2, chap. 4, p. 69)   (not combined)
```

CSL and Zotero allow only one locator per citation item, and style guides define no form above two locators, so a third locator is simply written as a literal suffix.

### Forcing a locator or a suffix (curly braces)

Pandoc’s curly-brace overrides work in linked citations too. Placing a locator in {curly braces} right after the key forces its contents to be parsed as a locator even when they do not look like one:

```markdown
[[@key|@ {ii, A, D-Z}, with a suffix]]
   →  (Author Year, ii, A, D–Z, with a suffix)
```

An empty `{}` after the citekey does the opposite — it stops the following text from being read as a locator, so a bare number stays part of the suffix:

```markdown
[[@key|@{}, 99 years later]]
[[@key|@ {}, 99 years later]]
   →  (Author Year, 99 years later)      (not a page locator)
```

`@{}` and `@ {}` are equivalent; use whichever reads better.

A forced block is still parsed as a **chain**, so a volume+page pair inside it combines like anywhere else, and the trailing `-` still makes the citation narrative:

```markdown
[[@key|@{vol. 2, p. 41–43}]]
[[@key|@{, vol. 2, p. 41–43} -]]
   →  Author Year (2010, 2:41–43)
```

In export the braces are kept inside the author-in-text bracket — `@key [{vol. 2, p. 41–43}]` — which pandoc and citeproc parse the same way (what goes in those brackets is exactly what would go after the comma in a normal citation).

### Markdown in prefixes and suffixes

The free text before and after a citation may contain Markdown emphasis and strong, exactly as in pandoc. `*italics*`, `_italics_`, `**bold**` and `__bold__` are rendered:

```markdown
[see *also* @key, p. 30 and *passim*]
   →  (see also Author Year, 30 and passim)     (also and passim in italics)
```

## Several works in one citation

Writing citations next to each other — separated only by spaces or a single line break — renders them as **one** compound citation:

`[[@a]] [[@b]]`        → (Author A Year; Author B Year)

This is the default and simplest way to cite several works at once and is the linked equivalent to pandoc's `[@a; @b]`. A **blank line**, or any text between the citations, keeps them separate. A narrative citation (`[[@key|@ -]]`), when followed by a non-narrative citation, is combined as it is in conventional pandoc, yielding `Author A (year; Author B year)`. But when a narrative-form citation follows a non-narrative citation, the narrative alias is disregarded, and the citations are combined.

The older container form still works:

`[ [[@a]] [[@b]] ]`    → the same compound citation

Usually, the default citation list without the container is simpler. But there is an important difference: inside a multi-citation container, and text outside the wikilink citations is disregarded, so the above example is equivalent to `[ [[@a]]; [[@b]] ]` and `[ [[@a]] and also [[@b]] ]`.

[ [[@nyasKashifAlilbas2001|ref]] and [[@dianteillPierreBourdieu2003]] [[@verterSpiritualCapital2003]] ]

## Inserting full references

For reading lists and syllabi, you can insert one or more formatted bibliography entries, rather than an in-text citation, by using the alias `reference` (or the abbreviation `ref`; both are case-insensitive). Each entry then renders on its own line:

```text
[[@key|reference]]   ->  the full reference for @key
[[@key|ref]]         ->  same
[[@a|reference]] [[@b]] [[@c]]
                     ->  a list of three full references, each on
                         a separate line
[ [[@a|reference]] [[@b]] and [[@c]] ]
                     ->  same
```

Place a `reference`/`ref` alias on any member of the list and the whole list becomes references — a list is either all citations or all references, so only one member needs the marker. This works whether you place the citations next to each other (they sit one below the other) or use the outer-bracket container (`[ … ]`, members separated by whitespace or `;`); with the container, text outside the `[[…]]` links is discarded. Both forms render each entry as its own paragraph (a single `[[@key|reference]]` can also sit inside a paragraph).

References are still citations: the works are collected in the reference sidebar alongside the note’s other citations. In Obsidian the entries are live — they re-render with your bibliography and citation style, and any DOI/URL in an entry stays a link. (Unlike the sidebar, the inline entry omits the literature-note / Zotero / PDF buttons.)

Pandoc and Zotero have no equivalent for a full reference in the body of the text, so on export the plugin pre-renders each entry from its own citation engine and writes it as plain (formatted) text. The exported document therefore contains the reference as ordinary text, not as a Zotero field.

To set the reference apart from the surrounding text, exports use a dedicated reference style: in Obsidian the entry carries a hanging indent and slightly smaller type; in DOCX/ODT it uses the **Bibliographic reference - body** paragraph style (a 1cm first line with a 0.75cm hanging indent); and in LaTeX the same indents come from the `swrefbody` environment.
