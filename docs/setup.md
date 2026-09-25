# Setup — from zero to Zotero–Obsidian–document integration

This page walks through **everything**, in order, with the exact menu items and clicks. Do the steps for your operating system. Anything in a grey box is a **terminal command**: copy one line at a time, paste it, and press Return/Enter.

## The easy way: run the setup script

### Two things to check first

Do these **before** the script. Both are things the script can't do for you, and together they cause almost every "it didn't work" report.

#### 1. macOS only: let your terminal see your vault

macOS blocks apps from folders such as **Documents**, **Desktop**, **Downloads**, and **iCloud Drive** until you allow it — and a fresh terminal has access to none of them. Since that's where most vaults live, the script can't read or write your vault until you grant access:

1. Open **System Settings → Privacy & Security → Full Disk Access**.
2. Turn on your terminal app — **Terminal**, **iTerm**, **Warp**, or **Visual Studio Code**, whichever you're using. If it isn't listed, click **+**, go to **Applications → Utilities**, and add it.
3. **Quit the terminal completely** (`Cmd` + `Q`) and reopen it — access only applies to a newly started app; closing the window is not enough.

(Windows and Linux: skip this step.)

#### 2. Everyone: check Obsidian's *installer* version

Obsidian has **two** version numbers, and the one that matters here isn't the one that updates itself:

- the **app** version updates automatically, and
- the **installer** version only changes when Obsidian is **reinstalled**.

**The installer being behind the app version is normal** — it happens every time the app updates, and it is not a problem in itself. What matters is the **threshold**: plugins — **ZotLit especially** — will not load on an installer **below 1.13.4**. (If you don't use ZotLit, an older installer is usually fine.)

**Check it:** open Obsidian → **Settings → About** (or run **Show debug info** from the command palette) and read the **Installer version**.

- **Below 1.13.4, or unsure?** You need to reinstall Obsidian for ZotLit to work.
- **1.13.4 or higher?** You're fine. It's still worth refreshing occasionally, but nothing is broken.

**Reinstalling Obsidian is easy, and the setup script offers to do it:** it asks *"Refresh Obsidian now?"* and reinstalls the app for you (through Homebrew, Flatpak, or winget, depending on your system). That replaces the app and updates its installer; **your vaults, plugins, and settings are untouched.**

- If Obsidian was installed through your package manager, the script updates it in place.
- If it was installed by hand (dragged from the download), the old app has to be removed first. The script **explains this and asks you to type `yes`** before doing anything — nothing is deleted by a stray keypress. If you prefer, decline and do it yourself: quit Obsidian, delete it from Applications, then reinstall.
- Either way the old app goes to the **Trash**, so it can be restored if anything goes wrong.

> **This doesn't commit you to the terminal.** Refreshing is a one-off: Obsidian keeps updating itself afterwards exactly as before, and doing so doesn't break anything. You only need the terminal again if you want to refresh a second time.

If you'd rather do it by hand: download the latest from <https://obsidian.md/download> and replace your current copy (on macOS, drag the new **Obsidian** into **Applications** and choose **Replace**).

### What the script does

**The script does all of the following steps for you, except those you’ve already done or opt out of**:

- installs/updates the Obsidian and Zotero apps
- adds the ScholarWeft and ZotLit plugins to Obsidian and the Better BibTeX and ZotLit add-ons to Zotero
- switches on Zotero's local connection
- and installs the document tools (Python, Pandoc, LibreOffice, LaTeX, fonts)

It asks before each step and skips anything you’ve already done. It offers to install **Homebrew** first if it's missing (the apps and tools are installed through it), and finds your vault on its own — it reads **Obsidian's own vault list** (the same list its "Open another vault" chooser shows), so it works wherever your vault lives, including iCloud Drive or another cloud folder. If Obsidian has no vault registered yet (never opened, or none created), it asks whether you have an existing vault to point it at, or pauses while you open Obsidian once and create one. If it installs Obsidian or Zotero for the first time, it tells you to open each once — Obsidian to create (or open) a vault, Zotero to create its profile — then quit it; the vault search and the Zotero steps pause and offer to **retry**, so you don't have to re-run the whole script if you forget to close Obsidian or Zotero.

Run the script first; the numbered steps below are the manual equivalent, and your fallback if a step fails.

The script installs plugin **files**; anything that needs another plugin's **settings** is finished from inside Obsidian the first time you open it (that's the only safe way to change another plugin's settings). So after running the script, open Obsidian once and it will finish setting up ScholarWeft's ZotLit import templates **and their frontmatter field mappings** — no manual step needed. It also offers the optional **Basic note template + Templater** step (see [Step 6b](#6b-optional-basic-note-template--templater)).

If you have more than one Obsidian vault on your machine, you'll have to run the script for each vault you want to use them with, just repeating Obsidian plugin steps (installing and configuring ScholarWeft and ZotLit).

### Open a terminal

- **macOS:** press `Cmd` + `Space`, type `Terminal`, press Enter.
- **Windows:** press the **Start** button, type `PowerShell`, open **Windows PowerShell**.
- **Linux:** press `Ctrl` + `Alt` + `T`, or open **Terminal** from your applications.

### Download and run the setup script

**macOS / Linux** — paste into a terminal (on Linux, change `install-mac.sh` to `install-linux.sh` in *both* lines):

```bash
curl -fsSL https://raw.githubusercontent.com/nebedaay/ScholarWeft/main/install/install-mac.sh -o install-mac.sh
bash install-mac.sh
```

**Windows** — paste into **PowerShell**:

```powershell
curl.exe -fsSL https://raw.githubusercontent.com/nebedaay/ScholarWeft/main/install/install-windows.ps1 -o install-windows.ps1
powershell -ExecutionPolicy Bypass -File .\install-windows.ps1
```

It is **interactive** (`y` / `n` / `q` as single keypresses before each step), safe to re-run, and finds your Obsidian vault on its own (asking which one if you have several). At the end it prints a **summary** of what **succeeded**, what **failed** (with the reason), and what you **skipped** — so you can fix a failure and run it again, or finish that one step by hand below.

> The citation features need **none** of the document tools — only **Obsidian + Zotero** (and optionally Better BibTeX/ZotLit). You can answer `n` to the Python/Pandoc/LibreOffice/LaTeX questions if you only want to cite and read; the manual steps below work the same way.

---

## 1. Install Obsidian

Download: <https://obsidian.md/download>

> **Already have Obsidian?** Check its **Installer version** (**Settings → About**, or **Show debug info**). The installer being behind the app version is normal and harmless — but plugins (ZotLit in particular) won't load on an installer **below 1.13.4**. If yours is below that, reinstall Obsidian; the [setup script](#the-easy-way-run-the-setup-script) offers a one-step **Refresh Obsidian**, or download the latest from <https://obsidian.md/download> and replace your copy. Your vaults, plugins, and settings are untouched.

**macOS**
1. Open the downloaded `.dmg`, drag **Obsidian** into the **Applications** folder, then open it from Applications.
2. On first launch, click **Open** if macOS warns about an app from the internet.
3. Click **Create new vault**; give it a name and pick a folder (e.g. `Documents/My Vault`); click **Create**.

**Windows**
1. Run the downloaded `.exe` installer and click through it, then open **Obsidian** from the Start menu.
2. Click **Create new vault**; name it and choose a folder; click **Create**.

**Linux**
1. Download the **AppImage**, or use your software store (Flatpak/Snap).
2. For the AppImage: right-click the file → **Properties** → **Permissions** → tick **Allow executing file as a program**, then double-click it.
3. Click **Create new vault**; name it and choose a folder; click **Create**.

Remember where your vault folder is — you will need it in Step 5.

---

## 2. Install Zotero and switch on the local connection

Download: <https://www.zotero.org/download/> — install the **Zotero** app (not the browser connector).

**Critical step (everyone misses it):** ScholarWeft talks to Zotero through Zotero's *local* connection, which is **off by default**. Turn it on once:

1. Open **Zotero**.
2. Open its settings:
   - **macOS:** menu **Zotero → Settings…** (or press `Cmd` + `,`)
   - **Windows/Linux:** menu **Edit → Settings…** (older Zotero: **Edit → Preferences…**)
3. Click the **Advanced** tab.
4. Near the bottom, tick **“Allow other applications on this computer to communicate with Zotero”** (some versions say *“…to connect to Zotero”*).
5. Close the settings window. Leave Zotero **running** whenever you use ScholarWeft.

> If you ever see the notice **“Cannot connect to Zotero”** in ScholarWeft's settings, these are the three usual reasons, in order:
>
> 1. **Zotero isn't running.** Start it (see the ScholarWeft banner or status-bar message when this is the cause).
> 2. **Another vault is already connected to Zotero.** Zotero accepts one local connection at a time, so a second vault — or a second Obsidian window on another vault — can't reach it while the first holds the connection. **Close the other vault(s)** and click Retry. If you work in several vaults, you don't need to shut them all down permanently — just switch the connection by closing the one that's using it.
> 3. **The checkbox above is off** — re-tick it.
>
> (The [setup script](#the-easy-way-run-the-setup-script) can tick the checkbox for you when Zotero is closed.)

---

## 3. Better BibTeX (recommended)

Better BibTeX (BBT) is a Zotero add-on that gives every item a stable **citekey** (e.g. `smithTitleYear`) — the short name you type in citations — so you don’t have to add one by hand to every Zotero reference. It is the easiest way to get citekeys, and ZotLit needs it. (ScholarWeft can also use Zotero's built-in API without BBT, but BBT is recommended.)

1. Download the BBT `.xpi` file: <https://retorque.re/zotero-better-bibtex/installation/> (click the download link for the latest version; it saves as a `.xpi`).
2. In **Zotero**: menu **Tools → Plugins** (older: **Tools → Add-ons**).
3. Click the **gear ⚙** icon (top-right of the Plugins window) → **Install Plugin From File…**.
4. Select the downloaded `.xpi` file. Restart Zotero if it asks.
5. Check it worked: **Tools** or **Settings** (depending on your operating system) should now have a **Better BibTeX** submenu.
6. At the top of that Better BibTeX submenu, set the **Citation key formula** to `auth(15).lower.alphanum.nopunct + shorttitle(2,2).nopunct.alphanum + year.alphanum.nopunct`. This keeps citekeys short and free of punctuation and unusual characters (first author, two-letter short title, year). (The [setup script](#the-easy-way-run-the-setup-script) can set this for you.)

BBT generates citekeys automatically. If an item has no citekey yet, right-click it → **Better BibTeX → Pin Citation Key** (or just leave it — BBT fills it in).

---

## 4. ZotLit (optional, recommended for literature notes)

ZotLit creates rich literature notes from Zotero items (annotations, metadata) and powers ScholarWeft's `@@` full-text search. It needs Better BibTeX from Step 3, and it has **two halves**: the Obsidian plugin below, and a small add-on inside Zotero (you'll see `zotlit@aidenlx.site` in Zotero's Add-ons). The [setup script](#the-easy-way-run-the-setup-script) can download and install the Zotero half for you when Zotero is closed; otherwise follow ZotLit's own instructions (<https://zotlit.aidenlx.top/>).

> **ZotLit won't enable, or errors when you turn it on?** This is almost always an Obsidian **installer below 1.13.4** (not an out-of-date app). Re-run the [setup script](#the-easy-way-run-the-setup-script) and answer **yes** to *Refresh Obsidian*, or reinstall Obsidian from <https://obsidian.md/download> and try again — see [Step 1](#1-install-obsidian). Your vault and settings are untouched.

1. In **Obsidian**: **Settings** (gear, bottom-left) → **Community plugins**.
2. If you see **Restricted mode** / **Turn on community plugins**, click **Turn on community plugins** and confirm.
3. Click **Browse**, type `ZotLit`, click **Install**, then **Enable**.
4. In **Settings → ScholarWeft → Literature note import**, click **Install and use ScholarWeft's ZotLit import templates** (or just open Obsidian if you ran the setup script — it does this for you). This copies ScholarWeft's ZotLit templates into a dedicated `sw-zotlit-templates/` folder and points ZotLit's **Template folder** setting at it, leaving your own templates untouched. It also writes ScholarWeft's **frontmatter field mappings** into ZotLit's settings — ZotLit builds each note's frontmatter from its settings, not from the templates, so the mappings are what make the imported properties (title, authors, `up`, `related`, …) come out the same way. It turns on ZotLit's **JavaScript templates** setting too (a *per-device* setting, off by default, without which the templates stay inert). ZotLit's previous settings are backed up as `data.json.scholarweft.bak`.

> If ScholarWeft can't see ZotLit, install and **enable** it first, then click the button again.

---

## 5. Install the ScholarWeft plugin

### Option A — BRAT (recommended; keeps it updated)

1. In **Obsidian**: **Settings → Community plugins → Browse**, search `BRAT`, **Install**, **Enable**.
2. Still in Settings, scroll the left list to **BRAT** and open it.
3. Click the `+` icon to the right of **Beta plugin list**.
4. In the `Repository` box, paste exactly: `nebedaay/ScholarWeft`, check the box **Enable after installing the plugin**, and click **Add Plugin**.

BRAT checks for updates automatically; you can force one from BRAT's settings (**Check for updates**).

### Option B — manual install

1. Open the latest release page: <https://github.com/nebedaay/ScholarWeft/releases/latest>
2. Download these three files: **`main.js`**, **`manifest.json`**, **`styles.css`**.
3. In your vault folder, show hidden files:
   - **macOS:** in Finder, press `Cmd` + `Shift` + `.` (dot)
   - **Windows:** File Explorer → **View** → **Show** → tick **Hidden items**
   - **Linux:** in Files, press `Ctrl` + `H`
4. Create this folder structure if it doesn't exist: `<your vault>/.obsidian/plugins/scholar-weft/`
   — then put the three downloaded files inside that `scholar-weft` folder.
5. In Obsidian: **Settings → Community plugins** and **Enable “ScholarWeft”**. If it doesn't appear, click the **Reload plugins** (⟳) button.

---

## 6. Optional: document import/export tools

**Skip this whole step if you only need citations, the sidebar, and literature notes.** These tools are only for **importing Word/ODT documents** and **compiling/exporting** documents to DOCX/ODT/PDF.

To install the document import/export tools, you’ll need to open a **terminal** into which you can paste commands.

### Option A: The script (it already did this and the rest)

The [setup script at the top of this page](#the-easy-way-run-the-setup-script) installs these document tools too — run it rather than doing this step by hand, unless you prefer the manual route or that step failed in the script. It reuses any Python, Pandoc, LibreOffice or LaTeX you already have.

### Option B: By hand

#### Python 3 + libraries (needed for all import/export)

Open a terminal (see above) and enter the following commands.

```bash
# macOS (uses Homebrew — install it first if you don't have it, see below)
brew install python
python3 -m venv ~/ScholarWeft/venv
~/ScholarWeft/venv/bin/pip install lxml python-docx requests
```
```bash
# Windows (PowerShell) — install Python from the Microsoft Store first,
# or from python.org with "Add python.exe to PATH" ticked during setup
py -m venv $HOME\ScholarWeft\venv
$HOME\ScholarWeft\venv\Scripts\pip install lxml python-docx requests
```
```bash
# Linux (Debian/Ubuntu)
sudo apt update && sudo apt install -y python3 python3-pip python3-venv
python3 -m venv ~/ScholarWeft/venv
~/ScholarWeft/venv/bin/pip install lxml python-docx requests
```

> **Why a venv?** *Some* Python builds mark themselves “externally managed” (PEP 668) and refuse a plain `pip install` — notably **Homebrew** Python on macOS/Linux and the **Debian/Ubuntu** system Python. On those, even `pip install --user` is refused (it needs `--break-system-packages` too, which Homebrew advises against). A *venv* is a private copy of Python just for these packages, which sidesteps the problem cleanly. **If your Python accepts `pip install`, you don't need a venv** — this is true of the **python.org** installers (macOS/Windows) and of **conda / Anaconda / Miniconda**; with those, just run `pip install lxml python-docx requests` (or `pip install --user …` to keep them in your home folder) and you're done. ScholarWeft finds any of these on its own (see Step 7), so you usually don't have to paste a path at all — it is, in order of preference:
> - macOS/Linux venv: `~/ScholarWeft/venv/bin/python3`
> - Windows venv: `C:\Users\<you>\ScholarWeft\venv\Scripts\python.exe`
> - otherwise your normal `python3` (including conda)
>
> Manual alternative to a venv on a Homebrew/Debian Python (works, but is what the marker discourages): `python3 -m pip install --user --break-system-packages lxml python-docx requests`.

Install **Homebrew** first on macOS if you don't have it (this is the standard package manager):

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```
Then follow the two commands it prints at the end to add `brew` to your PATH.

#### Pandoc (needed for every import/export)

```bash
brew install pandoc        # macOS
```
```bash
winget install --id JohnMacFarlane.Pandoc -e   # Windows (PowerShell)
```
```bash
sudo apt install -y pandoc   # Linux (Debian/Ubuntu)
```

#### LibreOffice (only for PDF via an ODT/DOCX template)

```bash
brew install --cask libreoffice      # macOS
```
```bash
winget install --id TheDocumentFoundation.LibreOffice -e   # Windows
```
```bash
sudo apt install -y libreoffice      # Linux
```

#### LaTeX with LuaLaTeX (only for PDF via a `.tex` template)

```bash
brew install --cask mactex-no-gui    # macOS — full TeX Live, large (~5 GB)
# …or the smaller BasicTeX:
brew install --cask basictex
```
```bash
winget install --id MiKTeX.MiKTeX -e   # Windows
```
```bash
sudo apt install -y texlive-luatex texlive-latex-recommended texlive-fonts-recommended   # Linux
```

#### Fonts the LaTeX templates expect

The default `.tex` templates use **Noto Serif**, **Noto Sans**, **Noto Emoji** (monochrome, for emoji) and **Scheherazade New** (Arabic). . Install them so exotic characters don't come out as empty boxes:

```bash
brew install --cask font-noto-serif font-noto-sans font-noto-emoji font-scheherazade-new   # macOS
```
```bash
# Windows/Linux: download from Google Fonts (https://fonts.google.com)
# — Noto Serif, Noto Sans, Noto Emoji — and Scheherazade New from
# https://software.sil.org/scheherazade/ ; then install them by
# double-clicking each file ("Install") or copying to ~/.fonts on Linux.
```
After installing fonts, refresh TeX's font cache:

```bash
luaotfload-tool --update    # every OS, once
```

---

## 6b. Optional: Basic note template + Templater

**Recommended if you want every new note to start with the same few properties.** ScholarWeft works best when every note carries a `created` date, a larger category (`up`), `related` notes, and alternative names (`aliases`). Based on Nick Milo's *Linking Your Thinking* philosophy, this optional step installs a **Basic note template** with those four properties and sets up the **Templater** plugin to apply it to every note you create in your vault — so you never have to add them by hand.

**The easy way:** the [setup script](#the-easy-way-run-the-setup-script) offers this step (it installs the Templater plugin; the configuration is finished from inside Obsidian on your next launch). Otherwise, do it from ScholarWeft's settings:

1. In **Obsidian**: **Settings → Community plugins → Browse**, search `Templater`, **Install**, then **Enable**.
2. Open **Settings → ScholarWeft → Literature note import** and click **Install the Basic note template and apply it to new notes**.
   - It copies the template into a dedicated `sw-markdown-templates/` folder — **your own templates are left untouched.**
   - It sets Templater to apply that template to new notes at the top level of your vault.
   - If you already have a Templater rule for new notes, it asks whether to **Keep** your rule or **Replace** it — nothing is overwritten without your say-so.
3. If new notes still start empty, open **Settings → Templater**, turn on **Trigger Templater on new file creation**, and confirm Templater's warning. (Templater keeps that switch in a per-device setting and guards it with a confirmation; the button above normally sets it for you, but Templater still asks you to accept the risk the first time you enable it by hand.)

> Prefer to make your own template? Point ScholarWeft's **Literature note import** page at your own folder and edit it there — the `sw-markdown-templates/` folder is ScholarWeft-managed and is overwritten on update.

---

## 7. Configure ScholarWeft

Open **Settings → ScholarWeft**.

- **Bibliography** — Zotero is **already switched on** with **My Library** selected. If Zotero isn't running (or the checkbox from Step 2 is off), you'll see **“Cannot connect to Zotero”** with a **Retry** button and instructions. Use a `.bib` file instead of Zotero? Just turn the Zotero toggle off and add your file under *Bibliography files*.
- **Literature note import** — where literature notes live and how they are created. This page also has the two setup buttons: **Install and use ScholarWeft's ZotLit import templates** (Step 4) and **Install the Basic note template and apply it to new notes** (Step 6b). Each finishes the job for you, and offers to install the companion plugin (**ZotLit** / **Templater**) if it isn't there yet. See [Literature Notes](./literature-notes.md).
- **Document import/export and compilation** — if you installed the document tools, each option shows a “not found” note until it detects them. ScholarWeft searches for a usable Python automatically (your `python3`/conda, or the setup script's `~/ScholarWeft/venv`), so **you normally don't have to set anything**. If it still reports Python missing:
  - **Path to Python 3** → paste your interpreter (e.g. `~/ScholarWeft/venv/bin/python3`, or your conda `python`)
  - **Path to Pandoc** → usually auto-detected (`/opt/homebrew/bin/pandoc` on Apple-silicon Macs)
  - Then click **Re-check tools** if offered.

---

## 8. Check that it works

1. Make sure **Zotero is running**, and that **no other vault is connected to it** — Zotero allows one local connection at a time, so if you have another vault open that uses Zotero, close it first.
2. In Obsidian, make a new note and type `[[@` — you should see citekey suggestions from Zotero's **My Library**. Pick one and press Enter.
3. Type `[[@` a few letters again and select a reference; the citation should turn into *(Author Year)* and link to a literature note.
4. Open **Settings → ScholarWeft → Bibliography** — it should say connected, not “Cannot connect to Zotero”.
5. (If you installed the document tools) open a note, then run **ScholarWeft: Compile and export the current document (DOCX, ODT, PDF, LaTeX)** from the command palette (`Cmd/Ctrl` + `P`) and export it to **DOCX** to confirm Pandoc/Python work.
6. (Optional) run **ScholarWeft: Insert Zotero notes into literature notes (vault)** to pull any Zotero notes you took before Obsidian into the matching literature notes — see [Literature Notes](./literature-notes.md).

---

## Troubleshooting

**A plugin (e.g. ZotLit) won't enable, or errors when you enable it.** Your Obsidian **installer** is probably **below 1.13.4**. (An installer older than the app version is normal and harmless — the threshold is what matters.) Check **Settings → About** (or **Show debug info**) for the **Installer version**. Re-run the [setup script](#the-easy-way-run-the-setup-script) and answer **yes** to *Refresh Obsidian*, or reinstall Obsidian from <https://obsidian.md/download> — your vault and settings are untouched.

**“Cannot connect to Zotero.”** Three usual causes, in order:

1. **Zotero isn't running** — start it. ScholarWeft shows a banner and a status-bar message when this is the cause, and connects on its own once Zotero appears.
2. **Another vault is already connected to Zotero** — only one vault can connect at a time, so **close the other vault** (or the other Obsidian window) and click **Retry**. If you use several vaults, close the one holding the connection; you don't need to keep them all closed.
3. **The connection checkbox is off** — open Zotero → Settings (**Zotero → Settings…** on macOS, **Edit → Settings…** on Windows/Linux) → **Advanced** → tick **“Allow other applications on this computer to communicate with Zotero”**, then click **Retry**.

**Zotero 10: features still report “Cannot connect”.** Zotero 10 added a security check that silently drops local requests it thinks come from a browser. ScholarWeft 0.2.5+ works with this automatically; on older versions, update ScholarWeft.

**No citekey suggestions when I type `[[@`.** You need stable citekeys. Install **Better BibTeX** (Step 3) and let it generate them; make sure Zotero is running, that **no other vault is connected to it** (one connection at a time), and that **My Library** is ticked under Settings → ScholarWeft → Bibliography.

**Pandoc / Python reported missing.** Install them (Step 6) and set **Path to Pandoc** / **Path to Python 3** in Settings → ScholarWeft → Document import/export. On Apple-silicon Macs Pandoc is usually at `/opt/homebrew/bin/pandoc`; on Windows, check that “Add python.exe to PATH” was ticked when installing Python.

**PDF export via `.tex` fails, or shows empty boxes (□) for symbols/emoji.** Install the fonts in Step 6 and run `luaotfload-tool --update`. Emoji need the *monochrome* **Noto Emoji** font (colour emoji fonts can't be used by LaTeX). Exporting to DOCX/ODT instead handles emoji automatically.

**`pip install` says “externally-managed-environment” (PEP 668).** Only some builds do this — Homebrew and Debian/Ubuntu. Use the virtual-environment commands in Step 6, or use a conda/python.org Python, which don't restrict pip.

**Where do I find the vault's `.obsidian` folder?** It is hidden. Show hidden files (macOS: `Cmd`+`Shift`+`.`; Windows: View → Show → Hidden items; Linux: `Ctrl`+`H`).

---

## Settings

Settings live under **Settings → ScholarWeft**, in four pages:

- **Bibliography** — where your sources come from. See [Bibliography](./bibliography.md) and [Zotero](./zotero.md).
- **Citation and reference formatting** — how citations and the reference list look in Obsidian. See [Citations](./citations.md).
- **Literature note import** — where literature notes live and how they are created. See [Literature Notes](./literature-notes.md).
- **Document import/export and compilation** — tools, templates, and defaults for compiling/exporting. See [Document Import and Export](./import-export.md).

See **[Dependencies](./dependencies.md)** for exactly what needs what. The plugin detects what you have and greys out options that can't run, so you can explore safely.
