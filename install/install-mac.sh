#!/usr/bin/env bash
#
# ScholarWeft setup helper — macOS.
#
# Asks before each step (y / n / esc to quit), reports progress, reuses what
# you already have, and ends with a summary of what succeeded / failed / was
# skipped. Nothing is changed without a yes; safe to re-run.
#
# Usage:  bash install-mac.sh
#
set -o pipefail

say()  { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
step() { printf '  \033[36m…\033[0m %s\n' "$*"; }
pass() { printf '  \033[32m✓\033[0m %s\n' "$*"; DONE+=("$*"); }
fail() { printf '  \033[31m✗\033[0m %s%s\n' "$1" "${2:+ — $2}"; FAILED+=("$1${2:+ — $2}"); }
skip() { SKIPPED+=("$*"); }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }

# The app's own version (CFBundleShortVersionString). NOTE: this is NOT the
# INSTALLER version — only Obsidian's "Show debug info" reveals that — but it is
# what changes when the app is replaced, so it makes a refresh verifiable.
obsidian_app_version() {
  /usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" \
    /Applications/Obsidian.app/Contents/Info.plist 2>/dev/null || true
}

# The app hosting this shell — needed to tell the user exactly which app to grant
# Full Disk Access to (macOS hides protected folders from it until then).
terminal_app_name() {
  case "${TERM_PROGRAM:-}" in
    Apple_Terminal) echo "Terminal" ;;
    iTerm.app)       echo "iTerm" ;;
    WarpTerminal)    echo "Warp" ;;
    vscode)          echo "Visual Studio Code" ;;
    Hyper)           echo "Hyper" ;;
    kitty)           echo "kitty" ;;
    WezTerm)         echo "WezTerm" ;;
    tabby)           echo "Tabby" ;;
    "")              echo "Terminal" ;;
    *)               echo "$TERM_PROGRAM" ;;
  esac
}

# Is a font family installed — whether by brew cask OR dragged into a Fonts
# folder (Font Book)? Uses fc-list when available, else scans the font folders.
# So we don't reinstall fonts the user already has (a cask installs one file
# per weight; a variable font is a single file).
font_present() { # <family with spaces>  <filename substring>
  if have fc-list && fc-list 2>/dev/null | grep -qiF "$1"; then return 0; fi
  local d
  for d in "$HOME/Library/Fonts" /Library/Fonts; do
    [ -d "$d" ] && find "$d" -maxdepth 1 -iname "*$2*" 2>/dev/null | grep -q . && return 0
  done
  return 1
}
FONT_SPECS=(
  "font-noto-serif|Noto Serif|NotoSerif"
  "font-noto-sans|Noto Sans|NotoSans"
  "font-noto-emoji|Noto Emoji|NotoEmoji"
  "font-scheherazade-new|Scheherazade|Scheherazade"
)

# Bump when the script changes, and print it at start-up so it's obvious which
# copy is running (a stale download has caused confusion).
SCRIPT_REV="2026-09-24e"

DONE=(); FAILED=(); SKIPPED=()
# Set once the user declines Homebrew, so later brew-needing steps don't keep
# re-asking.
_BREW_DECLINED=0

# This script asks questions as it goes. If stdin isn't a terminal (e.g. it was
# run as `curl … | bash`), `read` consumes the SCRIPT TEXT instead of the
# keyboard — so prompts are skipped and steps run as if answered. Refuse rather
# than act without consent.
if [ ! -t 0 ]; then
  echo "This setup asks before each step, so it needs an interactive terminal —"
  echo "it can't be piped (as in 'curl … | bash')."
  echo
  echo "Download it, then run it directly:"
  echo "  curl -fsSL https://raw.githubusercontent.com/nebedaay/ScholarWeft/main/install/install-mac.sh -o install-mac.sh"
  echo "  bash install-mac.sh"
  exit 1
fi

ask() { # <question> [label-for-summary]  → single keypress: y / n / q
  local a
  while :; do
    printf '%s [y/n/q] ' "$1"
    # Read from the terminal explicitly, so a redirected stdin can't feed answers.
    IFS= read -r -n 1 a </dev/tty || exit 0
    printf '\n'
    case "${a:-}" in
      [yY]) return 0 ;;
      [nN]) [ -n "${2:-}" ] && skip "$2"; return 1 ;;
      [qQ]|$'\e') echo '  Cancelled — nothing more will be changed.'; exit 0 ;;
      *) printf '  Please press y, n, or q.\n' ;;
    esac
  done
}

# Like `ask`, but requires the user to TYPE a word (not a single keypress) —
# used for anything destructive, where a stray keystroke must not trigger it.
# Enter / anything else declines.
ask_type() { # <question> <required-word> [label-for-summary]
  local answer
  printf '%s ' "$1"
  IFS= read -r answer </dev/tty || exit 0
  if [ "$answer" = "$2" ]; then return 0; fi
  [ -n "${3:-}" ] && skip "$3"
  return 1
}

# Remind the user to quit an app (Obsidian/Zotero) and offer to retry while a
# condition still holds, instead of skipping the step outright.
#   _retry_while <message> <skip-label> <test-command...>
_retry_while() {
  local msg="$1" label="$2"; shift 2
  while "$@"; do
    echo "  $msg"
    ask "  Retry?" "$label" || return 1
  done
  return 0
}

# Homebrew is how the document tools (and optionally the apps) are installed.
# Offer to install it when it's missing, then put it on PATH for this shell.
ensure_brew() {
  have brew && return 0
  [ "${_BREW_DECLINED:-0}" = 1 ] && return 1
  if ! ask "Homebrew is not installed — install it now (needed to install the apps and document tools)?" "Install Homebrew"; then
    _BREW_DECLINED=1
    return 1
  fi
  step "Installing Homebrew (the installer asks for your password)…"
  if /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"; then
    # Apple Silicon installs to /opt/homebrew; Intel to /usr/local. Evaluate
    # shellenv so brew is on PATH for the REST OF THIS RUN, and append the same
    # line to ~/.zprofile (idempotently) so FUTURE terminals find it too — the
    # installer only prints that command for you to run by hand.
    local brewexpr=''
    if   [ -x /opt/homebrew/bin/brew ]; then
      brewexpr='eval "$(/opt/homebrew/bin/brew shellenv)"'; eval "$(/opt/homebrew/bin/brew shellenv)"
    elif [ -x /usr/local/bin/brew ]; then
      brewexpr='eval "$(/usr/local/bin/brew shellenv)"'; eval "$(/usr/local/bin/brew shellenv)"
    fi
    if [ -n "$brewexpr" ] && [ -n "${HOME:-}" ]; then
      grep -qsF "$brewexpr" "$HOME/.zprofile" 2>/dev/null \
        || printf '\n# Added by the ScholarWeft setup script\n%s\n' "$brewexpr" >> "$HOME/.zprofile"
    fi
    if have brew; then pass "Installed Homebrew"; return 0; fi
    fail "Install Homebrew" "installed, but brew is not on PATH — open a new terminal and re-run"
  else
    fail "Install Homebrew" "the installer failed"
  fi
  return 1
}

# ── JSON settings writers (for other plugins' data.json) ─────────────────────
# A plugin needn't have been enabled for us to create its data.json: plugins
# merge `DEFAULT_SETTINGS` with whatever the file holds, so a partial file is
# fine. We only edit with Obsidian CLOSED so nothing rewrites it under us, and
# we back up first. Uses python3 when available, else writes only if absent.
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
#   ~/Library/Application Support/obsidian/obsidian.json
# — the same list its "Open another vault" chooser shows. Reading it is instant
# and authoritative, so it is the ONLY automatic source; we never scan the
# filesystem. If it lists no vaults, the user simply has none yet (Obsidian was
# never opened, or no vault was created), so we ASK rather than search.

# Obsidian's OWN vault registry — the same list its "Open another vault"
# chooser shows. Reading it is instant and authoritative, so it comes first.
# Contains {"vaults":{"<id>":{"path":"/…", …}, …}, …}.
_obsidian_registry_vaults() {
  local f="$HOME/Library/Application Support/obsidian/obsidian.json"
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

# Classify each vault Obsidian has registered, one line of output per entry:
#   OK<TAB>/path      a readable vault (.obsidian present)
#   STALE<TAB>/path   the parent folder is readable, but the vault is gone (moved/deleted)
#   BLOCKED<TAB>/path the parent folder is unreadable — almost always a macOS permission
#
# macOS protects ~/Documents, ~/Desktop, ~/Downloads and iCloud Drive: until the
# terminal app is granted access, a real vault there is invisible to us and
# `[ -d ]` simply returns false. So we must never confuse "can't read it" with
# "there is no vault".
_registry_file() { printf '%s\n' "$HOME/Library/Application Support/obsidian/obsidian.json"; }

_classify_vaults() {
  local v cand parent
  while IFS= read -r v; do
    [ -n "$v" ] || continue
    cand="${v%/}"
    if [ -d "$cand/.obsidian" ]; then
      printf 'OK\t%s\n' "$cand"
    else
      parent="$(dirname "$cand")"
      if [ -d "$parent" ]; then printf 'STALE\t%s\n' "$cand"
      else printf 'BLOCKED\t%s\n' "$cand"; fi
    fi
  done < <(_obsidian_registry_vaults)
}

# Explain the macOS permission wall for the vault paths passed in, and offer to
# open the right settings pane. Granting access needs a fresh terminal process,
# so the fix is "grant, quit, reopen, re-run".
_vault_permission_help() {
  local app v; app="$(terminal_app_name)"
  echo "  Obsidian lists a vault, but macOS is hiding it from this terminal:"
  for v in "$@"; do printf '    %s\n' "$v"; done
  echo
  echo "  macOS blocks the terminal from folders like Documents, Desktop, Downloads"
  echo "  and iCloud Drive until you allow it — so the vault can't be found or"
  echo "  written to yet."
  echo
  echo "  Do this once, then run the script again:"
  echo "    1. Open System Settings → Privacy & Security → Full Disk Access."
  echo "    2. Turn ON \"$app\"  (add it with + from Applications/Utilities if unlisted)."
  echo "    3. Quit and reopen $app, then re-run this script."
  echo
  echo "  In a hurry? Granting only the folder works too: add it under"
  echo "  Privacy & Security → Files and Folders. Moving the vault out of these"
  echo "  protected folders (e.g. to your home folder) also avoids the issue."
  if command -v open >/dev/null 2>&1; then
    if ask "  Open System Settings to Full Disk Access now?"; then
      open "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles" \
        || warn "Couldn't open System Settings — open it from the Apple menu."
    fi
  fi
}
VAULT=""
VAULTS=()
locate_vaults() {
  local v n i status path blocked stale
  local blocked_paths=() stale_paths=()
  step "Looking up your Obsidian vaults…"
  VAULTS=()
  while IFS=$'\t' read -r status path; do
    case "$status" in
      OK)
        [ -n "$path" ] || continue
        for v in "${VAULTS[@]}"; do [ "$v" = "$path" ] && continue 2; done
        VAULTS+=("$path") ;;
      BLOCKED) blocked_paths+=("$path") ;;
      STALE)   stale_paths+=("$path") ;;
    esac
  done < <(_classify_vaults)

  # Nothing usable? Say WHY. A registered-but-unreadable vault is a macOS
  # permission problem, not "no vault yet" — and before this check the two were
  # indistinguishable, which sent people round in circles.
  if [ "${#VAULTS[@]}" -eq 0 ]; then
    if [ "${#blocked_paths[@]}" -gt 0 ]; then
      _vault_permission_help "${blocked_paths[@]}"
      if ask "  I've granted access and reopened the terminal — look again?"; then
        VAULTS=(); locate_vaults; return
      fi
      if ask "  Type the vault path manually instead?"; then
        IFS= read -r -p "  Path to the vault: " VAULT
        VAULT="${VAULT/#\~/$HOME}"; VAULT="${VAULT%/}"
        if [ -d "$VAULT/.obsidian" ]; then
          pass "Using vault: $VAULT"
        elif [ -d "$VAULT" ]; then
          warn "That folder has no .obsidian folder — make sure it is a vault."
          pass "Using vault: $VAULT"
        else
          fail "Choose vault" "can't read ${VAULT:-<empty>} — if it's in Documents/Desktop/Downloads or iCloud, grant Full Disk Access"
          VAULT=""
        fi
        return
      fi
      echo "  Skipping the vault steps — re-run the script once access is granted."
      return
    fi

    if [ "${#stale_paths[@]}" -gt 0 ]; then
      warn "Obsidian lists a vault that no longer exists (moved or deleted): ${stale_paths[0]}"
    fi
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
  if [ "${#blocked_paths[@]}" -gt 0 ]; then
    warn "Some registered vaults weren't readable (macOS permission): ${blocked_paths[0]}"
    warn "If you meant that one, grant Full Disk Access to $(terminal_app_name) and re-run."
  fi
  if [ -n "$VAULT" ]; then
    if [ -d "$VAULT" ]; then printf '  Plugins will be installed into: %s\n' "$VAULT"
    else warn "Not a folder: $VAULT — I'll ask again if you choose to install a plugin."; VAULT=""; fi
  fi
}
pick_vault() { # used when a plugin install is chosen but no vault was located up front
  [ -n "$VAULT" ] && [ -d "$VAULT" ] && return 0
  IFS= read -r -p "  Path to your Obsidian vault: " VAULT
  VAULT="${VAULT/#\~/$HOME}"; VAULT="${VAULT%/}"
  if [ ! -d "$VAULT" ]; then
    fail "Choose vault" "can't read ${VAULT:-<empty>} — if it's in Documents/Desktop/Downloads or iCloud, grant $(terminal_app_name) Full Disk Access (System Settings → Privacy & Security) and re-run"
    VAULT=""; return 1
  fi
  return 0
}

# ── Obsidian plugin install ──────────────────────────────────────────────────
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
  # NOTE: compute `dir` on its own line. In one `local a=… b=$a/…` statement
  # bash 3.2 (macOS) expands `$a` BEFORE assigning it, so b would be built from
  # an empty value — that bug made the install path `/.obsidian/…`.
  local dir="$vault/.obsidian/plugins/$id" a u json tag latest inst
  if [ -z "$vault" ] || [ ! -d "$vault" ]; then
    fail "Install $id plugin" "no valid vault folder was chosen"; return 1
  fi
  mkdir -p "$dir"
  # GitHub's /releases/latest is 404 for repos whose releases are ALL marked
  # pre-release (ScholarWeft's are), so fall back to the releases LIST, which
  # includes pre-releases and is newest-first.
  json="$(curl -fsSL -H 'User-Agent: ScholarWeft' "https://api.github.com/repos/$repo/releases/latest" 2>/dev/null || true)"
  if ! printf '%s' "$json" | grep -q '"browser_download_url"'; then
    json="$(curl -fsSL -H 'User-Agent: ScholarWeft' "https://api.github.com/repos/$repo/releases?per_page=1" 2>/dev/null || true)"
  fi
  if ! printf '%s' "$json" | grep -q '"browser_download_url"'; then
    fail "Install $id plugin" "could not read release info (network or GitHub rate limit)"; return 1
  fi
  # Skip if the installed version is already the latest (no needless overwrite).
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


# Register repos in BRAT's beta list so they update automatically. BRAT needn't
# have run yet: its data.json is a partial file it merges with its defaults.
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


# Point ZotLit's "Template folder" at our folder. ZotLit needn't have run yet.
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


# Plugins that register the SAME sidebar view type ("ReferenceListView") as
# ScholarWeft: the ancestral "Pandoc Reference List" (which this fork derives
# from) and the fork's earlier names. With any of them enabled, Obsidian has two
# registrations of the same view type. Disable them (non-destructive) so they
# won't load — the user can remove the folders later if they wish.
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

# ── Zotero add-ons / prefs ───────────────────────────────────────────────────
# Recompute on demand: Zotero creates its profile on FIRST LAUNCH, so a Zotero
# installed during this run has none until the user opens it once.
zotero_profile() {
  local p
  for p in "$HOME/Library/Application Support/Zotero/Profiles"/*/prefs.js; do
    [ -f "$p" ] && { printf '%s' "$(dirname "$p")"; return 0; }
  done
  return 0
}
ZPROFILE="$(zotero_profile)"
# Ensure a Zotero profile exists, pausing for the user to launch Zotero once
# (which creates it), then offering to retry — instead of failing the step.
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
  if grep -qF "user_pref(\"$k\"" "$f"; then sed -i '' "s|^user_pref(\"$k\".*|user_pref(\"$k\", $v);|" "$f"
  else printf 'user_pref("%s", %s);\n' "$k" "$v" >> "$f"; fi
}

# Zotero 7 doesn't register an .xpi merely placed in extensions/; installation
# goes through the Add-ons Manager. To make Zotero pick up the files we placed,
# allow sideloading AND drop the lastApp* prefs so it re-scans extensions/ on
# next start (Zotero's own dev docs use this to force a re-read).
enable_zotero_sideload() { # <prefs.js>
  local f="$1"
  cp "$f" "$f.scholarweft.bak.$(date +%s)" 2>/dev/null || true
  set_pref "$f" "extensions.autoDisableScopes" "0"
  set_pref "$f" "extensions.enabledScopes" "15"
  set_pref "$f" "xpinstall.signatures.required" "false"
  sed -i '' '/^user_pref("extensions\.lastAppBuildID"/d; /^user_pref("extensions\.lastAppBuildId"/d; /^user_pref("extensions\.lastAppVersion"/d' "$f"
}

# ── Python / Pandoc ──────────────────────────────────────────────────────────
PY=""
for c in python3 "$HOME/miniconda3/bin/python3" "$HOME/anaconda3/bin/python3" \
         /opt/miniconda3/bin/python3 /opt/anaconda3/bin/python3 \
         /opt/homebrew/bin/python3 /usr/local/bin/python3 /usr/bin/python3 \
         "$HOME/.pyenv/shims/python3"; do
  if command -v "$c" >/dev/null 2>&1 && "$c" -c 'import lxml, docx, requests' >/dev/null 2>&1; then PY="$(command -v "$c")"; break; fi
done
ensure_python() {
  [ -n "$PY" ] && { pass "Python libraries already present ($PY)"; return 0; }
  step "Installing Python packages (lxml, python-docx, requests)…"
  local c
  for c in "$HOME/miniconda3/bin/python3" "$HOME/anaconda3/bin/python3" \
           /opt/miniconda3/bin/python3 /opt/anaconda3/bin/python3 \
           /usr/local/bin/python3 "$(command -v python3 2>/dev/null || true)"; do
    [ -n "$c" ] && [ -x "$c" ] || continue
    if "$c" -m pip install --quiet lxml python-docx requests >/dev/null 2>&1 \
       && "$c" -c 'import lxml, docx, requests' >/dev/null 2>&1; then PY="$c"; pass "Python libraries installed into $c"; return 0; fi
  done
  if ! have python3; then
    if ensure_brew; then step "Installing Python…"; brew install python || { fail "Install Python" "brew install failed"; return 1; }
    else fail "Install Python" "Homebrew is needed (see https://brew.sh)"; return 1; fi
  fi
  PY="$HOME/ScholarWeft/venv/bin/python3"
  step "Creating a private Python environment…"
  mkdir -p "$HOME/ScholarWeft"
  python3 -m venv "$HOME/ScholarWeft/venv" 2>/dev/null || "$(brew --prefix)"/bin/python3 -m venv "$HOME/ScholarWeft/venv" \
    || { fail "Create Python env" "venv creation failed"; return 1; }
  "$HOME/ScholarWeft/venv/bin/pip" install --quiet --upgrade pip >/dev/null 2>&1 || true
  "$HOME/ScholarWeft/venv/bin/pip" install --quiet lxml python-docx requests \
    && pass "Created a private Python environment ($PY)" || fail "Python libraries" "pip install failed"
}

# ═════════════════════════════════════════════════════════════════════════════
say "ScholarWeft setup (script $SCRIPT_REV)"
echo "  Running: $0"
echo "  I'll ask before each step — single keypress: y to install/configure, n to skip, q to quit."
echo "  Safe to re-run; nothing is changed without a yes."

# Check the apps first; Homebrew is offered as the means to install them (and
# again later if a document-tool step needs it), not unconditionally up front.
OBSIDIAN_APP=0; [ -d /Applications/Obsidian.app ] && OBSIDIAN_APP=1
ZOTERO_APP=0;   [ -d /Applications/Zotero.app ] && ZOTERO_APP=1
if [ "$OBSIDIAN_APP" = 0 ] || [ "$ZOTERO_APP" = 0 ]; then
  if ask "Install the Obsidian and Zotero apps with Homebrew?" "Install apps"; then
    if ensure_brew; then
      [ "$OBSIDIAN_APP" = 1 ] || { step "Installing Obsidian…"; brew install --cask obsidian && pass "Installed Obsidian" || fail "Install Obsidian" "brew install failed"; }
      [ "$ZOTERO_APP" = 1 ]   || { step "Installing Zotero…";   brew install --cask zotero   && pass "Installed Zotero"   || fail "Install Zotero" "brew install failed"; }
    else fail "Install apps" "Homebrew is needed to install the apps (see https://brew.sh)"; fi
  fi
fi

# Refresh Obsidian for an existing install. Obsidian has TWO version numbers:
# the APP self-updates, but the INSTALLER only changes when Obsidian is
# reinstalled — and plugins (ZotLit especially) refuse to load on an installer
# below 1.13.4. The installer version isn't readable from disk (only the app's
# Info.plist version is), so we ask the user, and word it so their answer picks
# between "you need this" and "you'd still benefit".
if [ "$OBSIDIAN_APP" = 1 ]; then
  echo
  echo "  Obsidian is installed. We recommend periodically REFRESHING it (reinstalling,"
  echo "  not just updating), which keeps its installer compatible with plugins."
  echo "    • Check Settings → About → Installer version."
  echo "    • Below 1.13.4, or unsure? You need to reinstall Obsidian to use ZotLit."
  echo "    • Higher? Still worth refreshing if you haven't in a while."
  echo "  Refreshing replaces the app; your vaults, plugins and settings are untouched."
  if ask "  Refresh Obsidian now?" "Refresh Obsidian"; then
    if ensure_brew; then
      # `brew upgrade`/`reinstall` only work on a cask BREW installed: they
      # uninstall-then-reinstall using the options it was originally installed
      # with, and fail on an app installed manually (e.g. dragged from the .dmg).
      # Obsidian's cask is a plain app copy — no sudo, no prompts.
      if brew list --cask --versions obsidian >/dev/null 2>&1; then
        local before; before="$(obsidian_app_version)"
        step "Refreshing Obsidian (Homebrew-managed)${before:+ — was $before}…"
        if brew upgrade --cask obsidian || brew reinstall --cask obsidian; then
          local after; after="$(obsidian_app_version)"
          pass "Refreshed Obsidian (installer updated)${after:+ — now version $after}"
        else
          fail "Refresh Obsidian" "brew failed — reinstall from https://obsidian.md/download"
        fi
      else
        # Manually installed: brew won't replace it in place, so the app has to
        # go first. Deleting an application is destructive, so this needs a
        # TYPED confirmation — a stray keypress must not start it — and we move
        # the app to the Trash rather than deleting it, so it can be restored.
        echo
        echo "  Refreshing replaces the current Obsidian with a fresh copy: it has to be"
        echo "  deleted and reinstalled. Your vaults, plugins and settings are NOT inside"
        echo "  the app, so they are safe."
        echo
        echo "    • To let this script do it, type:  yes"
        echo "    • To do it yourself later: quit Obsidian, delete it from Applications,"
        echo "      then reinstall from https://obsidian.md/download"
        echo "    • Anything else (including just pressing Return) skips this step."
        echo
        if ask_type "  Refresh Obsidian now? (yes/n/q):" "yes" "Refresh Obsidian"; then
          if _retry_while "Obsidian is still running — please quit it (Cmd+Q), then retry." \
                          "Refresh Obsidian" pgrep -x Obsidian; then
            step "Moving Obsidian to the Trash…"
            osascript -e 'tell application "Finder" to delete (POSIX file "/Applications/Obsidian.app" as alias)' >/dev/null 2>&1
            # Verify it actually went: `osascript` reports success even when the
            # Finder delete is refused (e.g. missing automation permission), so
            # never proceed on its exit status alone.
            if [ -d /Applications/Obsidian.app ]; then
              fail "Refresh Obsidian" "Obsidian is still in /Applications — delete it there, then reinstall from https://obsidian.md/download"
            else
              pass "Moved Obsidian to the Trash (restore it from there if this fails)"
              step "Reinstalling Obsidian…"
              if brew install --cask obsidian; then
                local after; after="$(obsidian_app_version)"
                pass "Refreshed Obsidian (installer updated)${after:+ — now version $after}"
              else
                fail "Refresh Obsidian" "install failed — Obsidian is in your Trash; reinstall from https://obsidian.md/download"
              fi
            fi
          fi
        else
          echo "  Skipped. You can refresh Obsidian yourself any time (see above)."
        fi
      fi
    else fail "Refresh Obsidian" "Homebrew is needed; reinstall from https://obsidian.md/download"; fi
  fi
fi
# A freshly installed app has no vault/profile yet; say so before the steps
# that need one (the vault search and the Zotero steps pause and offer a retry).
if [ "$OBSIDIAN_APP" = 0 ] && [ -d /Applications/Obsidian.app ]; then
  echo "  Obsidian was just installed: open it once, create (or open) a vault,"
  echo "  then quit it before the plugin step below."
fi
if [ "$ZOTERO_APP" = 0 ] && [ -d /Applications/Zotero.app ]; then
  echo "  Zotero was just installed: open it once (this creates its profile),"
  echo "  then quit it before the Zotero steps below."
fi

# Locate the vault up front, so it's clear where plugins would go before we ask.
locate_vaults

if ask "Set up the Obsidian plugins (ScholarWeft, ZotLit, BRAT) and their settings? (Close Obsidian first.)" "Set up Obsidian plugins"; then
  if _retry_while "Obsidian is still running — please quit it (Cmd+Q), then retry." "Set up Obsidian plugins" pgrep -x Obsidian; then
    if pick_vault; then
      # ZotLit (and sometimes others) refuse to load on an old Obsidian
      # INSTALLER even when the app is current — and the installer only updates
      # by reinstalling Obsidian. Flag it now, before the plugins are relied on,
      # since the symptom otherwise looks like a failed install.
      echo "  Reminder: if a plugin won't turn on (ZotLit is the usual one), its"
      echo "  INSTALLER is probably below 1.13.4. Re-run this script and say yes to"
      echo "  \"Refresh Obsidian\" (or reinstall from https://obsidian.md/download)."
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
  if _retry_while "Obsidian is still running — please quit it (Cmd+Q), then retry." "Install note template" pgrep -x Obsidian; then
    if pick_vault; then
      install_obsidian_plugin "SilentVoid13/Templater" "templater-obsidian" "$VAULT"
      queue_pending_setup "$VAULT" templater
    fi
  fi
fi

if ask "Install the Better BibTeX and ZotLit extensions into Zotero? (Close Zotero first.)" "Install Zotero extensions"; then
  if _retry_while "Zotero is still running — please quit it (Cmd+Q), then retry." "Install Zotero extensions" zotero_running; then
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
  if _retry_while "Zotero is still running — please quit it (Cmd+Q), then retry." "Set Zotero preferences" zotero_running; then
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
  ensure_python
  if have pandoc; then pass "Pandoc already installed"
  elif ensure_brew; then step "Installing Pandoc…"; brew install pandoc && pass "Installed Pandoc" || fail "Install Pandoc" "brew install failed"
  else fail "Install Pandoc" "Homebrew is needed (see https://brew.sh)"; fi
fi

if ask "Install LibreOffice (required for PDF export using DOCX/ODT templates)?" "Install LibreOffice"; then
  if [ -d /Applications/LibreOffice.app ]; then pass "LibreOffice already installed"
  elif ensure_brew; then step "Installing LibreOffice (large download)…"; brew install --cask libreoffice && pass "Installed LibreOffice" || fail "Install LibreOffice" "brew install failed"
  else fail "Install LibreOffice" "Homebrew is needed (see https://brew.sh)"; fi
fi

if ask "Install LaTeX (required for PDF export using .tex templates; may be several GB)?" "Install LaTeX"; then
  if have lualatex || [ -x /Library/TeX/texbin/lualatex ]; then pass "LaTeX already installed"
  elif ensure_brew; then step "Installing MacTeX…"; brew install --cask mactex-no-gui && pass "Installed LaTeX" || fail "Install LaTeX" "brew install failed"
  else fail "Install LaTeX" "Homebrew is needed (see https://brew.sh)"; fi
fi

if have lualatex || [ -x /Library/TeX/texbin/lualatex ]; then
  if ask "Install the fonts the LaTeX templates expect (Noto Serif/Sans/Emoji, Scheherazade)?" "Install fonts"; then
    if ensure_brew; then
      for spec in "${FONT_SPECS[@]}"; do
        cask="${spec%%|*}"; rest="${spec#*|*}"; fam="${rest%%|*}"; pat="${rest##*|}"
        if font_present "$fam" "$pat"; then pass "$fam already installed"
        else
          step "Installing $cask…"
          if out="$(brew install --cask "$cask" 2>&1)"; then pass "Installed $fam"
          elif printf '%s' "$out" | grep -qi 'already a Font'; then
            pass "$fam already present (a font file with that name exists — skipped)"
          else fail "Install $fam" "brew install failed"; fi
        fi
      done
      /Library/TeX/texbin/luaotfload-tool --update 2>/dev/null || true
    else fail "Install fonts" "Homebrew is needed (see https://brew.sh)"; fi
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
