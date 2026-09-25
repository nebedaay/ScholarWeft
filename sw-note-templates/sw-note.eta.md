<%/*
  sw-note.eta.md — OUR single-file literature-note template.

  One copy-pasteable file: it emits BOTH the frontmatter and the body (the
  Zotero-Integration shape), unlike the ZotLit-compatible multi-file set whose
  frontmatter lives in ZotLit's settings. Everything whitespace-sensitive is in
  the helpers (`add_property` serialises YAML, `annotation_callout` builds the
  callout, `zotero_notes` the note text) so this file states INTENT only.

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
<% if (!is_first_import()) { /* a re-import keeps the user's title line */ } -%>
# <%= escape_md(item.title ?? '') %>
<% if (item.abstract) { -%>

<%~ callout({ type: 'ABSTRACT', body: escape_md(item.abstract) }) %>
<% } -%>

## Notes

<% const notes = zotero_notes(); -%>
<% if (notes) { -%>
<%~ notes %>
<% } -%>
<% const annotated = attachments_with_annotations(); -%>
<% if (annotated.length) { -%>

## Annotations

<% for (const attachment of annotated) { -%>
### [<%= attachment.filename ?? attachment.key %>](<%= attachment.backlink %>)

<% for (const annotation of item.annotations.filter((a) => a.parentAttachment?.key === attachment.key)) { -%>
<%~ annotation_callout(annotation) %>

<% } -%>
<% } -%>
<% } -%>
