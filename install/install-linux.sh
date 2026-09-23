#!/usr/bin/env bash
#
# ScholarWeft setup helper — Linux (Debian/Ubuntu and Fedora).
#
# Asks before each step (y / n / esc to quit), reports progress, reuses what
# you already have, and ends with a summary. Nothing is changed without a yes.
#
# Usage:  bash install-linux.sh
#
set -o pipefail

say()  { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
step() { printf '  \033[36m…\033[0m %s\n' "$*"; }
pass() { printf '  \033[32m✓\033[0m %s\n' "$*"; DONE+=("$*"); }
fail() { printf '  \033[31m✗\033[0m %s%s\n' "$1" "${2:+ — $2}"; FAILED+=("$1${2:+ — $2}"); }
skip() { SKIPPED+=("$*"); }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }

SCRIPT_REV="2026-09-23"

DONE=(); FAILED=(); SKIPPED=()

ask() { # <question> [label-for-summary]  → single keypress: y / n / q
  local a
  while :; do
    printf '%s [y/n/q] ' "$1"
    IFS= read -r -n 1 a || exit 0
    printf '\n'
    case "${a:-}" in
      [yY]) return 0 ;;
      [nN]) [ -n "${2:-}" ] && skip "$2"; return 1 ;;
      [qQ]|$'\e') echo '  Cancelled — nothing more will be changed.'; exit 0 ;;
      *) printf '  Please press y, n, or q.\n' ;;
    esac
  done
}

# Remind the user to quit an app (Obsidian/Zotero) and offer to retry while a
# condition still holds, instead of skipping the step outright.
_retry_while() {
  local msg="$1" label="$2"; shift 2
  while "$@"; do
    echo "  $msg"
    ask "  Retry?" "$label" || return 1
  done
  return 0
}

PKG=""
have apt && PKG=apt
have dnf && PKG=dnf
apt_install() { if [ "$PKG" = apt ]; then sudo apt-get install -y "$@"; else sudo dnf install -y "$@"; fi; }

_pyjson() { command -v python3 2>/dev/null || printf '%s' "${PY:-}"; }
json_append_list() { # <file> <key> <value>  → dedupe-add to a JSON array
  local f="$1" k="$2" v="$3" py; py="$(_pyjson)"
  if [ -n "$py" ]; then
    "$py" - "$f" "$k" "$v" <<'PYEOF'
import json, sys
path, key, val = sys.argv[1], sys.argv[2], sys.argv[3]
try:
    d = json.load(open(path))
    if not isinstance(d, dict): d = {}
except FileNotFoundError:
    d = {}
except Exception:
    sys.exit(3)
lst = d.get(key)
if not isinstance(lst, list): lst = []
if val not in lst: lst.append(val)
d[key] = lst
json.dump(d, open(path, 'w'), indent=2)
PYEOF
    return $?
  fi
  if [ ! -s "$f" ]; then printf '{\n  "%s": ["%s"]\n}\n' "$k" "$v" > "$f"; return 0; fi
  return 2
}

gh_asset_url() {
  curl -fsSL "https://api.github.com/repos/$1/releases/latest" 2>/dev/null \
    | grep -o "\"browser_download_url\": *\"[^\"]*$2\"" | head -1 \
    | sed 's/.*"\(https[^"]*\)"/\1/'
}
download() { step "Downloading $3…"; curl -fsSL "$1" -o "$2" || { fail "Download $3" "download failed"; return 1; }; }

# ── Obsidian vault discovery ─────────────────────────────────────────────────
# Obsidian keeps its OWN vault list at
#   ${XDG_CONFIG_HOME:-~/.config}/obsidian/obsidian.json
# — the same list its "Open another vault" chooser shows. Reading it is instant
# and authoritative, so it is the ONLY automatic source; we never scan the
# filesystem. If it lists no vaults, the user simply has none yet, so we ASK.
# Obsidian's OWN vault registry — the same list its "Open another vault"
# chooser shows. Instant and authoritative.
_obsidian_registry_vaults() {
  local dir="${XDG_CONFIG_HOME:-$HOME/.config}/obsidian"
  local f="$dir/obsidian.json"
  [ -f "$f" ] || return 0
  if command -v python3 >/dev/null 2>&1; then
    python3 - "$f" <<'PY'
import json, sys
try:
    data = json.load(open(sys.argv[1]))
    for v in (data.get('vaults') or {}).values():
        p = v.get('path')
        if p:
            print(p)
except Exception:
    pass
PY
  else
    grep -o '"path"[[:space:]]*:[[:space:]]*"[^"]*"' "$f" 2>/dev/null \
      | sed -e 's/.*"path"[[:space:]]*:[[:space:]]*"//' -e 's/"$//' \
      | sed -e 's#\\/#/#g' -e 's#\\\\#\\#g'
  fi
}

find_vaults() {
  local list=() v x cand
  while IFS= read -r cand; do
    [ -n "$cand" ] || continue
    # A registry entry can be stale (vault moved/deleted); keep only real ones.
    [ -d "$cand/.obsidian" ] || continue
    cand="${cand%/}"
    for x in "${list[@]}"; do [ "$cand" = "$x" ] && continue 2; done
    list+=("$cand")
  done < <(_obsidian_registry_vaults)
  [ "${#list[@]}" -gt 0 ] && printf '%s\n' "${list[@]}"
}
VAULT=""
VAULTS=()
locate_vaults() {
  local v n i
  step "Looking up your Obsidian vaults…"
  VAULTS=()
  while IFS= read -r v; do [ -n "$v" ] && VAULTS+=("$v"); done < <(find_vaults)

  # No vaults in Obsidian's registry: the user almost certainly has none yet,
  # so don't scan — ask, or let them type a path for an unregistered vault.
  if [ "${#VAULTS[@]}" -eq 0 ]; then
    echo "  Obsidian has no vaults yet (it registers a vault the first time you open it)."
    if ask "  Do you have an existing Obsidian vault you'd like the script to use?"; then
      IFS= read -r -p "  Path to the vault: " VAULT
      VAULT="${VAULT/#\~/$HOME}"; VAULT="${VAULT%/}"
      if [ -d "$VAULT" ]; then
        [ -d "$VAULT/.obsidian" ] || warn "That folder has no .obsidian folder — make sure it is a vault."
        pass "Using vault: $VAULT"
      else
        fail "Choose vault" "not a folder: ${VAULT:-<empty>}"; VAULT=""
      fi
      return
    fi
    echo "  No vault yet: open Obsidian once, create (or open) a vault, quit Obsidian,"
    echo "  then retry."
    if ask "  Retry?"; then VAULTS=(); locate_vaults; return; fi
    echo "  (You can re-run this script once the vault exists.)"
    return
  fi

  case "${#VAULTS[@]}" in
    1) VAULT="${VAULTS[0]}"; pass "Found vault: $VAULT" ;;
    *) echo "  Found ${#VAULTS[@]} Obsidian vaults:"
       i=1; for v in "${VAULTS[@]}"; do printf '    %d) %s\n' "$i" "$v"; i=$((i+1)); done
       IFS= read -r -p "  Which one should I use? (1-${#VAULTS[@]}, or type a path) " n
       if [[ "$n" =~ ^[0-9]+$ ]] && [ "$n" -ge 1 ] && [ "$n" -le "${#VAULTS[@]}" ]; then VAULT="${VAULTS[$((n-1))]}"
       else VAULT="${n/#\~/$HOME}"; VAULT="${VAULT%/}"; fi ;;
  esac
  if [ -n "$VAULT" ]; then
    if [ -d "$VAULT" ]; then printf '  Plugins will be installed into: %s\n' "$VAULT"
    else warn "Not a folder: $VAULT — I'll ask again if you choose to install a plugin."; VAULT=""; fi
  fi
}
pick_vault() {
  [ -n "$VAULT" ] && [ -d "$VAULT" ] && return 0
  IFS= read -r -p "  Path to your Obsidian vault: " VAULT
  VAULT="${VAULT/#\~/$HOME}"; VAULT="${VAULT%/}"
  if [ ! -d "$VAULT" ]; then fail "Choose vault" "not a folder: ${VAULT:-<empty>}"; VAULT=""; return 1; fi
  return 0
}

enable_plugin() {
  local f="$1/.obsidian/community-plugins.json" id="$2" body
  mkdir -p "$1/.obsidian/plugins/$id"
  if [ ! -s "$f" ]; then printf '[\n  "%s"\n]\n' "$id" > "$f"; return; fi
  grep -q "\"$id\"" "$f" && return
  body="$(tr -d '\n' < "$f")"; body="${body%]}"; body="${body%,}"
  if [ "$body" = "[" ] || [ -z "$body" ]; then printf '[\n  "%s"\n]\n' "$id" > "$f"
  else printf '%s,\n  "%s"\n]\n' "$body" "$id" > "$f"; fi
}
install_obsidian_plugin() {
  local repo="$1" id="$2" vault="$3"
  # Compute `dir` on its own line — in one `local a=… b=$a/…` statement bash
  # expands `$a` before assigning it (see the macOS twin's comment).
  local dir="$vault/.obsidian/plugins/$id" a u json tag latest inst
  if [ -z "$vault" ] || [ ! -d "$vault" ]; then
    fail "Install $id plugin" "no valid vault folder was chosen"; return 1
  fi
  json="$(curl -fsSL -H 'User-Agent: ScholarWeft' "https://api.github.com/repos/$repo/releases/latest" 2>/dev/null || true)"
  if ! printf '%s' "$json" | grep -q '"browser_download_url"'; then
    json="$(curl -fsSL -H 'User-Agent: ScholarWeft' "https://api.github.com/repos/$repo/releases?per_page=1" 2>/dev/null || true)"
  fi
  if ! printf '%s' "$json" | grep -q '"browser_download_url"'; then
    fail "Install $id plugin" "could not read release info (network or GitHub rate limit)"; return 1
  fi
  tag="$(printf '%s' "$json" | grep -o '"tag_name": *"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')"
  latest="${tag#v}"
  if [ -f "$dir/manifest.json" ]; then
    inst="$(grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*"' "$dir/manifest.json" | head -1 | sed 's/.*"\([^"]*\)"$/\1/')"
    case "$inst" in *-*) inst_pre=1 ;; *) inst_pre=0 ;; esac
    case "$latest" in *-*) latest_pre=1 ;; *) latest_pre=0 ;; esac
    if [ -n "$inst" ] && [ -n "$latest" ] && [ "$inst_pre" = 0 ] \
       && [ "$(printf '%s\n%s\n' "$latest" "$inst" | sort -V | tail -1)" = "$inst" ]; then
      pass "$id already installed (v$inst, latest)"; return 0
    fi
    if [ -n "$inst" ] && [ -n "$latest" ]; then
      if [ "$inst_pre" = 1 ] && [ "$latest_pre" = 0 ]; then
        step "Replacing pre-release $id v$inst with the stable v$latest"
      else
        step "Updating $id v$inst → v$latest"
      fi
    fi
  fi
  mkdir -p "$dir"
  for a in main.js manifest.json styles.css; do
    u="$(printf '%s' "$json" | grep -o "\"browser_download_url\": *\"[^\"]*/$a\"" | head -1 | sed 's/.*"\(https[^"]*\)"/\1/')"
    if [ -n "$u" ]; then download "$u" "$dir/$a" "$a" || return 1
    else fail "Install $id plugin" "could not find $a in $repo releases"; return 1; fi
  done
  enable_plugin "$vault" "$id"
  pass "Installed the $id Obsidian plugin${latest:+ (v$latest)}"
}


brat_register() {
  local vault="$1"
  local data="$vault/.obsidian/plugins/obsidian42-brat/data.json" ok=1 r
  [ -f "$vault/.obsidian/plugins/obsidian42-brat/manifest.json" ] || { fail "Register with BRAT" "BRAT isn't installed"; return 1; }
  [ -s "$data" ] && cp "$data" "$data.scholarweft.bak"
  for r in "nebedaay/ScholarWeft"; do
    json_append_list "$data" "pluginList" "$r" || ok=0
  done
  if [ "$ok" = 1 ]; then pass "Registered ScholarWeft with BRAT for automatic updates"
  else fail "Register with BRAT" "couldn't write BRAT's settings (a backup was kept) — add the repos in BRAT's settings"; fi
}


# The installer can't safely edit another plugin's settings from outside, so
# record what ScholarWeft should finish (through the same routines its settings
# buttons use) the next time Obsidian opens.
queue_pending_setup() { # <vault> <item...>
  local vault="$1"; shift
  local data="$vault/.obsidian/plugins/scholar-weft/data.json" item ok=1
  mkdir -p "$vault/.obsidian/plugins/scholar-weft"
  for item in "$@"; do json_append_list "$data" "pendingSetup" "$item" || ok=0; done
  [ "$ok" = 1 ] && pass "Queued in-Obsidian setup: $* (runs when you next open Obsidian)"
}


disable_conflicting_plugins() {
  local vault="$1"
  local cfg="$vault/.obsidian/community-plugins.json"
  [ -f "$cfg" ] || return 0
  local id
  for id in obsidian-pandoc-reference-list pandoc-reference-list scholar-weave linked-citations; do
    if grep -q "\"$id\"" "$cfg"; then
      if remove_json_list_item "$cfg" "$id"; then
        pass "Disabled '$id' (it registers the same sidebar view as ScholarWeft)"
      else
        fail "Disable $id" "edit $cfg and remove \"$id\""
      fi
    fi
  done
  return 0
}

remove_json_list_item() { # <json-array-file> <value>
  local f="$1" v="$2" py; py="$(_pyjson)"
  [ -f "$f" ] || return 1
  if [ -n "$py" ]; then
    "$py" - "$f" "$v" <<'PYEOF'
import json, sys
path, val = sys.argv[1], sys.argv[2]
try:
    d = json.load(open(path))
except Exception:
    sys.exit(3)
if isinstance(d, list):
    json.dump([x for x in d if x != val], open(path, 'w'), indent=2)
PYEOF
    return $?
  fi
  return 2
}

# Recompute on demand: Zotero creates its profile on FIRST LAUNCH, so a Zotero
# installed during this run has none until the user opens it once.
zotero_profile() {
  local p
  for p in "$HOME/.zotero/zotero"/*/prefs.js; do
    [ -f "$p" ] && { printf '%s' "$(dirname "$p")"; return 0; }
  done
  return 0
}
ZPROFILE="$(zotero_profile)"
ensure_zotero_profile() {
  while :; do
    ZPROFILE="$(zotero_profile)"
    [ -n "$ZPROFILE" ] && return 0
    echo "  Zotero has no profile yet — it creates one the first time you open it."
    echo "  Open Zotero once (install it above if needed), then quit it."
    ask "  Retry?" || return 1
  done
}
zotero_running() { pgrep -x zotero >/dev/null 2>&1; }
install_zotero_addon() {
  local repo="$1" id="$2" url=""
  if [ "$repo" = "zotlit" ]; then
    step "Looking up the latest ZotLit Zotero add-on…"
    url="$(curl -fsSL 'https://api.github.com/repos/aidenlx/zotlit/releases?per_page=100' 2>/dev/null \
           | grep -o 'https://[^"]*zotlit-zotero-[0-9.]*\.xpi' | sort -uV | tail -1)"
  else
    url="$(gh_asset_url "$repo" ".xpi")"
  fi
  [ -n "$url" ] || { fail "Install $id" "could not resolve the download URL"; return 1; }
  mkdir -p "$ZPROFILE/extensions"
  download "$url" "$ZPROFILE/extensions/$id.xpi" "$id.xpi"
}
set_pref() {
  local f="$1" k="$2" v="$3"
  if grep -qF "user_pref(\"$k\"" "$f"; then sed -i "s|^user_pref(\"$k\".*|user_pref(\"$k\", $v);|" "$f"
  else printf 'user_pref("%s", %s);\n' "$k" "$v" >> "$f"; fi
}

# See install-mac.sh: make Zotero pick up xpis we placed in extensions/.
enable_zotero_sideload() { # <prefs.js>
  local f="$1"
  cp "$f" "$f.scholarweft.bak.$(date +%s)" 2>/dev/null || true
  set_pref "$f" "extensions.autoDisableScopes" "0"
  set_pref "$f" "extensions.enabledScopes" "15"
  set_pref "$f" "xpinstall.signatures.required" "false"
  sed -i '/^user_pref("extensions\.lastAppBuildID"/d; /^user_pref("extensions\.lastAppBuildId"/d; /^user_pref("extensions\.lastAppVersion"/d' "$f"
}

PY=""
for c in python3 "$HOME/miniconda3/bin/python3" "$HOME/anaconda3/bin/python3" \
         /opt/miniconda3/bin/python3 /opt/anaconda3/bin/python3 \
         /usr/bin/python3 "$HOME/.pyenv/shims/python3"; do
  if command -v "$c" >/dev/null 2>&1 && "$c" -c 'import lxml, docx, requests' >/dev/null 2>&1; then PY="$(command -v "$c")"; break; fi
done
ensure_python() {
  [ -n "$PY" ] && { pass "Python libraries already present ($PY)"; return 0; }
  step "Installing Python packages (lxml, python-docx, requests)…"
  local c
  for c in "$HOME/miniconda3/bin/python3" "$HOME/anaconda3/bin/python3" \
           /opt/miniconda3/bin/python3 /opt/anaconda3/bin/python3 \
           "$(command -v python3 2>/dev/null || true)"; do
    [ -n "$c" ] && [ -x "$c" ] || continue
    if "$c" -m pip install --quiet lxml python-docx requests >/dev/null 2>&1 \
       && "$c" -c 'import lxml, docx, requests' >/dev/null 2>&1; then PY="$c"; pass "Python libraries installed into $c"; return 0; fi
  done
  [ "$PKG" = apt ] && { step "Installing python3-venv…"; apt_install python3-venv || fail "Install python3-venv" "package install failed"; }
  step "Creating a private Python environment…"
  mkdir -p "$HOME/ScholarWeft"
  python3 -m venv "$HOME/ScholarWeft/venv" || { fail "Create Python env" "venv creation failed"; return 1; }
  PY="$HOME/ScholarWeft/venv/bin/python3"
  "$HOME/ScholarWeft/venv/bin/pip" install --quiet --upgrade pip >/dev/null 2>&1 || true
  "$HOME/ScholarWeft/venv/bin/pip" install --quiet lxml python-docx requests \
    && pass "Created a private Python environment ($PY)" || fail "Python libraries" "pip install failed"
}

# ═════════════════════════════════════════════════════════════════════════════
say "ScholarWeft setup (script $SCRIPT_REV)"
echo "  Running: $0"
echo "  I'll ask before each step — single keypress: y to install/configure, n to skip, q to quit."
echo "  Safe to re-run; nothing is changed without a yes."
[ -z "$PKG" ] && printf '  \033[33m!\033[0m Neither apt nor dnf found — package installs will be skipped.\n'

had_obsidian=0; have obsidian && had_obsidian=1
had_zotero=0;   have zotero   && had_zotero=1
if [ "$had_obsidian" = 0 ] || [ "$had_zotero" = 0 ]; then
  if ask "Install the Obsidian and Zotero apps with Flatpak?" "Install apps"; then
    if have flatpak; then
      [ "$had_obsidian" = 1 ] || { step "Installing Obsidian…"; flatpak install -y flathub md.obsidian.Obsidian && pass "Installed Obsidian" || fail "Install Obsidian" "flatpak failed"; }
      [ "$had_zotero" = 1 ]   || { step "Installing Zotero…";   flatpak install -y flathub org.zotero.Zotero      && pass "Installed Zotero"   || fail "Install Zotero" "flatpak failed"; }
    else fail "Install apps" "Flatpak is not installed (get the apps from obsidian.md and zotero.org)"; fi
  fi
fi
# A freshly installed app has no vault/profile yet; say so before the steps
# that need one (the vault search and the Zotero steps pause and offer a retry).
if [ "$had_obsidian" = 0 ] && have obsidian; then
  echo "  Obsidian was just installed: open it once, create (or open) a vault,"
  echo "  then quit it before the plugin step below."
fi
if [ "$had_zotero" = 0 ] && have zotero; then
  echo "  Zotero was just installed: open it once (this creates its profile),"
  echo "  then quit it before the Zotero steps below."
fi

# Locate the vault up front, so it's clear where plugins would go before we ask.
locate_vaults

if ask "Set up the Obsidian plugins (ScholarWeft, ZotLit, BRAT) and their settings? (Close Obsidian first.)" "Set up Obsidian plugins"; then
  if _retry_while "Obsidian is still running — please quit it, then retry." "Set up Obsidian plugins" pgrep -xi obsidian; then
    if pick_vault; then
      disable_conflicting_plugins "$VAULT"
      install_obsidian_plugin "nebedaay/ScholarWeft" "scholar-weft" "$VAULT"
      install_obsidian_plugin "PKM-er/obsidian-zotlit" "zotlit" "$VAULT"
      install_obsidian_plugin "TfTHacker/obsidian42-brat" "obsidian42-brat" "$VAULT"
      brat_register "$VAULT"
      queue_pending_setup "$VAULT" zotlit
    fi
  fi
fi

# Queued work runs inside Obsidian, where the plugins are loaded and their
# settings can be changed safely.
if [ -n "$VAULT" ]; then
  echo "  Note: ScholarWeft will install and set its ZotLit templates the next time"
  echo "  you open Obsidian (it does this from inside Obsidian, where it's safe to"
  echo "  change another plugin's settings)."
fi

# Optional and separate from the plugin step, so one can be declined without the other.
echo
echo "  Recommended: weave all your notes together."
echo "  ScholarWeft works best when every note carries a few properties. Based on Nick"
echo "  Milo's \"Linking Your Thinking\" philosophy, my \"Basic note template\" inserts"
echo "  four properties at the top of each new note: the 'created' date, the note's"
echo "  category ('up'), 'related' notes, and alternative names ('aliases'). It lives in"
echo "  its own folder (sw-markdown-templates/) so it never interferes with your own"
echo "  templates."
echo "  If you already have a rule applying another template to new notes in \"/\","
echo "  nothing is replaced now: the next time you open Obsidian, ScholarWeft asks"
echo "  whether to keep that rule or replace it with its own."
if ask "Install that template and configure Templater to apply it to every new note? (Close Obsidian first.)" "Install note template"; then
  if _retry_while "Obsidian is still running — please quit it, then retry." "Install note template" pgrep -xi obsidian; then
    if pick_vault; then
      install_obsidian_plugin "SilentVoid13/Templater" "templater-obsidian" "$VAULT"
      queue_pending_setup "$VAULT" templater
    fi
  fi
fi

if ask "Install the Better BibTeX and ZotLit extensions into Zotero? (Close Zotero first.)" "Install Zotero extensions"; then
  if _retry_while "Zotero is still running — please quit it, then retry." "Install Zotero extensions" zotero_running; then
    if ensure_zotero_profile; then
      if [ -f "$ZPROFILE/extensions/better-bibtex@iris-advies.com.xpi" ]; then pass "Better BibTeX already installed"
      else install_zotero_addon "retorquere/zotero-better-bibtex" "better-bibtex@iris-advies.com" && pass "Installed Better BibTeX"; fi
      if [ -f "$ZPROFILE/extensions/zotlit@aidenlx.site.xpi" ]; then pass "ZotLit Zotero add-on already installed"
      else install_zotero_addon "zotlit" "zotlit@aidenlx.site" && pass "Installed the ZotLit Zotero add-on"; fi
      enable_zotero_sideload "$ZPROFILE/prefs.js" && pass "Told Zotero to load the add-ons on next start (start Zotero now)"
    else
      skip "Install Zotero extensions"
    fi
  fi
fi

if ask "Set Zotero's local connection and the Better BibTeX citekey formula? (Close Zotero first.)" "Set Zotero preferences"; then
  if _retry_while "Zotero is still running — please quit it, then retry." "Set Zotero preferences" zotero_running; then
    if ensure_zotero_profile; then
      step "Editing Zotero's preferences (a backup is saved)…"
      cp "$ZPROFILE/prefs.js" "$ZPROFILE/prefs.js.scholarweft.bak.$(date +%s)"
      if grep -q 'extensions.zotero.httpServer.localAPI.enabled", true' "$ZPROFILE/prefs.js"; then
        pass "Zotero local connection already enabled"
      else
        set_pref "$ZPROFILE/prefs.js" "extensions.zotero.httpServer.enabled" "true"
        set_pref "$ZPROFILE/prefs.js" "extensions.zotero.httpServer.localAPI.enabled" "true"
        pass "Enabled Zotero's local connection (start Zotero again to apply)"
      fi
      if grep -q 'better-bibtex.citekeyFormat"' "$ZPROFILE/prefs.js"; then
        set_pref "$ZPROFILE/prefs.js" "extensions.zotero.translators.better-bibtex.citekeyFormat" '"auth(15).lower.alphanum.nopunct + shorttitle(2,2).nopunct.alphanum + year.alphanum.nopunct"'
        set_pref "$ZPROFILE/prefs.js" "extensions.zotero.translators.better-bibtex.citekeyFormatEditing" '"auth(15).lower.alphanum.nopunct + shorttitle(2,2).nopunct.alphanum + year.alphanum.nopunct"'
        pass "Set the Better BibTeX citekey formula"
      fi
    else
      skip "Set Zotero preferences"
    fi
  fi
fi

if ask "Install Python, its packages, and Pandoc (required for document import/export)?" "Install Python + Pandoc"; then
  if [ -n "$PKG" ]; then
    have python3 || { step "Installing Python…"; apt_install python3 python3-pip python3-venv && pass "Installed Python" || fail "Install Python" "package install failed"; }
    have pandoc  || { step "Installing Pandoc…"; apt_install pandoc && pass "Installed Pandoc" || fail "Install Pandoc" "package install failed"; }
  fi
  ensure_python
fi

if ask "Install LibreOffice (required for PDF export using DOCX/ODT templates)?" "Install LibreOffice"; then
  if have soffice; then pass "LibreOffice already installed"
  elif [ -n "$PKG" ]; then step "Installing LibreOffice…"; apt_install libreoffice && pass "Installed LibreOffice" || fail "Install LibreOffice" "package install failed"
  else fail "Install LibreOffice" "no package manager — install from libreoffice.org"; fi
fi

if ask "Install LaTeX (required for PDF export using .tex templates; may be several GB)?" "Install LaTeX"; then
  if have lualatex; then pass "LaTeX already installed"
  elif [ -n "$PKG" ]; then
    step "Installing TeX Live…"
    if [ "$PKG" = apt ]; then apt_install texlive-luatex texlive-latex-recommended texlive-fonts-recommended && pass "Installed LaTeX" || fail "Install LaTeX" "package install failed"
    else apt_install texlive-scheme-basic texlive-luatex && pass "Installed LaTeX" || fail "Install LaTeX" "package install failed"; fi
  else fail "Install LaTeX" "no package manager — install TeX Live from tug.org"; fi
fi

if have lualatex; then
  if ask "Install the fonts the LaTeX templates expect (Noto; Scheherazade for Arabic)?" "Install fonts"; then
    if [ "$PKG" = apt ]; then apt_install fonts-noto-core fonts-noto-extra && pass "Installed Noto fonts" || fail "Install fonts" "package install failed"; fi
    cat <<'EOF'
  For emoji, install the MONOCHROME "Noto Emoji" (https://github.com/googlefonts/noto-emoji);
  colour emoji fonts can't be used by LaTeX. For Arabic, Scheherazade New
  (https://software.sil.org/scheherazade/): copy the .ttf files to ~/.fonts, then run  fc-cache -f
EOF
    luaotfload-tool --update 2>/dev/null || true
  fi
fi

# ── Summary ──────────────────────────────────────────────────────────────────
say "Summary"
if [ "${#DONE[@]}" -gt 0 ]; then echo "  Succeeded:"; for x in "${DONE[@]}"; do echo "    ✓ $x"; done; fi
if [ "${#FAILED[@]}" -gt 0 ]; then echo; echo "  Failed:"; for x in "${FAILED[@]}"; do echo "    ✗ $x"; done; fi
if [ "${#SKIPPED[@]}" -gt 0 ]; then echo; echo "  Skipped:"; for x in "${SKIPPED[@]}"; do echo "    – $x"; done; fi
if [ "${#FAILED[@]}" -gt 0 ]; then
  echo
  echo "  Fix the reason shown next to each failure (e.g. quit Zotero and re-run for"
  echo "  the Zotero steps) and run this script again. If a failure has no clear reason,"
  echo "  follow the matching step in the manual instructions: docs/setup.md."
fi
[ -n "$PY" ] && echo "  Python ScholarWeft can use: $PY"
echo
echo "  If Obsidian shows \"Restricted mode\", turn it off (Settings → Community"
echo "  plugins): the plugins are already installed and listed, so they'll load then."
echo "  Then: start Zotero if it was closed; restart Obsidian and enable any plugins"
echo "  in Settings → Community plugins; click Retry in ScholarWeft's settings if it"
echo "  says \"Cannot connect to Zotero\"."
echo "  If a plugin won't turn on (ZotLit is the usual one), your Obsidian installer"
echo "  is probably older than the app: the app updates itself, but the installer only"
echo "  updates when you reinstall from a fresh download. Check Settings → About →"
echo "  Installer version, then reinstall from https://obsidian.md/download — your vault"
echo "  and settings are untouched."
echo "  If you installed ZotLit: ScholarWeft installs its import templates and"
echo "  points ZotLit's \"Template folder\" at sw-zotlit-templates/ the next time you"
echo "  open Obsidian — no manual step needed."
