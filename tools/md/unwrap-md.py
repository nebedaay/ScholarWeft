#!/usr/bin/env python3
"""
unwrap-md.py — join hard line wraps in Obsidian markdown so each paragraph is
ONE logical line.

Why: Obsidian renders markdown with proportional fonts and hides the markup
characters, so a source-level wrap breaks at a random place on screen (after a
comma mid-sentence, etc.). This is a vault convention (see "AI OS/Me.md" →
Text Formatting: "Always keep paragraphs in one line, without internal line
breaks/hard wrapping").

Usage:
    python3 scripts/unwrap-md.py FILE [FILE ...]      # fix in place
    python3 scripts/unwrap-md.py --check FILE ...     # report, change nothing
    python3 scripts/unwrap-md.py --dry-run FILE ...   # show a unified diff
    python3 scripts/unwrap-md.py --recursive DIR      # all *.md under DIR
    python3 scripts/unwrap-md.py --stdin < in.md

Exit status: 0 = nothing to change / all changes applied; 1 = --check found
wrapped paragraphs (so it can gate a pre-commit hook).

What is joined vs preserved
---------------------------
JOINED (a wrap is an accident of editing):
  * consecutive prose lines                → one line
  * a list item and its continuation lines → marker + one line
  * a block-quote's wrapped prose lines    → one `>` line
  * a wrap inside an inline `code span`    → rejoined WITH a single space
    (inline spans never legitimately contain a newline; the space the wrap
    replaced must be restored — see `join_pieces`)

PRESERVED (the line breaks are content, not wrapping):
  * fenced code blocks (``` or ~~~) — byte-for-byte untouched
  * `|` tables — every row stays on its own line
  * YAML frontmatter (`---` … `---`)
  * headings (#), horizontal rules (--- / *** / ___)
  * HTML blocks
  * a bare `>` line (quote paragraph separator) and every quoted list item,
    table row, heading, and callout header (`> [!note] Title`) — these start a
    new logical line rather than joining the previous one
  * blank lines between blocks

Idempotent: running it twice changes nothing the second time.
"""

from __future__ import annotations

import argparse
import difflib
import glob
import os
import re
import sys

# ── line classifiers ────────────────────────────────────────────────────────

BULLET = re.compile(r"^(\s*)([-*+]|\d{1,3}[.)])(\s+)(.*)$")
QUOTE_PREFIX = re.compile(r"^(\s*)>\s?(.*)$")
FENCE = re.compile(r"^\s*(```|~~~)")


def is_fence(line: str) -> bool:
    return bool(FENCE.match(line))


def is_table(line: str) -> bool:
    return line.lstrip().startswith("|")


def is_heading(line: str) -> bool:
    return line.lstrip().startswith("#")


def is_hr(line: str) -> bool:
    return line.strip() in ("---", "***", "___")


def is_quote(line: str) -> bool:
    return line.lstrip().startswith(">")


def is_html(line: str) -> bool:
    s = line.lstrip()
    return s.startswith("<") and not s.startswith("<http")


def is_blank(line: str) -> bool:
    return not line.strip()


def is_special(line: str) -> bool:
    """A line that starts a new block, so it is never swallowed as a wrap."""
    return (
        is_blank(line)
        or is_fence(line)
        or is_table(line)
        or is_pipe_row(line)
        or is_heading(line)
        or is_hr(line)
        or is_quote(line)
        or is_html(line)
        or BULLET.match(line) is not None
    )


# ── joining ─────────────────────────────────────────────────────────────────

def join_pieces(pieces: list[str]) -> str:
    """
    Join source lines into one logical line.

    A line break anywhere — including inside an inline `code span` — rejoins
    with a single space. Rationale (verified against the real docs, 2026-09-29):
    inline code spans are `like this` and never legitimately contain a newline,
    so a wrap inside one is an editing accident, and the space it replaced must
    be restored. Cases that prove it: `` `TeX capacity exceeded […]` ``,
    `` `<meta name="author">` ``, `` `for (const g of …) { … }` ``,
    `` `linkcolor=black citecolor=black urlcolor=swlinkcolor` `` — all need the
    space. There is no observed case where a no-space rejoin is correct.
    """
    return " ".join(p.strip() for p in pieces if p.strip())


# ── the unwrapper ───────────────────────────────────────────────────────────

def unwrap(text: str) -> str:
    lines = text.split("\n")
    out: list[str] = []
    i, n = 0, len(lines)

    # YAML frontmatter at the very top is preserved verbatim.
    if lines and lines[0].strip() == "---":
        try:
            end = next(k for k in range(1, n) if lines[k].strip() == "---")
        except StopIteration:
            end = -1
        if end > 0:
            out.extend(lines[: end + 1])
            i = end + 1

    while i < n:
        line = lines[i]

        if is_blank(line):
            out.append("")
            i += 1
            continue

        if is_fence(line):
            out.append(line.rstrip())
            i += 1
            while i < n:
                out.append(lines[i].rstrip())
                if is_fence(lines[i]):
                    i += 1
                    break
                i += 1
            continue

        if is_table(line) or is_heading(line) or is_hr(line) or is_html(line):
            out.append(line.rstrip())
            i += 1
            continue

        if is_quote(line):
            i = emit_quote(lines, i, out)
            continue

        bm = BULLET.match(line)
        if bm:
            indent, marker, text_ = bm.group(1), bm.group(2), bm.group(4)
            pieces = [text_]
            i += 1
            while i < n and not is_special(lines[i]):
                pieces.append(lines[i])
                i += 1
            out.append(f"{indent}{marker} {join_pieces(pieces)}".rstrip())
            continue

        pieces = [line]
        i += 1
        while i < n and not is_special(lines[i]):
            pieces.append(lines[i])
            i += 1
        out.append(join_pieces(pieces).rstrip())

    return "\n".join(out)


CALLOUT_HEADER = re.compile(r"^\[![\w-]+\]")


def quote_line_stands_alone(body: str) -> bool:
    """
    True when a quoted line must NOT be joined to the previous quoted line:
    a callout header (`[!note] …`), a list item, a table row, or a heading.
    """
    b = body.strip()
    return bool(
        CALLOUT_HEADER.match(b)
        or BULLET.match(body)
        or is_table(body)
        or is_heading(body)
        or is_hr(body)
    )


# A "table-ish" line: several `|`-separated cells. Obsidian accepts a pipe table
# whose rows are not flush-left (e.g. `\`Manuscript #\` | \`Author(s)\` | …`),
# so such a line is content, not a wrap, and must never be joined to the line
# above it.
PIPE_ROW = re.compile(r"^\s*[^|]*\|[^|]*\|")


def is_pipe_row(line: str) -> bool:
    return bool(PIPE_ROW.match(line))


def emit_quote(lines: list[str], i: int, out: list[str]) -> int:
    """
    Emit one block quote / callout, joining its wrapped prose.

    Consecutive `>` prose lines become ONE logical line (a paragraph wrapped in
    the source). The join is broken by: a blank `>` line (paragraph separator),
    a callout header `> [!type] Title`, and any quoted list item / table row /
    heading. An unmarked line continues the current quoted line only.
    Every output line keeps a single `>` prefix. Returns the first index not
    consumed.
    """
    n = len(lines)
    current: list[str] | None = None
    current_marker = "> "          # the literal marker of the line that opened it

    def flush() -> None:
        nonlocal current
        if current is not None:
            out.append((current_marker + join_pieces(current)).rstrip())
            current = None

    while i < n:
        raw = lines[i]
        m = QUOTE_PREFIX.match(raw)

        if m:
            # Preserve the source's own marker form: `>body`, `> body`, and
            # `>   body` all stay as written (Obsidian accepts `>[!note]` too,
            # and rewriting it would churn working callouts for no reason).
            marker = raw[: len(raw) - len(raw.lstrip())]      # leading indent
            rest = raw.lstrip()[1:]                            # drop the first '>'
            spaces = rest[: len(rest) - len(rest.lstrip())]    # its following space(s)
            body = rest.lstrip()
            marker = f"{marker}>{spaces}"
            if not body:
                # A bare `>` is the quote's blank separator: flush and emit it.
                flush()
                out.append(marker.rstrip() or ">")
            elif quote_line_stands_alone(body):
                flush()
                out.append((marker + body).rstrip())
            elif current is None:
                current = [body]
                current_marker = marker
            else:
                current.append(body)
            i += 1
            continue

        if is_blank(raw):
            # A blank line inside the quote (written as `>` alone) is emitted
            # by the QUOTE_PREFIX branch above; a truly blank source line ends
            # the quote unless another `>` follows after the gap.
            flush()
            j = i + 1
            while j < n and is_blank(lines[j]):
                j += 1
            if j < n and is_quote(lines[j]):
                out.append(">")
                i += 1
                continue
            return i

        if is_fence(raw) or is_table(raw) or is_heading(raw) or is_hr(raw) or BULLET.match(raw):
            flush()
            return i

        if current is not None:
            current.append(raw)      # lazy continuation
            i += 1
            continue

        flush()
        return i

    flush()
    return i


# ── CLI ─────────────────────────────────────────────────────────────────────

def gather(paths: list[str], recursive: bool) -> list[str]:
    files: list[str] = []
    for p in paths:
        if os.path.isdir(p):
            files.extend(sorted(glob.glob(os.path.join(p, "**", "*.md"), recursive=True)))
        else:
            files.append(p)
    if recursive:
        for p in list(files):
            if os.path.isdir(p):
                files.remove(p)
    seen, uniq = set(), []
    for f in files:
        if f not in seen:
            seen.add(f)
            uniq.append(f)
    return uniq


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="Join hard line wraps in Obsidian markdown.")
    ap.add_argument("paths", nargs="*", help="files or directories")
    ap.add_argument("--check", action="store_true", help="report only; change nothing")
    ap.add_argument("--dry-run", action="store_true", help="print a unified diff")
    ap.add_argument("--recursive", "-r", action="store_true", help="recurse into directories")
    ap.add_argument("--stdin", action="store_true", help="read markdown from stdin")
    args = ap.parse_args(argv)

    if args.stdin:
        src = sys.stdin.read()
        fixed = unwrap(src)
        sys.stdout.write(fixed)
        return 0

    if not args.paths:
        ap.error("no files given (or use --stdin)")

    files = gather(args.paths, args.recursive)
    changed = 0
    flagged = 0
    for f in files:
        try:
            original = open(f, encoding="utf-8").read()
        except (FileNotFoundError, IsADirectoryError):
            print(f"skip: {f}", file=sys.stderr)
            continue
        fixed = unwrap(original)
        if fixed == original:
            continue
        if args.check:
            flagged += 1
            print(f"wrapped: {f}")
            continue
        if args.dry_run:
            diff = difflib.unified_diff(
                original.splitlines(True), fixed.splitlines(True),
                fromfile=f, tofile=f,
            )
            sys.stdout.writelines(diff)
            changed += 1
            continue
        with open(f, "w", encoding="utf-8") as fh:
            fh.write(fixed)
        changed += 1
        print(f"unwrapped: {f}")

    if args.check:
        print(f"\n{flagged} file(s) have hard wraps")
        return 1 if flagged else 0
    if not args.dry_run:
        print(f"\n{changed} file(s) changed")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
