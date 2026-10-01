Install/update via BRAT.

### Search is faster, simpler, and more forgiving

Finding a work to cite is now quicker and behaves the way you would expect.

- **Spaces work in `@` searches.** `@bourdieu dist` searches those words together. The popup stays open across spaces and closes at a period, comma, or question mark — or when you press Escape or move the cursor. If you would rather a space end the search so prose can follow immediately, turn off **Allow spaces in @ searches** in Settings.
- **Write words separately, abbreviate by their beginnings.** `soc crit` finds "**Soc**ial **Cri**tique", and `berg mem` finds *Berg*son on *mem*ory. A term matches wherever a word *begins* with it, so two or three letters are usually enough. The old joined shorthand (`soccrit`) is no longer interpreted — a space is easier to type than suppressing one, and it says exactly what you mean.
- **A hyphen is a within-word marker.** `anti-colonial` and `anticolonial` are the same search: each finds both spellings. Neither matches "anti-witchcraft … colonial Africa", because those are two unrelated words, not the one compound you typed.
- **Citekeys are matched whole, spaces or not.** `bourdieudist`, `bourdieu dist`, and `bourdieu dist 1984` all put `bourdieuDistinctionSocial1984` first. A citekey is *author + short title + year* run together, so a spaced phrase that reads onto the key is that work.
- **Quote a term to search it literally.** `"anti-colonial"` matches that exact string anywhere in a field (case-insensitive), so it will not be split or matched against a different spelling.
- **Spelling variants are matched.** `color` finds "colour" and `colonization` finds "colonisation".
- **A search result is bolded whatever the hyphenation** — `anticolonial` emphasises both "Anticolonial" and "Anti-Colonial".

**It is also much faster.** A search used to score the entire library on every keystroke, which could stall for up to a second on a large library; a candidate that cannot match is now set aside instantly. The **Add Literature Notes** window no longer pauses when it opens: it scans your notes once per session instead of on every open, and it paints before it fills in results, so you can start typing straight away. Searching the abstracts (`@@`) is roughly twenty times faster than before.

### Notes update only when something actually changed

ScholarWeft watches Zotero and refreshes a literature note when its item changes. It no longer counts a non-change as one: opening a PDF in Zotero records that you read it, which the note does not import, so it will not be reported as an update. If a refresh produces a note identical to the one already on disk, the file is left untouched and nothing is announced.

### Changing the citation style applies straight away

Choosing a different citation style in Settings now re-renders the citations in your open notes immediately. Previously the engine changed but the open views kept the old style until Obsidian was reloaded.

### Everything already in ScholarWeft still works

Linked citations, the reference sidebar, document import and export, literature-note creation and updating, and the ZotLit import path are unchanged.
