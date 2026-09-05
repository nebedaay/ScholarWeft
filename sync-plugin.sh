#!/bin/zsh
# Sync modified ScholarWeave scripts into the installed plugin so Obsidian
# exports run the latest code. Optionally rebuild + install main.js (pass --build).
#
# Templates are DELIBERATELY NOT touched by this script at all, in either
# direction. The user hand-edits templates/*.docx/*.odt directly in the
# PLUGIN copy (Word/LibreOffice), often mid-session — copying src->plugin
# there risks silently clobbering an edit in progress; copying plugin->src
# risks committing a mid-edit/unsaved state as if it were final. If a
# template needs to move between src and plugin, do it as its own explicit,
# one-off `cp` after confirming with the user which side is current — never
# as a blanket step in this script. (2026-09-05: this script used to
# unconditionally `cp` templates every run, which re-stamped their mtimes
# even when content was unchanged, making it impossible to tell from
# timestamps when the user had actually last edited one — see
# never-revert-without-checking memory.)
#
# Script copies ARE content-aware (cmp -s before cp): a file is only
# overwritten, and only then gets a new mtime, when its bytes actually
# differ.
set -e
SRC="/Users/josephhill/Documents/Obsidian Vault/src/ScholarWeave"
PLUG="/Users/josephhill/Documents/Obsidian Vault/.obsidian/plugins/scholar-weave"

sync_if_changed() {
  # sync_if_changed <src-dir> <pattern> <dst-dir>
  local src_dir="$1" pattern="$2" dst_dir="$3"
  local f base dst copied=0
  for f in "$src_dir"/$~pattern(N); do
    base="${f:t}"
    dst="$dst_dir/$base"
    if [[ -f "$dst" ]] && cmp -s "$f" "$dst"; then
      continue   # identical — leave the destination's mtime alone
    fi
    cp "$f" "$dst"
    copied=$((copied + 1))
  done
  print -r -- "$copied"
}

n_scripts=$(sync_if_changed "$SRC/scripts" "*.py" "$PLUG/scripts")
n_lua=$(sync_if_changed "$SRC/scripts" "*.lua" "$PLUG/scripts")
n_mjs=$(sync_if_changed "$SRC/scripts" "*.mjs" "$PLUG/scripts")
echo "scripts synced: $((n_scripts + n_lua + n_mjs)) changed (templates: not touched by this script)"

if [[ "$1" == "--build" ]]; then
  cd "$SRC"
  # Call esbuild directly — the package.json "build" script's postbuild cp
  # assumes a plugin layout this checkout doesn't have.
  node esbuild.config.mjs production
  if ! cmp -s "$SRC/main.js" "$PLUG/main.js" 2>/dev/null; then
    cp main.js "$PLUG/"
    echo "main.js built + installed (changed); restart Obsidian to load it"
  else
    echo "main.js built; unchanged, not reinstalled"
  fi
  cmp -s "$SRC/manifest.json" "$PLUG/manifest.json" 2>/dev/null || cp manifest.json "$PLUG/"
  cmp -s "$SRC/styles.css" "$PLUG/styles.css" 2>/dev/null || cp styles.css "$PLUG/"
  # Deliberately NOT touching .asset-version: removing it forces
  # setupAssets() (src/assetSetup.ts) to re-extract EVERY bundled asset —
  # including templates/*.docx/*.odt — from whatever main.js has embedded,
  # overwriting the plugin's live template copies the user edits directly.
  # Scripts are already current on disk via sync_if_changed above; nothing
  # here depends on the bundled-asset extraction path. If a real version
  # bump ever needs a forced re-extract, do it deliberately, and only after
  # confirming the user isn't mid-edit on a plugin-folder template.
fi
