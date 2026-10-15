import {
  App,
  FileSystemAdapter,
  Modal,
  Notice,
  Platform,
  TFile,
} from 'obsidian';
import type ReferenceList from './main';
import { runImportScript } from './importCompiler';
import { rewritePandocToLinked } from './pandocToLinked';
import { FolderSuggest } from './settings/FolderSuggest';
import { probeTools } from './tools';
import type { ToolProbe } from './tools';
import { DEPENDENCIES, renderDependencyNote } from './dependencies';
import type { DepKey } from './dependencies';
import { setModalTitle } from './modals/modalTitle';

declare const require: (id: string) => unknown;


interface ImportHistoryEntry {
  folder: string;
  filename: string;
}

/** Per-source-file import destination, so re-importing an updated file updates
 *  the same note (mirrors the export modal's per-file history). Stored in the
 *  plugin's data file — `localStorage` is discouraged by the directory. */
function loadImportHistory(
  plugin: ReferenceList
): Record<string, ImportHistoryEntry> {
  const hist = plugin.settings.importHistory;
  return hist && typeof hist === 'object' ? hist : {};
}

function saveImportHistory(
  plugin: ReferenceList,
  sourcePath: string,
  entry: ImportHistoryEntry
): void {
  plugin.settings.importHistory = {
    ...loadImportHistory(plugin),
    [sourcePath]: entry,
  };
  void plugin.saveSettings();
}

/**
 * Absolute path of a dropped File. Electron < 32 exposed a non-standard
 * `File.path`; Electron >= 32 removed it in favour of
 * `webUtils.getPathForFile`, so probe the API first and fall back.
 */
function pathForDroppedFile(file: File): string | undefined {
  try {
    const { webUtils } = require('electron') as {
      webUtils?: { getPathForFile(file: File): string };
    };
    if (webUtils?.getPathForFile) {
      const p = webUtils.getPathForFile(file);
      if (p) return p;
    }
  } catch { /* older Electron */ }
  return (file as File & { path?: string }).path;
}

/**
 * Modal for "Import a Word/ODT document" command.
 *
 * Steps performed on Import:
 *   1. Run zotero-to-md.py to convert the DOCX/ODT (with Zotero citation
 *      fields) to Markdown with pandoc-style citations.
 *   2. Create the resulting note in the vault root.
 *   3. (Optional, default on) Convert [@citekey] citations to [[@citekey]].
 *   4. (Optional, default on) Create literature notes for citations that
 *      don't yet have one.
 */
export class ImportModal extends Modal {
  private plugin: ReferenceList;
  private inputPath = '';
  private fileLabel!: HTMLSpanElement;
  private convertCb!: HTMLInputElement;
  private litNotesCb!: HTMLInputElement;
  private importBtn!: HTMLButtonElement;
  private filenameInput!: HTMLInputElement;
  private outputDirInput!: HTMLInputElement;
  private overwriteCb!: HTMLInputElement;
  private filenameTouched = false;
  private probe: ToolProbe | null = null;
  private depNote!: HTMLElement;
  private importReady = false;

  constructor(app: App, plugin: ReferenceList) {
    super(app);
    this.plugin = plugin;
  }

  /** The directory the file picker should open to. */
  private getDefaultDir(): string {
    const stored = this.plugin.settings.importLastDir;
    if (stored) return stored;
    // Fall back to the vault root.
    const adapter = this.plugin.app.vault.adapter as FileSystemAdapter;
    return typeof adapter?.getBasePath === 'function' ? adapter.getBasePath() : '';
  }

  /** Persist the directory of the chosen file for next time. */
  private saveLastDir(filePath: string): void {
    // Node built-ins do not exist on mobile; this path is desktop-only.
    if (!Platform.isDesktop) return;
    try {
      const nodePath = require('path') as typeof import('path');
      this.plugin.settings.importLastDir = nodePath.dirname(filePath);
      void this.plugin.saveSettings();
    } catch { /* ignore */ }
  }

  /** Update the UI to reflect a chosen file, and enable the Import button. */
  private selectFile(filePath: string, fileName: string): void {
    this.inputPath = filePath;
    this.fileLabel.textContent = fileName;
    this.fileLabel.classList.remove('sw-import-drop-hint');
    this.importBtn.disabled = !this.importReady;
    // Restore this source file's previous destination if we have one; else
    // default the filename to the source basename + .md.
    const hist = loadImportHistory(this.plugin)[filePath];
    if (hist && this.filenameInput && this.outputDirInput) {
      this.outputDirInput.value = hist.folder ?? '';
      this.filenameInput.value = hist.filename
        || `${fileName.replace(/\.(docx|odt)$/i, '')}.md`;
      this.filenameTouched = true;
    } else if (this.filenameInput && !this.filenameTouched) {
      this.filenameInput.value = `${fileName.replace(/\.(docx|odt)$/i, '')}.md`;
    }
    this.saveLastDir(filePath);
  }

  private getLastOutputDir(): string {
    return this.plugin.settings.importLastOutputDir ?? '';
  }

  private saveLastOutputDir(): void {
    this.plugin.settings.importLastOutputDir = this.outputDirInput.value.trim();
    void this.plugin.saveSettings();
  }

  /** Dependencies the importer needs that were NOT found on this computer. */
  private importMissing(): DepKey[] {
    const p = this.probe;
    if (!p) return [];
    const missing: DepKey[] = [];
    if (!p.pythonImport) missing.push('python');
    if (!p.pandoc) missing.push('pandoc');
    if (!p.zotero) missing.push('zotero');
    return missing;
  }

  private async applyImportGating(): Promise<void> {
    this.probe = await probeTools(this.plugin);
    const missing = this.importMissing();
    this.depNote.empty();
    if (missing.length > 0) {
      renderDependencyNote(
        this.depNote,
        missing,
        'Document import needs the following, which was not found (or Zotero is not running):'
      );
    }
    this.importReady = missing.length === 0;
    this.importBtn.disabled = !(this.importReady && !!this.inputPath);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('sw-import-modal');
    setModalTitle(this, 'Import Document');
    contentEl.createEl('p', {
      text: 'Import a Word (.docx) or LibreOffice (.odt) file with Zotero citation fields into your vault as a Markdown note. Requires Zotero to be running.',
      cls: 'sw-export-modal-note',
    });

    // Requirement / missing-tool note, filled in by applyImportGating().
    this.depNote = contentEl.createDiv({ cls: 'sw-import-depnote' });

    // ── Drop zone + file picker ───────────────────────────────────────────────
    const dropZone = contentEl.createDiv({ cls: 'sw-import-drop-zone' });
    dropZone.style.cssText = [
      'border: 2px dashed var(--background-modifier-border)',
      'border-radius: 6px',
      'padding: 16px 12px',
      'margin-bottom: 12px',
      'display: flex',
      'align-items: center',
      'gap: 10px',
      'cursor: default',
      'transition: background 0.15s',
    ].join(';');

    const browseBtn = dropZone.createEl('button', { text: 'Browse…' });

    this.fileLabel = dropZone.createSpan({ cls: 'sw-import-file-label sw-import-drop-hint' });
    this.fileLabel.textContent = 'No file selected — or drop a .docx/.odt here';
    this.fileLabel.setCssStyles({ flex: '1', color: 'var(--text-muted)', fontSize: '0.9em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });

    // Drag-and-drop handlers on the whole drop zone.
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.setCssStyles({ background: 'var(--background-secondary)' });
    });
    dropZone.addEventListener('dragleave', () => {
      dropZone.setCssStyles({ background: '' });
    });
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.setCssStyles({ background: '' });
      const file = e.dataTransfer?.files?.[0] as
      | (File & { path?: string })
      | undefined;
      if (!file) return;
      const filePath: string | undefined = pathForDroppedFile(file);
      if (!filePath) {
        new Notice('[ScholarWeft] could not read the file path from the dropped file.');
        return;
      }
      const lower = filePath.toLowerCase();
      if (!lower.endsWith('.docx') && !lower.endsWith('.odt')) {
        new Notice('[ScholarWeft] Please drop a .docx or .odt file.');
        return;
      }
      this.selectFile(filePath, file.name);
    });

    // Browse button: native file dialog via @electron/remote, with last-used dir.
    browseBtn.addEventListener('click', () => {
      void (async () => {
        let filePath: string | undefined;
      let fileName: string | undefined;

      try {
        const { dialog } = require('@electron/remote') as {
          dialog: {
            showOpenDialog(opts: {
              defaultPath?: string;
              properties: string[];
              filters: Array<{ name: string; extensions: string[] }>;
            }): Promise<{ canceled: boolean; filePaths: string[] }>;
          };
        };
        const result = await dialog.showOpenDialog({
          defaultPath: this.getDefaultDir(),
          properties: ['openFile'],
          filters: [{ name: 'Documents', extensions: ['docx', 'odt'] }],
        });
        if (!result.canceled && result.filePaths.length > 0) {
          filePath = result.filePaths[0];
          const parts = filePath.replace(/\\/g, '/').split('/');
          fileName = parts[parts.length - 1];
        }
      } catch {
        // @electron/remote unavailable – fall back to <input type="file">
        await new Promise<void>(resolve => {
          const input = createEl('input');
          input.type = 'file';
          input.accept = '.docx,.odt';
          input.addEventListener('change', () => {
            const f = input.files?.[0] as (File & { path?: string }) | undefined;
            if (f?.path) { filePath = f.path; fileName = f.name; }
            resolve();
          });
          input.addEventListener('cancel', () => resolve());
          input.click();
        });
      }

        if (filePath && fileName) {
          this.selectFile(filePath, fileName);
        }
      })();
    });

    // ── Options ──────────────────────────────────────────────────────────────
    const convertRow = contentEl.createDiv({ cls: 'sw-export-check-row' });
    this.convertCb = convertRow.createEl('input', { type: 'checkbox' });
    this.convertCb.id = 'sw-import-convert';
    this.convertCb.checked = true;
    const convertLabel = convertRow.createEl('label', {
      text: 'Convert citations to linked format ([[@citekey]])',
    });
    convertLabel.htmlFor = 'sw-import-convert';

    const litRow = contentEl.createDiv({ cls: 'sw-export-check-row' });
    this.litNotesCb = litRow.createEl('input', { type: 'checkbox' });
    this.litNotesCb.id = 'sw-import-litnotes';
    this.litNotesCb.checked = true;
    const litLabel = litRow.createEl('label', {
      text: 'Create literature notes for citations that lack them',
    });
    litLabel.htmlFor = 'sw-import-litnotes';

    // ── Output filename + folder (mirrors the export dialogue) ───────────────
    const fnWrap = contentEl.createDiv({ cls: 'sw-export-row' });
    fnWrap.setCssStyles({ marginTop: '12px' });
    fnWrap.createEl('label', { text: 'Output filename' });
    this.filenameInput = fnWrap.createEl('input', {
      type: 'text',
      cls: 'sw-export-filename-input',
    });
    this.filenameInput.setCssStyles({ width: '100%', marginTop: '4px' });
    this.filenameInput.addEventListener('input', () => {
      this.filenameTouched = true;
    });

    const dirWrap = contentEl.createDiv({ cls: 'sw-export-row' });
    dirWrap.setCssStyles({ marginTop: '10px' });
    dirWrap.createEl('label', { text: 'Import folder (vault-relative)' });
    this.outputDirInput = dirWrap.createEl('input', {
      type: 'text',
      placeholder: '(vault root)',
      cls: 'sw-export-outdir-input',
    });
    this.outputDirInput.setCssStyles({ width: '100%', marginTop: '4px' });
    this.outputDirInput.value = this.getLastOutputDir();
    new FolderSuggest(this.app, this.outputDirInput);
    this.outputDirInput.addEventListener('change', () => this.saveLastOutputDir());

    // Overwrite-by-default: re-importing is normally meant to update the note.
    const owRow = contentEl.createDiv({ cls: 'sw-export-check-row' });
    owRow.setCssStyles({ marginTop: '4px' });
    this.overwriteCb = owRow.createEl('input', { type: 'checkbox' });
    this.overwriteCb.id = 'sw-import-overwrite';
    this.overwriteCb.checked = true;
    const owLabel = owRow.createEl('label', {
      text: 'Overwrite the note if it already exists',
    });
    owLabel.htmlFor = 'sw-import-overwrite';

    // ── Buttons ──────────────────────────────────────────────────────────────
    const btnRow = contentEl.createDiv({ cls: 'sw-export-btn-row' });
    btnRow.setCssStyles({ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' });

    const cancelBtn = btnRow.createEl('button', { text: 'Cancel' });
    cancelBtn.addEventListener('click', () => this.close());

    this.importBtn = btnRow.createEl('button', { text: 'Import', cls: 'mod-cta' });
    this.importBtn.disabled = true;
    this.importBtn.addEventListener('click', () => {
      void this.run();
    });

    window.setTimeout(() => browseBtn.focus(), 50);

    // Probe installed tools and gate the Import button.
    void this.applyImportGating();
  }

  private async run() {
    // Node built-ins do not exist on mobile; this path is desktop-only.
    if (!Platform.isDesktop) {
    	throw new Error('ScholarWeft: this feature is available on the desktop app only.');
    }
    if (!this.inputPath) return;
    if (!Platform.isDesktop) {
      new Notice('Document import is only available on desktop.');
      return;
    }

    const missing = this.importMissing();
    if (missing.length > 0) {
      new Notice(
        `Document import needs ${missing.map((k) => DEPENDENCIES[k].label).join(', ')}. ` +
          `Install it, then reopen this dialogue.`,
        8000
      );
      return;
    }

    // Capture options before closing (onClose empties the DOM).
    const doConvert = this.convertCb.checked;
    const doLitNotes = this.litNotesCb.checked;
    const overwrite = this.overwriteCb.checked;
    const outFolder = this.outputDirInput.value.trim().replace(/^\/+|\/+$/g, '');
    const outFilename = this.filenameInput.value.trim();
    this.saveLastOutputDir();  // remembered for the next (new) import
    this.close();

    const nodePath = require('path') as typeof import('path');
    const fs = require('fs') as typeof import('fs');
    const os = require('os') as typeof import('os');

    const basename = nodePath.basename(this.inputPath).replace(/\.(docx|odt)$/i, '');
    const tmpOutput = nodePath.join(os.tmpdir(), `${basename}.sw-import.md`);

    const progress = new Notice('Importing document… Zotero must be running.', 0);

    const result = await runImportScript(this.plugin, this.inputPath, tmpOutput);

    if (!result.ok) {
      progress.hide();
      new Notice(`[ScholarWeft] Import failed:\n${result.stderr}`, 10000);
      console.error('[scholar-weft] Import failed:', result.stderr);
      return;
    }

    // Read the temp file.
    let mdContent: string;
    try {
      mdContent = fs.readFileSync(tmpOutput, 'utf-8');
      try { fs.unlinkSync(tmpOutput); } catch { /* ignore */ }
    } catch (e) {
      progress.hide();
      new Notice(`[ScholarWeft] Import failed: could not read converted file.\n${e}`, 8000);
      return;
    }

    // Convert pandoc citations → linked citations in-memory before writing the
    // vault file.  Done here rather than in a post-creation step so the note
    // lands in the vault already converted.  Citations from Zotero are trusted
    // (allowUnresolved = true) regardless of bib-cache state.
    if (doConvert) {
      let body = mdContent;
      let frontmatter = '';
      const fm = /^---\n[\s\S]*?\n---\n?/.exec(mdContent);
      if (fm) { frontmatter = fm[0]; body = mdContent.slice(fm[0].length); }
      const { out } = rewritePandocToLinked(body, new Set(), /* allowUnresolved */ true);
      mdContent = frontmatter + out;
    }

    // Destination: chosen filename in the chosen vault folder (blank = root).
    // Remember it per source file so a re-import updates the same note; an
    // existing note is overwritten by default.
    const stem = (outFilename || `${basename}.md`).replace(/\.md$/i, '') || basename;
    const filename = `${stem}.md`;
    if (outFolder) {
      try {
        await this.app.vault.createFolder(outFolder);
      } catch {
        // already exists — fine
      }
    }
    const vaultRelPath = outFolder ? `${outFolder}/${filename}` : filename;
    saveImportHistory(this.plugin, this.inputPath, { folder: outFolder, filename });

    let newFile: TFile;
    try {
      const existing = this.app.vault.getAbstractFileByPath(vaultRelPath);
      if (existing instanceof TFile && overwrite) {
        await this.app.vault.modify(existing, mdContent);
        newFile = existing;
      } else if (existing) {
        // Keep the existing note; write alongside with a numeric suffix.
        let suffix = 0;
        let alt = vaultRelPath;
        do {
          suffix++;
          const unique = `${stem} (${suffix}).md`;
          alt = outFolder ? `${outFolder}/${unique}` : unique;
        } while (await this.app.vault.adapter.exists(alt));
        newFile = await this.app.vault.create(alt, mdContent);
      } else {
        newFile = await this.app.vault.create(vaultRelPath, mdContent);
      }
    } catch (e) {
      progress.hide();
      new Notice(`[ScholarWeft] Import failed: could not create note in vault.\n${e}`, 8000);
      return;
    }

    // Open the new note in the current leaf.
    await this.app.workspace.getLeaf(false).openFile(newFile);
    progress.hide();
    new Notice(`Imported: ${newFile.basename}`, 5000);

    // Step 3 (optional): Create missing literature notes.
    if (doLitNotes) {
      const litProgress = new Notice('Creating missing literature notes…', 0);
      try {
        const { created, missingKeys } = await this.plugin.bibManager.createMissingLitNotes(
          { file: newFile },
                  (done: number, total: number) =>
          (litProgress as Notice & {
            setProgress?: (done: number, total: number) => void;
          }).setProgress?.(done, total)
        );
        litProgress.hide();
        if (missingKeys.length) {
          new Notice(
            `Created ${created} of ${missingKeys.length} missing literature note(s).`,
            5000
          );
        }
      } catch (e) {
        litProgress.hide();
        new Notice(`[ScholarWeft] Literature note creation failed: ${e}`, 6000);
        console.error('[scholar-weft] lit note creation error:', e);
      }
    }

    void this.plugin.processReferences();
  }

  onClose() {
    this.contentEl.empty();
  }
}

