<%/*
  ScholarWeft author note template.

  Rendered when a creator link is clicked (with "Create author notes on link
  click" on), by the "Create author note" command, and when existing author
  notes are merged. Copy it into the vault from Settings → ScholarWeft →
  Author notes to customise it.

  Variables: display, alias, roles, related, publications, date
*/-%>
---
up:
  - "[[Authors]]"
title: <%= JSON.stringify(alias || display) %>
<% if (alias) { -%>
aliases:
  - <%= JSON.stringify(alias) %>
<% } -%>
created: <%= date %>
<% if (roles.length) { -%>
creator-roles:
<% for (const role of roles) { -%>
  - <%= role %>
<% } -%>
<% } -%>
<% if (related.length) { -%>
related:
<% for (const link of related) { -%>
  - <%= JSON.stringify(link) %>
<% } -%>
<% } else { -%>
related: []
<% } -%>
variants: []
---
%%sw-author-managed%%
<% if (publications.length) { -%>
# Publications

<%= publications.join(' ') %>
<% } -%>
%%/sw-author-managed%%
