ScholarWeft 0.5.5 gives Zotero annotation callouts their own `sw-` namespace, scopes the plugin's stylesheet to its own material, and fixes two long-standing annotation-rendering bugs.

### Annotation callouts

Annotations are now generated as `[!sw-annotation sw-yellow sw-highlight]`, with `[!sw-excerpt sw-highlight-text]` inside and `[!sw-comment]` for comments. The old ids (`[!yellow-highlight-annotation]`, `[!ann-highlight-text-yellow]`) were built by string concatenation, so any other plugin that put “annotation” in the same place could be caught by ScholarWeft's CSS — Midad's `[!mas-annotation-*]` bullet lists, for instance, were being rendered as coloured chips. The new ids are prefixed with `sw-`, which makes that collision impossible, and the inner excerpt no longer repeats the colour because it inherits it from the outer callout.

**If you have existing annotation notes:** they keep the old ids and will show without the annotation styling until they are regenerated. Run **Update all literature notes in the vault** once after updating; Zotero-driven auto-updates also refresh them as items change.

### Stylesheet

- Every annotation variable and CSS function is now `--sw-`-prefixed (`--sw-hue`, `--sw-yellow`…, `--sw-annot-*`, `--sw-light`/`--sw-bright`/`--sw-dark`). The old bare names could collide with a theme or another plugin; Midad had been borrowing `--gold` and `--bright()` without defining them.
- The three global SVG presentation properties are gone from `:root` — they applied to every SVG in the app, not just callouts.
- `.csl-entry` and `.csl-entry-wrapper` are citeproc's classes (ZotLit and other reference plugins emit them), so they keep their names, but every rule is now scoped to ScholarWeft's own containers.
- The obsolete `.hl-*` custom-highlight rules are removed; Obsidian's native highlight colours (`==🟢text==`) do that job now.

### Fixes

- **Text-comment callouts render again.** `[!sw-excerpt sw-text]Text comment…` needed a space after the closing bracket; without it Obsidian treated the block as an ordinary quote rather than a callout.
- **Annotation icons are correct on first load.** Obsidian sets a callout's icon once, when it renders; a note restored at startup could render before the plugin's stylesheet was in effect and keep the default pencil. The plugin now re-applies the computed icon when the layout is ready and when a note is opened.
- **All annotation icons share one colour** — the same blue — while each annotation kind keeps its own glyph. Highlight icons previously inherited the pale highlight accent and looked white.
- Icon values are no longer quoted, so `--callout-icon` resolves exactly as documented.

### Under the hood

Callout selectors now use prefixes and suffixes (`^="sw-annotation-"`, `$="-sw-image"`) instead of substring matches on “annotation” and “ann-”, and the annotation colour variables only apply inside ScholarWeft's own callouts. The stylesheet no longer styles citeproc output outside ScholarWeft's panels.
