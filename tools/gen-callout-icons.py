#!/usr/bin/env python3
"""Generate the callout icon PNGs from the Lucide source SVGs.

One transparent PNG per standard Obsidian callout type, drawn as a BLACK
stroke at 60% opacity so the callout's background colour shows through a
little.  Deliberately NOT one per colour: the callout colour lives on the
paragraph style, and the icon is a single neutral asset used in every format
(DOCX/ODT/LaTeX), so there is exactly one file per icon.

Source SVGs live in  src/ScholarWeft/icons/src/<type>.svg  (from
https://lucide.dev, fetched by hand — see the names below).  Output PNGs go to
src/ScholarWeft/icons/<type>.png and are bundled into main.js and extracted to
the plugin dir (see esbuild.config.mjs + src/assetSetup.ts).

Run from the repo root:  python3 tools/gen-callout-icons.py
Requires `rsvg-convert` (librsvg) on PATH — a DEV tool only; users never run
this and never need it, because the PNGs are committed and bundled.
"""
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'icons' / 'src'
OUT = ROOT / 'icons'

# type -> Lucide source icon name (already downloaded to icons/src/<type>.svg)
ICONS = [
    'note', 'abstract', 'info', 'todo', 'tip', 'success', 'question',
    'warning', 'failure', 'danger', 'bug', 'example', 'quote',
]

# Each icon's stroke colour = its type's Obsidian colour (keep in sync with
# tmp/add_callout_styles.py, which colours the paragraph styles).
COLORS = {
    'note': '448AFF', 'abstract': '00B0FF', 'info': '00B8D4',
    'todo': '00B8D4', 'tip': '00BFA5', 'success': '08B94E',
    'question': 'EC7500', 'warning': 'EC7500', 'failure': 'E93147',
    'danger': 'E93147', 'bug': 'E93147', 'example': '7852EE',
    'quote': '9E9E9E',
}
SIZE = 128          # px — crisp at the ~0.4cm display size
OPACITY = 1.0       # 1.0 = Obsidian-like full-strength type colour


def main():
    rsvg = shutil.which('rsvg-convert')
    if not rsvg:
        sys.exit('rsvg-convert not found on PATH (brew install librsvg)')
    OUT.mkdir(parents=True, exist_ok=True)
    missing = []
    for name in ICONS:
        src = SRC / f'{name}.svg'
        if not src.exists():
            missing.append(name)
            continue
        svg = src.read_text(encoding='utf-8')
        # Lucide uses stroke="currentColor"; bake in the type colour.
        colour = '#' + COLORS[name]
        if OPACITY < 1.0:
            repl = 'stroke="%s" stroke-opacity="%s"' % (colour, OPACITY)
        else:
            repl = 'stroke="%s"' % colour
        svg = svg.replace('stroke="currentColor"', repl)
        tmp = OUT / f'.{name}.svg'
        tmp.write_text(svg, encoding='utf-8')
        subprocess.run(
            [rsvg, '-w', str(SIZE), '-h', str(SIZE),
             '--background-color=none', '-o', str(OUT / f'{name}.png'),
             str(tmp)],
            check=True)
        tmp.unlink()
        print('  %-9s -> icons/%s.png  (%s)' % (name, name, colour))
    if missing:
        sys.exit('missing source SVGs: %s' % ', '.join(missing))
    print('generated %d icon PNGs' % len(ICONS))


if __name__ == '__main__':
    main()
