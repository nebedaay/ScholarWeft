ScholarWeft 0.5.4 clears 26 more of the community directory's review findings — and fixes a packaging bug that made a fresh clone impossible to build.

### The review, continued

The directory re-scanned 0.5.3 and moved the plugin from one bar to two ("Caution"), reporting **111 issues, down from 1720**, none of them errors. This release clears 26 of the 31 TypeScript ones. The rest are almost all CSS notices about the plugin's own citation-underline styling, which the scanner marks "only partially supported" even though every property involved works in every Obsidian version the plugin supports.

- **Five unsafe-`any` findings, one root cause.** `@codemirror/language` was listed under `devDependencies` — pinned to a `git+ssh://` fork — while its siblings (`state`, `view`, `lezer/common`) sat under `dependencies`. The scanner installs only `dependencies`, so the module never resolved, and `syntaxTree`, `tree` and the token-class node property all became `any`.
- **That was also a real bug, not just lint noise.** The lockfile resolved that package over `git+ssh`, so anyone without SSH keys to GitHub could not install the dependencies at all. It is now an ordinary registry dependency, with the single Obsidian-only export declared locally.
- **Six redundant type assertions** removed, and two promises fixed: an `async` callback passed where a `void` return was expected, and a rejection carrying a bare value instead of an `Error`.
- **The global `app` object is gone** from the last three places that used it; `app` is now threaded through the docs modal, the citation widget and the dependency notes.
- **Two debug loggers** now use `console.debug` — the review allows `warn`, `error` and `debug`, and objects only to `console.log`.
- **Four deprecated calls** removed: `unescape`, `document.execCommand('copy')` (the async Clipboard API is present in every Obsidian runtime, so the hidden-textarea fallback was dead code), and two legacy settings reads that the upgrade migration still needs but now reaches without touching the deprecated members.

### Still outstanding

Two things are deliberately left alone:

- The settings tab does not yet implement Obsidian 1.13's declarative settings API, so its settings will not appear in Obsidian's settings search on 1.13+. Adopting it needs a real 1.13 app to test against, because getting it wrong risks rendering every control twice.
- The CSS notices describe the plugin's own rendering — the colour-coded citation underlines. Clearing them means changing how citations look, so they wait for a visual pass.
