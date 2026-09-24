# Linked Citations

The heart of this plugin is its linked citation syntax, which allows you to integrate all citations as nodes in your Obsidian thought universe while also formatting them for display and export in publication-ready documents. This syntax simply takes pandoc’s citation syntax, places it in the link’s alias, and optionally allows you to use @ as a proxy for the citation key, since you’ve already mentioned it in the link. Although you can write something after the @, including the citekey itself, the parser only sees the @ and expands it back into `@citekey`, so anything beyond the @ is redundant.

A special alias, `reference` (or `ref`), inserts the **full formatted reference** for a work instead of an in-text citation — the linked-citation way to build a reading list or syllabus. See [Inserting full references](#inserting-full-references).

This plugin can parse conventional pandoc `[@citekey]` citations, and it has commands to convert citations in a note or the whole vault between the two formats: `Convert pandoc citations to linked citations (current note)` / `… (vault)` and `Revert linked citations to pandoc-style citations (current note)` / `… (vault)`. See [Commands](./commands.md).

None of this needs external tools — linked citations work without Pandoc or Zotero. (Zotero or a bibliography file is only needed to *resolve* the references; see [Dependencies](./dependencies.md).)

## Linked citation syntax

| Wikilink form           | Rendered as                    | Pandoc equivalent           |
| ----------------------- | ------------------------------ | --------------------------- |
| `[[@key]]`              | (Author Year)                  | `[@key]`                    |
| <code>[[@key&#124;@]]</code>           | (Author Year)                  | `[@key]`                    |
| <code>[[@key&#124;@ -]]</code>         | Author (Year)                  | `@key` (narrative)          |
| <code>[[@key&#124;-@]]</code>          | (Year)                         | `[-@key]` (suppress author) |
| <code>[[@key&#124;see @, p. 6]]</code> | (see Author Year, p. 6)        | `[see @key, p. 6]`          |
| <code>[[@key&#124;-@, p. 6]]</code>    | (Year, p. 6)                   | `[-@key, p. 6]`             |
| `[ [[@a]]; [[@b]] ]`    | (Author A Year; Author B Year) | `[@a; @b]` (multi-work)     |

Inside an alias, `@` is a proxy for the link’s own citekey. The convert commands translate between linked and pandoc forms losslessly.

See the [pandoc citation syntax](https://pandoc.org/demo/example33/8.20-citation-syntax.html#citation-syntax) for the underlying format.

## Inserting full references

For reading lists and syllabi, you can insert the formatted bibliography entry
itself, rather than an in-text citation, by using the alias `reference` (or the
abbreviation `ref`; both are case-insensitive):

| Wikilink form                          | Rendered as                            |
| -------------------------------------- | -------------------------------------- |
| <code>[[@key&#124;reference]]</code>                  | the full entry for `@key`              |
| <code>[[@key&#124;ref]]</code>                        | same                                   |
| <code>[ [[@a&#124;reference]] [[@b]] [[@c]] ]</code>  | the three entries, one below the other |
| <code>⟦[[@a&#124;reference]]; [[@b]]⟧</code>          | the two entries, one below the other   |

A container is a list of references when **any** member uses the `reference`/`ref`
alias — a list is either all citations or all references, so only one member
needs the marker. Both container forms work exactly as they do for citations: the
outer-bracket form (`[ … ]`, members separated by whitespace or `;`) and the
`⟦…⟧` multi-work container (members separated by `;`). Text outside the `[[…]]`
links inside the container is discarded, and each entry renders as its own
paragraph (a single `[[@key|reference]]` can also sit inside a paragraph).

References are still citations: the works are collected in the reference sidebar
alongside the note’s other citations. In Obsidian the entries are live — they
re-render with your bibliography and citation style, and any DOI/URL in an entry
stays a link. (Unlike the sidebar, the inline entry omits the literature-note /
Zotero / PDF buttons.)

Pandoc and Zotero have no equivalent for a full reference in the body of the
text, so on export the plugin pre-renders each entry from its own citation engine
and writes it as plain (formatted) text. The exported document therefore contains
the reference as ordinary text, not as a Zotero field.

To set the reference apart from the surrounding text, exports use a dedicated
reference style: in Obsidian the entry carries a hanging indent and slightly
smaller type; in DOCX/ODT it uses the **Bibliographic reference - body** paragraph
style (a 1cm first line with a 0.75cm hanging indent); and in LaTeX the same
indents come from the `swrefbody` environment.
