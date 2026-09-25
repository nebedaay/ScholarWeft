<%/* zotlit-annotation.eta.md — renders ONE annotation as a callout block.
     Merged annotations arrive pre-combined from zotlit-content.eta.md
     (text / comment / pageLabel / tags already merged, "+" marker
     stripped), so this template needs no merge logic of its own. */-%>
<% const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
const colorRaw = item.colorName ?? "Yellow";
const colorCap = cap(colorRaw);
const typeCap = cap(item.type);
const esc = s => (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const mdComment = s => (s ?? "").replace(/<i>/g, "*").replace(/<\/i>/g, "*").replace(/<b>/g, "**").replace(/<\/b>/g, "**").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escText = s => esc(s).replace(/\[/g, "\\[").replace(/\]/g, "\\]");
// Callout-safe multi-line content: EVERY line (including blank lines) gets a
// "> " prefix so paragraphs stay inside the callout. Obsidian callouts break
// on any line lacking the prefix; comments with several paragraphs or blank
// lines otherwise leak their later lines outside the [!ann-…] block.
const calloutLines = s => (s ?? "").split(/\r?\n/).map(l => l.trim() ? `> ${l}` : ">").join("\n");
-%>
<% bq(() => { -%>
[!<%= colorRaw %>-<%= item.type %>-annotation] <%= colorCap %> <%= typeCap %>
<% if (item.comment || (item.tags && item.tags.length > 0)) { -%>
> [!ann-comment]
<% if (item.comment) { -%>
<%= calloutLines(mdComment(item.comment)) %>
<% } -%>
<% for (const tag of (item.tags ?? [])) { -%>
> - [[<%= tag.name %>]]
<% } -%>
<% } -%>

<% if (item.type === "highlight" && item.text) { -%>
> [!ann-highlight-text-<%= colorRaw %>]
> <%= escText(item.text) %>
<% } else if (item.type === "underline" && item.text) { -%>
> [!ann-underline-text-<%= colorRaw %>]
> <%= escText(item.text) %>
<% } else if (item.type === "image") { -%>
> [!ann-image-<%= colorRaw %>]
> <%= embed(typeof item.imgLink === "function" ? item.imgLink : () => item.imgLink) %>
> - <%= typeof item.imgLink === "function" ? item.imgLink("view image") : item.imgLink %>
> - [[image annotations|images]]
<% } else if (item.type === "text" || item.type === "note") { -%>
> [!ann-text-<%= colorRaw %>]Text comment—click to view in context:
<% if (item.comment) { -%>
<%= calloutLines(mdComment(item.comment)) %>
<% } -%>
<% } else if (item.type === "ink") { -%>
> [!ann-ink-<%= colorRaw %>]
> <%= embed(typeof item.imgLink === "function" ? item.imgLink : () => item.imgLink) %>
> - <%= typeof item.imgLink === "function" ? item.imgLink("view ink image") : item.imgLink %>
<% } -%>
- [[<%= colorCap %> annotations|<%= colorCap %>]]
- (<% if (item.pageLabel) { %>[<%= item.pageLabel.includes("–") ? "pp. " : "p. " %><%= item.pageLabel %>](<%= item.backlink %>)<% } else { %>[View](<%= item.backlink %>)<% } %>, <%= item.dateAdded %>)
<% }) %>
