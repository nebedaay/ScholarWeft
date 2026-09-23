## Started with ChatGPT, ironed out with DeepSeek, OpenWork, and Claude
# DocumentCompiler: converts a bulleted outline of Obsidian notes to a single
# compiled markdown file (and optionally exports to .docx).
#
# Outline grammar — applies uniformly at every bullet level:
#   - "- Heading text"          plain-text bullet → heading at the bullet’s depth
#   - "- [[Note]]"              linked bullet → heading (title/filename) + note contents
#   - "- @@ Heading text"       plain-text with @@ → numbered heading ("Chapter N: …")
#   - "- @@[[Note]]"            linked with @@  → numbered heading + note contents
#   - "- x [[Note]]"            linked with x   → note contents only (no heading)
#
# Numbering-levels (YAML property / --numbering-levels):
#   0 (default) → only '@@'-marked headings are numbered.
#   N > 0       → every heading down to outline depth N is auto-numbered
#                 ('@@' is ignored); a '* ' prefix (space required, so
#                 *italics* is never mistaken for it) marks an unnumbered
#                 exception. E.g. numbering-levels: 2 numbers chapters and
#                 sections, leaving deeper headings alone.
#
# Heading title for linked notes (in order of preference):
#   1. YAML "title:" property of the linked note
#   2. Base filename, with leading ordering numbers stripped
#      ("1 Introduction" → "Introduction", "7-1 Details" → "Details")
#
# Heading demotion for included notes:
#   If the linked note contains section headings, the shallowest heading in the
#   note’s body becomes the level directly below the note’s own position in the
#   outline hierarchy. Example: a note whose title is a ## heading (depth 2) whose
#   body contains a "# Section" — that section becomes "### Section", and any
#   deeper headings shift by the same offset.
#
# Footnotes:
#   Footnotes are renumbered. Default is per-chapter for book* templates and
#   global (continuous) for article* templates. Override with --global-footnotes
#   or --no-global-footnotes.
#
# Endnotes (YAML property / --endnotes-mode): none (default) | native | body
#   none   → footnote definitions only (native page-bottom footnotes).
#   native → real endnote objects for DOCX/ODT (a single editable stream).
#   body   → a '# Notes' section whose body paragraphs are divided by chapter
#            ('## <chapter>'), for DOCX/ODT. Requires per-chapter numbering
#            (with continuous numbering it degrades to native).
# The native/body distinction is a DOCX/ODT concern (chapter headings inside a
# real endnote stream are impractical there). Markdown/LaTeX have no such
# problem and no endnote object to convert to, so BOTH choices give them the
# same VISIBLE, populated '# Notes' section.
# The old boolean property still works: true → native, false → none.
#
# Outline vs. compiled detection:
#   - "template: compile-<name>" in YAML explicitly marks a file as an outline;
#     after compilation the template is rewritten to "<name>".
#   - Otherwise: a top-level bullet list with no # headings is treated as an outline.
#   - "--export" exports the compiled markdown to .docx via the ScholarWeft pipeline.

import json
import re
import os
import sys
from pathlib import Path
from collections import OrderedDict
import argparse

# ── vault / plugin path resolution ───────────────────────────────────────────
# The script lives in <vault>/.obsidian/plugins/scholar-weft/scripts/ (or a
# copy/symlink of it). The plugin passes the vault root explicitly in the
# SW_VAULT env var (from adapter.getBasePath()); when the script is run
# standalone we derive it from THIS FILE's real location instead
# (os.path.realpath resolves symlinks), walking up
#   scripts → scholar-weft → plugins → .obsidian → <vault>.

_PLUGIN_SCRIPTS_DIR = Path(os.path.dirname(os.path.realpath(os.path.abspath(__file__))))
_PLUGIN_DIR = _PLUGIN_SCRIPTS_DIR.parent            # …/plugins/scholar-weft

sys.path.insert(0, str(_PLUGIN_SCRIPTS_DIR))
# Shared, format-agnostic helpers also used by the DOCX/ODT merge scripts —
# cover-value resolution (title/subtitle/author/date-default) and the
# roman-frontmatter reset-heading finder. The LaTeX export path (no merge
# step of its own) reuses these directly rather than reimplementing them.
from sw_merge_helpers import (  # noqa: E402
    resolve_cover, first_line, cover_author_lines,
    find_page_reset_index, looks_like_caption, strip_figure_prefix,
    append_extra_sections, resolve_note_sections,
    strip_bibliography_heading_from_markdown, parse_chapter_number,
    strip_chapter_prefix,
)


def _find_vault_root():
    env = os.environ.get('SW_VAULT')
    if env and (Path(env) / '.obsidian').is_dir():
        return Path(env)
    # Walk up from the script (installed: …/.obsidian/plugins/scholar-weft/
    # scripts; dev checkout: …/<vault>/src/ScholarWeft/scripts) and from the
    # cwd, looking for the directory that contains a `.obsidian/` folder.
    for start in (_PLUGIN_SCRIPTS_DIR, Path.cwd()):
        for d in (start, *start.parents):
            if (d / '.obsidian').is_dir():
                return d
    raise SystemExit(
        'Could not locate the Obsidian vault. Run this from inside a vault, '
        "or set SW_VAULT to the vault's root path. "
        f'(script at {_PLUGIN_SCRIPTS_DIR}, cwd {Path.cwd()})')


_VAULT_ABS = _find_vault_root()

# Propagate to child processes (pandoc + sw-export.lua read SW_VAULT).
os.environ.setdefault('SW_VAULT', str(_VAULT_ABS))

# Callout icon PNGs live next to the scripts (…/scripts/ → …/icons/), in both
# the source checkout and the extracted plugin dir.  sw-callouts.lua reads this
# to place the per-type icon image.  Computed from THIS file's location so it
# works for the plugin and for a bare CLI run alike.
os.environ.setdefault(
    'SW_ICONS_DIR',
    os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                  '..', 'icons')))

def vault_rel(*parts):
    """Return a vault path (absolute, anchored at the vault root).
    The name is historical; the path is absolute so rglob/reads work
    regardless of the caller's working directory."""
    return str(Path(_VAULT_ABS, *parts))

def vault_rel_to_cwd(*parts):
    """Return a vault path expressed relative to the current working
    directory. Used ONLY for subprocess args (pandoc/merge) where the
    process runs in the vault and relative paths avoid permission prompts."""
    rel = os.path.relpath(Path(_VAULT_ABS, *parts), os.getcwd())
    return rel

def plugin_script_path(*parts):
    """A path inside the plugin's scripts/ dir (lua filters, merge script,
    converter). Absolute, anchored at the plugin's real location."""
    return str(Path(_PLUGIN_SCRIPTS_DIR, *parts))

def plugin_template_path(name):
    """An Export Template inside the plugin's sw-export-templates dir (fallback)."""
    return str(Path(_PLUGIN_DIR, 'sw-export-templates', name))

def _resolve_template_path(tpl, ext, template_dir):
    """Template file candidate chain, shared by every export format: the
    user's own templates dir (if any) → the plugin's bundled sw-export-templates/ →
    same two locations for 'document<ext>' as a final fallback. Returns the
    first candidate that exists, else the last candidate (so callers can
    still report a clear "not found" using the same path they tried)."""
    candidates = []
    if template_dir:
        candidates.append(os.path.join(template_dir, f'{tpl}{ext}'))
    candidates.append(plugin_template_path(f'{tpl}{ext}'))
    if template_dir:
        candidates.append(os.path.join(template_dir, f'document{ext}'))
    candidates.append(plugin_template_path(f'document{ext}'))
    path = next((c for c in candidates if os.path.exists(c)), candidates[-1])
    if not os.path.exists(path):
        print(f"WARNING: no template found for '{tpl}' (and no document{ext} fallback). "
              f"Tried: {candidates}")
    elif not path.endswith(f'{tpl}{ext}'):
        print(f"WARNING: template '{tpl}{ext}' not found; using {path} as fallback.")
    return path

def get_indent_level(line: str) -> int:
    line_expand = line.replace("\t", "    ")
    spaces = len(line_expand) - len(line_expand.lstrip(" "))
    return spaces // 4

def extract_yaml(text: str):
    """Split a leading YAML frontmatter block from the body."""
    # Normalise CRLF → LF so the regex works on Windows-edited files.
    text = text.replace('\r\n', '\n')
    yaml_match = re.match(r"(?s)^---\n(.*?)\n---\n", text)
    if yaml_match:
        return yaml_match.group(1), text[yaml_match.end():]
    return None, text


def strip_frontmatter_citations(text: str) -> str:
    """Remove pandoc citation syntax from the leading YAML frontmatter block.

    Pandoc's --citeproc processes citations found in METADATA as well as the
    body, so a citation in a navigation property (e.g. `up: [[@key|Alias]]`,
    which the converter rewrites to `[@key]`) adds a bibliography entry for a
    work that is never cited in the document body — the phantom "in the
    references but not cited" bug. Only the leading `---` block is touched; the
    body keeps its citations.
    """
    m = re.match(r'(?s)^(---\n.*?\n---\n)(.*)$', text)
    if not m:
        return text
    head, body = m.group(1), m.group(2)
    # Bracketed citations: [@key], [-@key], [see @key, p. 5], [@a; @b].
    head = re.sub(r'\[[^\[\]]*@[^\[\]]*\]', '', head)
    # Narrative/bare citations: @key (not part of an email address).
    head = re.sub(r'(?<![\w@])@[A-Za-z][\w:.#$%&+\-?<>~/]*', '', head)
    return head + body

def sanitize_title(title: str) -> str:
    # Keep alphanumeric and underscores only
    return re.sub(r"[^\w]", "_", title.strip())

def strip_ordering_number(title: str) -> str:
    """Strip a leading ordering number from a filename-provided title.
    Handles '1 Title', '7-1 Title', '1.5 Title', '12 Title', '7–1 Title'.
    """
    return re.sub(r'^\d+(?:[-–.\u2013]\d+)*\s+', '', title, count=1)

def extract_footnotes_from_text(text: str):
    """Extract all footnotes (anchors and definitions) from a text."""
    # Pattern for footnote anchors (NOT followed by colon)
    anchor_pattern = re.compile(r"\[\^([^\]]+)\](?!:)")
    # Pattern for footnote definitions
    def_pattern = re.compile(r"\[\^([^\]]+)\]:\s*(.*?)(?=\n\[\^|\n\n|\Z)", re.DOTALL)
    
    # Find all anchors in order with their positions
    anchors = []
    for match in anchor_pattern.finditer(text):
        anchors.append({
            'name': match.group(1),
            'start': match.start(),
            'end': match.end(),
            'full_text': match.group(0)
        })
    
    # Find all definitions in order
    definitions = []
    for match in def_pattern.finditer(text):
        definitions.append({
            'name': match.group(1),
            'content': match.group(2).strip(),
            'start': match.start(),
            'end': match.end()
        })
    
    return anchors, definitions

def process_chapter_footnotes(chapter_text: str, chapter_prefix: str, chapter_name: str,
                              global_footnotes: bool = False, global_counter: int = 0,
                              endnotes: bool = False):
    """Process all footnotes in a chapter at once.

    Returns (modified_text, notes, pair_count), where `notes` is a list of
    {'name', 'display', 'content'} dicts in reading order. The caller renders
    them as native footnote definitions (endnotes=False) or as a visible
    Notes section (endnotes=True). In endnotes mode the body anchor becomes a
    superscript number (``^N^``) instead of a ``[^name]`` footnote reference,
    so nothing is left for pandoc to turn into a page-bottom footnote.
    """
    
    print(f"\n--- Processing {chapter_name} ---")
    
    # Extract all anchors and definitions from the chapter text
    anchors, definitions = extract_footnotes_from_text(chapter_text)
    
    print(f"  Found {len(anchors)} anchors in order")
    print(f"  Found {len(definitions)} definitions in order")
    
    # Pair anchors with definitions in order of appearance
    pair_count = min(len(anchors), len(definitions))
    
    if len(anchors) != len(definitions):
        print(f"  WARNING: Mismatch: {len(anchors)} anchors vs {len(definitions)} definitions")
    
    # Name + display number for each paired note, in reading order. `name` is
    # the pandoc footnote id (footnote mode); `anchor_id` is a document-unique
    # slug for the endnote mode's HTML link targets.
    notes = []
    if global_footnotes:
        # Use global counter for sequential numbering across all chapters
        print(f"  Using global numbering: starting from Global_{global_counter + 1}")
        for i in range(pair_count):
            n = global_counter + i + 1
            notes.append({
                'name': f"{n}",
                'display': n,
                'anchor_id': f"{n}",
                'content': definitions[i]['content'],
            })
    else:
        # Use chapter-specific numbering (display number restarts per chapter)
        print(f"  Using chapter numbering: starting from {chapter_prefix}_1")
        for i in range(pair_count):
            notes.append({
                'name': f"{chapter_prefix}_{i+1}",
                'display': i + 1,
                # Unique per chapter even when display numbers repeat (1, 2 …).
                'anchor_id': f"{chapter_prefix}-{i+1}",
                'content': definitions[i]['content'],
            })

    # Process the text from the end to avoid position shifting
    # Sort anchors in reverse order by position
    sorted_anchors = sorted(anchors[:pair_count], key=lambda x: x['start'], reverse=True)

    # Replace anchors in reverse order (from last to first)
    modified_text = chapter_text
    for anchor in sorted_anchors:
        # Find the corresponding note (need to map from original order)
        original_index = anchors.index(anchor)
        note = notes[original_index]
        if endnotes:
            # Superscript number linking DOWN to its note. Markdown link with
            # ^N^ as the link text — pandoc renders it as a real superscript
            # hyperlink (DOCX/ODT) and as <a><sup>N</sup></a> in HTML/Markdown,
            # so one form serves every format. The target is a fenced Div
            # (::: {#id}) emitted at each note, which pandoc turns into a real
            # bookmark/section in every writer; a raw HTML <a id> is dropped by
            # the DOCX/ODT writers and would leave a dead link. The id is
            # chapter-qualified so per-chapter numbering can't collide.
            new_anchor = (f'[^{note["display"]}^](#notes-{note["anchor_id"]})')
        else:
            new_anchor = f"[^{note['name']}]"
        # Replace this specific instance
        modified_text = modified_text[:anchor['start']] + new_anchor + modified_text[anchor['end']:]

    # Remove all footnote definitions from the chapter text
    def_pattern = re.compile(r"\[\^([^\]]+)\]:\s*(.*?)(?=\n\[\^|\n\n|\Z)", re.DOTALL)
    modified_text = def_pattern.sub("", modified_text)

    print(f"\n  Prepared {pair_count} {'endnote' if endnotes else 'footnote'}(s)")
    return modified_text, notes, pair_count

def resolve_note_path(note_name: str):
    """Find a vault note by name (with .md extension). Returns Path or None.
    Uses vault-relative paths only.

    Normalizes both the search target and every filesystem entry to NFC before
    comparing. macOS APFS preserves whatever Unicode normalization was used
    when a file was created, so a note whose filename is NFD on disk won't be
    found by rglob() when the wikilink text is NFC (or vice versa). Comparing
    NFC-normalized forms handles both cases correctly.
    """
    import unicodedata
    target = unicodedata.normalize('NFC', note_name + '.md')
    matches = [
        p for p in Path(vault_rel()).rglob('*.md')
        if unicodedata.normalize('NFC', p.name) == target
    ]
    if not matches:
        raise FileNotFoundError(f"Note '{note_name}' not found in vault: {_VAULT_ABS}")
    # Prefer the shallowest match (fewest path parts) — mirrors the old
    # behavior while being more predictable when names repeat.
    return min(matches, key=lambda p: len(p.parts))

def rewrite_poetry_callouts(content: str) -> str:
    """Rewrite Obsidian poetry callouts so pandoc preserves the couplet
    structure. Pandoc flattens '>-' (verse start) and '>\t-' (second
    hemistich) into one Para where both become plain Str('-') — the lua
    filter can then no longer tell them apart and emits each hemistich as
    its own paragraph.

    Fix: join each verse's two hemistichs onto ONE line with an explicit
    '<br>' marker, which pandoc preserves as a RawInline and the filter
    treats as a hemistich separator:
      English:  >- h1  +  >\t- h2   →  >- h1<br>h2
      Arabic:   >\t- h1 + >\t- h2  →  >\t- h1<br>h2  (consecutive pairs)
    """
    def repl(m):
        marker = m.group(1)
        body = m.group(2)
        lines = body.splitlines()
        is_arabic = 'arabic' in marker.lower()
        out_lines = []
        verse_buf = None
        for raw in lines:
            line = raw.lstrip('>').strip()
            if not line:
                continue
            is_tab = raw.startswith('>\t')
            if is_arabic:
                # Format:  > - full line  → a full verse line (not a hemistich)
                #          >\t- hemistich → one hemistich of a couplet (tab-indented)
                #          >-             → bare dash separator, ignored
                # Tab-indented pairs are joined with <br>; top-level lines stand alone.
                stripped = line.lstrip('- ').strip()
                if not stripped:
                    # Bare ">-" separator: flush any dangling single hemistich.
                    if verse_buf is not None:
                        out_lines.append(verse_buf)
                        verse_buf = None
                elif is_tab:
                    # Tab-indented: part of a hemistich pair.
                    if verse_buf is not None:
                        out_lines.append(verse_buf + '<br>' + stripped)
                        verse_buf = None
                    else:
                        verse_buf = stripped
                else:
                    # Top-level (not tab): a full verse line, not a hemistich.
                    if verse_buf is not None:
                        out_lines.append(verse_buf)
                        verse_buf = None
                    out_lines.append(stripped)
                continue
            # English: tab line = second hemistich of current verse.
            if is_tab and verse_buf is not None:
                verse_buf += '<br>' + line.lstrip('- ').strip()
                continue
            if verse_buf is not None:
                out_lines.append(verse_buf)
            verse_buf = line.lstrip('- ').strip()
        if verse_buf is not None:
            out_lines.append(verse_buf)
        # Keep a trailing newline so a body paragraph that follows the
        # callout doesn't get glued to the last verse line.
        # The blank '>' line between the marker and the body is essential:
        # without it pandoc puts the marker and all body lines into ONE Para,
        # and collect_all_inlines returns an empty list (rest[0] is the marker block).
        return marker.rstrip() + '\n>\n>' + '\n>'.join(out_lines) + '\n'
    return re.sub(r'(>?\s*\[!(?:arabic-)?poetry(?:-callout)?\][^\n]*\n)'
                  r'((?:\s*>.*\n?)+)', repl, content)

def resolve_attachment_path(filename: str):
    """Find a vault attachment (image etc.) by exact filename. Returns Path
    or None. Obsidian resolves embeds against the whole vault."""
    matches = list(Path(vault_rel()).rglob(filename))
    if not matches:
        return None
    return min(matches, key=lambda p: len(p.parts))

# Excalidraw drawings are embedded as ![[Name.excalidraw]] (Obsidian omits the
# trailing .md). The Excalidraw plugin keeps sidecar image files next to the
# drawing when autoexportSVG / autoexportPNG are on ("Name.excalidraw.svg" /
# "Name.excalidraw.png", kept in sync with the drawing). We embed the sidecar
# instead of the drawing source. PNG is tried first: it is a faithful raster of
# what Obsidian shows, whereas Word and LibreOffice render the SVG with a
# substitute font (the Excalidraw hand-drawn font isn't installed) and
# LibreOffice drops some shape fills. SVG is the fallback when no PNG sidecar
# exists.
_EXCALIDRAW_SIDECAR_FORMATS = ('png', 'svg')


def _parse_embed_pipe(parts):
    """Split the segments after the first '|' of an Obsidian embed into
    (alt_text, width, height). A purely numeric segment (optionally NxN) is a
    pixel size; anything else is alt text."""
    alt_bits, width, height = [], None, None
    for seg in parts[1:]:
        dm = re.fullmatch(r'(\d+)(?:x(\d+))?', seg)
        if dm:
            width, height = dm.group(1), dm.group(2)
        elif seg:
            alt_bits.append(seg)
    return ' '.join(alt_bits), width, height


def _embed_markdown(resolved, alt, width, height):
    """Build the pandoc image markdown for a resolved attachment path."""
    rel = os.path.relpath(resolved, os.getcwd())
    attrs = ''
    if width:
        dims = ['width=%spx' % width]
        if height:
            dims.append('height=%spx' % height)
        # No space before '{' — pandoc only reads it as an image attribute
        # when it is directly adjacent to the ')'.
        attrs = '{%s}' % ' '.join(dims)
    return f'![{alt}]({rel}){attrs}'


def resolve_embed_links(content: str) -> str:
    """Rewrite Obsidian image embeds (![[name.ext]]) to vault-relative paths
    so pandoc can fetch them. Without this, pandoc looks relative to the
    compiled file's directory and replaces the image with its filename.
    Excalidraw embeds (![[name.excalidraw]]) resolve to their exported sidecar
    image. Non-image embeds (![[other note]]) are left untouched (wikilinks).
    """
    img_ext = r'(?:png|jpe?g|gif|bmp|tiff?|webp|svg)'
    def repl(m):
        # Obsidian pipe syntax: ![[img.png|alt text]] (alt) and
        # ![[img.png|454]] / ![[img.png|454x300]] (display size in px).
        # Split on '|' FIRST — the filename/extension is only in the first
        # segment; a purely numeric (optionally NxN) segment is a size, any
        # other segment is alt text. Without this the whole "name|454" string
        # fails the extension check, "454" leaks into the caption, and pandoc
        # renders no image.
        parts = [p.strip() for p in m.group(1).split('|')]
        target = parts[0].strip()

        # Excalidraw: ![[Name.excalidraw]] / [[...excalidraw.md]] / with a
        # #frame or #^ref fragment — always embed the whole-drawing sidecar.
        exc = re.match(r'(?i)^(.*\.excalidraw)(?:\.md)?(?:#.*)?$', target)
        if exc:
            base = exc.group(1)
            resolved = next(
                (p for ext in _EXCALIDRAW_SIDECAR_FORMATS
                 for p in (resolve_attachment_path(f'{base}.{ext}'),) if p),
                None,
            )
            if resolved is None:
                # Leaving the raw ![[...]] wikilink in place used to look
                # like a mysterious parsing bug: pandoc's own wikilinks
                # extension (-f markdown+wikilinks_title_after_pipe, needed
                # elsewhere) still parses an unresolved image embed as
                # ![pipe-part](target) — so a size like "|500" silently
                # became the alt text and the raw wikilink target became a
                # literal (nonexistent) file path, with no visible warning.
                print(f'WARNING: Excalidraw drawing "{base}" has no '
                      f'exported PNG/SVG sidecar next to it (re-export the '
                      f'drawing — e.g. open it in Excalidraw and save — or '
                      f'check it hasn\'t been renamed since the sidecar was '
                      f'last generated). Substituting a placeholder.',
                      file=sys.stderr)
                return f'**[Missing image: {base}]**'
            alt, width, height = _parse_embed_pipe(parts)
            return _embed_markdown(resolved, alt or re.sub(r'\.excalidraw$', '', base, flags=re.I),
                                   width, height)

        if not re.search(rf'\.{img_ext}$', target, re.IGNORECASE):
            return m.group(0)
        alt, width, height = _parse_embed_pipe(parts)
        resolved = resolve_attachment_path(target)
        if resolved is None:
            print(f'WARNING: Image "{target}" not found in vault attachments. '
                  f'Substituting a placeholder.', file=sys.stderr)
            return f'**[Missing image: {target}]**'
        return _embed_markdown(resolved, alt or target, width, height)
    return re.sub(r'!\[\[([^\]]+)\]\]', repl, content)

def adjust_heading_levels(content: str, depth: int) -> str:
    """Demote all markdown headings in *content* so the shallowest heading sits
    at depth+1 (i.e., one level below the note's own position in the outline).

    Example: a note at depth 2 whose body has "# Section" and "## Sub":
      min_level = 1, offset = (2+1) - 1 = 2
      "# Section" → "### Section"   "## Sub" → "#### Sub"
    """
    heading_re = re.compile(r'^(#{1,6}) ', re.M)
    levels = [len(m.group(1)) for m in heading_re.finditer(content)]
    if not levels:
        return content
    min_level = min(levels)
    offset = (depth + 1) - min_level
    if offset <= 0:
        return content
    def repl(m):
        new_level = min(len(m.group(1)) + offset, 6)
        return '#' * new_level + ' '
    return heading_re.sub(repl, content)


def strip_wikilinks(text: str) -> str:
    """Replace Obsidian wikilinks with their display text.
    [[Target|alias]] -> alias
    [[Target]]       -> Target (leading order-numbers stripped, extension dropped)
    ![[...]]         -> left untouched (image embeds handled by resolve_embed_links)
    [[@key...]]      -> left untouched (citations already converted before this runs)

    Wikilinks inside fenced code blocks and inline code spans are left VERBATIM
    (pandoc renders code literally, so a `[[Note]]` example must survive).
    """
    def _replace_wl(inner):
        if '|' in inner:
            return inner.split('|', 1)[1]
        name = re.sub(r'\.(md|markdown)$', '', inner, flags=re.I)
        name = re.sub(r'^\d[\d.\-]*\s+', '', name)
        return name

    # One pass over: fenced block | inline code span | wikilink. Only the
    # wikilink alternative is rewritten; code is emitted unchanged.
    token = re.compile(
        r'(?P<fence>^[ \t]*(?P<f>`{3,}|~{3,})[^\n]*\n.*?^[ \t]*(?P=f)[ \t]*$)'
        r'|(?P<code>(?P<tick>`+)(?:(?!(?P=tick)).)+(?P=tick))'
        r'|(?<!!)\[\[(?P<wl>[^\[\]]+)\]\]',
        re.M | re.S)

    def _sub(m):
        if m.group('wl') is None:      # matched a fenced block or a code span
            return m.group(0)
        return _replace_wl(m.group('wl'))

    return token.sub(_sub, text)

def linkify_bare_urls(text: str) -> str:
    """Convert bare http(s) URLs to [url](url) markdown links.
    Strips trailing sentence punctuation. Skips URLs already in link syntax.
    """
    _BARE_URL = re.compile(r'(?<![\\[(])(https?://[^\s<>\)\]]+)(?![\)\]])')
    _TRAIL    = re.compile(r'[.,;:!?]+$')
    def _sub(m):
        url = m.group(1)
        trail_m = _TRAIL.search(url)
        if trail_m:
            trail = trail_m.group(0)
            url   = url[:-len(trail)]
            suffix = trail
        else:
            suffix = ''
        return '[' + url + '](' + url + ')' + suffix
    return _BARE_URL.sub(_sub, text)


def compile_note(note_name: str, depth: int, marker='', suppress_heading=False):
    """Compile a linked note into an optional heading + content.

    Heading title resolution order:
      1. YAML `title:` property (bare or quoted, same line only)
      2. Base filename with leading ordering number stripped
         ('1 Introduction' → 'Introduction')

    The note's body headings are demoted so that the shallowest heading
    in the body sits one level below the note's own depth in the outline.

    marker: the numbering-intent marker ('@@', '*', or '@@ *') copied from the
    outline bullet and kept in the compiled heading. A later whole-document
    numbering pass (number_headings) reads these markers and replaces them with
    the real number — see the note at the top of this file.

    suppress_heading=True omits the section heading entirely (for "x [[Note]]"
    bullets that append content to an existing section).
    """
    note_file = resolve_note_path(note_name)
    text = note_file.read_text(encoding="utf-8")

    # Strip YAML frontmatter before processing body.
    fm_match = re.match(r'^---\n[\s\S]*?\n---\n?', text)
    body = text[fm_match.end():] if fm_match else text

    # 1. YAML title property (same-line value only, quoted or bare).
    yaml_title = None
    if fm_match:
        m = re.search(r'^title:[^\S\n]*(?:["\']([^"\']+)["\']|(\S.*?))(?:\s*#.*)?$',
                      fm_match.group(0), re.M)
        if m and (m.group(1) or m.group(2)):
            yaml_title = (m.group(1) or m.group(2)).strip()

    # 2. Fallback: base filename with ordering number stripped.
    if yaml_title:
        original_heading = yaml_title
        # Body headings are NOT the note's title — keep them all in content.
        content = body.strip()
    else:
        # Use the first # heading as the section title and remove it from body.
        lines = body.splitlines()
        heading_line = next(
            (l for l in lines if re.match(r'^#+\s+', l) and not l.startswith('#tags')),
            None
        )
        if heading_line:
            original_heading = heading_line.lstrip('#').strip()
            content = '\n'.join(l for l in lines if l != heading_line).strip()
        else:
            original_heading = strip_ordering_number(note_name)
            content = body.strip()

    # Demote body headings relative to this node's depth. This is the last
    # compilation step: poetry-callout / embed rewrites and every other markdown
    # transformation belong to the shared post-compile pipeline (see
    # finalize_markdown and export_document's pre-pandoc block), which runs on
    # the FINAL document for outlines and single notes alike.
    content = adjust_heading_levels(content, depth)

    # Each note numbers its own footnotes from 1, so compiling several notes
    # would otherwise reuse the same [^fn1] name and mismatch anchors to
    # definitions once they are one document. Prefix this note's footnotes with
    # a slug unique to the note (the finalize stage matches them by name).
    _slug = re.sub(r'[^A-Za-z0-9]+', '-', note_name).strip('-') or 'note'
    content = re.sub(r'\[\^([^\]]+)\]',
                     lambda m: f'[^{_slug}--{m.group(1)}]', content)

    if suppress_heading:
        return content

    prefix = (marker + ' ') if marker else ''
    section_heading = '#' * depth + ' ' + prefix + original_heading

    return section_heading + '\n\n' + content

def parse_outline(body_text: str, numbering_levels=0):
    """Parse the bullet-list body into a tree of nodes.

    Each node is a dict:
      {
        'text': str,              # display text (link target name or heading text)
        'link': str | None,       # wikilink target if this bullet is a note include
        'chapter': bool,          # True if bullet started with @@
        'starred': bool,          # True if bullet started with '* ' (numbering-levels > 0)
        'suppress_heading': bool, # True if bullet started with 'x' (link only)
        'children': [node],
      }

    Prefix rules (applied in order before the wikilink check):
      'x '  or  'x[['  → suppress_heading (content only, no title heading)
      '@@'              → chapter (numbered heading)
      '* '              → starred (unnumbered exception), ONLY when the caller
                          set numbering_levels > 0 — see _node_is_numbered.
    Both prefixes may apply together only via '@@' on a plain-text node; 'x'
    only applies to linked nodes (suppressing the heading makes no sense for
    a plain-text heading).
    """
    root = []
    stack = []  # stack of (indent, node)

    def flush_to(indent):
        while stack and stack[-1][0] >= indent:
            stack.pop()

    for raw in body_text.splitlines():
        if not raw.strip():
            continue
        stripped = raw.lstrip()
        if not stripped.startswith('-'):
            continue
        indent = get_indent_level(raw)
        item = stripped.lstrip('-').strip()
        if not item:
            continue

        node = {
            'text': item,
            'link': None,
            'chapter': False,
            'starred': False,
            'suppress_heading': False,
            'children': [],
        }

        rest = item

        # Check for 'x' suppress-heading prefix (only meaningful before a link).
        suppress = False
        if re.match(r'^x\s*\[\[', rest):
            suppress = True
            rest = re.sub(r'^x\s*', '', rest)

        # Check for '@@' numbered-heading prefix.
        is_chapter = False
        if rest.startswith('@@'):
            is_chapter = True
            rest = rest[2:].strip()

        # Check for the '* ' unnumbered-exception prefix. Space required so a
        # heading that starts with *italics* is never mistaken for the marker.
        # This is only meaningful when auto-numbering by level is on; when it
        # is off (the default) the text is left completely untouched, so a
        # heading literally starting with '* ' keeps rendering as before.
        starred = False
        if numbering_levels and numbering_levels > 0 and re.match(r'^\*\s+', rest):
            starred = True
            rest = re.sub(r'^\*\s+', '', rest, count=1)

        # A bullet that IS a bare wikilink is a note include.
        # A bullet that merely CONTAINS a link (inline citation, prose tail) is plain text.
        link_match = re.fullmatch(r'\[\[([^\[\]]+)\]\]', rest)
        if link_match:
            target = link_match.group(1).strip()
            # Citekey wikilinks ([[@key|…]]) are citations, not includes.
            if not target.startswith('@'):
                node['link'] = target
                node['text'] = target
                node['suppress_heading'] = suppress

        node['chapter'] = is_chapter
        node['starred'] = starred
        if not node['link'] and not suppress:
            # Plain-text bullet: use rest (prefix-stripped) as the heading text.
            node['text'] = rest if (is_chapter or starred) else item

        flush_to(indent)
        if stack:
            stack[-1][1]['children'].append(node)
        else:
            root.append(node)
        stack.append((indent, node))

    return root

def _marker_is_numbered(anchored, starred, numbering_levels):
    """The single numbering decision, from a heading's markers.

    numbering_levels == 0: only an '@@'-anchored heading is numbered.
    numbering_levels  > 0: every heading is numbered EXCEPT a '* '-starred one
    (the level test happens at the call site, since only number_headings knows
    the outline depth of a heading). Shared by _heading_numbered_and_title (the
    finalize pass) and the selftest, so the rule is defined once.
    """
    if numbering_levels and numbering_levels > 0:
        return not starred
    return bool(anchored)


def _node_marker(node):
    """The numbering-intent marker to keep in an outline node's compiled
    heading: '@@' (explicit), '* ' (unnumbered exception), or both."""
    m = '@@' if node.get('chapter') else ''
    if node.get('starred'):
        m = (m + ' *').strip()
    return m


def compile_node(node, depth, marker=''):
    """Compile one outline node recursively. Returns the section text.

    - Linked node:       heading (from note title/filename) + note content + children.
    - Linked + suppress: note content only (no heading) + children.
    - Plain-text node:   heading from bullet text + children.

    `marker` ('@@', '*', '@@ *') is copied into the heading so the later
    whole-document numbering pass (number_headings) can see the author's
    intent. No numbers are written here — see the note at the top of the file.
    """
    parts = []

    if node['link']:
        parts.append(compile_note(
            node['link'], depth,
            marker,
            suppress_heading=node.get('suppress_heading', False),
        ))
    else:
        title = node['text']
        prefix = (marker + ' ') if marker else ''
        parts.append('#' * depth + ' ' + prefix + title)

    for child in node['children']:
        parts.append(compile_node(child, depth + 1, _node_marker(child)))

    return '\n\n'.join(parts)


#: An ATX heading line (up to 6 hashes) with its text.
_ATX_HEADING_RE = re.compile(r'^(#{1,6})[ \t]+(.*)$')


def _endnote_entry(n):
    """One endnote line: "[N\\.]{#id} content" — a bracketed span carrying the
    anchor id wraps ONLY the note number, followed by the note text.

    Wrapping just the number means the anchor id is attached (pandoc turns the
    span id into a real bookmark/section the body's superscript link targets)
    AND the leading "N." cannot be read as an ordered-list marker — while the
    note text itself sits OUTSIDE the span, so a note whose text contains "[",
    "]", or unbalanced brackets can no longer break the anchor or leak a stray
    bracket. The number's dot is escaped so pandoc keeps it literal.

    A single SPACE separates the number from the text. LaTeX/Markdown keep it
    (the note reads "N. text"); the DOCX/ODT merges replace it with a tab in
    their endnote style, so it never shows up twice."""
    return (f'[{n["display"]}\\.]{{#notes-{n["anchor_id"]}}} {n["content"]}')


def render_notes_section(collected_notes, *, endnotes, global_footnotes,
                         numbering_levels, group_chapters=True):
    """The '# Notes' section markup for a set of collected notes, or ''.

    `collected_notes` maps a chapter heading to a list of note dicts (see
    process_chapter_footnotes). endnotes=False returns the footnote DEFINITIONS
    instead (no heading — pandoc consumes them into page-bottom footnotes);
    endnotes=True returns a visible Notes section, grouped per chapter when
    numbering is per-chapter. Shared by the outline compiler and the
    single-note path so both emit the identical structure.
    """
    if not collected_notes:
        return ''
    # When auto-numbering by level is on, the generated Notes headings must be
    # marked with the '* ' exception so number_headings leaves them unnumbered.
    star = '* ' if (numbering_levels and numbering_levels > 0) else ''
    if not endnotes:
        if global_footnotes:
            all_defs = []
            for notes_list in collected_notes.values():
                all_defs.extend(
                    f"[^{n['name']}]: {n['content']}" for n in notes_list)
            return "\n\n" + "\n\n".join(all_defs) + "\n\n"
        out = ""
        for _chapter, notes_list in collected_notes.items():
            defs = [f"[^{n['name']}]: {n['content']}" for n in notes_list]
            out += "\n\n" + "\n\n".join(defs) + "\n\n"
        return out
    if global_footnotes or not group_chapters:
        # One flat list: continuous numbering, or a single note with no
        # chapters to divide by.
        all_notes = []
        for notes_list in collected_notes.values():
            all_notes.extend(notes_list)
        body = "\n\n".join(_endnote_entry(n) for n in all_notes)
        return f"\n\n# {star}Notes\n\n{body}\n"
    out = f"\n\n# {star}Notes\n"
    for chapter_heading, notes_list in collected_notes.items():
        entries = "\n\n".join(_endnote_entry(n) for n in notes_list)
        out += f"\n\n## {star}{chapter_heading}\n\n{entries}\n"
    return out


def _split_h1_body(md_text):
    """Split markdown into (level-1 heading line or None, body) chunks.

    The text before the first level-1 heading comes back with a None heading
    (frontmatter/title block); each subsequent chunk starts at a '# …' line.
    Fenced code blocks are ignored, so a '#' inside code is not a heading.
    """
    chunks = []
    heading = None
    buf = []
    in_fence = False
    for line in md_text.split('\n'):
        if re.match(r'^\s*(?:```|~~~)', line):
            in_fence = not in_fence
        if not in_fence:
            m = re.match(r'^#(?!#)[ \t]+(.*)$', line)
            if m:
                chunks.append((heading, '\n'.join(buf)))
                heading = line
                buf = []
                continue
        buf.append(line)
    chunks.append((heading, '\n'.join(buf)))
    return chunks


def _heading_numbered_and_title(heading_line, numbering_levels):
    """From a level-1 heading (its markers still present), return
    (is_numbered, bare_title). Level-1 is always within any numbering depth, so
    the decision is _marker_is_numbered's ('@@' numbers in mode 0; '* ' is the
    exception in mode > 0), with the markers stripped from the title."""
    text = re.sub(r'^#[ \t]+', '', heading_line or '').strip()
    anchored = text.startswith('@@')
    if anchored:
        text = text[2:].strip()
    starred = False
    if numbering_levels and numbering_levels > 0 and re.match(r'^\*\s+', text):
        starred = True
        text = re.sub(r'^\*\s+', '', text, count=1)
    return _marker_is_numbered(anchored, starred, numbering_levels), text


def apply_note_style(md_text, *, endnotes=False, global_footnotes=False,
                     numbering_levels=0):
    """Build the visible '# Notes' section for endnote mode.

    Every footnote definition is matched to its ANCHOR BY NAME (not by order),
    so a definition may sit anywhere — including the citation notes that
    citations_to_footnotes appends at the very end. Notes are grouped by the
    chapter their anchor falls in, in reading order, so the Notes section and
    its '## <chapter>' groups mirror the document.

    endnotes=False returns the text unchanged: pandoc resolves plain footnote
    definitions wherever they sit, so the footnote path needs no restructuring.
    """
    if not endnotes:
        return md_text

    chunks = _split_h1_body(md_text)

    # Collect every definition by name, removing the definition lines. This is
    # a FULL pass first: definitions usually sit at the document end, so an
    # anchor in an earlier chapter can only be resolved once they're all known.
    def_pattern = re.compile(
        r"\[\^([^\]]+)\]:[ \t]*(.*?)(?=\n\[\^|\n\n|\Z)", re.DOTALL)
    def_map = {}

    def strip_defs(s):
        def repl(m):
            def_map.setdefault(m.group(1), m.group(2).strip())
            return ''
        return def_pattern.sub(repl, s)

    stripped_chunks = [(h, strip_defs(b)) for h, b in chunks]

    anchor_re = re.compile(r"\[\^([^\]]+)\](?!:)")
    out_sections = []
    collected = OrderedDict()
    chapter_n = 0
    global_ctr = [0]

    for heading, body in stripped_chunks:
        if heading is None:
            out_sections.append(body)
            continue
        numbered, title = _heading_numbered_and_title(heading, numbering_levels)
        if numbered:
            chapter_n += 1
            chapter_prefix = f"Ch_{chapter_n}"
            chapter_heading = f"Chapter {chapter_n}. {title}"
        else:
            chapter_prefix = sanitize_title(title)
            chapter_heading = title

        counter = [0]
        notes = []

        def repl(m):
            name = m.group(1)
            content = def_map.get(name)
            if content is None:
                return m.group(0)  # no matching definition — leave the anchor
            if global_footnotes:
                global_ctr[0] += 1
                disp, anchor_id = global_ctr[0], str(global_ctr[0])
            else:
                counter[0] += 1
                disp, anchor_id = counter[0], f"{chapter_prefix}-{counter[0]}"
            notes.append({'name': name, 'display': disp,
                          'anchor_id': anchor_id, 'content': content})
            return f'[^{disp}^](#notes-{anchor_id})'

        body = anchor_re.sub(repl, body)
        out_sections.append(heading + '\n' + body)
        if notes:
            collected.setdefault(chapter_heading, []).extend(notes)

    final_text = '\n\n'.join(s for s in out_sections if s.strip() != '')
    if collected:
        final_text += render_notes_section(
            collected, endnotes=True, global_footnotes=global_footnotes,
            numbering_levels=numbering_levels)
        _total = sum(len(v) for v in collected.values())
        print(f"Added Notes section ({_total} note(s) in "
              f"{len(collected)} chapter(s))")
    return re.sub(r'\n{3,}', '\n\n', final_text)


def finalize_markdown(md_text, *, numbering_levels=0, endnotes=False,
                      global_footnotes=False):
    """The ONE place every exported document's markdown is finalised.

    Compilation (compile_book) does exactly one thing — assemble linked notes
    into one markdown document, keeping the author's @@/* markers and footnote
    syntax untouched. Everything else happens here, on the FINAL markdown, so an
    outline's compiled output and a single note written as a whole book go
    through the identical steps:

      1. footnote handling — each level-1 chapter's footnote definitions become
         either plain definitions (native page-bottom footnotes) or a visible
         '# Notes' section divided by chapter;
      2. heading numbering (number_headings), which also strips the markers.

    Order matters: the Notes section is built BEFORE numbering so it can carry
    the '* ' unnumbered marker, and numbering then consumes every marker.
    Returns the finalised markdown.
    """
    if endnotes:
        # Visible '# Notes' section: definitions matched to anchors by name so
        # citation notes appended at the document end group under their chapter.
        final_text = apply_note_style(
            md_text, endnotes=True, global_footnotes=global_footnotes,
            numbering_levels=numbering_levels)
        final_text = number_headings(final_text, numbering_levels)
        return re.sub(r'\n{3,}', '\n\n', final_text)

    chunks = _split_h1_body(md_text)

    # ── Footnote handling, grouped by chapter ────────────────────────────────
    out_sections = []
    collected_notes = OrderedDict()
    chapter_n = 0
    global_counter = 0
    for heading, body in chunks:
        if heading is None:
            out_sections.append(body)
            continue
        numbered, title = _heading_numbered_and_title(heading, numbering_levels)
        if numbered:
            chapter_n += 1
            chapter_prefix = f"Ch_{chapter_n}"
            chapter_heading = f"Chapter {chapter_n}. {title}"
        else:
            chapter_prefix = sanitize_title(title)
            chapter_heading = title
        processed, notes, count = process_chapter_footnotes(
            body, chapter_prefix, chapter_heading,
            global_footnotes, global_counter, endnotes=endnotes)
        if global_footnotes:
            global_counter += count
        out_sections.append(heading + '\n' + processed)
        if notes:
            collected_notes.setdefault(chapter_heading, []).extend(notes)

    final_text = '\n\n'.join(s for s in out_sections if s.strip() != '')

    if collected_notes:
        final_text += render_notes_section(
            collected_notes, endnotes=endnotes,
            global_footnotes=global_footnotes,
            numbering_levels=numbering_levels)
        print(f"Added footnote definitions for "
              f"{len(collected_notes)} chapter(s)")

    # ── Whole-document numbering (consumes the @@/* markers) ─────────────────
    final_text = number_headings(final_text, numbering_levels)

    return re.sub(r'\n{3,}', '\n\n', final_text)


def write_intermediate(source_path, markdown, *, compiled=False, output_dir=None):
    """Write the ONE intermediate file for an export and return its path.

    The user's source is NEVER touched (an outline's source is its bullet list;
    a single note is a real note the user keeps editing). Named
    "<stem> - compiled.md" when the text was compiled from an outline, else
    "<stem> - export.md" (a working copy of the note for this export).

    Everything before this — compiling and every transformation — is done in
    memory on plain markdown text; this is the only write.
    """
    source = Path(source_path)
    out_dir = Path(output_dir).expanduser() if output_dir else source.parent
    out_dir.mkdir(parents=True, exist_ok=True)
    suffix = 'compiled' if compiled else 'export'
    dest = out_dir / f'{source.stem} - {suffix}.md'
    dest.write_text(markdown, encoding='utf-8')
    return dest


def number_headings(md_text, numbering_levels=0):
    """Number the headings of a FINAL compiled document, in place.

    This is the single numbering decision, applied after compilation so a
    heading is numbered by where it sits in the finished document — including
    headings that came from inside an included note, which the outline-level
    numbering of the old compiler could never see.

    Markers kept by compile_node are consumed:
      '@@'  → this heading is numbered (numbering_levels == 0 mode).
      '* '  → this heading is an UNNUMBERED exception (numbering_levels > 0).

    numbering_levels == 0: only '@@'-marked headings are numbered.
    numbering_levels  > 0: every heading down to that depth is numbered; '@@'
                          is ignored and '* ' is the exception.

    Labels follow _number_label: a level-1 number reads "Chapter N.", and a
    heading nested under a numbered ancestor inherits its path ("1.1"), while
    one under an unnumbered heading starts a fresh bare number ("1."). The
    parent is the nearest numbered ancestor in the document, exactly as the old
    tree walk defined it (an unnumbered heading still breaks the chain for its
    own children). Fenced code blocks are skipped; YAML frontmatter has no
    headings and passes through untouched.
    """
    lines = md_text.split('\n')
    out = []
    in_fence = False
    fence_re = re.compile(r'^\s*(?:```|~~~)')
    # Stack of every open heading: (level, path_or_None, numbered_child_count).
    stack = []
    root_count = 0

    for line in lines:
        if fence_re.match(line):
            in_fence = not in_fence
            out.append(line)
            continue
        if in_fence:
            out.append(line)
            continue
        m = _ATX_HEADING_RE.match(line)
        if not m:
            out.append(line)
            continue

        level = len(m.group(1))
        text = m.group(2).strip()
        has_anchor = False
        if text.startswith('@@'):
            has_anchor = True
            text = text[2:].strip()
        starred = False
        if numbering_levels and numbering_levels > 0 and re.match(r'^\*\s+', text):
            starred = True
            text = re.sub(r'^\*\s+', '', text, count=1)

        while stack and stack[-1][0] >= level:
            stack.pop()
        parent = stack[-1] if stack else None

        if numbering_levels and numbering_levels > 0:
            numbered = level <= numbering_levels and not starred
        else:
            numbered = has_anchor

        if numbered:
            if parent is not None:
                parent[2] += 1
                n, parent_path = parent[2], parent[1]
            else:
                root_count += 1
                n, parent_path = root_count, None
            label, path = _number_label(level, n, parent_path)
            stack.append([level, path, 0])
            out.append('#' * level + ' ' + label + ' ' + text)
        else:
            stack.append([level, None, 0])
            out.append('#' * level + ' ' + text)

    return '\n'.join(out)

def _number_label(depth, n, parent_path):
    """The literal number and numeric path to print before a @@ heading.

    depth 1                   -> ("Chapter N.", (n,))
    nested under a numbered parent -> ("<parent>.<n>", parent_path + (n,))
    otherwise                 -> ("N.", (n,))  — a fresh number that isn't
                                 under a number, so e.g. sections under an
                                 unnumbered Introduction read "1.", "2."
                                 rather than colliding with Chapter 1's "1.1".
    """
    if parent_path:
        display = '.'.join(str(p) for p in parent_path + (n,))
        return display, parent_path + (n,)
    if depth == 1:
        return f'Chapter {n}.', (n,)
    return f'{n}.', (n,)


def run_selftest():
    """Assert the @@ numbering rule and the heading->LaTeX rule.

    Runnable with ``DocumentCompiler.py --selftest x`` (the positional master
    file is ignored). Exists because this project has no Python test runner;
    these are the pure functions most likely to regress silently, and a wrong
    number or a missing \\addcontentsline is invisible until a PDF is opened.
    Returns 0 when every check passes, 1 otherwise.
    """
    failures = []

    def check(name, got, want):
        if got != want:
            failures.append(f'{name}\n    got:  {got!r}\n    want: {want!r}')

    # ── Numbering rule (via _number_label directly) ──────────────────────────
    check('L1 first', _number_label(1, 1, None), ('Chapter 1.', (1,)))
    check('L1 second', _number_label(1, 2, None), ('Chapter 2.', (2,)))
    check('L2 under numbered L1',
          _number_label(2, 1, (1,)), ('1.1', (1, 1)))
    check('L3 under numbered L1/L2',
          _number_label(3, 2, (1, 1)), ('1.1.2', (1, 1, 2)))
    check('L2 under UNnumbered L1 (fresh, not 0.x)',
          _number_label(2, 1, None), ('1.', (1,)))

    # ── numbering decision (mode 0: @@ only; mode >0: all but '* ') ──────────
    check('nl=0: @@ numbered', _marker_is_numbered(True, False, 0), True)
    check('nl=0: plain unnumbered', _marker_is_numbered(False, False, 0), False)
    check('nl=2: plain numbered', _marker_is_numbered(False, False, 2), True)
    check('nl=2: @@ also numbered', _marker_is_numbered(True, False, 2), True)
    check('nl=2: star is the exception',
          _marker_is_numbered(False, True, 2), False)

    # _heading_numbered_and_title extracts the marker + bare title (level 1).
    check('heading @@ numbered, title stripped',
          _heading_numbered_and_title('# @@ The Tarbiya Process', 0),
          (True, 'The Tarbiya Process'))
    check('heading plain unnumbered (mode 0)',
          _heading_numbered_and_title('# Preface', 0), (False, 'Preface'))
    check('heading plain numbered (mode 2)',
          _heading_numbered_and_title('# Chapter One', 2),
          (True, 'Chapter One'))
    check('heading * exception (mode 2)',
          _heading_numbered_and_title('# * Preface', 2), (False, 'Preface'))

    # parse_outline strips the '* ' marker ONLY when numbering-levels is on.
    tree = parse_outline('- * Preface\n- Chapter One\n  - Section A\n', 2)
    check('nl>0: star stripped + flagged',
          (tree[0]['text'], tree[0]['starred']), ('Preface', True))
    check('nl>0: unmarked heading intact', tree[1]['text'], 'Chapter One')
    check('nl=0: "*" is not a marker',
          parse_outline('- *Preface*\n', 0)[0]['text'], '*Preface*')

    # ── endnotes: visible Notes stream (superscript anchor, no definition) ────
    import io as _io
    import contextlib as _ctx
    with _ctx.redirect_stdout(_io.StringIO()):
        en_md, en_notes, en_n = process_chapter_footnotes(
            'Body.[^a]\n\n[^a]: A note.', 'Ch_1', 'Chapter 1. X',
            global_footnotes=False, global_counter=0, endnotes=True)
    check('endnotes: anchor becomes superscript link down to the note',
          '[^1^](#notes-Ch_1-1)' in en_md and '[^a]' not in en_md, True)
    check('endnotes: definition removed', '[^a]:' in en_md, False)
    check('endnotes: note captured',
          (en_n, en_notes[0]['content']), (1, 'A note.'))
    check('endnotes: anchor id chapter-qualified',
          en_notes[0]['anchor_id'], 'Ch_1-1')

    # ── number_headings: whole-document numbering by final position ─────────
    nh_in = ('# @@ Chapter One\n'
             '## @@ Section A\n'
             '### Deep\n'
             '## @@ Section B\n'
             '# Preface\n'
             '## @@ Fresh\n'
             '# @@ Chapter Two\n'
             '## @@ Section C\n')
    nh = number_headings(nh_in, 0)
    check('nh=0: level-1 chapter', '# Chapter 1. Chapter One' in nh, True)
    check('nh=0: nested section', '## 1.1 Section A' in nh, True)
    check('nh=0: unmarked deeper heading untouched', '### Deep' in nh, True)
    check('nh=0: second section', '## 1.2 Section B' in nh, True)
    check('nh=0: unmarked chapter left alone', '# Preface' in nh, True)
    check('nh=0: fresh number under unnumbered parent',
          '## 1. Fresh' in nh, True)
    check('nh=0: second chapter', '# Chapter 2. Chapter Two' in nh, True)
    check('nh=0: section under second chapter', '## 2.1 Section C' in nh, True)
    check('nh=0: no @@ markers left', '@@' in nh, False)
    # With numbering-levels 0 the '* ' marker has no meaning and is left as-is.
    check('nh=0: star not a marker', number_headings('# * X\n', 0).strip(), '# * X')

    # numbering-levels > 0: auto-number by depth, '* ' is the exception.
    nh2 = number_headings(
        '# Chapter One\n## Section A\n### Deep\n# * Preface\n## Topic\n', 2)
    check('nh=2: chapter auto-numbered', '# Chapter 1. Chapter One' in nh2, True)
    check('nh=2: section auto-numbered', '## 1.1 Section A' in nh2, True)
    check('nh=2: depth 3 untouched', '### Deep' in nh2, True)
    check('nh=2: star exception', '# Preface' in nh2, True)
    check('nh=2: fresh under starred', '## 1. Topic' in nh2, True)
    # An unnumbered heading still breaks the parent chain for its children.
    nh3 = number_headings('# @@ A\n## Plain\n### @@ Sub\n', 0)
    check('nh: unnumbered breaks parent chain', '### 1. Sub' in nh3, True)

    # ── Heading -> LaTeX: star pattern and chapter-number stripping ──────────
    book_in = ('# Chapter 1. The *Tarbiya* Process\n'
               '## 1.1 Some section\n'
               '# Preface\n'
               '## 1. Topic\n')
    out = latexize_headings(book_in, is_book=True)
    check('numbered chapter -> \\chapter (no star, label stripped)',
          '\\chapter{The \\textit{Tarbiya} Process}' in out, True)
    check('numbered chapter keeps no literal "Chapter 1."',
          'Chapter 1.' in out, False)
    check('unnumbered chapter -> \\chapter*',
          '\\chapter*{Preface}' in out, True)
    check('section -> \\section keeping literal number (LaTeX adds the TOC entry)',
          '\\section{1.1 Some section}' in out, True)
    check('section gets NO manual TOC entry (LaTeX adds it)',
          '\\addcontentsline{toc}{section}' in out, False)
    check('numbered chapter does NOT get a manual TOC entry '
          '(\\chapter adds its own)',
          '\\addcontentsline{toc}{chapter}{The \\textit{Tarbiya} Process}' in out,
          False)

    # document/article: no chapters, so even a "Chapter 1." heading is unstarred
    # (level 1 becomes \section) — only books auto-number chapters.
    doc_out = latexize_headings('# Chapter 1. T\n## 1.1 S\n', is_book=False)
    check('document: level 1 is \\section', '\\section{Chapter 1. T}' in doc_out, True)

    if failures:
        print(f'SELFTEST FAILED ({len(failures)}):\n')
        for f in failures:
            print('  ✗ ' + f)
        return 1
    print('SELFTEST PASSED (numbering + heading->LaTeX rules)')
    return 0

def compile_book(master_file_path):
    """Compile an outline into ONE markdown document (returned as TEXT).

    Compilation does exactly one thing: assemble linked notes. It strips each
    included note's YAML, demotes its headings to sit under its outline
    position, and copies the note bodies in, keeping the author's @@/* markers
    and footnote syntax verbatim. It does NOT number headings, move footnotes
    into a Notes section, or rewrite poetry/embeds — all of that happens in the
    shared post-compile stage (finalize_markdown) that single notes also use, so
    an outline and a whole book written in one note come out identically.

    Nothing is written here; the caller writes the one intermediate via
    write_intermediate after finalize_markdown.
    """
    master_file_path = Path(master_file_path).expanduser()
    text = master_file_path.read_text(encoding="utf-8")

    # Keep the outline's own frontmatter (title/author/…) at the top.
    yaml_block, body = extract_yaml(text)

    output_sections = []
    tree = parse_outline(body)

    for node in tree:
        # Compile this node (heading + any linked content) and its children.
        # The author's @@/* intent is kept in the heading for the numbering
        # stage; the node's text names its section in the log.
        print(f"\n{'='*60}")
        print(f"Processing: {node['text']}")
        print(f"{'='*60}")
        section_text = compile_node(node, 1, _node_marker(node))
        print(f"  Added main section: {node['text']}")
        output_sections.append(section_text)

    final_text = ''
    if yaml_block:
        final_text += f"---\n{yaml_block}\n---\n\n"
    final_text += "\n\n".join(output_sections)
    return re.sub(r'\n{3,}', '\n\n', final_text)

_OUTLINE_LIST_ITEM_RE = re.compile(r'^([-*+]|\d+[.)])\s')
_OUTLINE_INCLUDE_RE = re.compile(r'^\[\[([^\[\]]+)\]\]$')


def outline_bullet_is_include(item: str) -> bool:
    """True when a bullet's text is a single non-citekey wikilink — the same
    rule parse_outline uses to decide a bullet is a note include. `item` must
    already have its list marker stripped."""
    rest = re.sub(r'^x\s*', '', item)
    if rest.startswith('@@'):
        rest = rest[2:].strip()
    m = _OUTLINE_INCLUDE_RE.match(rest.strip())
    return bool(m and not m.group(1).strip().startswith('@'))


def detect_outline(text: str) -> bool:
    """Structural check for an OUTLINE (needs compiling) vs a compiled note or
    a plain note that should just be rendered.

    An outline is a document whose body is made up ENTIRELY of list items —
    no ordinary prose paragraphs — and that contains at least one note
    INCLUDE: a bullet that is a single `[[wikilink]]` (the includes may sit
    beneath plain-text heading bullets). A bullet list inside an ordinary note
    is NOT an outline: a prose paragraph anywhere disqualifies the document,
    and a list of only plain-text/topic bullets has no includes, hence no note
    content to compile. Explicit `template: compile-<name>` still overrides
    this (see main())."""
    _, body = extract_yaml(text)
    has_include = False
    for raw in body.splitlines():
        if not raw.strip():
            continue
        stripped = raw.lstrip()
        # Any ATX heading means the document is already compiled.
        if stripped.startswith('#'):
            return False
        # Indented continuation of a list item (or a block scalar) — not prose.
        if raw[:1] in (' ', '\t') and not _OUTLINE_LIST_ITEM_RE.match(stripped):
            continue
        if _OUTLINE_LIST_ITEM_RE.match(stripped):
            item = _OUTLINE_LIST_ITEM_RE.sub('', stripped, count=1).strip()
            if outline_bullet_is_include(item):
                has_include = True
            continue
        # Footnote definitions and horizontal rules don't disqualify.
        if stripped.startswith('[^') or re.fullmatch(r'([-*_])\1{2,}', stripped):
            continue
        # Any other non-indented line is an ordinary prose paragraph.
        return False
    return has_include

def read_yaml_prop(yaml_block, prop: str):
    m = re.search(rf'^{prop}:[^\S\n]*["\']?([^"\'\n]+)', yaml_block, re.M)
    return m.group(1).strip() if m else None

def rewrite_compiled_template_prop(text, template_name: str):
    """After compiling an outline whose template was 'compile-<name>', the
    compiled output should carry 'template: <name>' (without the prefix) so a
    later export uses the real template name. Text-in/text-out (the caller owns
    writing the intermediate)."""
    new_text, n = re.subn(r'^(template:\s*["\']?)(?:compile-)?[^"\'\n]+',
                          rf'\g<1>{re.escape(template_name)}',
                          text, count=1, flags=re.M)
    if n:
        print(f"  template: compile-{template_name} → template: {template_name}")
        return new_text
    return text

def _yaml_block(text, pos, indicator):
    """Read a YAML block scalar (|, |-, >, >-) starting at pos in text.

    pos  — character position just after the key's line (i.e. m.end() from the
           key regex), so the very next lines are the block content.
    indicator — the raw matched token, e.g. '|-' or '>'.

    Returns the block content as a string (newlines joined for literal, spaces
    for folded), or None if no indented lines are found.
    """
    folded = indicator.startswith('>')
    after = text[pos:]
    block_lines = []
    for line in after.splitlines():
        if re.match(r'^\s', line):
            block_lines.append(line.strip())
        elif not line.strip():
            if block_lines:
                block_lines.append('')  # keep internal blank lines for literal
        else:
            break  # non-indented, non-blank line ends the block
    # Strip trailing blank lines (|- / >- semantics)
    while block_lines and block_lines[-1] == '':
        block_lines.pop()
    if not block_lines:
        return None
    if folded:
        return ' '.join(l for l in block_lines if l)
    else:
        return '\n'.join(block_lines)


def _yaml_scalar(text, key):
    """Read a top-level YAML property `key` from frontmatter `text`, handling
    ALL three forms a hand-edited (or importer-written) property can take:
      - inline scalar:  title: My Title        → "My Title"
      - block scalar:   author: |-            → the indented lines (via
                                                     _yaml_block; a one-line
                                                     regex would return "|-")
      - list:           author:                  → items joined with ", "
                          - Jane Doe
    Returns a string, or None when the property is absent/empty.
    """
    m = re.search(r'^' + re.escape(key) + r':[^\S\n]*(.*)$', text, re.M)
    if not m:
        return None
    raw = m.group(1).strip()
    if raw.startswith('|') or raw.startswith('>'):
        return _yaml_block(text, m.end(), raw) or None
    if raw:
        return raw.strip('"\'') or None
    items = []
    for line in text[m.end():].splitlines():
        if re.match(r'^[^\S\n]*-\s+', line):
            items.append(re.sub(r'^[^\S\n]*-\s+', '', line).strip().strip('"\''))
        elif line.strip() == '':
            if items:
                break
            continue
        else:
            break
    return ', '.join(items) if items else None


def _yaml_int(text, key, default=0):
    """Read an integer frontmatter property, tolerating the quoted form
    Obsidian's property editor writes (``numbering-levels: "2"``). Returns
    `default` when absent or not an integer."""
    val = _yaml_scalar(text, key)
    if val is None:
        return default
    try:
        return int(str(val).strip())
    except (TypeError, ValueError):
        return default


def _yaml_bool(text, key, default=False):
    """Read a boolean frontmatter property (true/false, yes/no, on/off, 1/0).
    Returns `default` when absent or unrecognised."""
    val = _yaml_scalar(text, key)
    if val is None:
        return default
    v = str(val).strip().lower()
    if v in ('true', 'yes', 'on', '1'):
        return True
    if v in ('false', 'no', 'off', '0'):
        return False
    return default


def _yaml_endnotes_mode(text, default='none'):
    """Read the tri-state `endnotes` property: none / native / body.

    Accepts the historical boolean too (true → native, false → none) so a note
    written before the tri-state option keeps working.
    """
    val = _yaml_scalar(text, 'endnotes')
    if val is None:
        return default
    v = str(val).strip().lower()
    if v in ('none', 'false', 'no', 'off', '0', ''):
        return 'none'
    if v in ('native', 'true', 'yes', 'on', '1'):
        return 'native'
    if v in ('body', 'paragraphs', 'chapters'):
        return 'body'
    return default


def resolve_template_dir(template_dir, vault_root):
    """Resolve the user's templates directory from explicit arg → env → vault."""
    if template_dir is None:
        template_dir = os.environ.get('SW_TEMPLATES_DIR', '')
    if not template_dir:
        vault_tpl_dir = os.path.join(vault_root, 'Export Templates')
        if os.path.isdir(vault_tpl_dir):
            template_dir = vault_tpl_dir
    return template_dir


def resolve_intermediate_format(raw_tpl, template_dir, vault_root=None):
    """The PDF intermediate format ('docx' / 'odt' / 'latex') for a template.

    Shared by export_pdf's auto-detection and main()'s endnotes decision, so
    both agree on whether a PDF export goes through LaTeX. An explicit template
    filename from the export dialog ("book.docx" / "book.odt" / "book.tex")
    IS the intended format; a bare name (from frontmatter) prefers ODT, then
    DOCX, then LaTeX — matching the historical default.
    """
    ext_m = re.search(r'\.(docx|odt|tex)$', raw_tpl or '', flags=re.IGNORECASE)
    if ext_m:
        ext = ext_m.group(1).lower()
        return 'latex' if ext == 'tex' else ext
    tpl = raw_tpl or ''
    if template_dir is None:
        template_dir = resolve_template_dir(None, vault_root or vault_rel())
    def _has(ext):
        cands = []
        if template_dir:
            cands.append(os.path.join(template_dir, f'{tpl}{ext}'))
        cands.append(plugin_template_path(f'{tpl}{ext}'))
        return any(os.path.exists(c) for c in cands)
    return ('odt' if _has('.odt')
            else 'docx' if _has('.docx')
            else 'latex' if _has('.tex')
            else 'docx')


def find_user_lua_filters(template_dir):
    """Return sorted list of *.lua files in template_dir, skipping built-in names."""
    if not template_dir or not os.path.isdir(template_dir):
        return []
    builtin = {'sw-doc-title.lua', 'sw-callouts.lua', 'sw-export.lua', 'sw-poetry.lua', 'sw-bidi.lua', 'sw-zotero.lua'}
    result = []
    for f in sorted(os.listdir(template_dir)):
        if f.lower().endswith('.lua') and f not in builtin:
            result.append(os.path.join(template_dir, f))
    return result


def load_mappings(template_dir, mappings_json=None):
    """Return list of (source, styleName) pairs from --mappings JSON arg or
    mappings.json file (for backwards compatibility). The JSON arg takes
    priority. Returns [] when nothing is configured.

    --mappings JSON format (from TypeScript):
      [{"source": "arabic-poetry", "styleName": "Arabic poetry"}, ...]

    Legacy mappings.json file format:
      {"callouts": {"arabic-poetry": "ArabicPoetry"}, "divClasses": {...}}
    """
    import json
    if mappings_json:
        try:
            data = json.loads(mappings_json)
            result = [
                (m['source'], m['styleName'])
                for m in data
                if m.get('source') and m.get('styleName')
            ]
            if result:
                return result
        except Exception as e:
            print(f'WARNING: could not parse --mappings JSON: {e}')
    # Fall back to mappings.json file (legacy / manual workflow)
    if not template_dir:
        return []
    mappings_path = os.path.join(template_dir, 'mappings.json')
    if not os.path.exists(mappings_path):
        return []
    try:
        import json as _json
        with open(mappings_path, encoding='utf-8') as f:
            data = _json.load(f)
        all_styles = {**data.get('divClasses', {}), **data.get('callouts', {})}
        return list(all_styles.items())
    except Exception as e:
        print(f'WARNING: could not read mappings.json: {e}')
        return []


def preprocess_md_syntax(text: str) -> str:
    """Convert Markdown Attributes and Extended Markdown Syntax inline spans to
    pandoc bracketed spans ([text]{.class}) so the mappings Lua filter can
    apply character styles.

    Markdown Attributes plugin — class sits INSIDE the closing delimiter:
      *text{.cls}*        →  [*text*]{.cls}
      **text{.cls}**      →  [**text**]{.cls}
      ***text{.cls}***    →  [***text***]{.cls}
      `text{.cls}`        →  [`text`]{.cls}
      ==text{.cls}==      →  [==text==]{.cls}

    Extended Markdown Syntax plugin:
      !!{cls}text!!       →  [text]{.cls}
      ++text++            →  [text]{.inserted}
      =={color}text==     →  [text]{.highlight-<color>}
                             (leading '#' stripped; spaces → hyphens)
    """
    # Markdown Attributes: class INSIDE the closing delimiter.
    # Process longest delimiter first to avoid partial-match issues (*** > ** > *).
    # The inner group uses [^*\n]* rather than .*? to avoid "bleeding" across
    # other italic/bold markers in the same paragraph.  Without this restriction,
    # a line such as "*word1* more *word2{.cls}*" would match from the first *
    # all the way to {.cls}*, wrapping the entire intervening text in the span.
    for delim in ('***', '**', '*'):
        esc = re.escape(delim)
        text = re.sub(
            rf'{esc}([^*\n]*?)\{{\.([^}}\n]+)\}}{esc}',
            lambda m, d=delim: f'[{d}{m.group(1)}{d}]{{.{m.group(2)}}}',
            text
        )
    # Backtick code span with class.
    text = re.sub(
        r'`([^`\n]*?)\{\.([^}\n]+)\}`',
        lambda m: f'[`{m.group(1)}`]{{.{m.group(2)}}}',
        text
    )
    # Highlight with class (Markdown Attributes): ==text{.cls}== — class is
    # at the end of the content, before the closing ==.
    text = re.sub(
        r'==([^=\n]*?)\{\.([^}\n]+)\}==',
        lambda m: f'[=={m.group(1)}==]{{.{m.group(2)}}}',
        text
    )
    # Extended Markdown: !!{cls}text!! → [text]{.cls}
    text = re.sub(
        r'!!\{([^}\n]+)\}([^!\n]+)!!',
        lambda m: f'[{m.group(2)}]{{.{m.group(1)}}}',
        text
    )
    # Extended Markdown: ++text++ → [text]{.inserted}
    text = re.sub(
        r'\+\+([^+\n]+)\+\+',
        lambda m: f'[{m.group(1)}]{{.inserted}}',
        text
    )
    # Extended Markdown: =={color}text== → [text]{.highlight-color}
    # Strip leading '#'; replace spaces with hyphens for a valid CSS class name.
    text = re.sub(
        r'==\{([^}\n]+)\}([^=\n]+)==',
        lambda m: (
            f'[{m.group(2)}]'
            f'{{.highlight-{m.group(1).lstrip("#").replace(" ", "-")}}}'
        ),
        text
    )
    return text


def ensure_blank_before_headings(text: str) -> str:
    """Obsidian renders any line starting with '# ' as a heading regardless of
    what precedes it. Pandoc (treating single newlines as soft breaks) folds a
    heading that directly follows a paragraph or list item into that block as
    literal text — "# Research Process" ends up mid-sentence. Insert a blank
    line before every ATX heading that isn't already preceded by one. (Pandoc's
    +lists_without_preceding_blankline extension already covers the mirror-image
    problem for lists.) Lines inside fenced code blocks are left untouched so a
    '# comment' in a code sample is never treated as a heading.
    """
    out = []
    fence = None          # opening fence marker while inside a code block
    prev_blank = True     # start of file behaves as if preceded by a blank line
    for line in text.split('\n'):
        fence_m = re.match(r'\s*(`{3,}|~{3,})', line)
        if fence is not None:
            out.append(line)
            if fence_m and fence_m.group(1)[0] == fence[0] \
                    and len(fence_m.group(1)) >= len(fence):
                fence = None
            prev_blank = False
            continue
        if fence_m:
            fence = fence_m.group(1)
            out.append(line)
            prev_blank = False
            continue
        if re.match(r'#{1,6} ', line) and not prev_blank:
            out.append('')
        out.append(line)
        prev_blank = not line.strip()
    return '\n'.join(out)


#: A bracketed pandoc citation containing an @citekey — e.g. [@key],
#: [see @key, 45], [@a; @b], [-@key]. Excludes ] and newlines (pandoc
#: citations never contain either).
_BRACKET_CITE_RE = re.compile(
    r'[ \t]*'
    r'(?P<cite>\[[^\[\]\n]*?-?@[A-Za-z][\w:.#$%&+?<>~/-]*[^\[\]\n]*\])'
    r'(?P<trail>["\'“”‘’]?[.,;:!?]*["\'”’]?)'
)


def _sub_line_citations(line, defs, counter):
    """Rewrite bracketed citations on one line to footnote references,
    skipping inline-code spans. Appends `[^zoterociteN]: <citation>` strings
    to `defs`."""
    def repl(m):
        counter[0] += 1
        label = 'zoterocite%d' % counter[0]
        defs.append('[^%s]: %s' % (label, m.group('cite')))
        # Trailing sentence punctuation moves BEFORE the marker (Zotero's own
        # note conversion leaves it after — this is the fix).
        return '%s[^%s]' % (m.group('trail'), label)

    parts = re.split(r'(`+[^`]*`+)', line)  # keep code spans as odd segments
    for i in range(0, len(parts), 2):
        parts[i] = _BRACKET_CITE_RE.sub(repl, parts[i])
    return ''.join(parts)


def citations_to_footnotes(text):
    """For a note/footnote citation style: move every in-text bracketed
    citation into a real footnote — `word [@key].` becomes `word.[^zoterociteN]`
    plus an appended `[^zoterociteN]: [@key]` definition. Pandoc then renders
    proper footnotes, and sw-zotero.lua converts the [@key] inside each one to
    a Zotero field — matching the structure Zotero produces when a document is
    switched to a note style, and fixing the punctuation placement Zotero
    leaves wrong.

    Skips fenced code, inline code, existing footnote definitions (a citation
    there is already in a note), and heading lines.
    """
    lines = text.split('\n')
    out, defs, counter = [], [], [0]
    fence = None
    in_fndef = False
    for line in lines:
        stripped = line.lstrip()
        fence_m = re.match(r'(`{3,}|~{3,})', stripped)
        if fence is not None:
            out.append(line)
            if fence_m and stripped.startswith(fence):
                fence = None
            continue
        if fence_m:
            fence = fence_m.group(1)
            out.append(line)
            continue
        if re.match(r'[ \t]*\[\^[^\]\n]+\]:', line):
            in_fndef = True
            out.append(line)
            continue
        if in_fndef:
            if line.strip() == '' or line[:1] in (' ', '\t'):
                out.append(line)
                continue
            in_fndef = False
        if re.match(r'#{1,6} ', line):
            out.append(line)
            continue
        out.append(_sub_line_citations(line, defs, counter))
    if defs:
        if out and out[-1].strip() != '':
            out.append('')
        out.extend(defs)
    return '\n'.join(out)


def generate_mappings_filter(mappings_data, auto_name=True):
    """Given a list of (source, styleName) pairs, generate a temporary Lua
    filter that applies custom-style attributes. Returns the path to the temp
    .lua file, or None when mappings_data is empty and auto_name is False.

    source:    callout type or CSS class name (e.g. "arabic-poetry")
    styleName: human-readable style name as in the template (e.g. "Arabic poetry")
    auto_name: when True, any class/callout not in the explicit mapping table
               is auto-named by capitalising the first letter and replacing
               hyphens with spaces ("quran-quote" → "Quran quote").
    """
    import tempfile
    if not mappings_data and not auto_name:
        return None

    entries = '\n'.join(
        f'  ["{src}"] = "{sty}",'
        for src, sty in (mappings_data or [])
    )
    auto_name_lua = 'true' if auto_name else 'false'
    lua_code = f"""-- Auto-generated by ScholarWeft (style mappings)
local CLASS_STYLES = {{
{entries}
}}
local AUTO_NAME = {auto_name_lua}

-- Convert a CSS class to a human-readable style name when no explicit mapping
-- exists: capitalise the first character, replace hyphens with spaces.
local function auto_style_name(cls)
  return (cls:gsub("^%l", string.upper):gsub("%-", " "))
end

local function find_style(classes)
  for _, cls in ipairs(classes) do
    if CLASS_STYLES[cls] then return CLASS_STYLES[cls] end
    local bare = cls:match("^callout%-(.+)$")
    if bare and CLASS_STYLES[bare] then return CLASS_STYLES[bare] end
  end
  if AUTO_NAME then
    for _, cls in ipairs(classes) do
      if cls ~= '' then return auto_style_name(cls) end
    end
  end
  return nil
end

function Div(el)
  local style = find_style(el.classes)
  if not style then return nil end
  local result = {{}}
  pandoc.walk_block(el, {{
    Para = function(para)
      table.insert(result, pandoc.Div(
        {{pandoc.Para(para.content)}},
        pandoc.Attr("", {{}}, {{["custom-style"] = style}})
      ))
    end
  }})
  return #result > 0 and result or nil
end

-- Inline spans: applies the mapped (or auto-named) style as a character style.
function Span(el)
  local style = find_style(el.classes)
  if not style then return nil end
  el.attributes["custom-style"] = style
  -- *text*{{.class}} (Obsidian Markdown Attributes syntax) produces a Span
  -- whose sole content is an Emph or Strong node.  Unwrap it so the custom
  -- style is the ONLY formatting applied — not Emphasis + custom.  This
  -- mirrors the user's intent: the *...* is syntactic sugar for the span
  -- brackets, not a request for extra italic/bold on top of the custom style.
  if #el.content == 1 then
    local inner = el.content[1]
    if inner.t == 'Emph' or inner.t == 'Strong' then
      el.content = inner.content
    end
  end
  return el
end

-- Handle Obsidian callouts (> [!type] ...) that sw-poetry.lua did not claim
-- (i.e. non-poetry callouts mapped via explicit style mappings).
-- Pandoc 3.x may parse these as BlockQuote whose first block is a Header
-- (when the callout title line is rendered as a heading) or a Para.
function BlockQuote(el)
  local content = el.content
  if #content == 0 then return nil end
  local first = content[1]
  local s
  if first.t == "Para" or first.t == "Header" then
    s = pandoc.utils.stringify(first.content)
  else
    return nil
  end
  local marker = s:match("^%[!([^%]]+)%]")
  if not marker then return nil end
  local style = CLASS_STYLES[marker:lower()] or CLASS_STYLES["callout-" .. marker:lower()]
  if not style then return nil end
  local result = {{}}
  -- Wrap inlines in a custom-style Div.
  local function add_block(inlines)
    table.insert(result, pandoc.Div(
      {{pandoc.Para(inlines)}},
      pandoc.Attr("", {{}}, {{["custom-style"] = style}})
    ))
  end
  -- Recurse into any nesting depth to find leaf Para/Plain blocks.
  local function collect(blocks)
    for _, b in ipairs(blocks) do
      if b.t == "Para" or b.t == "Plain" then
        add_block(b.content)
      elseif b.t == "BulletList" or b.t == "OrderedList" then
        for _, item in ipairs(b.content) do
          collect(item)
        end
      elseif b.t == "BlockQuote" or b.t == "Div" then
        collect(b.content)
      end
    end
  end
  if #content == 1 and first.t == "Para" then
    -- All content is in one Para — skip past the marker (up to first SoftBreak)
    local after = pandoc.List()
    local past = false
    for _, inl in ipairs(first.content) do
      if not past then
        if inl.t == "SoftBreak" then past = true end
      else
        after:insert(inl)
      end
    end
    if #after > 0 then add_block(after) end
  else
    -- Multiple blocks: skip first (marker), recurse into the rest.
    local rest = {{}}
    for i = 2, #content do rest[#rest+1] = content[i] end
    collect(rest)
  end
  return #result > 0 and result or nil
end
"""
    tmp = tempfile.NamedTemporaryFile(
        mode='w', suffix='.lua', delete=False, encoding='utf-8')
    tmp.write(lua_code)
    tmp.close()
    print(f'Generated Lua mappings filter: {tmp.name}')
    return tmp.name


# Sentinel background colours — cycled across undefined styles so each one is
# visually distinct.  First colour (yellow) matches the previous single colour.
_SENTINEL_COLORS = ['#FFFF00', '#FFC080', '#80FF80', '#80DFFF', '#FFB0FF', '#FFDF80']

# Human-readable names of the paragraph styles that sw-poetry.lua always emits
# (regardless of explicit mappings). These must always be present in the
# reference doc so pandoc can apply them.
_SW_POETRY_PARAGRAPH_STYLES = ['Arabic poetry', 'English poetry']


def collect_span_styles(text, mappings_data, auto_name=True):
    """Scan preprocessed markdown text and return the deduplicated list of
    human-readable style names that will be applied by the Lua mappings filter —
    both explicit class→style mappings and auto-named styles from unrecognised
    CSS classes on bracketed spans and fenced divs.

    text:          the preprocessed citations markdown (after preprocess_md_syntax)
    mappings_data: list of (source, styleName) pairs from explicit mappings
    auto_name:     when True, unrecognised classes are auto-named (first letter
                   capitalised, hyphens → spaces), matching the Lua filter logic
    """
    cls_map = {}
    for src, sty in (mappings_data or []):
        cls_map[src] = sty
        if not src.startswith('callout-'):
            cls_map[f'callout-{src}'] = sty

    def auto_style_name(cls):
        return cls[0].upper() + cls[1:].replace('-', ' ') if cls else cls

    seen = set()
    styles = []

    def add_cls(cls):
        if not cls:
            return
        # Reject class names that don't look like valid CSS identifiers.
        # This prevents false matches from patterns like ][^1]{…} or ]{} that
        # could arise from footnote references or other markdown constructs.
        if not re.match(r'^[a-zA-Z_][a-zA-Z0-9_-]*$', cls):
            return
        if cls in cls_map:
            sty = cls_map[cls]
        elif auto_name:
            sty = auto_style_name(cls)
        else:
            return
        if sty not in seen:
            seen.add(sty)
            styles.append(sty)

    # Bracketed spans: [text]{.class1 .class2} — first class wins (mirrors Lua)
    for m in re.finditer(r'\]\{([^}]+)\}', text):
        for part in m.group(1).split():
            if part.startswith('.') and len(part) > 1:
                add_cls(part[1:])
                break

    # Fenced divs: :::class  or  ::: {.class}
    for m in re.finditer(r'^:::\s*(?:\{\.([^}\s]+)\}|(\S+))', text, re.MULTILINE):
        add_cls(m.group(1) or m.group(2))

    return styles


def _classify_style_names(style_names, defined, para_referenced, char_referenced,
                          span_styles, to_key):
    """Classify explicitly-named styles into paragraph vs character usage sets.

    Walks style_names, converting each to its output-key form via to_key, then
    checks membership in para_referenced / char_referenced.  span_styles is a
    secondary signal for the fallback case (key not found in either set):
    styles listed there are classified as character; everything else as paragraph.

    Returns (type_para, type_char) as sets of *human-readable* style names (the
    original values from style_names, not the key form), so callers can use the
    display name directly when building format-specific injection XML.

    to_key examples:
      ODT  — lambda n: n.replace(' ', '_20_')
      DOCX — lambda n: re.sub(r'\\s+', '', n)
    """
    type_para: set = set()
    type_char: set = set()
    span_set = set(span_styles or [])
    for n in style_names:
        key = to_key(n)
        if key in defined:
            continue
        is_para = key in para_referenced
        is_char = key in char_referenced
        if is_para:
            type_para.add(n)
        if is_char:
            type_char.add(n)
        if not is_para and not is_char:
            # Not seen in the output XML.  Use span_styles as a secondary
            # signal: styles the markdown uses as inline spans are character
            # styles; everything else falls back to paragraph.
            (type_char if n in span_set else type_para).add(n)
    return type_para, type_char


def inject_missing_odt_styles(odt_path, style_names=None, template_odt_path=None, span_styles=None):
    """Post-processing: scan the ODT output for every style actually referenced
    in content.xml, determine which are absent from the reference template, and
    inject a sentinel paragraph + character style (cycling background colour) for
    each.  Styles already defined in the template are left alone.

    style_names: optional extra list of human-readable names to also check —
                 useful when the Lua filter applied styles the scanner might miss.
                 If None/empty, auto-detection alone is used.
    template_odt_path: ODT whose styles.xml is treated as 'already defined'.
                       When absent, the output's own styles.xml is used instead
                       (in that case pandoc-generated stubs count as defined and
                       the caller should pass style_names for belt-and-suspenders).
    """
    import zipfile, shutil, tempfile

    def to_odt_name(s):
        return s.replace(' ', '_20_')
    def to_human(odt_name):
        return odt_name.replace('_20_', ' ')

    odt_path = Path(odt_path)

    # ── 1. determine which styles are already defined ─────────────────────────
    # Scan BOTH the template (named styles, display names) AND the output
    # (pandoc auto-styles merged into content.xml) so that:
    # - styles stored by LibreOffice with their display name (style:display-name)
    #   rather than the _20_-encoded internal name are recognised; and
    # - built-in LibreOffice styles (e.g. "List Number Tight") that pandoc
    #   auto-defines in content.xml (not present in the template's styles.xml)
    #   are treated as defined and not flagged as missing.
    ref_sources = []
    if template_odt_path and os.path.exists(template_odt_path):
        ref_sources.append(template_odt_path)
    out_path_str = str(odt_path)
    if out_path_str not in ref_sources:
        ref_sources.append(out_path_str)
    ref_text = ''
    for _rp in ref_sources:
        try:
            with zipfile.ZipFile(_rp, 'r') as z:
                ref_text += ''.join(
                    z.read(n).decode('utf-8')
                    for n in ['styles.xml', 'content.xml']
                    if n in z.namelist()
                )
        except Exception as _e:
            print(f'WARNING: could not read reference ODT {_rp}: {_e}')
    try:
        # LibreOffice ODTs sometimes store style:name with actual spaces
        # ("Arabic poetry") rather than _20_ encoding ("Arabic_20_poetry").
        # Also scan style:display-name so styles whose internal name differs
        # from their display name (e.g. style:name="ListNumberTight" with
        # style:display-name="List Number Tight") are still recognised.
        _raw_defined = (set(re.findall(r'style:name="([^"]+)"', ref_text))
                        | set(re.findall(r'style:display-name="([^"]+)"', ref_text)))
        defined = set()
        for _dn in _raw_defined:
            defined.add(_dn)
            defined.add(_dn.replace(' ', '_20_'))                   # spaces → _20_
            defined.add(_dn.replace('_20_', ' '))                   # _20_ → spaces
            defined.add(_dn.replace(' ', '').replace('_20_', ''))   # "Footnote Reference" → "FootnoteReference"
    except Exception as e:
        print(f'WARNING: could not build defined-styles set for sentinel check: {e}')
        defined = set()

    # ── 2. collect all text:style-name references from the output ─────────────
    try:
        with zipfile.ZipFile(odt_path, 'r') as z:
            out_content = (z.read('content.xml').decode('utf-8')
                           if 'content.xml' in z.namelist() else '')
    except Exception as e:
        print(f'WARNING: could not read output ODT content.xml: {e}')
        out_content = ''

    # Distinguish paragraph-style references (on text:p/text:h elements) from
    # character-style references (on text:span elements) so each missing style is
    # injected only as the type(s) it is actually used as in the output.
    para_referenced = set(re.findall(r'<text:(?:p|h)\b[^>]*\btext:style-name="([^"]+)"', out_content))
    char_referenced = set(re.findall(r'<text:span\b[^>]*\btext:style-name="([^"]+)"', out_content))

    # ── 3. compute the missing set, split by usage type ───────────────────────
    # When style_names is provided (always the case in the export pipeline),
    # check ONLY those explicitly-named styles (avoids spurious hits on
    # built-in LibreOffice TOC/heading styles resolved at render time).
    # Fall back to auto-scan only when style_names is None/empty.
    if style_names:
        # Classify via shared helper; returns human-readable name sets.
        # ODT key form is _20_-encoded (to_odt_name).
        _para_h, _char_h = _classify_style_names(
            style_names, defined, para_referenced, char_referenced,
            span_styles=span_styles, to_key=to_odt_name,
        )
        # Convert back to ODT key form for injection and membership tests below.
        type_para = {to_odt_name(n) for n in _para_h}
        type_char = {to_odt_name(n) for n in _char_h}
        missing_odt = sorted(type_para | type_char)
    else:
        # Auto-scan: only flag styles with _20_ in their ODT name (the reliable
        # marker for user-created named styles vs pandoc's short auto-style IDs).
        type_para = {n for n in para_referenced if n not in defined and '_20_' in n}
        type_char = {n for n in char_referenced if n not in defined and '_20_' in n}
        missing_odt = sorted(type_para | type_char)
    if not missing_odt:
        return

    missing_human = [to_human(n) for n in missing_odt]
    print(f'Injecting sentinel ODT styles: {missing_odt}')

    tmp_dir = Path(tempfile.mkdtemp())
    try:
        with zipfile.ZipFile(odt_path, 'r') as z:
            z.extractall(tmp_dir)
        styles_path = tmp_dir / 'styles.xml'
        if not styles_path.exists():
            print('WARNING: styles.xml not found in ODT — skipping sentinel injection.')
            return

        styles = styles_path.read_text(encoding='utf-8')
        color_map = {n: _SENTINEL_COLORS[i % len(_SENTINEL_COLORS)]
                     for i, n in enumerate(missing_odt)}
        injection_parts = []
        for n, h in zip(missing_odt, missing_human):
            color = color_map[n]
            if n in type_para:
                # Paragraph style — sentinel background at paragraph level.
                injection_parts.append(
                    f'<style:style style:name="{n}" style:display-name="{h}"'
                    f' style:family="paragraph"'
                    f' style:parent-style-name="Default_20_Paragraph_20_Style">'
                    f'<style:paragraph-properties fo:background-color="{color}"/>'
                    f'<style:text-properties fo:background-color="{color}"/>'
                    f'</style:style>'
                )
            if n in type_char:
                # Character style — sentinel background on text spans.
                injection_parts.append(
                    f'<style:style style:name="{n}" style:display-name="{h}"'
                    f' style:family="text">'
                    f'<style:text-properties fo:background-color="{color}"/>'
                    f'</style:style>'
                )
        injection = ''.join(injection_parts)
        # Named paragraph styles belong in <office:styles>, not automatic-styles.
        if '</office:styles>' in styles:
            styles = styles.replace(
                '</office:styles>',
                injection + '</office:styles>', 1)
            styles_path.write_text(styles, encoding='utf-8')
        else:
            print('WARNING: </office:styles> not found in styles.xml — skipping injection.')
            return

        # Repack (preserve mimetype uncompressed as required by the ODF spec)
        tmp_odt = odt_path.with_suffix('.tmp.odt')
        with zipfile.ZipFile(tmp_odt, 'w', zipfile.ZIP_DEFLATED) as zout:
            mimetype = tmp_dir / 'mimetype'
            if mimetype.exists():
                zout.write(mimetype, 'mimetype', compress_type=zipfile.ZIP_STORED)
            for item in sorted(tmp_dir.rglob('*')):
                if item.is_file() and item.name != 'mimetype':
                    zout.write(item, item.relative_to(tmp_dir), compress_type=zipfile.ZIP_DEFLATED)
        odt_path.unlink()
        tmp_odt.rename(odt_path)
        print(f'  Sentinel styles injected into {odt_path.name} — '
              f'define these in your template to remove the yellow highlight.')
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


def inject_missing_docx_styles(docx_path, style_names=None, template_docx_path=None, span_styles=None):
    """Post-processing: scan the DOCX output for every paragraph and character
    style actually referenced in word/document.xml, determine which are absent
    from the reference template, and inject a yellow-shaded sentinel style for
    each.  Styles already defined in the template are left alone.

    style_names: optional extra list of human-readable names to also check —
                 useful when the Lua filter applied styles the scanner might miss.
    template_docx_path: DOCX whose word/styles.xml is treated as 'already defined'.
                        When absent, the output's own word/styles.xml is used.
    """
    import zipfile, shutil, tempfile

    docx_path = Path(docx_path)

    # ── 1. determine which styles are already defined ─────────────────────────
    # Scan BOTH the template and the output word/styles.xml so that built-in
    # styles emitted by pandoc into the output (e.g. "Footnote Reference") are
    # treated as defined and not flagged as missing — mirroring the ODT approach.
    ref_sources = []
    if template_docx_path and os.path.exists(template_docx_path):
        ref_sources.append(template_docx_path)
    if str(docx_path) not in ref_sources:
        ref_sources.append(str(docx_path))
    ref_styles = ''
    for _rp in ref_sources:
        try:
            with zipfile.ZipFile(_rp, 'r') as z:
                ref_styles += (z.read('word/styles.xml').decode('utf-8')
                               if 'word/styles.xml' in z.namelist() else '')
        except Exception as e:
            print(f'WARNING: could not read DOCX for sentinel check: {e}')
    defined_raw = set(re.findall(r'<w:name\s+w:val="([^"]+)"', ref_styles))
    # w:styleId values (e.g. "FootnoteReference") are the exact IDs pandoc
    # uses in rStyle/pStyle vals, so include them verbatim.
    defined_ids = set(re.findall(r'w:styleId="([^"]+)"', ref_styles))
    # Also add space-collapsed variants so built-in styles stored with a
    # display name ("Footnote Reference") also match their internal ID form
    # ("FootnoteReference") used in user-defined mappings.
    defined = set()
    for _dn in defined_raw:
        defined.add(_dn)
        defined.add(_dn.replace(' ', ''))   # "Footnote Reference" → "FootnoteReference"
    defined.update(defined_ids)

    # ── 2. collect all pStyle / rStyle references from the output ─────────────
    try:
        with zipfile.ZipFile(docx_path, 'r') as z:
            out_doc = (z.read('word/document.xml').decode('utf-8')
                       if 'word/document.xml' in z.namelist() else '')
    except Exception as e:
        print(f'WARNING: could not read output DOCX document.xml: {e}')
        out_doc = ''

    para_referenced = set(re.findall(r'<w:pStyle\s+w:val="([^"]+)"', out_doc))
    char_referenced = set(re.findall(r'<w:rStyle\s+w:val="([^"]+)"', out_doc))

    # ── 3. compute what's missing for each usage type ─────────────────────────
    # Pandoc strips spaces from rStyle vals ("Quran quote" → "Quranquote") but
    # may preserve them in pStyle vals — so the DOCX key form for checking
    # membership in para_referenced / char_referenced is the space-stripped ID.
    _to_sid = lambda name: re.sub(r'\s+', '', name)
    # Map space-stripped ID → human-readable name for display in <w:name>.
    sid_to_name = {_to_sid(n): n for n in (style_names or [])}

    if style_names:
        # Classify via shared helper; returns human-readable name sets.
        # DOCX key form is space-stripped (_to_sid).
        _para_h, _char_h = _classify_style_names(
            style_names, defined, para_referenced, char_referenced,
            span_styles=span_styles, to_key=_to_sid,
        )
        # para_missing: human names (used verbatim in <w:name w:val="..."/>),
        # plus EVERY referenced pStyle absent from the template/output — not
        # only spaced ones. Word refuses a pStyle it can't resolve (it reports
        # the file as unreadable and strips the reference), and pandoc's own
        # built-ins (e.g. "SourceCode", no space) are exactly the ones a
        # template usually lacks.
        para_missing = sorted(
            _para_h
            | {n for n in para_referenced if n not in defined}
        )
        # char_missing: space-stripped IDs (matching rStyle vals in document.xml);
        # sid_to_name recovers the display name at injection time.
        char_missing = sorted(
            {_to_sid(n) for n in _char_h}
            | {n for n in char_referenced if n not in defined}
        )
    else:
        # Auto-scan only (no explicit style list supplied).
        para_missing = sorted({n for n in para_referenced if n not in defined})
        char_missing = sorted({n for n in char_referenced if n not in defined})
    if not para_missing and not char_missing:
        return

    tmp_dir = Path(tempfile.mkdtemp())
    try:
        with zipfile.ZipFile(docx_path, 'r') as z:
            z.extractall(tmp_dir)
        styles_path = tmp_dir / 'word' / 'styles.xml'
        if not styles_path.exists():
            return

        styles_xml = styles_path.read_text(encoding='utf-8')

        # Assign colours consistently across both paragraph and character
        # sentinels so the same style name always gets the same colour.
        all_missing_names = sorted(set(para_missing) | set(char_missing))
        color_map = {
            name: _SENTINEL_COLORS[i % len(_SENTINEL_COLORS)].lstrip('#')
            for i, name in enumerate(all_missing_names)
        }
        print(f'Injecting sentinel DOCX paragraph styles: {para_missing}')
        print(f'Injecting sentinel DOCX character styles:  {char_missing}')

        sentinel_styles = []
        rStyle_rewrites = {}  # style_id → char_id, for post-processing document.xml

        for name in para_missing:
            color = color_map[name]
            style_id = re.sub(r'\s+', '', name)
            sentinel_styles.append(
                f'<w:style w:type="paragraph" w:styleId="{style_id}">'
                f'<w:name w:val="{name}"/>'
                f'<w:basedOn w:val="Normal"/>'
                f'<w:pPr><w:shd w:val="clear" w:color="auto" w:fill="{color}"/></w:pPr>'
                f'<w:rPr><w:shd w:val="clear" w:color="auto" w:fill="{color}"/></w:rPr>'
                f'</w:style>'
            )

        for name in char_missing:
            color = color_map[name]
            style_id = re.sub(r'\s+', '', name)
            # Recover the human-readable display name from the sid_to_name map.
            # pandoc strips spaces from style IDs in rStyle vals (e.g.
            # "Quranquote" for "Quran quote"), so `name` here is the stripped
            # form; prefer the original spaced form for <w:name>.
            display_name = sid_to_name.get(style_id, name)
            # Character styleId must differ from any paragraph style with the
            # same name (OOXML requires unique IDs across all style types).
            # Rewrite w:rStyle refs in document.xml below to match.
            char_id = style_id + 'Char'
            rStyle_rewrites[style_id] = char_id
            sentinel_styles.append(
                f'<w:style w:type="character" w:styleId="{char_id}">'
                f'<w:name w:val="{display_name}"/>'
                f'<w:rPr><w:shd w:val="clear" w:color="auto" w:fill="{color}"/></w:rPr>'
                f'</w:style>'
            )

        injection = ''.join(sentinel_styles)
        if '</w:styles>' in styles_xml:
            styles_xml = styles_xml.replace('</w:styles>', injection + '</w:styles>', 1)
            styles_path.write_text(styles_xml, encoding='utf-8')

        # Rewrite w:rStyle refs in document.xml: pandoc emits style_id, but
        # we need char_id (style_id + 'Char') to avoid duplicate styleIds.
        doc_path = tmp_dir / 'word' / 'document.xml'
        if doc_path.exists() and rStyle_rewrites:
            doc_xml = doc_path.read_text(encoding='utf-8')
            for sid, cid in rStyle_rewrites.items():
                doc_xml = re.sub(
                    rf'(<w:rStyle\s+w:val="){re.escape(sid)}"',
                    rf'\g<1>{cid}"',
                    doc_xml,
                )
            doc_path.write_text(doc_xml, encoding='utf-8')

        # Repack
        tmp_docx = docx_path.with_suffix('.tmp.docx')
        with zipfile.ZipFile(tmp_docx, 'w', zipfile.ZIP_DEFLATED) as zout:
            for item in tmp_dir.rglob('*'):
                if item.is_file():
                    zout.write(item, item.relative_to(tmp_dir))
        shutil.move(str(tmp_docx), str(docx_path))
        print(f'  Sentinel styles injected into {docx_path.name} — '
              f'define these in your template to remove the yellow highlight.')
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


def find_soffice():
    """Find the LibreOffice soffice binary."""
    import shutil as _sh
    candidates = [
        os.environ.get('SW_SOFFICE', ''),
        'soffice',
        '/Applications/LibreOffice.app/Contents/MacOS/soffice',
        '/usr/bin/soffice',
        '/usr/local/bin/soffice',
    ]
    for c in candidates:
        if c and _sh.which(c):
            return c
    return None


def find_latex_engine():
    """Find the lualatex binary (pandoc's --pdf-engine for LaTeX export).

    LuaLaTeX is required for Arabic/RTL content: the templates use babel's
    `bidi=basic` (LuaTeX's node-based UAX#9 implementation — no macro
    expansion). XeLaTeX's macro-based bidi/polyglossia alternatives crash a
    real multi-footnote document with "TeX capacity exceeded [main memory
    size=5000000]" inside hyperref's bidi-compatibility code at the first
    \\footnote (confirmed empirically); babel bidi=basic has no such limit and
    also auto-detects inline Arabic runs (see the templates' Arabic note)."""
    import shutil as _sh
    candidates = [
        os.environ.get('SW_LUALATEX', ''),
        'lualatex',
        '/Library/TeX/texbin/lualatex',            # MacTeX / BasicTeX
        '/usr/bin/lualatex',                        # Linux (distro TeX Live)
        '/usr/local/bin/lualatex',
        r'C:\Program Files\MiKTeX\miktex\bin\x64\lualatex.exe',
        r'C:\texlive\2026\bin\windows\lualatex.exe',
    ]
    for c in candidates:
        if c and _sh.which(c):
            return c
    return None


#: Plain-text -> LaTeX special-character escaping, for values (author name,
#: short title) substituted into a .tex template's raw preamble — these are
#: NOT markdown, so pandoc's own escaping never sees them.
_LATEX_ESCAPE_MAP = {
    '\\': r'\textbackslash{}',
    '&': r'\&', '%': r'\%', '$': r'\$', '#': r'\#',
    '_': r'\_', '{': r'\{', '}': r'\}',
    '~': r'\textasciitilde{}', '^': r'\textasciicircum{}',
}
_LATEX_ESCAPE_RE = re.compile('|'.join(re.escape(c) for c in _LATEX_ESCAPE_MAP))


def _latex_escape(text):
    if not text:
        return ''
    return _LATEX_ESCAPE_RE.sub(lambda m: _LATEX_ESCAPE_MAP[m.group(0)], text)


#: A compiled-markdown ATX heading line: level (#s) + text.
_MD_HEADING_RE = re.compile(r'^(#{1,6})[ \t]+(.*?)[ \t]*$', re.M)


def _md_inline_to_latex(text):
    """Minimal Markdown-inline -> LaTeX for heading titles.

    Handles the common emphasis forms (``**bold**``/``__bold__`` and
    ``*italic*``/``_italic_``) before escaping the rest, so a chapter written
    as ``@@ The *Tarbiya* Process`` becomes ``The \\textit{Tarbiya} Process``.
    Deliberately small: heading titles rarely carry more than emphasis, and
    anything else is escaped as literal text.
    """
    placeholders = []

    def stash(latex):
        placeholders.append(latex)
        return f'\x00{len(placeholders) - 1}\x00'

    # Strong first (so ** isn't eaten by the single-* rule), then emphasis.
    text = re.sub(r'\*\*(.+?)\*\*', lambda m: stash(r'\textbf{' + m.group(1) + '}'), text)
    text = re.sub(r'__(.+?)__', lambda m: stash(r'\textbf{' + m.group(1) + '}'), text)
    text = re.sub(r'\*(.+?)\*', lambda m: stash(r'\textit{' + m.group(1) + '}'), text)
    text = re.sub(r'(?<![A-Za-z0-9])_(.+?)_(?![A-Za-z0-9])',
                  lambda m: stash(r'\textit{' + m.group(1) + '}'), text)

    text = _latex_escape(text)
    # Restore stashed LaTeX; re-escape their inner text too.
    def unstash(m):
        latex = placeholders[int(m.group(1))]
        head, inner = latex.split('{', 1)
        inner = inner.rsplit('}', 1)[0]
        return head + '{' + _latex_escape(inner) + '}'
    return re.sub(r'\x00(\d+)\x00', unstash, text)


def latexize_headings(md_text, is_book):
    """Rewrite Markdown headings as raw LaTeX so their NUMBERING is exactly
    what the compiler decided, rather than pandoc's all-or-nothing rule.

    - A numbered chapter (book, level-1 heading whose text starts
      "Chapter N.") -> ``\\chapter{…}``: LaTeX renders the number, and the
      chapter counter increments (figure numbering "chapter.N" depends on it).
    - Every other heading -> the starred form (``\\chapter*``/``\\section*``/…),
      keeping whatever literal number the compiler wrote (e.g. "1.1", "1.").

    Emitting raw LaTeX (via the raw_attribute passthrough pandoc is already
    run with) is what makes the star/no-star choice possible at all: pandoc on
    its own numbers ALL headings or NONE, and never emits a starred form.
    Inline emphasis in the title is converted by _md_inline_to_latex.
    """
    level_cmd_book = {1: 'chapter', 2: 'section', 3: 'subsection',
                      4: 'subsubsection', 5: 'paragraph', 6: 'subparagraph'}
    level_cmd_plain = {1: 'section', 2: 'subsection', 3: 'subsubsection',
                       4: 'paragraph', 5: 'subparagraph', 6: 'subparagraph'}

    def repl(m):
        hashes, title = m.group(1), m.group(2)
        level = len(hashes)
        cmd = (level_cmd_book if is_book else level_cmd_plain).get(level, 'subparagraph')
        # "Is this a numbered chapter?" uses the SAME test as DOCX/ODT
        # (parse_chapter_number on a level-1 heading), and the label is removed
        # with the SAME stripper (strip_chapter_prefix) — so all three formats
        # agree on which chapters are numbered and on the bare title, and none
        # can drift from the others.
        numbered_chapter = is_book and level == 1 and parse_chapter_number(title) > 0
        if numbered_chapter:
            # LaTeX supplies "Chapter N" itself, so drop the literal label the
            # compiler wrote — otherwise the number would appear twice.
            title = strip_chapter_prefix(title)
        latex_title = _md_inline_to_latex(title)
        # A numbered chapter -> \chapter{Title}: LaTeX supplies the number and
        # adds the TOC entry itself. Every other heading -> the UNSTARRED form,
        # which LaTeX ALSO adds to the TOC automatically; secnumdepth=0 (set in
        # the body) keeps sections and deeper unnumbered, so the literal number
        # the compiler wrote is what shows. Only an UNNUMBERED chapter needs the
        # starred form plus a manual TOC entry, since a *-form heading is not
        # auto-added.
        unnumbered_chapter = is_book and level == 1 and not numbered_chapter
        star = '*' if unnumbered_chapter else ''
        out = [f'```{{=latex}}', f'\\{cmd}{star}{{{latex_title}}}']
        if star:
            out.append(
                f'\\addcontentsline{{toc}}{{{cmd}}}{{{latex_title}}}')
        # Book: define this chapter's notes-group heading, which the enotez
        # split-title looks up ("Notes for Chapter N" for a numbered chapter,
        # "Notes for <title>" for an unnumbered one). The key is enotez's OWN
        # per-\chapter split counter (via \swnotesgroupid), NOT
        # \arabic{chapter}: a starred \chapter* does not advance the chapter
        # counter, so keying by it made Preface/Introduction (both 0) and
        # Chapter 2/Conclusion (both 2) collide — Introduction's and
        # Conclusion's labels silently overwrote the earlier ones. \xdef
        # expands the id now, so each chapter's value is stored, not the last
        # one's.
        if is_book and level == 1:
            _grp = ('\\chaptername\\ \\thechapter' if numbered_chapter
                    else latex_title)
            out.append(
                '\\expandafter\\xdef\\csname swnotesheading'
                f'\\swnotesgroupid\\endcsname{{{_grp}}}')
        out.append('```')
        return '\n'.join(out)
    return _MD_HEADING_RE.sub(repl, md_text)


#: A solo image markdown line — `![alt](path)` optionally followed by a
#: pandoc attribute block on the same line, e.g. `{width=200px}`.
_LATEX_SOLO_IMAGE_RE = re.compile(
    r'^(!\[)[^\]]*(\]\([^)\n]+\)(?:\{[^}\n]*\})?)[ \t]*\n'
    r'(?:\n+([^\n]+(?:\n[^\n]+)*))?',
    re.M,
)


def latex_process_images(text):
    """Make every solo image embed a floating, centered figure, and give it
    a real caption ONLY when an explicit 'Figure...' paragraph follows it —
    same vault convention DOCX/ODT apply (centered image styles +
    looks_like_caption/strip_figure_prefix in the merge step); there is no
    merge step for LaTeX, so this runs on the compiled markdown instead,
    before pandoc.

    resolve_embed_links() always gives an image non-empty alt text (the
    Obsidian embed's own alt, or else the filename) so pandoc's own image
    handling has something to work with. But pandoc's `implicit_figures`
    extension treats ANY solo image with non-empty alt text as a captioned,
    numbered figure using that alt text as the caption — so left alone,
    every image would get a "dummy" filename-derived caption, whether or
    not the note actually captioned it.

    When a 'Figure...' paragraph follows, the alt text becomes the real
    (unnumbered — pandoc computes the figure number) description and the
    now-redundant caption paragraph is dropped, so implicit_figures produces
    one correctly-captioned figure. Otherwise the alt text is cleared so
    implicit_figures does not trigger — no numbering, no caption, matching
    DOCX/ODT's "no Figure paragraph -> no caption" behaviour — but the image
    is still wrapped in a plain (uncaptioned) `figure` environment rather
    than left as an ordinary inline \\includegraphics: without SOME float
    environment, a large image that doesn't fit the remaining space on a
    page still can't split, so it just pushes everything after it onto the
    next page, leaving the current page short — exactly the kind of gap
    \\raggedbottom (see the templates) accepts for text but an image doesn't
    need to cause, since a float can instead move up to fill that space with
    a nearby smaller block of text, or move itself to the top/bottom of the
    best-fitting page. A caption-less `figure` gets no number and no ToF
    entry — \\caption{} is what creates both — so this is purely a placement
    mechanism, invisible in the output except for where the image ends up.
    Returns (text, has_figures) — has_figures is True when at least one
    image got a real caption, so the caller can skip \\listoffigures (tof)
    the same way DOCX/ODT skip an empty Table of Figures when there's
    nothing to list.
    """
    found_caption = [False]
    def repl(m):
        prefix, rest, maybe_next = m.group(1), m.group(2), m.group(3)
        if maybe_next and looks_like_caption(maybe_next):
            found_caption[0] = True
            desc = ' '.join(strip_figure_prefix(maybe_next).split())
            desc = desc.replace(']', '\\]')
            return f'{prefix}{desc}{rest}\n'
        img = (f'```{{=latex}}\n\\begin{{figure}}\n\\centering\n```\n'
               f'{prefix}{rest}\n```{{=latex}}\n\\end{{figure}}\n```\n')
        if maybe_next:
            return f'{img}\n{maybe_next}'
        return img
    text = _LATEX_SOLO_IMAGE_RE.sub(repl, text)
    return text, found_caption[0]


_CITEKEY_TOKEN_RE = re.compile(r'(?<![\w@.])-?@([A-Za-z][\w:.#$%&+?<>~/-]*)')


def _extract_citekeys(text):
    """Best-effort scan for pandoc citation keys (@key) in compiled markdown,
    used to pre-fetch a static CSL-JSON bibliography before pandoc runs.
    Mirrors the character class the plugin's own parser uses for a citation
    token (src/parser/parser.ts's /@[^\\s,;\\]\\[]*/), tightened to avoid
    matching emails/handles in prose. A stray false positive just costs a
    harmless "not found" lookup; missing a real key would silently drop that
    citation instead, so this stays intentionally permissive.
    """
    keys = set()
    for m in _CITEKEY_TOKEN_RE.finditer(text):
        key = m.group(1).rstrip('.,;:\'")]')
        if key:
            keys.add(key)
    return sorted(keys)


def _parse_zotero_meta(text):
    """Read the 'zotero:' YAML frontmatter block (csl-style, client, library)
    that sw-zotero.lua normally reads itself — needed here only for the
    static-citation (PDF) path, where Python builds the bibliography instead
    of the Lua filter building live Zotero fields.
    """
    import yaml
    yaml_block, _ = extract_yaml(text)
    z = {}
    if yaml_block:
        try:
            data = yaml.safe_load(yaml_block)
            if isinstance(data, dict):
                z = data.get('zotero') or {}
        except yaml.YAMLError:
            z = {}
    csl_style = z.get('csl-style')
    if csl_style == 'apa7':
        csl_style = 'apa'
    return {
        'csl_style': csl_style or 'apa',
        'client':    z.get('client') or 'zotero',
        'library':   z.get('library'),
    }


def _fetch_zotero_csl_items(citekeys, csl_style, client='zotero', library=None):
    """Fetch CSL-JSON bibliography data for citekeys via Better BibTeX's
    JSON-RPC — the same endpoint/method sw-zotero.lua's load_items() uses
    (item.pandoc_filter). Returns a list of CSL-JSON item dicts ready for
    pandoc's --bibliography: Better BibTeX already sets each item's own "id"
    field to the citekey itself (confirmed via a live call to this endpoint),
    so no remapping is needed the way sw-zotero.lua must remap to Zotero's
    internal numeric item ID for its live-field use case.

    Missing/duplicate citekeys are reported but don't fail the export;
    pandoc will just leave those citations unresolved.
    """
    if not citekeys:
        return []
    import urllib.request
    import urllib.parse
    import urllib.error
    port = 24119 if client == 'jurism' else 23119
    base_url = f'http://127.0.0.1:{port}/better-bibtex/json-rpc?'
    payload = {
        'jsonrpc': '2.0',
        'method':  'item.pandoc_filter',
        'params': {
            'citekeys': citekeys,
            'style':    csl_style or 'apa',
            'asCSL':    True,
        },
    }
    if library:
        payload['params']['libraryID'] = library
    url = base_url + urllib.parse.quote(json.dumps(payload))
    # A book-length document can have 100+ citekeys in one request; Better
    # BibTeX resolving all of them against a large library can genuinely take
    # a while, and this is a one-time build step — waiting longer is far
    # better than failing outright. A quick "not running" call (no citekeys
    # queued for a live document) fails via immediate connection-refused
    # well before this, so a long timeout here doesn't slow that case down.
    try:
        with urllib.request.urlopen(url, timeout=90) as resp:
            body = resp.read().decode('utf-8')
    except (OSError, urllib.error.URLError) as e:
        raise RuntimeError(
            'PDF export needs Zotero running (with Better BibTeX installed) '
            f'to fetch citation data: {e}') from e
    response = json.loads(body)
    if response.get('error'):
        raise RuntimeError(
            f"Could not fetch Zotero items: {response['error'].get('message')}")
    result = response.get('result') or {}
    errors = result.get('errors') or {}
    for key, code in errors.items():
        print(f"@{key}: {'not found' if code == 0 else 'duplicates found'} in Zotero")
    items = result.get('items') or {}
    csl_items = []
    for key, item in items.items():
        clean = dict(item)
        clean.pop('custom', None)
        csl_items.append(clean)
    return csl_items


_DEFAULT_STATIC_CSL_STYLE = 'chicago-author-date'


def _read_template_csl_style(template_path, fmt):
    """Look for a real Zotero "Document Preferences" payload already stored
    in the export template file itself — the same ZOTERO_PREF_1/_2/...
    custom document properties Zotero's own Word/LibreOffice integration
    writes when a user runs "Document Preferences" (or inserts a citation)
    on that file directly, chunked across multiple numbered properties when
    the payload is long.

    Different templates legitimately target different journals/publishers
    with different required styles, so the template's own stored preference
    (when present) takes priority over any single global default — that's
    the whole point of checking here rather than using one fixed style.

    Returns a short CSL style id (e.g. "chicago-author-date") or None if the
    template has never had Zotero's own document preferences set on it.
    """
    import zipfile
    try:
        with zipfile.ZipFile(template_path) as z:
            if fmt == 'docx':
                raw = z.read('docProps/custom.xml').decode('utf-8', 'ignore')
                parts = re.findall(
                    r'name="ZOTERO_PREF_\d+"[^>]*><vt:lpwstr>(.*?)</vt:lpwstr>',
                    raw, re.S)
            else:
                raw = z.read('meta.xml').decode('utf-8', 'ignore')
                parts = re.findall(
                    r'meta:name="ZOTERO_PREF_\d+"[^>]*>(.*?)</meta:user-defined>',
                    raw, re.S)
    except (KeyError, FileNotFoundError, OSError, zipfile.BadZipFile):
        return None
    if not parts:
        return None
    import html
    payload = html.unescape(''.join(parts))
    m = re.search(r'<style\s+id="([^"]+)"', payload)
    if not m:
        return None
    return m.group(1).rstrip('/').rsplit('/', 1)[-1]


def _note_frontmatter_csl(text):
    """The note's own top-level `csl:` / `citation-style:` YAML property
    (a bare style name, a path, or a URL), or None. This is the same key the
    live Obsidian renderer honours; here it feeds export style selection for
    direct CLI use (the plugin resolves it itself and passes --csl-style)."""
    yaml_block, _ = extract_yaml(text)
    if not yaml_block:
        return None
    for key in ('csl', 'citation-style'):
        val = read_yaml_prop(yaml_block, key)
        if val:
            return val.strip()
    return None


def _csl_short_name(value):
    """Reduce a style name / path / URL / style-id to its short id
    ('.../styles/chicago-author-date' or '/x/apa.csl' -> 'chicago-author-date' /
    'apa'). A bare name passes through unchanged."""
    if not value:
        return value
    v = value.strip().rstrip('/')
    v = re.sub(r'\.csl$', '', v, flags=re.IGNORECASE)
    return v.rsplit('/', 1)[-1]


def _resolve_export_csl_style(text, template_path, fmt, override=None,
                              from_template=False):
    """Decide which CSL style an export should use.

    Returns (short_style_name, is_explicit_override). `is_explicit_override`
    is True when the style came from a deliberate choice (the export dialog's
    override checkbox, or the note's own `csl:` property) rather than a
    template/global default — only then is the style written into the output
    file's Zotero document preferences.

    Priority:
      1. `override`            (dialog: "apply the selected style")
      2. `from_template`       (dialog: checkbox off) -> template pref / global
                               default, skipping the note's csl: property
      3. note `csl:` property
      4. template ZOTERO_PREF
      5. SW_DEFAULT_CSL        (the plugin's configured live-render style)
      6. _DEFAULT_STATIC_CSL_STYLE ('chicago-author-date')
    """
    tpl_style = (_read_template_csl_style(template_path, fmt)
                 if template_path and os.path.exists(template_path) else None)
    env_default = _csl_short_name(os.environ.get('SW_DEFAULT_CSL', '').strip()) \
        or None

    if override:
        return _csl_short_name(override), True
    if from_template:
        return (tpl_style or env_default or _DEFAULT_STATIC_CSL_STYLE), False
    fm = _note_frontmatter_csl(text)
    if fm:
        return _csl_short_name(fm), True
    if tpl_style:
        return tpl_style, False
    return (env_default or _DEFAULT_STATIC_CSL_STYLE), False


#: Pandoc's citeproc bundles this style as its built-in default. When the
#: resolved style IS this one, skip the network fetch entirely and let pandoc
#: use its own copy (emit no --csl argument).
_PANDOC_DEFAULT_CSL_STYLE = 'chicago-author-date'


def _https_get(url, timeout):
    """GET *url*, tolerating the python.org macOS build's un-wired CA store
    (a very common setup: the installer ships certs but leaves them inactive
    until "Install Certificates.command" is run). Tries the normal verified
    context, then certifi's bundle if importable, then falls back to an
    unverified context with a warning — the payload here is a public, static,
    non-executed file that we cache and hand to pandoc, so an unverified TLS
    fetch is an acceptable last resort. Non-certificate errors (offline, 404)
    are not retried."""
    import ssl
    import urllib.request
    import urllib.error

    attempts = [None]  # verified default context
    try:
        import certifi
        attempts.append(ssl.create_default_context(cafile=certifi.where()))
    except ImportError:
        pass
    unverified = ssl._create_unverified_context()
    attempts.append(unverified)

    last_err = None
    for ctx in attempts:
        try:
            with urllib.request.urlopen(url, timeout=timeout, context=ctx) as resp:
                data = resp.read()
            if ctx is unverified:
                print('WARNING: fetched %s over an UNVERIFIED HTTPS connection — '
                      'your Python has no active CA certificates. Run the '
                      '"Install Certificates.command" that ships with python.org '
                      'Python, or `pip install certifi`.' % url)
            return data
        except urllib.error.URLError as e:
            last_err = e
            if not isinstance(getattr(e, 'reason', None),
                              ssl.SSLCertVerificationError):
                break  # offline / DNS / HTTP error — retrying won't help
    raise last_err


def _zotero_style_dirs(client=None):
    """Candidate `<data-dir>/styles` folders of an installed Zotero / Jurism,
    most-preferred first. Honours a custom data directory set in prefs.js
    (`extensions.zotero.dataDir`); otherwise the default `~/Zotero` (`~/Jurism`).
    `client` ('zotero' | 'jurism', from the note's zotero: block) just reorders
    the two — both are always checked."""
    dirs, seen = [], set()
    env_dir = os.environ.get('SW_ZOTERO_DIR', '').strip()
    if env_dir:
        p = Path(env_dir).expanduser()
        # Accept either the data dir or the styles dir itself.
        for styles in ((p if p.name == 'styles' else p / 'styles'), p / 'styles'):
            if styles not in seen:
                seen.add(styles)
                dirs.append(styles)
    names = ['Jurism', 'Zotero'] if client == 'jurism' else ['Zotero', 'Jurism']
    for name in names:
        base = Path.home() / name
        candidates = []
        try:
            prefs = (base / 'prefs.js').read_text(encoding='utf-8', errors='ignore')
            m = re.search(
                r'user_pref\("extensions\.zotero\.dataDir",\s*"((?:[^"\\]|\\.)*)"\)',
                prefs)
            if m:
                candidates.append(Path(m.group(1).encode()
                                       .decode('unicode_escape')))
        except OSError:
            pass
        candidates.append(base)
        for d in candidates:
            styles = d / 'styles'
            if styles not in seen:
                seen.add(styles)
                dirs.append(styles)
    return dirs


def _installed_csl_path(csl_style, client=None):
    """Path to `csl_style` in an installed Zotero/Jurism styles folder, or None.
    This copy is the user's canonical, Zotero-managed version — prefer it over
    a download or pandoc's bundled default."""
    for d in _zotero_style_dirs(client):
        p = d / f'{csl_style}.csl'
        if p.is_file():
            return str(p)
    return None


def _fetch_csl_style_file(csl_style, client=None):
    """Return a local path to the given CSL style's XML, or None when no file
    is needed (pandoc's built-in default). Resolution order:

      1. An installed Zotero/Jurism style (`~/Zotero/styles/<style>.csl`, or a
         custom data dir) — the user's own, up-to-date, Zotero-managed copy.
      2. Pandoc's built-in default — return None, pandoc uses its own copy.
      3. This session's on-disk cache from a previous download.
      4. A one-time download from citation-style-language/styles, then cached.

    No freshness check: CSL styles change rarely, so a cached copy is fine;
    a newer one is picked up whenever the cache is next cleared or Zotero
    updates its own folder.
    """
    local = _installed_csl_path(csl_style, client)
    if local:
        return local
    if csl_style == _PANDOC_DEFAULT_CSL_STYLE:
        return None
    import tempfile
    import urllib.error
    cache_dir = Path(tempfile.gettempdir()) / 'scholarweft-csl-cache'
    cache_path = cache_dir / f'{csl_style}.csl'
    if not cache_path.exists():
        cache_dir.mkdir(parents=True, exist_ok=True)
        url = (
            'https://raw.githubusercontent.com/citation-style-language/'
            f'styles/master/{csl_style}.csl'
        )
        try:
            cache_path.write_bytes(_https_get(url, timeout=20))
        except (OSError, urllib.error.URLError) as e:
            raise RuntimeError(
                f'Could not find CSL style "{csl_style}" in the Zotero styles '
                f'folder or download it from citation-style-language/styles: '
                f'{e}') from e
    return str(cache_path)


def _csl_is_note_style(csl_path):
    """True when the CSL file at `csl_path` is a note/footnote style
    (`<category citation-format="note"/>`). None / unreadable / a dependent
    style with no own category → False (safe default: no restructuring)."""
    if not csl_path:
        return False
    try:
        with open(csl_path, 'r', encoding='utf-8', errors='ignore') as fh:
            head = fh.read(8000)
    except OSError:
        return False
    return bool(re.search(r'<category\s+citation-format="note"', head))


def resolve_note_citation_style(text, template_path, fmt, override=None,
                                from_template=False):
    """True when this export uses a note/footnote CSL citation style.

    Resolves the style the same way export_document does (see
    _resolve_export_csl_style) and asks whether it is a note style. Used by
    main() so in-text citations can be turned into notes BEFORE the shared
    finalize stage, where they join the author's own notes in whichever stream
    (footnotes or endnotes) the export selected.
    """
    style, _ = _resolve_export_csl_style(
        text, template_path, fmt, override=override, from_template=from_template)
    zmeta = _parse_zotero_meta(text)
    try:
        csl_path = _fetch_csl_style_file(style, zmeta['client'])
    except (RuntimeError, OSError):
        csl_path = None
    return _csl_is_note_style(csl_path)


#: The suffix(es) DocumentCompiler appends to a working copy's filename
#: ("<note> - export", "<note> - compiled"). Stripped before using a stem as a
#: title/short-title fallback, so an untitled note is titled by its NOTE name,
#: not by the working file ("Rule of 3s - export - export").
_INTERMEDIATE_SUFFIX_RE = re.compile(
    r'(?:\s+[-–]\s+(?:export|compiled))+$', re.IGNORECASE)


def _source_stem(stem):
    """The source note's stem, with any intermediate-file suffix removed."""
    cleaned = _INTERMEDIATE_SUFFIX_RE.sub('', stem or '').strip()
    return cleaned or (stem or '')


def _parse_yaml_metadata(text, stem):
    """Parse all YAML frontmatter properties used by the export pipeline.

    Returns a dict with keys: tpl, title, author, subtitle, date_val, abstract,
    extra_sections, short_title.  Call once per export; pass the result to
    export_document (or use it directly when inspecting without exporting).
    """
    m = re.search(r'^template:[^\S\n]*["\']?([^"\'\n]+)', text, re.M)
    tpl = m.group(1).strip() if m else 'document'
    tpl = re.sub(r'\.(docx|odt)$', '', tpl, flags=re.IGNORECASE)
    if tpl.startswith('compile-'):
        tpl = tpl[len('compile-'):]

    title = _yaml_scalar(text, 'title')
    if title:
        # A title split over two lines (a `|-` block scalar, or a wrapped
        # single value) reads as "Title: Subtitle" — resolve_cover then splits
        # it into the Title and Subtitle slots.
        lines = [l.strip() for l in title.split('\n') if l.strip()]
        title = ': '.join(lines) if len(lines) == 2 else ' '.join(lines)
    title = title or _source_stem(stem)

    author = _yaml_scalar(text, 'author')
    if author:
        # Keep the WHOLE author block in the note's YAML form (name +
        # affiliation/address/date): the title block prints all of it (line
        # breaks preserved), while only its first line goes in the running
        # header (see first_line, applied in each export path).
        author = author.strip()

    subtitle = _yaml_scalar(text, 'subtitle')
    date_val = _yaml_scalar(text, 'date')

    # abstract and note:/sw-* extra sections are extracted in ONE
    # position-ordered pass (re.finditer yields matches in source order) so
    # extra_sections preserves the note's own YAML order — a 'note:'
    # property between two sw-* properties stays between them, rather than
    # abstract always being forced first regardless of where it actually
    # appears. abstract is also kept as its own field below (unchanged
    # value, just no longer separately-positioned) since some callers want
    # it standalone.
    abstract = None
    extra_sections = []
    for m in re.finditer(
            r'^(abstract|note|sw-[\w-]+):[^\S\n]*(?:["\']([^"\']+)["\']|(\S[^\n]*?))(?:\s*#[^\n]*)?\s*$',
            text, re.M):
        key = m.group(1)
        raw = (m.group(2) or m.group(3) or '').strip()
        val = _yaml_block(text, m.end(), raw) if re.match(r'^[|>]', raw) else raw
        if not val:
            continue
        if key == 'abstract':
            abstract = val
        extra_sections.append([key, val])

    # Shorttitle: explicit 'shorttitle' prop → title before ':' → stem.
    # Markdown markers are preserved here; merge scripts strip them for plain
    # string fields but format them as rich runs in even-page headers.
    short_title = _yaml_scalar(text, 'shorttitle')
    if not short_title and title:
        short_title = title.split(':')[0].strip()
    if not short_title:
        short_title = _source_stem(stem)

    return {
        'tpl':            tpl,
        'title':          title,
        'author':         author,
        'subtitle':       subtitle,
        'date_val':       date_val,
        'abstract':       abstract,
        'extra_sections': extra_sections,
        'short_title':    short_title,
    }


def _resolve_output_stem(output_name, default_stem):
    """Filename stem for an export. `output_name` is the export dialog's
    'Desired output filename' (may carry an extension, which is dropped here —
    the caller re-adds the format's own). Blank/None → the source note's stem."""
    if not output_name:
        return default_stem
    stem = Path(str(output_name)).name
    stem = re.sub(r'\.(docx|odt|pdf|md)$', '', stem, flags=re.IGNORECASE)
    return stem.strip() or default_stem


def export_document(fmt, compiled_md, vault_root=None, template=None, toc=False,
                    toc_levels=None, tof=False, endnotes_mode='none',
                    template_dir=None, output_dir=None,
                    default_author=None, new_page_headings=True,
                    restart_footnotes=True, mappings_data=None, generate_date=True,
                    roman_frontmatter=False, page1_starts_with='',
                    static_citations=False, raw_citations=False,
                    static_bibliography=None, csl_style_override=None,
                    csl_from_template=False, output_name=None,
                    citations_input=None, citations_converted=False,
                    include_bibliography=True):
    """Unified export pipeline for DOCX and ODT.

    citations_converted: the caller (main) already turned in-text citations into
    notes before the shared finalize stage, so their notes joined the author's
    own notes in the chosen stream. Skips this function's own
    citations_to_footnotes step to avoid converting twice.

    static_citations: when True, skip sw-zotero.lua's live-Zotero-field
    generation and let pandoc's own --citeproc render final citation text
    and a real bibliography instead, using a CSL-JSON bibliography fetched
    from Zotero/Better BibTeX up front. Used by export_pdf(), since a PDF
    has no live document to refresh fields in later; DOCX/ODT exports keep
    the default (live fields, refreshable in Word/LibreOffice).

    Both formats share: YAML metadata parsing, citation conversion, markdown
    pre-processing, Lua filter construction, pandoc invocation, template
    lookup, merge script invocation, and missing-style injection.

    Format-specific details are isolated to two narrow sections:

      DOCX — pandoc writes a clean OOXML file (no reference-doc needed);
             sw_export_merge.py handles template merging.

      ODT  — pandoc writes a clean ODF file using the template as
             --reference-doc (so custom-style attributes resolve correctly);
             sentinel styles are pre-injected into a temp copy first;
             sw_export_odt_merge.py handles template merging.
             Note: --toc is NOT forwarded to pandoc — the ODT merger manages
             the TOC element directly from the template structure.

    Both merge scripts share the same CLI interface, so the merge command
    construction is identical; only the script path differs.

    Returns the output file path (Path).
    """
    import subprocess
    compiled_md  = Path(compiled_md)
    vault_root   = vault_root or vault_rel()
    template_dir = resolve_template_dir(template_dir, vault_root)

    text = compiled_md.read_text(encoding='utf-8')
    meta = _parse_yaml_metadata(text, compiled_md.stem)

    # Caller may override the template name (e.g. from the export dialog).
    tpl = template if template is not None else meta['tpl']
    tpl = re.sub(r'\.(docx|odt)$', '', tpl, flags=re.IGNORECASE)
    if tpl.startswith('compile-'):
        tpl = tpl[len('compile-'):]

    doc_title      = meta['title']
    doc_author     = meta['author'] or default_author
    doc_subtitle   = meta['subtitle']
    doc_date       = meta['date_val']
    doc_abstract   = meta['abstract']
    extra_sections = meta['extra_sections']
    short_title    = meta['short_title']

    out_dir = Path(output_dir).expanduser() if output_dir else compiled_md.parent
    out_dir.mkdir(parents=True, exist_ok=True)
    ext        = '.docx' if fmt == 'docx' else '.odt'
    clean_path = out_dir / f"{compiled_md.stem}.clean{ext}"
    # A caller-supplied name (export dialog) is written to DIRECTLY — never
    # generate the default-named file first (that would clobber a real export
    # the user keeps under the note's own name).
    out_stem   = _resolve_output_stem(output_name, compiled_md.stem)
    out_path   = out_dir / f"{out_stem}{ext}"

    # ── Citation conversion (identical for both formats) ───────────────────────
    citations_md = compiled_md.with_suffix('.citations.md')
    if citations_input:
        # The caller already converted citations (the plugin does this
        # in-process, so no external Node.js is required); use its output.
        cit_text = Path(citations_input).read_text(encoding='utf-8')
        citations_md.write_text(cit_text, encoding='utf-8')
    else:
        conv_script = plugin_script_path('convert-citations.mjs')
        node_bin    = os.environ.get('SW_NODE', 'node')
        subprocess.run([node_bin, conv_script, str(compiled_md), str(citations_md)],
                       check=True)
        cit_text = citations_md.read_text(encoding='utf-8')

    # ── Markdown pre-processing (identical for both formats) ───────────────────
    cit_text = ensure_blank_before_headings(cit_text)
    cit_text = rewrite_poetry_callouts(cit_text)
    cit_text = preprocess_md_syntax(cit_text)
    cit_text = resolve_embed_links(cit_text)  # fixes images in direct-note exports
    cit_text = strip_wikilinks(cit_text)       # strips vault-internal wikilinks
    cit_text = linkify_bare_urls(cit_text)     # converts bare URLs to markdown links
    # Drop citation syntax from the YAML block: pandoc's --citeproc processes
    # metadata citations too, which would add a bibliography entry for a work
    # cited only in navigation metadata (up:/related:), never in the body.
    cit_text = strip_frontmatter_citations(cit_text)
    citations_md.write_text(cit_text, encoding='utf-8')

    # A caller-provided CSL-JSON bibliography (the plugin's loaded library) means
    # a STATIC export: --citeproc renders citations from it instead of live
    # Zotero fields, and no Zotero fetch is needed.
    use_static = static_citations or bool(static_bibliography)

    # ── Lua filter construction (identical for both formats) ───────────────────
    filters = [
        plugin_script_path('sw-doc-title.lua'),
        plugin_script_path('sw-callouts.lua'),
        plugin_script_path('sw-export.lua'),
        plugin_script_path('sw-poetry.lua'),
        plugin_script_path('sw-bidi.lua'),
    ]
    if not use_static and not raw_citations:
        filters.append(plugin_script_path('sw-zotero.lua'))
    filters += find_user_lua_filters(template_dir)
    active_mappings = mappings_data or load_mappings(template_dir)
    # Only include poetry styles when the document actually contains poetry callouts.
    _arabic_re = re.compile(r'^\s*>\s*\[!arabic-poetry', re.M | re.I)
    _english_re = re.compile(r'^\s*>\s*\[!(?:poetry|english-poetry)', re.M | re.I)
    poetry_styles = []
    if _arabic_re.search(cit_text):
        poetry_styles.append('Arabic poetry')
    if _english_re.search(cit_text):
        poetry_styles.append('English poetry')
    _span_styles = collect_span_styles(cit_text, active_mappings)
    all_styles = list(dict.fromkeys(
        poetry_styles
        + [sty for _, sty in active_mappings]
        + _span_styles
    ))
    mappings_filter = generate_mappings_filter(active_mappings)
    if mappings_filter:
        filters.append(mappings_filter)
    filter_args = []
    for f in filters:
        filter_args += ['--lua-filter', f]
    # Live-field path: tell sw-zotero.lua to omit the bibliography (it gates on
    # this; the static path uses --metadata suppress-bibliography instead).
    bib_off_args = []
    if not include_bibliography and not use_static and not raw_citations:
        bib_off_args = ['--metadata', 'zotero_no-bibliography=true']

    # ── Template path lookup (identical candidate chain for every format) ──────
    template_path = _resolve_template_path(tpl, ext, template_dir)

    # ── CSL style resolution (see _resolve_export_csl_style for priority).
    # `_csl_is_override` marks a deliberate choice (dialog checkbox or the
    # note's own csl: property) — only then do we write the style into the
    # output file's Zotero document preferences (merge --csl-style).
    zmeta = _parse_zotero_meta(text)
    csl_style, _csl_is_override = _resolve_export_csl_style(
        text, template_path, fmt,
        override=csl_style_override, from_template=csl_from_template)

    # ── Note/footnote citation style: move each in-text citation into a real
    # footnote before pandoc runs (see citations_to_footnotes). The live-field
    # path needs this so sw-zotero.lua writes note fields. The static path
    # normally lets --citeproc produce the notes itself — but in BODY endnote
    # mode the notes must become visible paragraphs, so the citations are moved
    # first and apply_note_style gathers them into the Notes section too;
    # otherwise citeproc turns them into footnotes in the BODY and the inline
    # step would replace the body's note anchors with full references.
    _move_citations = (not raw_citations and not citations_converted
                       and fmt in ('docx', 'odt')
                       and (not use_static or endnotes_mode == 'body'))
    if _move_citations:
        try:
            _csl_path_for_notes = _fetch_csl_style_file(csl_style, zmeta['client'])
        except (RuntimeError, OSError):
            _csl_path_for_notes = None
        if _csl_is_note_style(_csl_path_for_notes):
            cit_text = citations_to_footnotes(cit_text)
            citations_md.write_text(cit_text, encoding='utf-8')
            print('Note citation style — moved in-text citations into footnotes')

    # ── Body endnotes: now that every citation is resolved, move ALL footnotes
    # (author notes + citation notes) into a visible '# Notes' section, grouped
    # by the chapter of each reference. The merge styles that section as the
    # endnote stream; nothing is left as a page-bottom footnote. Native
    # endnotes skip this — their footnotes are converted to real endnote
    # objects by the merge instead.
    if endnotes_mode == 'body' and fmt in ('docx', 'odt'):
        cit_text = apply_note_style(
            cit_text, endnotes=True,
            global_footnotes=not restart_footnotes)
        citations_md.write_text(cit_text, encoding='utf-8')

    # Native endnotes: a level-1 'Notes' heading at the end of the body, which
    # the word processor places immediately before the generated endnote
    # stream, so 'Notes' appears in the TOC. (Body mode's apply_note_style
    # already emits the heading and its '## <chapter>' groups.)
    if endnotes_mode == 'native' and fmt in ('docx', 'odt'):
        if re.search(r'\[\^[^\]]+\]', cit_text):
            cit_text = cit_text.rstrip() + '\n\n# Notes\n'
            citations_md.write_text(cit_text, encoding='utf-8')

    # ── Static-citation mode (PDF path): fetch a CSL-JSON bibliography and
    # the CSL style file up front, and hand citation processing to pandoc's
    # own --citeproc instead of sw-zotero.lua's live-field generation.
    citeproc_args = []
    _tmp_biblio_dir = None
    if use_static:
        csl_path = None
        if static_bibliography:
            # Caller supplied the bibliography (the plugin's loaded library, so
            # .bib-sourced citations render without Zotero); do NOT fetch Zotero.
            biblio_path = Path(static_bibliography)
            try:
                csl_path = _fetch_csl_style_file(csl_style, zmeta['client'])
            except Exception:
                csl_path = None
        else:
            citekeys = _extract_citekeys(cit_text)
            csl_items = _fetch_zotero_csl_items(
                citekeys, csl_style, zmeta['client'], zmeta['library'])
            csl_path = _fetch_csl_style_file(csl_style, zmeta['client'])
            import tempfile as _tempfile
            _tmp_biblio_dir = Path(_tempfile.mkdtemp())
            biblio_path = _tmp_biblio_dir / 'bibliography.json'
            biblio_path.write_text(json.dumps(csl_items, ensure_ascii=False), encoding='utf-8')
        citeproc_args = [
            '--citeproc',
            '--bibliography', str(biblio_path),
            '--metadata', 'reference-section-title=Bibliography',
            # Link each in-text citation to its bibliography entry.  The DOCX/
            # ODT merges make INTERNAL links invisible (they strip the Hyperlink
            # style / "Definition" span), so the citation reads as plain body
            # text but is still clickable.
            '--metadata', 'link-citations=true',
        ]
        if not include_bibliography:
            # Static path: let citeproc render citations but emit no
            # bibliography section.
            citeproc_args += ['--metadata', 'suppress-bibliography=true']
        # csl_path is None when the style is pandoc's built-in default —
        # omit --csl and let pandoc use its own bundled copy.
        if csl_path:
            citeproc_args += ['--csl', csl_path]

    # ── pandoc invocation (format-specific) ────────────────────────────────────
    if fmt == 'docx':
        # DOCX: clean output with no reference-doc; merge script applies template.
        cmd = [os.environ.get('SW_PANDOC', 'pandoc'), str(citations_md),
               '-t', 'docx',
               '-f', 'markdown+wikilinks_title_after_pipe+lists_without_preceding_blankline',
               *filter_args,
               *citeproc_args,
               *bib_off_args,
               '--metadata', f'source-note={compiled_md.stem}',
               '-o', str(clean_path)]
        print('Running pandoc:', ' '.join(cmd))
        subprocess.run(cmd, check=True)
        _tmp_ref_dir = None

    else:  # odt
        # ODT: use the template as --reference-doc so pandoc resolves custom-style
        # attributes correctly.  Sentinel styles are pre-injected into a temp copy
        # before pandoc runs so styles the template doesn't define yet are visible.
        # --toc is NOT forwarded: the ODT merger manages TOC from template structure.
        _tmp_ref_dir = None
        pandoc_ref_doc = template_path if os.path.exists(template_path) else None
        if pandoc_ref_doc and all_styles:
            pandoc_ref_doc, _tmp_ref_dir = _prep_reference_odt(pandoc_ref_doc, all_styles)
        ref_doc_args = ['--reference-doc', pandoc_ref_doc] if pandoc_ref_doc else []
        cmd = [os.environ.get('SW_PANDOC', 'pandoc'), str(citations_md),
               '-t', 'odt',
               '-f', 'markdown+wikilinks_title_after_pipe+lists_without_preceding_blankline',
               *filter_args,
               *citeproc_args,
               *bib_off_args,
               *ref_doc_args,
               '-o', str(clean_path)]
        print('Running pandoc:', ' '.join(cmd))
        subprocess.run(cmd, check=True)
        if _tmp_ref_dir:
            import shutil as _sh2
            _sh2.rmtree(_tmp_ref_dir, ignore_errors=True)

    if _tmp_biblio_dir:
        import shutil as _sh3
        _sh3.rmtree(_tmp_biblio_dir, ignore_errors=True)

    citations_md.unlink(missing_ok=True)

    # ── Merge step (format-specific script; identical CLI interface) ───────────
    # Both sw_export_merge.py and sw_export_odt_merge.py accept the same set of
    # arguments, so the command construction is the same — only the script differs.
    merge_script = plugin_script_path(
        'sw_export_merge.py' if fmt == 'docx' else 'sw_export_odt_merge.py')
    merge_cmd = [os.environ.get('SW_PYTHON', 'python3'), merge_script,
                 '--template',   template_path,
                 '--input',      str(clean_path),
                 '--output',     str(out_path),
                 '--title',      doc_title,
                 '--shorttitle', short_title,
                 '--basename',   compiled_md.stem]
    if doc_author:    merge_cmd += ['--author',   doc_author]
    if doc_subtitle:  merge_cmd += ['--subtitle', doc_subtitle]
    if doc_date:      merge_cmd += ['--date',     doc_date]
    if doc_abstract:  merge_cmd += ['--abstract', doc_abstract]
    if extra_sections:
        merge_cmd += ['--extra-sections', json.dumps(extra_sections, ensure_ascii=False)]
    if not new_page_headings:
        merge_cmd.append('--no-new-page-headings')
    merge_cmd.append('--no-global-footnotes' if restart_footnotes
                     else '--global-footnotes')
    if toc:
        merge_cmd.append('--toc')
        if toc_levels is not None:
            merge_cmd += ['--toc-levels', str(toc_levels)]
    if tof:
        merge_cmd.append('--list-of-figures')
    if endnotes_mode and endnotes_mode != 'none':
        merge_cmd += ['--endnotes-mode', endnotes_mode]
    if not generate_date:
        merge_cmd.append('--no-generated-date')
    if roman_frontmatter:
        merge_cmd.append('--roman-frontmatter')
        if page1_starts_with:
            merge_cmd += ['--page1-starts-with', page1_starts_with]
    if use_static or raw_citations:
        merge_cmd.append('--static-citations')
    if _csl_is_override and csl_style:
        # Write the chosen style into the output's Zotero document
        # preferences so a later Word/LibreOffice "Refresh" uses it without
        # prompting. Pass the resolved .csl path when we have one (its <id>
        # is authoritative); otherwise the bare short name.
        _csl_ref = None
        try:
            _csl_ref = _installed_csl_path(csl_style, zmeta['client'])
        except Exception:
            _csl_ref = None
        merge_cmd += ['--csl-style', _csl_ref or csl_style]
    print('Merging:', ' '.join(merge_cmd))
    subprocess.run(merge_cmd, check=True)
    clean_path.unlink(missing_ok=True)

    # ── Missing-style injection (belt-and-suspenders for both formats) ─────────
    if fmt == 'docx':
        inject_missing_docx_styles(out_path, style_names=all_styles,
                                   template_docx_path=template_path,
                                   span_styles=_span_styles)
    else:
        inject_missing_odt_styles(out_path, style_names=all_styles,
                                  template_odt_path=template_path,
                                  span_styles=_span_styles)

    print(f'Template: {template_path}')
    print(f'Exported [{tpl}] → {out_path}')
    print(out_path)   # last line — parsed by exportCompiler.ts as the output path
    return out_path


def export_docx(compiled_md, vault_root=None, template=None, toc=False,
                toc_levels=None, tof=False, endnotes_mode='none',
                template_dir=None, output_dir=None,
                default_author=None, new_page_headings=True, restart_footnotes=True,
                mappings_data=None, generate_date=True,
                roman_frontmatter=False, page1_starts_with='',
                static_citations=False, raw_citations=False,
                static_bibliography=None, csl_style_override=None,
                csl_from_template=False, output_name=None,
                citations_input=None, citations_converted=False,
                include_bibliography=True):
    """Export compiled markdown to DOCX. Thin wrapper around export_document."""
    return export_document('docx', compiled_md,
                           vault_root=vault_root, template=template, toc=toc,
                           toc_levels=toc_levels, tof=tof,
                           endnotes_mode=endnotes_mode,
                           template_dir=template_dir, output_dir=output_dir,
                           default_author=default_author,
                           new_page_headings=new_page_headings,
                           restart_footnotes=restart_footnotes,
                           mappings_data=mappings_data, generate_date=generate_date,
                           roman_frontmatter=roman_frontmatter,
                           page1_starts_with=page1_starts_with,
                           static_citations=static_citations,
                           raw_citations=raw_citations,
                           static_bibliography=static_bibliography,
                           csl_style_override=csl_style_override,
                           csl_from_template=csl_from_template,
                           output_name=output_name,
                           citations_input=citations_input,
                           citations_converted=citations_converted,
                           include_bibliography=include_bibliography)


def _prep_reference_odt(ref_doc_path, style_names):
    """Return a temp copy of ref_doc_path with sentinel styles pre-injected into
    styles.xml's <office:styles> section, so pandoc can apply custom-style
    attributes for styles not yet defined in the user's template.

    Returns (path_to_use, temp_dir_to_cleanup).  If no injection is needed
    (all styles present, or ref_doc_path is None) returns (ref_doc_path, None).
    """
    import zipfile, shutil as _sh, tempfile
    if not ref_doc_path or not os.path.exists(ref_doc_path) or not style_names:
        return ref_doc_path, None

    def to_odt_name(s):
        return s.replace(' ', '_20_')

    # Which styles are missing from the template?
    try:
        with zipfile.ZipFile(ref_doc_path, 'r') as z:
            tpl_text = ''.join(
                z.read(n).decode('utf-8')
                for n in ['styles.xml', 'content.xml']
                if n in z.namelist()
            )
        # Normalise: LibreOffice may store style:name with actual spaces or _20_,
        # and some styles are stored with a distinct style:display-name that
        # differs from the internal style:name (e.g. "ListNumberTight" / "List
        # Number Tight"). Scan both so we don't pre-inject a style that's
        # already in the template under the alternate encoding or display name.
        _raw_tpl = (set(re.findall(r'style:name="([^"]+)"', tpl_text))
                    | set(re.findall(r'style:display-name="([^"]+)"', tpl_text)))
        defined = set()
        for _dn in _raw_tpl:
            defined.add(_dn)
            defined.add(_dn.replace(' ', '_20_'))
            defined.add(_dn.replace('_20_', ' '))
            defined.add(_dn.replace(' ', '').replace('_20_', ''))   # "Footnote Reference" → "FootnoteReference"
        missing_human = [n for n in style_names if to_odt_name(n) not in defined]
    except Exception as e:
        print(f'WARNING: could not inspect reference ODT for pre-injection: {e}')
        return ref_doc_path, None

    if not missing_human:
        return ref_doc_path, None

    missing_odt = [to_odt_name(n) for n in missing_human]
    print(f'Pre-injecting sentinel styles into reference ODT copy: {missing_odt}')

    tmp_dir = Path(tempfile.mkdtemp())
    try:
        extract_dir = tmp_dir / 'extracted'
        extract_dir.mkdir()
        with zipfile.ZipFile(ref_doc_path, 'r') as z:
            z.extractall(extract_dir)

        styles_path = extract_dir / 'styles.xml'
        if not styles_path.exists():
            _sh.rmtree(tmp_dir, ignore_errors=True)
            return ref_doc_path, None

        styles = styles_path.read_text(encoding='utf-8')
        injection = ''.join(
            # Paragraph style — background at paragraph level.
            f'<style:style style:name="{n}" style:display-name="{h}"'
            f' style:family="paragraph"'
            f' style:parent-style-name="Default_20_Paragraph_20_Style">'
            f'<style:paragraph-properties fo:background-color="{color}"/>'
            f'<style:text-properties fo:background-color="{color}"/>'
            f'</style:style>'
            # Character style — same name, family="text", used by Span handler.
            f'<style:style style:name="{n}" style:display-name="{h}"'
            f' style:family="text">'
            f'<style:text-properties fo:background-color="{color}"/>'
            f'</style:style>'
            for i, (n, h) in enumerate(zip(missing_odt, missing_human))
            for color in [_SENTINEL_COLORS[i % len(_SENTINEL_COLORS)]]
        )
        if '</office:styles>' not in styles:
            _sh.rmtree(tmp_dir, ignore_errors=True)
            return ref_doc_path, None
        styles = styles.replace('</office:styles>', injection + '</office:styles>', 1)
        styles_path.write_text(styles, encoding='utf-8')

        tmp_odt = tmp_dir / 'reference_with_sentinels.odt'
        with zipfile.ZipFile(tmp_odt, 'w', zipfile.ZIP_DEFLATED) as zout:
            mimetype = extract_dir / 'mimetype'
            if mimetype.exists():
                zout.write(mimetype, 'mimetype', compress_type=zipfile.ZIP_STORED)
            for item in sorted(extract_dir.rglob('*')):
                if item.is_file() and item.name != 'mimetype':
                    zout.write(item, item.relative_to(extract_dir))

        return str(tmp_odt), str(tmp_dir)
    except Exception as e:
        print(f'WARNING: pre-injection of reference ODT failed: {e}')
        _sh.rmtree(tmp_dir, ignore_errors=True)
        return ref_doc_path, None


def export_odt(compiled_md, vault_root=None, template=None, toc=False,
               toc_levels=None, tof=False, endnotes_mode='none',
               template_dir=None, output_dir=None,
               default_author=None, new_page_headings=True, restart_footnotes=True,
               mappings_data=None, generate_date=True,
               roman_frontmatter=False, page1_starts_with='',
               static_citations=False, raw_citations=False,
               static_bibliography=None, csl_style_override=None,
               csl_from_template=False, output_name=None,
               citations_input=None, citations_converted=False,
                include_bibliography=True):
    """Export compiled markdown to ODT. Thin wrapper around export_document."""
    return export_document('odt', compiled_md,
                           vault_root=vault_root, template=template, toc=toc,
                           toc_levels=toc_levels, tof=tof,
                           endnotes_mode=endnotes_mode,
                           template_dir=template_dir, output_dir=output_dir,
                           default_author=default_author,
                           new_page_headings=new_page_headings,
                           restart_footnotes=restart_footnotes,
                           mappings_data=mappings_data, generate_date=generate_date,
                           roman_frontmatter=roman_frontmatter,
                           page1_starts_with=page1_starts_with,
                           static_citations=static_citations,
                           raw_citations=raw_citations,
                           static_bibliography=static_bibliography,
                           csl_style_override=csl_style_override,
                           csl_from_template=csl_from_template,
                           output_name=output_name,
                           citations_input=citations_input,
                           citations_converted=citations_converted,
                           include_bibliography=include_bibliography)


def _latex_notes_parts(abstract, extra_sections):
    """Abstract (if present) followed by each note:/sw-* extra section, as a
    flat list of markdown/raw-LaTeX string fragments ready to join into the
    title page/block. This is the SAME format-agnostic ordering/labeling
    logic DOCX and ODT use for their own title blocks — resolve_note_sections
    (abstract-first ordering) and append_extra_sections (title_case labels +
    split_paragraphs body chunks) both live in sw_merge_helpers.py and are
    shared unchanged; only the make_heading/make_body callbacks below are
    LaTeX-specific (DOCX/ODT supply their own, building XML elements instead
    of markdown strings).

    Every fragment (heading or paragraph) carries a LEADING \\medskip: pandoc's
    default LaTeX template loads the `parskip` package unconditionally, which
    removes first-line paragraph indentation in favor of vertical space
    between paragraphs — but that vertical space is barely visible at the
    small font size used on the title page, reading as one run-on paragraph
    even when it's several. \\medskip gives a clearly visible gap before
    every heading and every paragraph, regardless of font size/context.
    """
    parts = []
    append_extra_sections(
        parts, resolve_note_sections(abstract, extra_sections),
        make_heading=lambda label: f'```{{=latex}}\n\\medskip\n```\n**{label}**\n\n',
        make_body=lambda chunk: f'```{{=latex}}\n\\medskip\n```\n{chunk}\n\n',
    )
    return parts


def _latex_multiline(text):
    """Render a multi-line value (the author block) as markdown with hard line
    breaks (backslash + newline) so pandoc keeps the name/affiliation/date on
    separate lines. Single-line values are returned unchanged."""
    lines = [l for l in str(text or '').splitlines() if l.strip()]
    return '\\\n'.join(lines)


def _latex_titlepage_block(title, subtitle, author, date_val, abstract, extra_sections):
    """A standalone title page, as markdown+raw-LaTeX body content: raw
    \\begin{titlepage}/size commands wrapping ordinary markdown paragraphs
    (title/subtitle/author/date/abstract each still go through pandoc's
    normal markdown->LaTeX rendering, so e.g. *italics* in a title works).

    Needed because pandoc's own \\maketitle only lands on its own page
    automatically for the book/report classes — not article — so this same
    construction is used for all three doc types instead of relying on
    per-class native behaviour. Same information as the DOCX/ODT title
    block's Title/Subtitle/Author/Date/Abstract + note:/sw-* slots.

    \\swTitleLogo is a template-defined hook (empty by default — see
    book.tex) a user can redefine to \\includegraphics a logo above the
    title, without touching this function.
    """
    parts = ['```{=latex}\n\\begin{titlepage}\n\\thispagestyle{empty}\n'
             '\\centering\n\\swTitleLogo\n\\vspace*{3cm}\n\\LARGE\n```\n']
    parts.append(f'{title}\n\n' if title else '\n')
    if subtitle:
        parts.append('```{=latex}\n\\large\n```\n')
        parts.append(f'{subtitle}\n\n')
    parts.append('```{=latex}\n\\vspace{2cm}\n\\normalsize\n```\n')
    if author:
        parts.append(f'{_latex_multiline(author)}\n\n')
    if date_val:
        parts.append(f'{date_val}\n\n')
    notes_parts = _latex_notes_parts(abstract, extra_sections)
    if notes_parts:
        parts.append('```{=latex}\n\\vspace{1.5cm}\n'
                     '\\begin{minipage}{0.8\\textwidth}\\small\n```\n')
        parts.extend(notes_parts)
        parts.append('```{=latex}\n\\end{minipage}\n```\n')
    parts.append('```{=latex}\n\\end{titlepage}\n```\n\n')
    return ''.join(parts)


def _latex_title_block(title, subtitle, author, date_val, abstract, extra_sections):
    """A title BLOCK (not a page), as markdown+raw-LaTeX body content:
    title/subtitle/author/date centered at the top of page 1, immediately
    followed by the abstract/note:/sw-* sections (if any) and body content
    on the SAME page — no page break. Matches document.docx/document.odt
    and article.docx/article.odt, whose title/subtitle/author/date are
    ordinary paragraphs, not a dedicated cover page (only book.docx/book.odt
    gets a real cover page — see _latex_titlepage_block above).

    \\swTitleLogo is a template-defined hook (empty by default — see
    document.tex) a user can redefine to \\includegraphics a logo above the
    title, without touching this function.
    """
    parts = ['```{=latex}\n\\thispagestyle{plain}\n\\begin{center}\n'
             '\\swTitleLogo\n{\\huge\\bfseries\n```\n']
    parts.append(f'{title}\n\n' if title else '\n')
    parts.append('```{=latex}\n}\n```\n')
    if subtitle:
        parts.append('```{=latex}\n{\\Large\n```\n')
        parts.append(f'{subtitle}\n\n')
        parts.append('```{=latex}\n}\n```\n')
    if author:
        parts.append(f'{_latex_multiline(author)}\n\n')
    if date_val:
        parts.append(f'{date_val}\n\n')
    parts.append('```{=latex}\n\\end{center}\n\\vspace{1em}\n```\n\n')
    notes_parts = _latex_notes_parts(abstract, extra_sections)
    if notes_parts:
        parts.append('```{=latex}\n\\begin{quotation}\\noindent\n```\n')
        parts.extend(notes_parts)
        parts.append('```{=latex}\n\\end{quotation}\n```\n')
    return ''.join(parts)


def export_latex(compiled_md, vault_root=None, template=None, toc=False,
                 toc_levels=None, tof=False, endnotes_mode='none',
                 template_dir=None, output_dir=None,
                 default_author=None, new_page_headings=True,
                 restart_footnotes=True, mappings_data=None, generate_date=True,
                 roman_frontmatter=False, page1_starts_with='',
                 csl_style_override=None, csl_from_template=False,
                 output_name=None, citations_input=None,
                 citations_converted=False, include_bibliography=True,
                 as_pdf=False):
    """Export compiled markdown to LaTeX (.tex), or — when as_pdf — straight
    to PDF via pandoc's own --pdf-engine=lualatex. No LibreOffice, no
    intermediate file: pandoc goes from markdown to PDF in one call.

    Unlike export_document (DOCX/ODT), there is no merge step: LaTeX's own
    engine computes TOC/figure/footnote numbering and pagination natively
    (a book-class \\chapter always starts a new page and always resets to the
    `plain` page style for its own first page — the "no header on a chapter
    opener" rule falls out of that for free), so none of sw_merge_helpers'
    DOCX/ODT XML machinery applies here. Citations are always static
    (pandoc's own --citeproc) — LaTeX has no live-field concept, matching the
    PDF-via-DOCX/ODT path. Custom style mappings (arbitrary callout -> named
    style) have no LaTeX equivalent and are not applied here.

    tof (Table of Figures) and new_page_headings (page break before each
    top-level heading) both apply here too — via \\listoffigures and a
    template-side \\newpage token respectively — matching DOCX/ODT, though
    book's top-level heading (\\chapter) always starts a new page regardless
    of new_page_headings, same as DOCX/ODT's own book template.
    restart_footnotes drives section-scoped FIGURE numbering for
    document/article via a template-side token (article-class has no native
    equivalent to fall back on). Footnotes are deliberately NOT tied to this
    flag: book.cls already resets them to plain numbers at every \\chapter,
    and article-class footnotes are naturally continuous — both exactly the
    desired behaviour with zero custom code, so reimplementing either would
    just be redundant (DOCX/ODT need their own restart logic because
    Word/LibreOffice have no native equivalent at all; LaTeX does).
    """
    import subprocess
    import shutil as _sh
    import tempfile as _tempfile
    compiled_md  = Path(compiled_md)
    vault_root   = vault_root or vault_rel()
    template_dir = resolve_template_dir(template_dir, vault_root)

    text = compiled_md.read_text(encoding='utf-8')
    meta = _parse_yaml_metadata(text, compiled_md.stem)

    tpl = template if template is not None else meta['tpl']
    tpl = re.sub(r'\.(docx|odt|tex)$', '', tpl, flags=re.IGNORECASE)
    if tpl.startswith('compile-'):
        tpl = tpl[len('compile-'):]
    is_book = tpl.startswith('book')

    doc_title, doc_subtitle, doc_author, doc_date = resolve_cover(
        meta['title'], meta['subtitle'], meta['author'] or default_author,
        meta['date_val'], compiled_md.stem, generate_date=generate_date)
    doc_abstract   = meta['abstract']
    extra_sections = meta['extra_sections']
    short_title    = meta['short_title'] or doc_title

    out_dir = Path(output_dir).expanduser() if output_dir else compiled_md.parent
    out_dir.mkdir(parents=True, exist_ok=True)
    out_ext  = '.pdf' if as_pdf else '.tex'
    out_stem = _resolve_output_stem(output_name, compiled_md.stem)
    out_path = out_dir / f"{out_stem}{out_ext}"

    template_path = _resolve_template_path(tpl, '.tex', template_dir)

    # ── Citation conversion + markdown pre-processing (shared with DOCX/ODT) ──
    citations_md = compiled_md.with_suffix('.citations.md')
    if citations_input:
        # The caller already converted citations (plugin path; no external Node).
        cit_text = Path(citations_input).read_text(encoding='utf-8')
        citations_md.write_text(cit_text, encoding='utf-8')
    else:
        conv_script = plugin_script_path('convert-citations.mjs')
        node_bin    = os.environ.get('SW_NODE', 'node')
        subprocess.run([node_bin, conv_script, str(compiled_md), str(citations_md)],
                       check=True)
        cit_text = citations_md.read_text(encoding='utf-8')

    cit_text = ensure_blank_before_headings(cit_text)
    cit_text = rewrite_poetry_callouts(cit_text)
    cit_text = preprocess_md_syntax(cit_text)
    cit_text = resolve_embed_links(cit_text)
    cit_text, has_figures = latex_process_images(cit_text)
    cit_text = strip_wikilinks(cit_text)
    cit_text = linkify_bare_urls(cit_text)

    # NOTE: headings are converted to raw LaTeX near the END of this function
    # (see latexize_headings below), AFTER the \mainmatter insertion and the
    # bibliography-heading strip — both of those search for Markdown "#"
    # headings, so latexizing first would make them find nothing (which is
    # exactly the bug that silently dropped \mainmatter and left a book in
    # roman numerals throughout).

    # Strip the note's own YAML frontmatter — pandoc reads title/author/date
    # from IT directly (independent of any --metadata CLI flag, and even an
    # empty --metadata override doesn't unset a $if(title)$ check), which
    # would trigger pandoc's own \maketitle. Everything in it we still need
    # (title/subtitle/author/date/abstract) is already in the Python
    # variables above (via _parse_yaml_metadata + resolve_cover).
    # Must happen BEFORE the book frontmatter injection below: extract_yaml
    # only matches a "---" block at the very start of the text, and the
    # \frontmatter raw block would otherwise get prepended first, pushing the
    # YAML out of position-0 and silently defeating the strip (only visible
    # for book, since article/document never prepend anything here).
    _, cit_text = extract_yaml(cit_text)

    # ── CSL style resolution (same priority chain as the static/PDF path) ──────
    zmeta = _parse_zotero_meta(text)
    csl_style, _csl_is_override = _resolve_export_csl_style(
        text, template_path, 'latex',
        override=csl_style_override, from_template=csl_from_template)
    citekeys  = _extract_citekeys(cit_text)
    csl_items = _fetch_zotero_csl_items(citekeys, csl_style, zmeta['client'], zmeta['library'])
    csl_path  = _fetch_csl_style_file(csl_style, zmeta['client'])

    # A note's own pre-existing 'Bibliography' heading (e.g. hand-typed
    # references predating ScholarWeft's citation system) duplicates
    # pandoc's own --citeproc-rendered one once real bibliography entries are
    # actually resolved (DocumentCompiler.py passes --metadata
    # reference-section-title=Bibliography below) — strip it from the source
    # before pandoc ever sees it, mirroring DOCX/ODT's own
    # duplicate-bibliography handling (sw_export_merge.py /
    # sw_export_odt_merge.py, via the shared strip_duplicate_bibliographies).
    # Gated on csl_items (the actually-fetched entries), not just citekeys:
    # citekeys is a raw text scan for "@key" patterns and stays non-empty even
    # when Zotero isn't running / a key doesn't resolve, in which case pandoc
    # renders no bibliography of its own — the note's hand-typed one is the
    # only content there is, and stripping it would silently delete it.
    if csl_items:
        cit_text = strip_bibliography_heading_from_markdown(cit_text)

    # ── Book only: roman-numeral frontmatter -> \mainmatter, inserted at the
    # reset heading DOCX/ODT use too (find_page_reset_index, shared) — a raw
    # LaTeX block in the compiled markdown, since it must sit in the BODY,
    # not the preamble (it fires mid-document, at whichever heading resets
    # to arabic numbering).
    if is_book and roman_frontmatter:
        h1_positions = [m.start() for m in re.finditer(r'^# .+$', cit_text, re.M)]
        h1_texts = [cit_text[p:cit_text.find('\n', p)].lstrip('# ').strip()
                   for p in h1_positions]
        reset_idx = find_page_reset_index(h1_texts, page1_starts_with)
        if reset_idx is not None:
            cut = h1_positions[reset_idx]
            cit_text = (cit_text[:cut]
                       + '```{=latex}\n\\mainmatter\n```\n\n'
                       + cit_text[cut:])

    # LaTeX needs no endnote-mode handling: 'native' and 'body' both arrive as
    # the compiler's Notes section (LaTeX has no word-processor endnote object
    # to convert to, and no awkwardness about putting chapter headings inside
    # the note stream). See main()'s endnotes_mode resolution: for a .tex
    # target, 'native' is folded to 'body'.

    # ── Front matter, in reading order: title page/block first, then (book
    # only, roman_frontmatter) \frontmatter switching to roman page numbers,
    # then the table of contents. All built as body content (raw LaTeX
    # wrapping ordinary markdown paragraphs, so title/subtitle/etc. still go
    # through pandoc's normal markdown->LaTeX rendering) and placed manually
    # here rather than via pandoc's own --toc, which would render the TOC
    # BEFORE $body$ entirely — i.e. before the title page/block itself,
    # since pandoc's template always emits TOC ahead of body content.
    # Manual placement also means the TOC sits under the same \frontmatter
    # roman-numbering as the title page, with no separate
    # --include-before-body plumbing needed.
    #
    # "document"/"article" get a title block flowing directly into the body
    # (matching their DOCX/ODT analogs, which have no section break there);
    # "book" gets a dedicated title page (matching book.docx/.odt's own
    # section-break-separated cover). Either way we deliberately do NOT pass
    # title/subtitle/author/date as pandoc metadata — that would trigger a
    # redundant \maketitle, which only gets its own page automatically for
    # book/report anyway, not article.
    title_block_fn = _latex_titlepage_block if is_book else _latex_title_block
    # secnumdepth 0: LaTeX prints an automatic number ONLY for chapters (level
    # 0). Sections and deeper are emitted starred by latexize_headings and keep
    # their literal compiler-written number in the text, so there is nothing for
    # LaTeX to number at those levels. The old `numbersections=true` (which set
    # secnumdepth to 5) was belt-and-braces from before heading numbering moved
    # into the compiler; 0 is the honest setting and can't double-number a
    # section. An unstarred \chapter still steps the chapter counter, which is
    # what per-chapter figure numbering needs.
    front_matter = ('```{=latex}\n\\setcounter{secnumdepth}{0}\n```\n\n'
                    + title_block_fn(
                        doc_title, doc_subtitle, doc_author, doc_date,
                        doc_abstract, extra_sections))

    # ── Headings -> raw LaTeX (MUST run after every step above that searches
    # for Markdown "#" headings: the \mainmatter insertion and the
    # bibliography-heading strip). Only a NUMBERED chapter gets LaTeX's
    # automatic number; every other heading is unnumbered (\chapter*/\section*/
    # …) and simply shows whatever literal number the compiler wrote into its
    # text (e.g. "1.1", or "1." for a numbered section under an unnumbered
    # parent). LaTeX's own sectioning counters are therefore untouched, which
    # keeps per-chapter figure numbering correct (it needs the chapter counter
    # alive) — see the @@ note at the top of this file for the numbering rule.
    # Emitting raw LaTeX (via the raw_attribute passthrough pandoc is already
    # run with) is what makes the star/no-star choice possible at all: pandoc
    # on its own numbers ALL headings or NONE, and never emits a starred form.
    cit_text = latexize_headings(cit_text, is_book)

    if is_book and roman_frontmatter:
        front_matter += '```{=latex}\n\\frontmatter\n```\n\n'
    if toc:
        # toc-levels (export property, default 2) = deepest heading level the
        # TOC shows: 1 = chapters only, 2 = chapters + sections. LaTeX's
        # tocdepth is exactly this number, so it needs no other plumbing.
        _toc_depth = toc_levels if toc_levels and toc_levels > 0 else 2
        front_matter += (f'```{{=latex}}\n{{\\setcounter{{tocdepth}}{{{_toc_depth}}}\n'
                         '\\tableofcontents\n}\n```\n\n')
    # Matches DOCX/ODT: only render a Table of Figures when the "Include
    # table of figures" checkbox is on AND the document actually contains at
    # least one captioned figure — otherwise \listoffigures would print an
    # empty, heading-only section.
    if tof and has_figures:
        front_matter += '```{=latex}\n\\listoffigures\n```\n\n'
    cit_text = front_matter + cit_text

    # ── Notes: print the enotez list at the END OF THE BODY, before pandoc's
    # --citeproc bibliography. Pandoc appends its CSLReferences bibliography
    # after the body, so putting \printendnotes in the body (rather than via
    # --include-after-body, which lands AFTER the bibliography) is what makes
    # Notes precede Bibliography — the usual academic order, and what the
    # DOCX/ODT body-endnotes pipeline already does. \swnotesfixids (book) must
    # run first so enotez's <split-level-id> resolves to the same unique
    # per-chapter id \swnotesheading was keyed on. The "Notes" TOC entry is
    # added by \AtEveryEndnotesList (see the preamble below) so it lands on the
    # first notes page, i.e. AFTER \chapter*{Notes}'s page break.
    if endnotes_mode and endnotes_mode != 'none':
        cit_text = cit_text.rstrip() + (
            '\n\n```{=latex}\n'
            + ('\\swnotesfixids\n' if is_book else '')
            + '\\printendnotes\n'
            + '```\n')

    citations_md.write_text(cit_text, encoding='utf-8')

    # ── Lua filters: poetry -> verse (sw-export.lua), bidi, etc. No
    # sw-doc-title.lua — its "fall back to source-note" title logic would set
    # meta.title from --metadata source-note=..., re-triggering pandoc's own
    # \maketitle (which we deliberately avoid — see the title-page block
    # below); resolve_cover already gives the same basename fallback. No
    # sw-zotero.lua (always static) and no style-mappings filter (no LaTeX
    # equivalent for a named custom style).
    filters = [
        plugin_script_path('sw-callouts.lua'),
        plugin_script_path('sw-export.lua'),
        plugin_script_path('sw-poetry.lua'),
        plugin_script_path('sw-bidi.lua'),
    ]
    filters += find_user_lua_filters(template_dir)
    filter_args = []
    for f in filters:
        filter_args += ['--lua-filter', f]

    tmp_dir = Path(_tempfile.mkdtemp())
    try:
        biblio_path = tmp_dir / 'bibliography.json'
        biblio_path.write_text(json.dumps(csl_items, ensure_ascii=False), encoding='utf-8')

        # ── Preamble include: the resolved .tex template, with its
        # SWTOKAUTHOR / SWTOKSHORTTITLE placeholders substituted for the real
        # (LaTeX-escaped) values — NOT pandoc $variable$ syntax, which raw
        # --include-in-header content would have LaTeX read as inline math.
        preamble_src = (Path(template_path).read_text(encoding='utf-8')
                        if os.path.exists(template_path) else '')

        # Extra \documentclass options, read from a marker COMMENT line in
        # the template (e.g. "% SWEXTRACLASSOPTIONS: twocolumn") — a plain
        # --include-in-header preamble can't change \documentclass's own
        # options (twoside is fixed, needed by the running-header
        # convention), since that line has already executed by the time
        # this file's content runs. This is the one documentclass-level knob
        # exposed to the template anyway, for things like twocolumn/12pt
        # that only take effect as class options, not as later \usepackage
        # settings.
        extra_classoptions = []
        m = re.search(r'^%[ \t]*SWEXTRACLASSOPTIONS:[ \t]*(.*)$', preamble_src, re.M)
        if m:
            extra_classoptions = [o.strip() for o in m.group(1).split(',') if o.strip()]

        # "Restart footnote and figure numbering per chapter" (restart_footnotes)
        # only affects FIGURE numbering here, and only for document/article —
        # footnotes are deliberately left to each class's own native behaviour
        # instead of being reimplemented: book.cls already resets footnotes to
        # plain "1, 2, 3..." at every \chapter and gives figures a "chapter.N"
        # \thefigure, both unconditionally and with zero custom code (confirmed
        # empirically — a bare \documentclass{book} already does both); article-
        # class footnotes are naturally continuous, which IS the desired
        # "non-book top-level sections don't restart" behaviour, so there's
        # nothing to add there either. The one gap LaTeX doesn't fill natively:
        # article-class has no per-section figure numbering, so
        # SWTOKFIGURECOUNTER supplies \counterwithin{figure}{section} for
        # document/article when the checkbox is on (see document.tex's own
        # list of tokens; book.tex doesn't have this token at all).
        #
        # "Top-level headings start on a new page" (new_page_headings) has no
        # native equivalent for document/article either, hence
        # SWTOKNEWPAGEHEADING there (book's \chapter always starts a new page
        # regardless, so book.tex has no such token).
        #
        # Single-line substitution values, deliberately: both tokens are also
        # named (as literal text) in each template's own top-of-file
        # documentation comment, so the blind string-replace below touches
        # that mention too — a value with an embedded newline would leave
        # everything after the break un-commented (missing its own leading
        # "%"), which is exactly what "! LaTeX Error: Missing \begin{document}"
        # turned out to mean the first time this was tried with a multi-line
        # value. A single-line value can never split a comment line in two,
        # whatever line it lands on.
        figure_counter_latex = (
            '\\counterwithin{figure}{section}' if restart_footnotes else ''
        )
        newpage_latex = '\\newpage' if new_page_headings else ''

        # Heading numbering is decided in the compiled markdown by the compiler
        # itself (see number_headings + latexize_headings): numbered chapters
        # use LaTeX's own number, every other heading is emitted starred with a
        # literal number. secnumdepth is set to 0 in the body (see front_matter)
        # so pandoc's own numbering can never add a second number. Titles keep
        # their styling from LaTeX's defaults (or the class's), not from
        # per-level \titleformat, which is why neither titlesec nor titletoc
        # appears here any more.

        preamble_src = (preamble_src
                        .replace('SWTOKAUTHOR', _latex_escape(first_line(doc_author) or ''))
                        .replace('SWTOKSHORTTITLE', _latex_escape(short_title or ''))
                        .replace('SWTOKTITLE', _latex_escape(doc_title or ''))
                        .replace('SWTOKFIGURECOUNTER', figure_counter_latex)
                        .replace('SWTOKNEWPAGEHEADING', newpage_latex))
        # LaTeX endnotes, natively: enotez collects pandoc's footnotes (both
        # author notes and note-style citations), splits the list by chapter and
        # restarts the numbering in each — the book's endnote layout.
        # \printendnotes is emitted at the end of the BODY (see above), before
        # pandoc's bibliography, so Notes precedes Bibliography.
        if endnotes_mode and endnotes_mode != 'none':
            # List heading: a chapter for book (Notes is a major back-matter
            # division with its own TOC entry and page), a section for
            # article/document. Per-chapter group headings sit one level below
            # (\section*), matching DOCX/ODT's Heading 1 / Heading 2 hierarchy.
            _notes_heading = '\\chapter*{#1}' if is_book else '\\section*{#1}'
            _notes_toc = 'chapter' if is_book else 'section'
            preamble_src += (
                '\n\\usepackage{enotez}\n'
                '\\let\\footnote\\endnote\n'
                # ~6pt between consecutive notes, at body size (\normalsize, not
                # enotez's default \footnotesize which is 8pt in a 10pt book).
                # The list preamble also zeroes \parskip: pandoc's template
                # loads parskip.sty (6pt between body paragraphs), and enotez's
                # notes are ordinary paragraphs, so without this each note got
                # notes-sep PLUS the 6pt body paragraph skip (a full blank line).
                '\\DeclareInstance{enotez-list}{swendnotes}{paragraph}\n'
                f'  {{notes-sep=6pt, format=\\normalsize, heading={_notes_heading}}}\n'
                # The "Notes" TOC entry is added from the endnote-list preamble,
                # which enotez runs AFTER the list heading — so for book it lands
                # on the first notes page, after \chapter*{Notes}'s page break
                # (adding it before, as enotez's own totoc option does, would
                # point the TOC at the previous page).
                '\\AtEveryEndnotesList{\\setlength{\\parskip}{0pt}'
                '\\phantomsection'
                f'\\addcontentsline{{toc}}{{{_notes_toc}}}{{Notes}}}}\n')
            if is_book:
                preamble_src += (
                    # Each chapter defines \swnotesheading<id> (see
                    # latexize_headings): "Chapter N" for a numbered chapter,
                    # the bare title for an unnumbered one — so a group reads
                    # "Notes for Chapter 1" / "Notes for Introduction", never
                    # "Notes for Chapter 0". The id is enotez's own per-chapter
                    # split counter (incremented by every \chapter, starred or
                    # not), so starred chapters get distinct ids.
                    '\\ExplSyntaxOn\n'
                    '\\cs_new:Npn \\swnotesgroupid '
                    '{ \\int_use:N \\g__enotez_list_printed_int }\n'
                    # enotez's <split-level-id> tag expands to \value{chapter},
                    # which starred chapters do NOT advance — so Preface and
                    # Introduction (both 0) and Chapter 2 and Conclusion (both 2)
                    # would look up the same label. Rebuild that property from
                    # enotez's own unique split counter (run by \swnotesfixids
                    # just before \printendnotes) so the lookup key matches the
                    # key \swnotesheading was stored under.
                    '\\cs_new_protected:Npn \\swnotesfixids {\n'
                    '  \\prop_map_inline:Nn \\g__enotez_endnote_split_prop\n'
                    '    { \\prop_gput:Nnn \\g__enotez_endnote_sect_id_prop'
                    ' {##1} {##2} }\n'
                    '}\n'
                    '\\ExplSyntaxOff\n'
                    # split-heading is starred so the per-chapter groups stay
                    # out of the TOC (only the "Notes" list heading is added).
                    '\\setenotez{list-style=swendnotes, list-name=Notes, '
                    'counter-format=arabic, split=chapter, reset, '
                    'split-heading={\\section*{#1}}, '
                    'split-title={Notes for \\csname swnotesheading'
                    '<split-level-id>\\endcsname}}\n')
            else:
                # No chapters to split by: one flat list (article-class
                # footnotes are continuous), matching DOCX/ODT's global mode.
                preamble_src += (
                    '\\setenotez{list-style=swendnotes, list-name=Notes, '
                    'counter-format=arabic, split=false}\n')
        # Tighter spacing between bibliography entries: pandoc's CSLReferences
        # environment (defined in pandoc's own template, BEFORE this include)
        # hard-codes \itemsep to its entry-spacing argument, which pandoc always
        # passes as 1 (= one full \baselineskip) — hence the full blank line
        # between references. Redefine it with the same body but ~6pt, matching
        # the endnote spacing. Only when pandoc will actually emit the
        # environment: it is undefined when there is no bibliography (no
        # resolved items, or --no-bibliography/suppress-bibliography), and
        # \renewenvironment on an undefined environment is an error.
        if csl_items and include_bibliography:
            preamble_src += (
                '\\renewenvironment{CSLReferences}[2]\n'
                ' {\\begin{list}{}{%\n'
                '  \\setlength{\\itemindent}{0pt}\n'
                '  \\setlength{\\leftmargin}{0pt}\n'
                '  \\setlength{\\parsep}{0pt}\n'
                '  \\ifodd #1\n'
                '   \\setlength{\\leftmargin}{\\cslhangindent}\n'
                '   \\setlength{\\itemindent}{-1\\cslhangindent}\n'
                '  \\fi\n'
                '  \\setlength{\\itemsep}{6pt}}}\n'
                ' {\\end{list}}\n')
        preamble_path = tmp_dir / 'preamble.tex'
        preamble_path.write_text(preamble_src, encoding='utf-8')

        engine = find_latex_engine()
        if as_pdf and not engine:
            raise RuntimeError(
                'PDF export via LaTeX needs lualatex installed (part of any '
                'TeX distribution: MacTeX/BasicTeX on macOS, MiKTeX on '
                'Windows, TeX Live on Linux). Install one, or export to '
                'DOCX/ODT and convert to PDF via LibreOffice instead.')

        cmd = [os.environ.get('SW_PANDOC', 'pandoc'), str(citations_md),
               '-t', 'latex',
               '-f', 'markdown+wikilinks_title_after_pipe'
                     '+lists_without_preceding_blankline+raw_attribute',
               *filter_args,
               '--citeproc', '--bibliography', str(biblio_path),
               '--metadata', 'reference-section-title=Bibliography',
               # Link each in-text citation to its bibliography entry; with
               # citecolor=black (below) the link is invisible but clickable.
               '--metadata', 'link-citations=true',
               *(['--metadata', 'suppress-bibliography=true']
                 if not include_bibliography else []),
               '--include-in-header', str(preamble_path),
               '--metadata', f'documentclass={"book" if is_book else "article"}',
               '--metadata', 'classoption=twoside',
               # No numbersections: every heading is emitted as raw LaTeX by
               # latexize_headings, and secnumdepth=0 (set in the body) allows
               # only the numbered \chapter{} forms to print a number. An
               # unstarred \chapter still steps LaTeX's chapter counter, which
               # is what per-chapter figure numbering needs; there is nothing to
               # gain from letting pandoc number headings itself.
               *[a for opt in extra_classoptions
                 for a in ('--metadata', f'classoption={opt}')],
               # Font, page size/margins, and link color are NOT set here —
               # each template sets its own via \setmainfont/geometry/
               # \definecolor{swlinkcolor}(...) directly, so a user can copy
               # a template and edit those values without touching Python.
               # colorlinks/linkcolor/citecolor/urlcolor below just wire
               # pandoc's own hypersetup call (which runs AFTER our
               # --include-in-header content, so it can already see
               # swlinkcolor) to the template-defined color name.
               '--metadata', 'colorlinks=true',
               # Internal links — TOC/ToF entries, cross-references, footnote
               # marks and citations — are BLACK: these are print documents,
               # and only EXTERNAL internet links should carry the link colour
               # (swlinkcolor, below).
               '--metadata', 'linkcolor=black',
               '--metadata', 'citecolor=black',
               '--metadata', 'urlcolor=swlinkcolor',
               '--metadata', f'source-note={compiled_md.stem}']
        if is_book:
            # Force \chapter for level-1 headings explicitly, rather than
            # relying on pandoc's own book/report-class detection: that
            # detection only fires when documentclass is set as a template
            # VARIABLE (-V) rather than metadata (-M, used above so the value
            # still reaches $documentclass$ in --include-in-header's
            # surrounding template) — and it is bundled together with an
            # auto-inserted \frontmatter/\mainmatter/\backmatter (pandoc's
            # own $if(has-frontmatter)$ blocks) that would duplicate our own
            # precisely-placed \frontmatter/\mainmatter raw blocks above,
            # producing extra blank pages and page-numbering churn. Setting
            # documentclass via -V to only ever get \chapter, without also
            # getting has-frontmatter's side effect, isn't possible — the two
            # are keyed off the same internal check — so --top-level-division
            # is used instead: it selects \chapter independently of that
            # book-class detection, leaving has-frontmatter false. Confirmed
            # via isolated pandoc test: -M documentclass=book alone -> \section;
            # -V documentclass=book -> \chapter + duplicate \frontmatter/etc.;
            # -M documentclass=book --top-level-division=chapter -> \chapter,
            # no duplicate \frontmatter/\mainmatter/\backmatter.
            cmd += ['--top-level-division=chapter']
        # title/subtitle/author/date are deliberately NOT passed as pandoc
        # metadata — that would also trigger pandoc's own \maketitle,
        # duplicating the title page/block we already built into the body
        # above. The PDF's internal pdftitle/pdfauthor metadata is the one
        # thing not replicated for LaTeX output as a result (a cosmetic gap,
        # not a content one) — see document.tex's own note on this.
        if csl_path:
            cmd += ['--csl', csl_path]
        # --toc is deliberately NOT passed: the table of contents is placed
        # manually in the body above (right after the title page/block)
        # instead, so it doesn't render before that content the way pandoc's
        # own --toc always does.
        if as_pdf:
            cmd += ['--pdf-engine', engine, '-o', str(out_path)]
        else:
            cmd += ['-o', str(out_path)]
        print('Running pandoc:', ' '.join(cmd))
        subprocess.run(cmd, check=True)
    finally:
        _sh.rmtree(tmp_dir, ignore_errors=True)
        citations_md.unlink(missing_ok=True)

    print(f'Exported [{tpl}] → {out_path}')
    print(str(out_path))   # last line — parsed by exportCompiler.ts as the output path
    return str(out_path)


def export_pdf(compiled_md, vault_root=None, template=None, toc=False,
               toc_levels=None, tof=False, endnotes_mode='none',
               generate_date=True, roman_frontmatter=False, page1_starts_with='',
               template_dir=None, output_dir=None,
               new_page_headings=True, restart_footnotes=True,
               intermediate_format=None, keep_intermediate=False,
               mappings_data=None, csl_style_override=None,
               csl_from_template=False, output_name=None,
               citations_input=None, citations_converted=False,
                include_bibliography=True):
    """Export to PDF via an intermediate ODT, DOCX, or LaTeX file.

    The intermediate format is auto-determined from the template: ODT is
    preferred when an ODT template file exists, then DOCX, then LaTeX (a
    bare template name with only a .tex file falls back to it; an explicit
    "book.tex" always means LaTeX). Pass intermediate_format='docx' / 'odt' /
    'latex' to override.

    ODT/DOCX use LibreOffice headless for the -> PDF conversion (no
    fallback: needs a large separate PDF engine, has unicode/font issues,
    and produces output unlike the word-processor rendering — see
    export_document's docstring). LaTeX instead uses pandoc's own
    --pdf-engine=lualatex, straight from markdown to PDF — no LibreOffice,
    no intermediate file needed at all (see export_latex).
    """
    import tempfile, shutil as _sh
    compiled_md = Path(compiled_md)
    vault_root = vault_root or vault_rel()
    out_dir = Path(output_dir).expanduser() if output_dir else compiled_md.parent
    out_dir.mkdir(parents=True, exist_ok=True)

    # Auto-determine intermediate format when not explicitly specified.
    if intermediate_format is None:
        text = compiled_md.read_text(encoding='utf-8')
        meta = _parse_yaml_metadata(text, compiled_md.stem)
        raw_tpl = template if template is not None else meta['tpl']
        # The export dialog passes a specific template ("book.docx" vs
        # "book.odt" vs "book.tex") — that choice IS the intended intermediate
        # format; a bare name (from frontmatter) prefers ODT, then DOCX, then
        # LaTeX. See resolve_intermediate_format (also used by main()'s
        # endnotes decision so both agree).
        intermediate_format = resolve_intermediate_format(
            raw_tpl, resolve_template_dir(template_dir, vault_root), vault_root)
        print(f'PDF intermediate format auto-determined: {intermediate_format}')

    if intermediate_format == 'latex':
        # pandoc goes straight from markdown to PDF — no intermediate file,
        # no LibreOffice. keep_intermediate additionally asks for the .tex
        # pandoc would have produced along the way, via one extra (cheap,
        # no lualatex) pandoc call.
        latex_kwargs = dict(
            vault_root=vault_root, template=template, toc=toc,
            toc_levels=toc_levels, tof=tof, endnotes_mode=endnotes_mode,
            template_dir=template_dir, output_dir=str(out_dir),
            new_page_headings=new_page_headings,
            restart_footnotes=restart_footnotes,
            mappings_data=mappings_data, generate_date=generate_date,
            roman_frontmatter=roman_frontmatter, page1_starts_with=page1_starts_with,
            csl_style_override=csl_style_override,
            csl_from_template=csl_from_template, output_name=output_name,
            citations_input=citations_input, include_bibliography=include_bibliography)
        if keep_intermediate:
            tex_path = export_latex(compiled_md, as_pdf=False, **latex_kwargs)
            print(f'Intermediate LaTeX kept at: {tex_path}')
        out_pdf = export_latex(compiled_md, as_pdf=True, **latex_kwargs)
        print(f'\nExported PDF written to {out_pdf}')
        print(str(out_pdf))
        return str(out_pdf)

    # Export to the intermediate format in a temp directory.
    tmp_dir = Path(tempfile.mkdtemp())
    try:
        common_kwargs = dict(
            vault_root=vault_root, template=template, toc=toc,
            toc_levels=toc_levels, tof=tof, endnotes_mode=endnotes_mode,
            template_dir=template_dir, output_dir=str(tmp_dir),
            new_page_headings=new_page_headings,
            restart_footnotes=restart_footnotes,
            mappings_data=mappings_data, generate_date=generate_date,
            roman_frontmatter=roman_frontmatter, page1_starts_with=page1_starts_with,
            csl_style_override=csl_style_override,
            csl_from_template=csl_from_template,
            # PDF has no live document to refresh fields in later, so let
            # pandoc's own --citeproc render final citations + bibliography
            # instead of live Zotero fields (see export_document's docstring).
            static_citations=True,
            citations_input=citations_input, include_bibliography=include_bibliography)
        if intermediate_format == 'docx':
            inter_path = Path(export_docx(compiled_md, **common_kwargs))
        else:
            inter_path = Path(export_odt(compiled_md, **common_kwargs))

        out_stem = _resolve_output_stem(output_name, compiled_md.stem)
        out_pdf = out_dir / f"{out_stem}.pdf"

        # LibreOffice headless — renders the document identically to what the
        # user sees on screen, honouring all template styles. Required: there
        # is no fallback (see the docstring).
        soffice = find_soffice()
        if not soffice:
            raise RuntimeError(
                'PDF export needs LibreOffice installed (it converts the '
                'DOCX/ODT to PDF). Install LibreOffice, or export to DOCX/ODT '
                'and convert to PDF yourself.')
        import subprocess
        # Convert INTO the temp dir, never the output dir — LibreOffice names
        # its output <intermediate-stem>.pdf, which would clobber a real
        # export the user keeps under the note's own name. Move it to the
        # final name afterwards (the only file we touch in out_dir).
        cmd = [soffice, '--headless', '--convert-to', 'pdf',
               '--outdir', str(tmp_dir), str(inter_path)]
        print('Converting to PDF via LibreOffice:', ' '.join(cmd))
        subprocess.run(cmd, check=True)
        lo_out = tmp_dir / f"{inter_path.stem}.pdf"
        if not lo_out.exists():
            raise RuntimeError('LibreOffice did not produce a PDF '
                               f'({lo_out} missing).')
        _sh.move(str(lo_out), str(out_pdf))

        if keep_intermediate:
            dest = out_dir / f"{out_stem}{inter_path.suffix}"
            _sh.copy2(str(inter_path), str(dest))
            print(f'Intermediate {intermediate_format.upper()} kept at: {dest}')

        print(f'\nExported PDF written to {out_pdf}')
        print(str(out_pdf))   # last line — parsed by exportCompiler.ts as the output path
        return str(out_pdf)
    finally:
        _sh.rmtree(tmp_dir, ignore_errors=True)


def main():
    parser = argparse.ArgumentParser(description='Compile an Obsidian book outline to markdown (and optionally export to docx)')
    parser.add_argument('master_file', help='Path to the master markdown file (outline or compiled)')
    parser.add_argument('--global-footnotes', action='store_true',
                       help='Use global footnote numbering (default for article* templates; override for book* templates)')
    parser.add_argument('--no-global-footnotes', action='store_true',
                       help='Restart footnote numbering per chapter (default for book* templates; override for article* templates)')
    parser.add_argument('--export', action='store_true',
                       help='Also export to docx/odt via pandoc (see --format)')
    parser.add_argument('--format', dest='export_format', default='docx',
                       choices=['md', 'docx', 'odt', 'latex', 'pdf'],
                       help='Export format when --export is set: docx (default), odt, '
                            'latex, pdf, or md (compile only). The format also decides '
                            'whether endnotes are emitted (md/latex) or the notes stay '
                            'native footnotes (docx/odt).')
    parser.add_argument('--keep-intermediate', action='store_true',
                       help='Keep the intermediate docx/odt/tex when exporting to PDF')
    parser.add_argument('--keep-compiled-md', action='store_true',
                       dest='keep_compiled_md',
                       help='Keep the compiled markdown file after a docx/odt/pdf '
                            'export (default: delete it once the export is done; '
                            'has no effect for an already-compiled input file or '
                            'when --export is not given)')
    parser.add_argument('--template', default=None,
                       help='Override the template (default: read "template" YAML from the master file)')
    parser.add_argument('--toc', action='store_true',
                       help='Include a TOC field in the exported docx (default for book* templates)')
    parser.add_argument('--no-toc', action='store_true',
                       help='Omit the TOC field (default for article* templates; override for book* templates)')
    parser.add_argument('--list-of-figures', action='store_true',
                       dest='list_of_figures',
                       help='Include a table of figures (rendered only when the doc has figures; default for book*)')
    parser.add_argument('--no-list-of-figures', action='store_true',
                       dest='no_list_of_figures',
                       help='Omit the table of figures')
    parser.add_argument('--toc-levels', type=int, default=None, dest='toc_levels',
                       help='Deepest heading level the TOC shows (1 = chapters, '
                            '2 = chapters + sections; default 2, else the note\'s '
                            'toc-levels property). Overrides the template\'s own '
                            'configured TOC depth.')
    parser.add_argument('--numbering-levels', type=int, default=None,
                       dest='numbering_levels',
                       help='Levels to auto-number (0 = only @@-marked headings, the '
                            'default; 1 = chapters; 2 = chapters + sections). When set, '
                            '@@ is ignored and a "* " prefix marks an unnumbered '
                            'exception. Else the note\'s numbering-levels property.')
    parser.add_argument('--endnotes-mode', choices=['none', 'native', 'body'],
                       default=None, dest='endnotes_mode',
                       # default None so the note's own `endnotes` property is
                       # honoured when the flag is absent
                       help='How notes are rendered: none = footnotes (default); '
                            'native = real word-processor endnotes (DOCX/ODT) or a '
                            'Notes section (Markdown/LaTeX); body = a visible Notes '
                            'section divided by chapter (per-chapter numbering only).')
    # Historical aliases: --endnotes == native, --no-endnotes == none.
    parser.add_argument('--endnotes', action='store_const', const='native',
                       dest='endnotes_mode',
                       help='Alias for --endnotes-mode native.')
    parser.add_argument('--no-endnotes', action='store_const', const='none',
                       dest='endnotes_mode',
                       help='Alias for --endnotes-mode none.')
    parser.add_argument('--bibliography', action='store_true', default=None,
                       dest='bibliography',
                       help='Include a bibliography (default on). With a note/'
                            'footnote citation style, this is what keeps it.')
    parser.add_argument('--no-bibliography', action='store_false',
                       dest='bibliography',
                       help='Omit the generated bibliography.')
    parser.add_argument('--no-generated-date', action='store_true',
                       dest='no_generated_date',
                       help="Don't insert today's date when the doc has no date property")
    parser.add_argument('--roman-frontmatter', action='store_true',
                       dest='roman_frontmatter',
                       help='Roman-numeral frontmatter page numbers, arabic from the reset heading (default for book*)')
    parser.add_argument('--no-roman-frontmatter', action='store_true',
                       dest='no_roman_frontmatter')
    parser.add_argument('--page1-starts-with', default='', dest='page1_starts_with',
                       help='Heading text that begins arabic page 1 (blank = auto)')
    parser.add_argument('--new-page-headings', action='store_true', default=True,
                       help='Start each heading section on a new page (default: on)')
    parser.add_argument('--no-new-page-headings', action='store_true',
                       help='Do not insert page breaks before headings')
    parser.add_argument('--default-author', default=None,
                       help='Fallback author name when the document has no author property')
    parser.add_argument('--templates-dir', default=None,
                       help='Directory of user .docx/.odt export templates (default: <vault>/Export Templates/, '
                            'then the plugin\'s bundled sw-export-templates/)')
    parser.add_argument('--output-dir', default=None,
                       help='Directory for the compiled markdown and exported file (default: the source '
                            'file\'s own folder)')
    parser.add_argument('--output-name', default=None, dest='output_name',
                       help='Filename for the exported document (extension optional — '
                            'the format\'s own is used). Default: the source note\'s '
                            'name. The file is written to this name directly, so a '
                            'different name never touches an existing export.')
    parser.add_argument('--mappings', default=None,
                       help='JSON array of {source, styleName} objects for style mappings '
                            '(overrides mappings.json in the templates directory)')
    parser.add_argument('--csl-style', default=None, dest='csl_style',
                       help='Citation style for the export (a Zotero style name, a '
                            '.csl path, or a style URL). Overrides the template\'s '
                            'own style and the note\'s csl: property, and is written '
                            'into the exported DOCX/ODT\'s Zotero document preferences.')
    parser.add_argument('--csl-style-from-template', action='store_true',
                       dest='csl_from_template',
                       help='Ignore the note\'s csl: property; use the template\'s '
                            'embedded style (or the global default) only.')

    parser.add_argument('--citations-input', default=None, dest='citations_input',
                       help='Path to a markdown file whose citation wikilinks have '
                            'ALREADY been converted to pandoc syntax. When given, the '
                            'external Node.js conversion step is skipped (the plugin '
                            'converts in-process); when omitted, convert-citations.mjs '
                            'is run via Node as usual.')

    parser.add_argument('--prepare-convert', action='store_true', dest='prepare_convert',
                       help='Compile (if the input is an outline) and print the '
                            'resulting markdown path as the last stdout line, then '
                            'exit WITHOUT exporting. Used by the plugin, which '
                            'converts citations in-process and re-invokes with '
                            '--export --citations-input.')

    parser.add_argument('--static-bibliography', default=None, dest='static_bibliography',
                       help='Path to a CSL-JSON bibliography to render citations '
                            'statically from (--citeproc), instead of live Zotero '
                            'fields and instead of fetching from Zotero. Used by the '
                            'plugin when Zotero is unavailable. DOCX/ODT only.')
    parser.add_argument('--raw-citations', action='store_true', dest='raw_citations',
                       help='Do NOT use Zotero fields or --citeproc: leave citations as '
                            'literal text (e.g. [@citekey]). Used when the user chooses to '
                            'export without Zotero running. DOCX/ODT only.')
    parser.add_argument('--selftest', action='store_true', dest='selftest',
                       help='Run internal checks on the @@ numbering and heading->LaTeX '
                            'rules, print PASS/FAIL, and exit (no file is read or written).')

    args = parser.parse_args()

    if args.selftest:
        sys.exit(run_selftest())

    master_file = Path(args.master_file).expanduser()
    if not master_file.exists():
        print(f"Error: {master_file} does not exist.")
        sys.exit(1)

    text = master_file.read_text(encoding='utf-8')
    yaml_block, _ = extract_yaml(text)
    yaml_tpl = read_yaml_prop(yaml_block, 'template') if yaml_block else None

    # Decide: outline vs already-compiled.
    # 1. Explicit marker: template: compile-<name>
    explicit_compile = yaml_tpl and yaml_tpl.startswith('compile-')
    is_outline = explicit_compile or detect_outline(text)

    if explicit_compile:
        # template: compile-book2 → book2
        effective_tpl = yaml_tpl[len('compile-'):]
    else:
        effective_tpl = args.template or yaml_tpl
    effective_tpl = re.sub(r'\.(docx|odt)$', '', effective_tpl or 'document', flags=re.IGNORECASE)

    # Template-aware defaults (match the export modal's document-type presets):
    #   book*         -> TOC on,  footnote + figure numbering restart per chapter
    #   anything else -> TOC off, global footnote + figure numbering
    # (Heading 1 is a chapter only in a book; elsewhere it is a section.)
    is_book = effective_tpl.startswith('book')
    is_article = effective_tpl.startswith('article')
    use_toc = is_book
    use_tof = is_book
    use_roman = is_book
    use_global = not is_book
    if args.toc:
        use_toc = True
    if args.no_toc:
        use_toc = False
    if args.list_of_figures:
        use_tof = True
    if args.no_list_of_figures:
        use_tof = False
    if args.roman_frontmatter:
        use_roman = True
    if args.no_roman_frontmatter:
        use_roman = False
    if args.global_footnotes:
        use_global = True
    if args.no_global_footnotes:
        use_global = False

    # ── numbering-levels / toc-levels / endnotes ────────────────────────────────
    # Each is: the export dialog's explicit flag (which already folds in the
    # file's remembered setting and, below it, the note's YAML property) → the
    # note's own YAML property → the built-in default. Reading the property here
    # too means a bare `DocumentCompiler.py` run (no dialog) honours it.
    numbering_levels = (args.numbering_levels if args.numbering_levels is not None
                        else _yaml_int(text, 'numbering-levels', 0))
    toc_levels = (args.toc_levels if args.toc_levels is not None
                  else _yaml_int(text, 'toc-levels', 2))
    endnotes_mode = (args.endnotes_mode if args.endnotes_mode is not None
                     else _yaml_endnotes_mode(text))
    # 'body' always means a visible '# Notes' section: with per-chapter
    # numbering it is divided by chapter, with continuous numbering it is a
    # single list (see apply_note_style / render_notes_section).
    # For PDF, follow the intermediate the chosen template implies.
    target_fmt = args.export_format
    if target_fmt == 'pdf':
        target_fmt = resolve_intermediate_format(
            args.template or effective_tpl,
            resolve_template_dir(args.templates_dir, _VAULT_ABS), _VAULT_ABS)
    # The native/body distinction only exists for the word-processor formats:
    # 'native' converts the resolved footnotes into real DOCX/ODT endnote
    # objects in the merge; 'body' moves them into a visible '# Notes' section
    # (divided by chapter). LaTeX and Markdown have no endnote objects to
    # convert to, so both choices give them the same visible Notes section.
    use_native_endnotes = (endnotes_mode == 'native'
                           and target_fmt in ('docx', 'odt'))
    use_body_endnotes = (not use_native_endnotes and endnotes_mode != 'none'
                         and target_fmt != 'latex')
    # prepare-convert hands the compiled markdown to the plugin, which converts
    # citations and re-invokes for the export. For DOCX/ODT the endnote stream
    # is built in the EXPORT step, AFTER citation conversion, so the compiled
    # markdown must keep plain footnotes here — building a Notes section now
    # would strip the author notes before the citations inside them resolve.
    if args.prepare_convert and target_fmt in ('docx', 'odt'):
        use_body_endnotes = False

    print(f"Template: {effective_tpl} — TOC {'on' if use_toc else 'off'} "
          f"(levels {toc_levels}), footnotes "
          f"{'global' if use_global else 'per-chapter'}, "
          f"numbering-levels {numbering_levels}, endnotes {endnotes_mode}")

    # STEP 1 — compile (outlines only), IN MEMORY: assemble the linked notes
    # into one markdown string. A single note is already one document; its text
    # is read as-is. Nothing is written yet.
    if is_outline:
        print(f"Detected outline "
              f"({'explicit compile- template' if explicit_compile else 'bullet list without headings'}). "
              f"Compiling…")
        working = compile_book(master_file)
        if explicit_compile:
            working = rewrite_compiled_template_prop(working, effective_tpl)
    else:
        print("Not an outline (has headings, prose paragraphs, or no note "
              "includes). Treating as a compiled note; skipping compilation.")
        working = master_file.read_text(encoding='utf-8')

    # STEP 1b — citations → notes, IN MEMORY, BEFORE finalize: when the export
    # uses a note/footnote citation style (live DOCX/ODT fields), turn each
    # in-text citation into a footnote definition. Doing it here means the
    # shared finalize stage sees the author's OWN notes and the citation notes
    # as ONE stream, so with endnotes selected BOTH go to the endnote stream
    # instead of citations becoming separate page-bottom footnotes.
    citations_converted = False
    _live_note_export = (args.export and args.export_format in ('docx', 'odt')
                         and not args.raw_citations
                         and not args.static_bibliography)
    if _live_note_export:
        try:
            _tpl_path = _resolve_template_path(
                effective_tpl, '.docx' if args.export_format == 'docx' else '.odt',
                resolve_template_dir(args.templates_dir, _VAULT_ABS))
            if resolve_note_citation_style(
                    working, _tpl_path, args.export_format,
                    override=args.csl_style,
                    from_template=args.csl_from_template):
                if args.citations_input:
                    # The plugin converts the citation wikilinks in-process and
                    # hands the result back via --citations-input. THAT text is
                    # what pandoc consumes, so the in-text→footnote move has to
                    # run on it inside export_document — citations_converted
                    # stays False. (Moving citations in `working` here would be
                    # discarded AND would suppress the move on the real input.)
                    print('Note citation style — in-text citations will be moved '
                          'into notes in the export step (citations-input)')
                else:
                    working = citations_to_footnotes(working)
                    citations_converted = True
                    print('Note citation style — moved in-text citations into notes')
        except Exception as e:
            print(f'WARNING: could not convert citations to notes up front: {e}')

    # STEP 2 — finalize IN MEMORY: the ONE shared post-compile stage every
    # document goes through (footnote/endnote handling + whole-document
    # numbering). Identical for outlines and whole books written in one note.
    working = finalize_markdown(
        working, numbering_levels=numbering_levels,
        endnotes=use_body_endnotes, global_footnotes=use_global)

    # ── Bibliography decision (one place, all formats) ───────────────────────
    # The `include-bibliography` property/flag defaults to TRUE:
    #   • there are no references at all  → omit (always);
    #   • setting on                      → emit whenever there are references;
    #   • setting off                     → emit only for author-date citations
    #                                        (a note/footnote style omits it).
    # Since references and author-date citations are exactly what has_citations
    # and "not a note style" mean, this reduces to:
    #   include = has_citations and (setting or not note_style)
    bibliography_opt = (args.bibliography if args.bibliography is not None
                        else _yaml_bool(text, 'include-bibliography', True))
    has_citations = bool(re.search(r'\[\[@|(?<![\w@])@[A-Za-z]', working))
    target_fmt_bib = args.export_format
    if target_fmt_bib == 'pdf':
        target_fmt_bib = resolve_intermediate_format(
            args.template or effective_tpl,
            resolve_template_dir(args.templates_dir, _VAULT_ABS), _VAULT_ABS)
    try:
        _bib_tpl_path = _resolve_template_path(
            effective_tpl,
            '.tex' if target_fmt_bib == 'latex'
            else ('.odt' if target_fmt_bib == 'odt' else '.docx'),
            resolve_template_dir(args.templates_dir, _VAULT_ABS))
        note_style = resolve_note_citation_style(
            working, _bib_tpl_path,
            'latex' if target_fmt_bib == 'latex' else target_fmt_bib,
            override=args.csl_style, from_template=args.csl_from_template)
    except Exception:
        note_style = False
    include_bibliography = has_citations and (bibliography_opt or not note_style)
    if has_citations:
        print(f"Bibliography: {'included' if include_bibliography else 'omitted'}"
              f" ({'note' if note_style else 'author-date'} style, "
              f"setting {'on' if bibliography_opt else 'off'})")

    # STEP 3 — the ONLY write: the single intermediate file. The user's source
    # is never modified.
    compiled = write_intermediate(
        master_file, working, compiled=is_outline, output_dir=args.output_dir)

    if args.prepare_convert:
        # Plugin path: hand the (compiled) markdown path back so the plugin can
        # convert citations in-process, then exit. The plugin re-invokes with
        # --export --citations-input. Print the path as the LAST line.
        print(str(compiled))
        return

    if args.export:
        active_mappings = load_mappings(args.templates_dir, args.mappings)
        _common = dict(
            template=args.template or effective_tpl, toc=use_toc,
            toc_levels=toc_levels, tof=use_tof,
            endnotes_mode=endnotes_mode,
            template_dir=args.templates_dir, output_dir=args.output_dir,
            new_page_headings=not args.no_new_page_headings,
            restart_footnotes=not use_global,
            mappings_data=active_mappings,
            generate_date=not args.no_generated_date,
            roman_frontmatter=use_roman,
            page1_starts_with=args.page1_starts_with,
            csl_style_override=args.csl_style,
            csl_from_template=args.csl_from_template,
            output_name=args.output_name,
            citations_input=args.citations_input,
            citations_converted=citations_converted,
            include_bibliography=include_bibliography)
        if args.export_format == 'pdf':
            export_pdf(compiled, keep_intermediate=args.keep_intermediate, **_common)
        elif args.export_format == 'odt':
            export_odt(compiled, raw_citations=args.raw_citations,
                       static_bibliography=args.static_bibliography, **_common)
        elif args.export_format == 'latex':
            export_latex(compiled, default_author=args.default_author, **_common)
        else:
            export_docx(compiled, raw_citations=args.raw_citations,
                        static_bibliography=args.static_bibliography,
                        default_author=args.default_author, **_common)

        # The intermediate markdown is throwaway once it's been exported —
        # delete it unless the user asked to keep it. The source note is never
        # touched either way.
        if not args.keep_compiled_md:
            try:
                Path(compiled).unlink(missing_ok=True)
            except OSError as e:
                print(f'WARNING: could not remove intermediate markdown: {e}',
                      file=sys.stderr)
    elif args.output_name:
        # Compile-only ('md' format) with a chosen filename: rename the
        # intermediate markdown to it.
        src = Path(compiled)
        if src.exists():
            dest = src.with_name(_resolve_output_stem(args.output_name, src.stem)
                                 + '.md')
            if dest != src:
                src.replace(dest)
                print(str(dest))

if __name__ == "__main__":
    import sys
    main()
