Install/update via BRAT.

### Reading mode and live preview now format citations the same way

Reading mode and live preview used to be two separate implementations, and they drifted: a citation could render correctly in one and not the other. They now share **one** pipeline — the same parser, the same matching, and the same rendering — so a citation looks the same in both.

This fixes a cluster of reading-mode problems:

- **Citations that silently did not render.** Some notes showed raw `[[@key|alias]]` text or literal `[@key, …]` while their neighbours formatted, apparently at random. The DOM is now turned back into source and parsed exactly as live preview parses it, so every citation is found.
- **Reversed text around emphasis.** A citation containing emphasis rendered its parts backwards — `and *passim*` came out as `)passim(…and`. This was our own bug (the children were moved into the link in reverse order) and is fixed.
- **Adjacent linked citations and reference lists.** `[[@a]] [[@b]]` and `[[@a|ref]] [[@b]] [[@c]]` now merge correctly in reading mode even when Obsidian wraps the links in separate elements, and a reference list no longer leaves stray citations behind it.
- **Citations split by formatting.** A `[@key, … and *passim*]` that Obsidian splits across an `<em>` now renders, and `@author [@bracket]` author-in-text citations render too.

### Locators: forced braces, combined volume:page, and ranges

- **Curly-brace overrides** work in both plain and linked citations: `{…}` forces its contents to be a locator, and an empty `{}` stops the following number from being read as one.
- **Volume and page combine** into the single Chicago locator when they are adjacent — `vol. 2, p. 69` becomes `2:69` — in plain and linked form, in braces or not. A third locator is named explicitly in the suffix.
- **Ranges use en dashes.** A locator range is normalized (`10-13` → `10–13`), matching how citeproc and pandoc render it.
- **The narrative dash works with a locator.** `[[@key|@, vol. 2, p. 41–43 -]]` now renders as narrative with the combined locator (`Author (2010, 2:41–43)`); previously the dash was lost when a locator was present.
- **Export matches.** A forced-locator block keeps its braces inside the author-in-text bracket — `@a [{ii, A, D-Z}]` — which pandoc and citeproc parse the same way as the in-app render.

A stale rendered-citation cache from an earlier version is discarded automatically on update, so the new rendering applies immediately.

### Finding references: spelling variants and faster search

- **Spelling variants are folded.** `color` finds "colour", `colonization` finds "colonisation", and `-ize`/`-ise` spellings and dropped-e stems (`theatre`/`theater`) return the same set, with the other spelling highlighted in the results.
- **Diacritics are normalized** in unquoted query terms too, so `Bourdieu` and `Bourdiéu` search the same.
- **Search no longer stalls.** A keystroke used to score the entire library, which could pause for up to a second on a large library; candidates that cannot match are now set aside instantly.

### Literature notes: add citations, fill in missing notes, and tidy foreign notes

- **The Add window can add citations.** **Add Literature Notes/Citations (search and filter)** now has an **Add** choice — literature notes, citations, or both. Citations are inserted as one contiguous run at the cursor (`[[@a]] [[@b]]`, or `[@a] [@b]` when linked citations are off).
- **Insert literature notes for linked citations** (a new setting) quietly creates a note from Zotero when a linked citation `[[@key]]` has none — for all linked citations, only on insertion, or never (the default). Notes are created without stealing focus.
- **Notes found under a foreign name are handled deliberately.** When a note carries an item's `zotero-key` but a filename that is neither its current nor its recorded citekey, ScholarWeft offers to convert and rename it, convert it keeping your `## Notes`, create a fresh note beside it, or cancel — asked each time, never silently.
- **Keyed notes outside your literature-note folder are offered a home.** After the library loads, ScholarWeft reviews notes with a `zotero-key` in one cheap pass and, if any live outside your literature-note folder, asks once whether to move them into it when they are next updated (so an import does not create a duplicate beside them). Group-library notes are placed in their library's subfolder automatically.

### Everything already in ScholarWeft still works

Linked citations, the reference sidebar, document import and export, literature-note creation and updating, and the ZotLit import path are unchanged.
