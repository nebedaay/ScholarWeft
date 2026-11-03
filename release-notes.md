ScholarWeft 0.5.8 is a follow-up to 0.5.7: it fixes author-note cleanup and placement, removes Zotero tags from author `related` lists, and adds a title text colour for the YAML formatting addon.

### Author notes

The `Unassigned` placeholder that Templater's basic note template adds is now removed reliably after the template settles, so a new author note no longer keeps an `up: "[[Unassigned]]"` entry. The cleanup retries as the file is written instead of racing the create event.

Author pages now migrate once to the default section order: `# Overview (AI generated)` first, then `# Publications`, then your own sections. A new **Place new Publications sections** setting controls where a first-time `# Publications` region goes — after the AI overview (default), at the top, or at the end. Existing regions are left where you put them and are not moved on later updates; only a first insertion and the one-time migration use the setting.

Template-only duplicates are tidied up. If a note with `up: "[[Authors]]"` sits outside the Authors folder and a same-named author page already exists inside it, the outside copy is removed only when its body contains nothing but the managed template output. A duplicate with an AI overview or your own text is preserved.

The author `related` list now contains only the works that list the person as a creator. Zotero item tags are deliberately not copied into it, so article keywords no longer turn the list into a keyword dump.

### YAML properties

The **Format YAML properties** addon has a new **Title colour** picker for the title and short-title text. It is separate from the title background, so a light text colour can be used on a dark background. The colour is applied to the inner metadata editor as well as its container, which is where Obsidian actually paints the text.

### Documentation

The [author notes](https://github.com/nebedaay/ScholarWeft/blob/main/docs/author-notes.md) and [setup](https://github.com/nebedaay/ScholarWeft/blob/main/docs/setup.md) guides describe the new placement setting, the title colour control, and the duplicate cleanup.
