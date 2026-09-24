Install/update via BRAT.

### Citations work on a first run, even before Zotero is open

The main fix in this release. Previously, opening Obsidian while Zotero was closed loaded an *empty* library and treated it as finished — so citations stayed unformatted, and the only way out was noticing the problem and clicking **Refresh bibliography** yourself.

- **Your library loads on its own.** ScholarWeft now recognises that it couldn't reach Zotero (rather than mistaking it for an empty library) and retries until it connects. Start Zotero at any point and your citations format within seconds — no manual refresh.
- **You're told what's wrong.** A banner appears when Zotero can't be reached, and the status bar shows progress beside the `@` icon for the whole load, including while waiting for Zotero. (The old notice was easy to miss, and disappeared when clicked.)
- **"Refresh bibliography" is now the same code path as startup**, so the two can't drift apart again.

### One vault at a time

Zotero accepts a **single** local connection, so a second vault can't reach it while another holds the connection. This is now called out explicitly wherever a connection problem is described — the on-screen help, the setup guide, and the Zotero page — because it looked like a broken plugin rather than a limitation.

### Creating literature notes

- **Zotero notes are now inserted automatically** whenever ScholarWeft creates a literature note — from the sidebar/tooltip ✚ button, the "create literature notes" commands, or a ZotLit import. **Insert Zotero notes into literature notes (vault)** remains available to re-run.
- **ZotLit import no longer silently falls back** to ScholarWeft's simpler template. If ZotLit can't create the note, you're asked: wait and try again, or explicitly use ScholarWeft's default template. The previous silent fallback produced notes in a shape you hadn't asked for.
- ZotLit's **JavaScript templates** setting is applied immediately where possible, instead of needing a second restart of Obsidian.

### Setup

- **macOS: your terminal needs Full Disk Access** to see a vault in Documents, Desktop, Downloads, or iCloud Drive. The setup script now says so, names the terminal app, and offers to open the right settings pane — instead of reporting "Obsidian has no vaults yet".
- **Check Obsidian's installer version.** An out-of-date *installer* (not app) stops ZotLit from loading. The setup guide now checks this up front, and the scripts repeat the reminder at the plugin step.
- Windows: the setup script prints its revision (it was showing a stale date).

### Documentation

- The two prerequisites above now appear **before** the setup script, where they can actually prevent a failed run.
- Fixed pipe characters inside code spans in tables, which Obsidian rendered with a stray backslash.
