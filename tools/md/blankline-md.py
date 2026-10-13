#!/usr/bin/env python3
"""
blankline-md.py — markdown line-spacing hygiene for Obsidian, strict pandoc style.

Three rules:
  1. A BLANK LINE BETWEEN ALL BLOCK ELEMENTS — pandoc's strict markdown wants
     one between heading↔text, paragraph↔list, paragraph↔table, list↔paragraph,
     etc. (Obsidian is lenient, so a missing blank line reads as one block in
     the source and renders differently once it reaches pandoc.)
  2. NO RUNS OF BLANK LINES — `\n\n\n` collapses to `\n\n`. A run of blanks is
     never content outside a fence.
  3. TIDY EDGES — no leading blank lines, exactly one trailing newline.

Why: the vault convention says "separate all elements with a blank line (except
items within a list)" — see `AI OS/Me.md` → Text Formatting.

Usage:
    python3 scripts/blankline-md.py FILE ...          # fix in place
    python3 scripts/blankline-md.py --check FILE ...  # report, change nothing
    python3 scripts/blankline-md.py --dry-run FILE ...# show a unified diff
    python3 scripts/blankline-md.py --recursive DIR

Exit status: 0 = clean / fixed; 1 = --check found issues.

What is separated (a blank line is INSERTED between them):
  * heading → anything (text, list, table, quote, code fence)
  * anything → heading
  * paragraph → list          list → paragraph
  * paragraph → table         table → paragraph
  * paragraph → quote         quote → paragraph
  * code fence ↔ surrounding block (outside the fence only)

What is NEVER touched:
  * INSIDE a fenced code block (``` / ~~~) — a fence is a "leave me alone"
    island: its internal blank lines are content (e.g. PEP 8's two-blank-line
    convention in an embedded Python snippet). Copied verbatim.
  * YAML frontmatter at the very top
  * between the items of ONE list (same indentation) — items stay tight,
    INCLUDING nested children under an item (putting a blank line between a
    parent item and its children splits the list apart)
  * a list item's own continuation lines

Idempotent.
"""

from __future__ import annotations

import argparse
import difflib
import glob
import os
import re
import sys

FENCE = re.compile(r"^\s*(```|~~~)")
BULLET = re.compile(r"^(\s*)([-*+]|\d{1,3}[.)])(\s+)(.*)$")
QUOTE = re.compile(r"^\s*>")
# Inline spans whose `|` characters are content, not table-cell delimiters:
# a wikilink alias (`[[@key|alias]]`) or an inline code span.
_INLINE_SPAN = re.compile(r"\[\[[^\]]*\]\]|`[^`]*`")


def is_fence(line: str) -> bool:
    return bool(FENCE.match(line))


def is_heading(line: str) -> bool:
    return line.lstrip().startswith("#")


def is_hr(line: str) -> bool:
    return line.strip() in ("---", "***", "___")


def is_table(line: str) -> bool:
    """A table row: flush-left `|…`, or a line of several `|`-separated cells.

    Pipes inside `[[…]]` wikilinks and `` `…` `` code spans do NOT count: a
    bullet like `- see [[@key|alias]] and [[@key2|alias2]]` is a LIST item, not
    a table row. Counting those pipes inserted spurious blank lines around such
    a bullet (a false positive that split a tight list).
    """
    s = line.lstrip()
    if s.startswith("|"):
        return True
    bare = _INLINE_SPAN.sub("", line)
    return bare.count("|") >= 2 and not is_fence(line)


def is_quote(line: str) -> bool:
    return bool(QUOTE.match(line))


def is_blank(line: str) -> bool:
    return not line.strip()


def bullet_indent(line: str):
    m = BULLET.match(line)
    return len(m.group(1).expandtabs(4)) if m else None


def kind(line: str) -> str:
    """Classify a line's block kind."""
    if is_blank(line):
        return "blank"
    if is_fence(line):
        return "fence"
    if is_heading(line):
        return "heading"
    if is_hr(line):
        return "hr"
    if is_table(line):
        return "table"
    if is_quote(line):
        return "quote"
    if BULLET.match(line):
        return "list"
    return "para"


def needs_blank_between(prev: str, cur: str, prev_cont: bool) -> bool:
    """
    True when a blank line must be inserted between `prev` and `cur`.

    `prev_cont` indicates that `prev` is a continuation of a list item (so the
    pair is inside one list block and must stay tight).
    """
    a, b = kind(prev), kind(cur)

    if a == "blank" or b == "blank":
        return False
    if prev_cont:
        return False                       # inside a list item's own text

    # Headings always get air around them.
    if a == "heading" or b == "heading":
        return True

    # Lists: within a running list every bullet stays tight — siblings and
    # nested children alike (the vault rule is "except items within a list").
    # A list only gets air when it BEGINS after a non-list block.
    if b == "list":
        return a in ("para", "table", "quote", "fence")
    if a == "list" and b in ("para", "table", "quote", "fence"):
        return True

    # Fences get air around them (the fence's own line starts/ends the block).
    if a == "fence" or b == "fence":
        return True

    # Distinct adjacent paragraph-ish blocks.
    if a in ("para", "table", "quote") and b in ("para", "table", "quote"):
        return a != b

    return False


def add_blank_lines(text: str, trim_edges: bool = False) -> str:
    lines = text.split("\n")
    out: list[str] = []
    i, n = 0, len(lines)

    # YAML frontmatter must OPEN the file: a blank line before it would break the
    # YAML, so those blanks are ALWAYS removed (not subject to --trim-edges).
    # Only skip them when frontmatter actually follows — otherwise a leading
    # blank line is the deliberate "top of the page" cursor room and is kept.
    j = i
    while j < n and is_blank(lines[j]):
        j += 1
    has_frontmatter = j < n and lines[j].strip() == "---"
    if has_frontmatter:
        i = j

    # Yield frontmatter verbatim.
    if has_frontmatter:
        try:
            end = next(k for k in range(i + 1, n) if lines[k].strip() == "---")
        except StopIteration:
            end = -1
        if end > 0:
            out.extend(lines[i : end + 1])
            i = end + 1
            # A single blank line between the frontmatter and the body is the
            # "top of the page" cursor room. Keep it, or insert one when the body
            # begins immediately after the closing fence — unless trimming.
            if not trim_edges:
                out.append("")
            while i < n and is_blank(lines[i]):
                i += 1

    prev_cont = False                      # prev was a list-item continuation
    in_list_indent = None                  # indent of the current list, if in one

    while i < n:
        line = lines[i]

        if is_fence(line):
            # Separate the fence from whatever precedes it.
            if out and not is_blank(out[-1]) and kind(out[-1]) != "blank":
                out.append("")
            out.append(line.rstrip())
            i += 1
            while i < n:
                out.append(lines[i].rstrip())
                if is_fence(lines[i]):
                    i += 1
                    break
                i += 1
            prev_cont = False
            in_list_indent = None
            continue

        if is_blank(line):
            # Collapse runs of blank lines to a SINGLE blank line (the vault
            # policy: \n\n\n → \n\n). A run is never content outside a fence.
            # EDGE blank lines are preserved unless trimming is requested: a
            # leading blank line is deliberate in files like a Daily-note
            # template (it gives the cursor somewhere to sit outside a callout).
            if out and not is_blank(out[-1]):
                out.append("")
            elif not out and not trim_edges:
                out.append("")          # keep a leading blank line
            prev_cont = False
            i += 1
            continue

        k = kind(line)

        # Track list context: a bullet at the same indent continues the list;
        # an indented bullet is a nested new list; a deeper non-bullet line is a
        # continuation of the current item.
        if k == "list":
            ind = bullet_indent(line)
            if out and not is_blank(out[-1]):
                if needs_blank_between(out[-1], line, prev_cont):
                    out.append("")
            in_list_indent = ind if in_list_indent is None else min(in_list_indent, ind)
            prev_cont = False
            out.append(line.rstrip())
            i += 1
            continue

        # Non-blank, non-list line: is it a continuation of the current list
        # item (more-indented than the last bullet)?
        if in_list_indent is not None and k == "para" and line[:1] in (" ", "\t"):
            indent = len(line) - len(line.lstrip())
            if indent > (in_list_indent or 0):
                out.append(line.rstrip())
                prev_cont = True
                i += 1
                continue
        else:
            prev_cont = False

        if out and not is_blank(out[-1]) and needs_blank_between(out[-1], line, prev_cont):
            out.append("")

        out.append(line.rstrip())
        prev_cont = False
        i += 1

    result = "\n".join(out)
    return normalize_edges(result) if trim_edges else result


def normalize_edges(text: str) -> str:
    """
    Tidy the file edges: no leading blank lines, exactly one trailing newline.

    OFF BY DEFAULT (see `--trim-edges`). A single leading or trailing blank line
    can be deliberate in a vault file — e.g. a Daily-note template starts with a
    blank line so the cursor lands outside the opening callout. Interior runs are
    still collapsed; only the edges are governed by this function.
    """
    s = text
    # Drop leading blank lines (but keep YAML frontmatter if it starts with ---).
    if not s.startswith("---"):
        s = s.lstrip("\n")
    # Exactly one trailing newline.
    s = s.rstrip("\n") + "\n"
    return s


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="Enforce blank lines between markdown blocks.")
    ap.add_argument("paths", nargs="*")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--recursive", "-r", action="store_true")
    ap.add_argument("--trim-edges", action="store_true",
                    help="also strip leading blank lines and force exactly one "
                         "trailing newline (off by default: an edge blank line can "
                         "be deliberate, e.g. a Daily-note template's cursor room)")
    args = ap.parse_args(argv)

    files: list[str] = []
    for p in args.paths:
        if os.path.isdir(p):
            files.extend(sorted(glob.glob(os.path.join(p, "**", "*.md"), recursive=True)))
        else:
            files.append(p)
    if not files:
        ap.error("no files given")

    changed = flagged = 0
    for f in files:
        try:
            original = open(f, encoding="utf-8").read()
        except (OSError, UnicodeDecodeError):
            continue
        fixed = add_blank_lines(original, trim_edges=args.trim_edges)
        if fixed == original:
            continue
        if args.check:
            flagged += 1
            print(f"missing blank lines: {f}")
            continue
        if args.dry_run:
            sys.stdout.writelines(difflib.unified_diff(
                original.splitlines(True), fixed.splitlines(True), fromfile=f, tofile=f))
            changed += 1
            continue
        with open(f, "w", encoding="utf-8") as fh:
            fh.write(fixed)
        changed += 1
        print(f"fixed: {f}")

    if args.check:
        print(f"\n{flagged} file(s) need blank lines")
        return 1 if flagged else 0
    if not args.dry_run:
        print(f"\n{changed} file(s) changed")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
