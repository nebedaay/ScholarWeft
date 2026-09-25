<%/*
  sw-note.eta.md — OUR single-file literature-note template.

  One copy-pasteable file: it emits BOTH the frontmatter and the body. It follows
  the layout of the user's ZotLit templates (`sw-zotlit-templates/`), NOT the
  older Zotero-Integration shape: there is NO title heading or abstract in the
  body (those live only in the frontmatter), `## Notes` is always present and
  OUTSIDE the managed region, and the managed region holds only `## Annotations`
  — emitted only when there ARE annotations, so an empty region is never left
  behind (it is appended later if annotations appear).

  Everything whitespace-sensitive is in the helpers (`add_property` serialises
  YAML, `annotation_callout` builds the callout, `zotero_notes` the note text) so
  this file states INTENT only.

  Data root: `item` (see src/template/context.ts). Settled helper API is
  documented in src/template/note-helpers.ts.
*/-%>
<% start_YAML(); -%>
<% add_property('document-type', '[[zotero-import]]'); -%>
<% add_property('created', import_date()); -%>
<% add_property('up', ['[[Bibliographic Notes]]']); -%>
<% add_property('related', related_links()); -%>
<% add_property('item-type', item.itemType); -%>
<% add_property('title', item.title); -%>
<% add_property('shorttitle', short_title()); -%>
<% add_property('series', item.series ? wikilink(item.series) : null); -%>
<% add_property('series-number', item.seriesNumber); -%>
<% add_property('edition', item.edition); -%>
<% for (const group of creators_by_type()) { add_property(group.key, group.values); } -%>
<% add_property('year', item.date ? `[[${item.date.year}]]` : null); -%>
<% add_property('issue', item.issue); -%>
<% add_property('volume', item.volume); -%>
<% add_property('publication', item.containerTitle ? wikilink(item.containerTitle) : null); -%>
<% add_property('place', item.place); -%>
<% add_property('publisher', item.publisher ? wikilink(item.publisher) : null); -%>
<% add_property('doi', item.DOI); -%>
<% add_property('citekey', item.citekey); -%>
<% add_property('zotero-link', item.backlink); -%>
<% add_property('attachments', attachment_links()); -%>
<% add_property('aliases', aliases()); -%>
<%~ end_YAML() -%>
## Notes

<% const notes = zotero_notes(); -%>
<% if (notes) { -%>
<%~ notes %>
<% } -%>
<% const annotated = attachments_with_annotations(); -%>
<% if (annotated.length) { %>
%%sw-managed%%
## Annotations

<% for (const attachment of annotated) { -%>
### [<%= attachment.filename ?? attachment.key %>](<%= attachment.backlink %>)

<% for (const annotation of item.annotations.filter((a) => a.parentAttachment?.key === attachment.key)) { -%>
<%~ annotation_callout(annotation) %>

<% } -%>
<% } -%>
%%/sw-managed%%
<% } -%>
