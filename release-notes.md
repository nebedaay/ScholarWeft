ScholarWeft 0.5.3 clears every error the community directory's own code review reports, and nearly every warning.

### The code review is now clean

The directory runs a linter over the plugin's source (the same rules the review page shows), and 0.5.2 was reported with **1720 issues — including six classes of error**. This release fixes all of them and reduces the total to **18**, none of which are errors:

- **Unsafe HTML** — four `innerHTML` assignments replaced with inert parsing (`DOMParser`, or moving child nodes), which is also what the review asks for.
- **Inline styles** — 88 direct `element.style.x = …` assignments replaced with Obsidian's `setCssStyles`.
- **Regular-expression lookbehind** — rewritten without it, because iOS before 16.4 cannot parse one.
- **Settings headings** — built with Obsidian's heading API instead of raw `<h2>` elements.
- **Directive comments** — every suppression now says why it is there.
- **Node built-ins** — `fs`, `path`, `os`, `child_process` and `util` are now guarded by `Platform.isDesktop` (or reached through one guarded accessor), so the desktop-only paths degrade instead of crashing on mobile.

The remaining 18 are deliberate: seven read settings fields older builds wrote (deprecated, but an upgrade must still find them), two are the plugin's own gated debug loggers, and the rest need either Obsidian 1.13 or a change in behaviour to clear.

### Fixes found along the way

Typing the code to satisfy the review turned up real bugs, not just lint noise:

- **`makeBibliography()` returns `false`**, not only a citation list, when there is nothing to render. The untyped code indexed it anyway — a crash waiting to happen. Now narrowed properly.
- **A tooltip lookup** used `if (!file && !(file instanceof TFile))`, so a *folder* passed the guard and was then treated as a file. Now a correct `instanceof` check.
- **`sourceFile()`** fell back to casting the vault **root folder** to a file. It now returns a real file or `null`.
- **An old template** that still wrote `zotero-key` would have silently stripped a note's identity property. ScholarWeft now writes `sw-zotero-id` from it instead.
- **Two notes can no longer share one `sw-zotero-id`**, which would have split updates and citation links between them.
- A `!` in one note-list lookup was **masking a bitwise-or typo**.

### Also in this release

- The plugin is **smaller still** (3.4 MB) and its release assets carry a build-provenance attestation.
- The **Zotero picker is gone** (see 0.5.2) — removed because Zotero's own picker searches every library, including ones the plugin does not load.
