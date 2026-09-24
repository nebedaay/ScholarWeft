Install/update via BRAT.

### ZotLit templates now render on first install

Installing ScholarWeft's ZotLit import templates now also turns on ZotLit's **JavaScript templates** setting, so the templates — and the JavaScript frontmatter fields — render immediately instead of appearing blank.

That setting is **per-device** (kept in Obsidian's local storage, not in ZotLit's `data.json`) and **off by default**, which is why a fresh install previously needed you to find the toggle in ZotLit's settings yourself. The install now sets it directly and, when ZotLit is running, applies it without a restart; the completion message reports that it was enabled.

> ZotLit normally asks before enabling this because Eta templates can run JavaScript with the same access as ZotLit itself. Installing these templates is that opt-in.

### Setup script: instant vault lookup, per-step Homebrew, first-run pauses

The macOS/Linux/Windows setup scripts were reworked:

- **Vault lookup is instant and never scans your disk.** It reads Obsidian's own vault list — the one its *Open another vault* chooser shows — so it finds your vault wherever it lives, iCloud Drive and other cloud folders included. If Obsidian has no vault yet, it asks whether you have one to point it at, or pauses while you open Obsidian and create one, instead of searching.
- **Homebrew is offered only when a step you chose needs it**, and its `shellenv` line is added to your `~/.zprofile` for you — no up-front prompt when you don't need the document tools.
- **Obsidian or Zotero still running:** the script now reminds you and offers **Retry** instead of failing the step.
- **Freshly installed Obsidian or Zotero:** it pauses for the first launch (Obsidian to create a vault, Zotero to create its profile), then retries — no need to re-run the whole script.
