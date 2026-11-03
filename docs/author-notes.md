# Author notes

ScholarWeft can turn a creator link into an author note. The literature-note template writes creators as `[[Last, First]]` (or a literal name such as `[[An Institute]]`), and clicking an unresolved two-part creator link creates a note with a template, an alias, and the works that mention that person.

## Creating an author note

- **Click an unresolved creator link.** Obsidian creates the empty note; ScholarWeft fills it from the author template and moves it to the **Authors** subfolder of your literature notes folder (for example `_2 Bibliographic notes/Authors`). This is on by default — turn it off under **Settings → ScholarWeft → Author notes → Create author notes on link click**. Only an exact `Last, First` display name for a two-part creator is filled automatically. A literal creator (for example a YouTube username), a `First Last` alias, or any other name is left for the **Create author note** command, so a similarly named note is never claimed by accident.
- **Run “Create author note”** from the command palette. A searchable list of every creator in your library appears; pick one to create (or open) its page. Use this for a creator that is not linked anywhere yet.

Only a genuinely empty new note is filled. If Obsidian's new-note template (Templater or the Basic note template) filled the file first, ScholarWeft replaces it when the file has no body; anything you have written is never overwritten.

## What the page contains

The default template writes:

- `up: "[[Authors]]"`;
- `aliases: "First Last"` for a two-part name (`Last, First` is the note title and link target);
- `creator-roles` — every role the person has in your library (author, editor, translator, …);
- `related` — `[[@citekey]]` for every work that lists the person as a creator, plus the works' tags as `[[tag]]` links;
- `variants: []` — see below;
- a `## Publications` managed region with a contiguous reference run of the works that have **literature notes**: `[[@key1|ref]] [[@key2]] …`. Each entry links to its literature note, but the link inherits the note's text colour and has no underline or theme link styling. Works without a note are not listed.

The `related` property is refreshed when the Zotero library gains or changes an item, even if no literature note exists yet. The Publications region is updated when a literature note is imported, so it grows as you import more of the person's works. Existing `related` entries are preserved and new links are appended without duplicates; the whole property is never replaced. The `related` YAML links are deliberately not citations: ScholarWeft strips frontmatter before scanning for citations, so adding an author page never imports works by itself. Only the body Publications run is a citation list, and it contains already-imported works.

## Customising the template

The default is bundled with the plugin. Under **Settings → ScholarWeft → Author notes**:

1. Turn off **Use the default author template**.
2. Click **Copy the default author template to your vault**, choose a folder, and edit the copy.
3. Pick the copy under **Author template file** if it is not selected automatically.

The copy is not overwritten by plugin updates. The template uses Eta, like the literature-note template; its variables are `display`, `alias`, `roles`, `related`, `publications` and `date`.

## The Authors folder

Author notes are created in the folder set under **Author notes folder**. Leave it blank for `<literature notes folder>/Authors` (for example `_2 Bibliographic notes/Authors`).

`up: "[[Authors]]"` still marks a note as an author note, but it is not enough by itself to merge a note whose filename does not match an imported creator display. The main note's filename does not have to be a Zotero creator name: if it has `up: "[[Authors]]"` and at least one `variants` entry matching a cached creator, it is treated as an author note and its variants' works populate `related` and `## Publications`. Opening or editing a promoted note adds the template block if it is missing.

**Merge existing author notes** compares each note's filename with the exact display name ScholarWeft imports for a creator in your library: `Last, First`, or a literal name such as `One Long Author Name`. A filename of two or more words merges when it matches. A one-word filename merges only when it also has `up: "[[Authors]]"`. The merge applies the template and updates the managed fields and the Publications region; your own body text and properties are preserved.

Notes whose filenames do not match an imported display name are left alone. Dictionary/term pages (`term:`) and Midad repository notes (`midad-*` properties, including `Hans Wehr`) are skipped. The merge matches only the imported display name, never the `First Last` alias, so Midad's `Hans Wehr` repository note is not treated as the `Wehr, Hans` author page.

## Author-name variants

Some people appear in Zotero under more than one name — a fuller form of the given name, a married name, a spelling variant, or an institutional name. Put the alternate creator names in the **main** note's `variants` property:

```yaml
variants:
  - Al-Kawlakhī, al-Shaykh Ibrāhīm b. ʿAbdallāh
```

`variants` is the source of truth. Values are exact creator display names (square brackets in a name are preserved as part of the name) — `Last, First`, `Last, First Middle`, or a multi-word literal — written as plain text, not wikilinks. They are not aliases; an entry in `aliases` never becomes a variant. For link rewriting and template resolution, a variant is used only when its name is currently present in the Zotero cache as a creator display or `First Last` alias; non-matching variants are still retained in the main note (and the note is still given author-template material), but they cannot resolve works that are not in the cache. Matching ignores punctuation, spacing, case, diacritics and ʿayn/hamza marks, but keeps name order significant (`Ali, Muhammad` and `Muhammad Ali` stay different). If two different author records normalize to the same key, the match is treated as ambiguous and skipped rather than merged.

**Link author name as a variant** is available when the current note has `up: "[[Authors]]"`; its name does not have to be in the Zotero cache. It opens a searchable picker prefilled with the current note name; choose the main author. The command then:

- adds the current note name to the main note's `variants`;
- adds autocomplete aliases for the variant: the variant itself and its `First Middle Last` form;
- rewrites creator properties across the vault from `[[Variant]]` to `[[Main, Author|Variant]]`, so the note displays the published variant name but links to the main page;
- moves the current note to the trash.

Adding a variant to `variants` by hand has the same link and alias effect while Obsidian is running: the plugin notices the new value, adds the generated aliases, and rewrites matching creator properties. The old note is not deleted automatically in that case.

The main note includes the variant's works and tags in its `related` and Publications lists. A variant note may carry `variant-of: "[[Niasse, Ibrahim]]"` to record its main note, but the main note is the one that keeps the biography and merged lists.

`aliases` is still used for display and Obsidian's link autocomplete. The plugin adds the variant forms there for convenience, but it never treats an alias as the definition of a variant. This keeps a display alias such as `First Last` separate from the `variants` list.

New imports use the variant map automatically: `creator_values` and `creators_by_type` write `[[Main|Variant]]` when a creator name is a known variant. Custom Eta templates can call `creator_link(name)` for the same resolution.

A periodic check runs at startup and every five minutes. It compares the variant map with the author names currently in the Zotero cache; variants that do not match a cached creator name are ignored. For the variants that remain, it adds missing aliases and rewrites creator links that still point at a variant or its generated `First Middle Last` form. Only variants that are new or changed since the last pass are processed, and Obsidian's metadata cache is used as a prefilter, so notes whose creator fields already point at the main author are never read.

## AI author overview (optional)

The **Generate author overview** command adds a short AI-written background section to an author note. It is off by default; enable it under **Settings → ScholarWeft → Author notes → AI author overview**.

Settings:

- **LLM base URL** — an OpenAI-compatible endpoint. The default is Gemini’s `https://generativelanguage.googleapis.com/v1beta/openai`.
- **LLM model** — default `gemini-3.1-flash-lite`.
- **LLM API key** — stored in this vault’s plugin settings.
- **Author overview prompt** — instructions for the model. The default asks for about 100 words identifying the author and summarizing their written work, school of thought, and contribution to their fields.

The command is available on notes with `up: "[[Authors]]"`. It builds context from the author note name, its variants, and one or two works from your library (a book if available, otherwise an article or chapter), then prepends the user prompt. If the note title is a 2–4-letter all-caps acronym (for example `BN`), the note title is not sent as the author name; the variants are used instead. The generated text is inserted at the beginning of the note body as:

```markdown
# Overview (AI generated)

…
```

This section is **not managed**: it is written once and the user can edit or remove it. Running the command again replaces that section.

## Commands

- **Generate author overview** — add the optional AI background section to an author note.
- **Create author note** — pick a creator and create/open their page.
- **Merge existing author notes into the Authors folder** — the one-time tidy-up described above.
- **Link author name as a variant** — available on an author note; link its name to a main author page and move this note to the trash.
