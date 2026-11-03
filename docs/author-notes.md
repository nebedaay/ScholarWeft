# Author notes

ScholarWeft can turn a creator link into an author note. The literature-note template writes creators as `[[Last, First]]` (or a literal name such as `[[An Institute]]`), and clicking an unresolved one creates a note with a template, an alias, and the works that mention that person.

## Creating an author note

- **Click an unresolved creator link.** Obsidian creates the empty note; ScholarWeft fills it from the author template and moves it to the **Authors** folder. This is on by default — turn it off under **Settings → ScholarWeft → Author notes → Create author notes on link click**.
- **Run “Create author note”** from the command palette. A searchable list of every creator in your library appears; pick one to create (or open) its page. Use this for a creator that is not linked anywhere yet.

Only a genuinely empty new note is filled. If Obsidian's new-note template (Templater or the Basic note template) filled the file first, ScholarWeft replaces it when the file has no body; anything you have written is never overwritten.

## What the page contains

The default template writes:

- `up: "[[Authors]]"`;
- `aliases: "First Last"` for a two-part name (`Last, First` is the note title and link target);
- `creator-roles` — every role the person has in your library (author, editor, translator, …);
- `related` — `[[@citekey]]` for every work that lists the person as a creator, plus the works' tags as `[[tag]]` links;
- `variants: []` — see below;
- a `## Publications` managed region with a contiguous reference run of the works that have **literature notes**: `[[@key1|ref]] [[@key2]] …`. Works without a note are not listed.

The Publications region is updated when a literature note is imported, so it grows as you import more of the person's works. The `related` YAML links are deliberately not citations: ScholarWeft strips frontmatter before scanning for citations, so adding an author page never imports works by itself. Only the body Publications run is a citation list, and it contains already-imported works.

## Customising the template

The default is bundled with the plugin. Under **Settings → ScholarWeft → Author notes**:

1. Turn off **Use the default author template**.
2. Click **Copy the default author template to your vault**, choose a folder, and edit the copy.
3. Pick the copy under **Author template file** if it is not selected automatically.

The copy is not overwritten by plugin updates. The template uses Eta, like the literature-note template; its variables are `display`, `alias`, `roles`, `related`, `publications` and `date`.

## The Authors folder

Author notes are created in the folder set under **Author notes folder** (default `Authors`). **Merge existing author notes** moves every note that is named after a creator, or that has `up: "[[Authors]]"`, into that folder and applies the template. It adds the managed fields and the Publications region; your own body text and properties are preserved.

## Variants

Some people publish under more than one name. Put the other names in the **main** note's `variants` property:

```yaml
variants:
  - "[[Al-Kawlakhī, al-Shaykh Ibrāhīm b. ʿAbdallāh]]"
```

The main note then includes those variants' works and tags in its `related` and Publications lists. A variant note can carry `variant-of: "[[Niasse, Ibrahim]]"` to record its main note, but the main note is the one that keeps the biography and merged lists. Creator links still use the literal name; ScholarWeft does not rewrite them.

## Commands

- **Create author note** — pick a creator and create/open their page.
- **Merge existing author notes into the Authors folder** — the one-time tidy-up described above.
