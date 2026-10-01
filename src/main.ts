import { Prec } from '@codemirror/state';
import {
  Editor,
  Events,
  MarkdownFileInfo,
  MarkdownView,
  Menu,
  Modal,
  Notice,
  Platform,
  Plugin,
  TAbstractFile,
  TFile,
  WorkspaceLeaf,
  debounce,
  htmlToMarkdown,
  normalizePath,
  setIcon,
} from 'obsidian';

import {
  citeKeyCacheField,
  citeKeyPlugin,
  bibManagerField,
  editorTooltipHandler,
} from './editorExtension';
import { API_VERSION, LinkedCitationsApi } from './api';
import { cslToBibTeX } from './bib/bibtexSerializer';
import { t } from './lang/helpers';
import { processCiteKeys } from './markdownPostprocessor';
import {
  DEFAULT_SETTINGS,
  ReferenceListSettings,
  ReferenceListSettingsTab,
} from './settings';
import { TooltipManager } from './tooltip';
import { ReferenceListView, viewType } from './view';
import { DataExplorerView, dataExplorerViewType } from './dataExplorer';
import { PromiseCapability, debugLog, SW_CACHE_DIR, SW_CACHE_DIR_LEGACY } from './helpers';
import { isAbsolutePath, DEFAULT_ZOTERO_PORT, isZoteroRunning } from './bib/helpers';
import { pickZoteroItems } from './zoteroPicker';
import { findPandoc } from './bib/pandoc';
import { BibManager, getScopedSettings } from './bib/bibManager';
import { CiteSuggest } from './citeSuggest/citeSuggest';
import { ExportModal } from './exportModal';
import { ImportModal } from './importModal';
import { setModalTitle } from './modals/modalTitle';
import { formatImportSummary } from './template/import-summary';
import {
  DEFAULT_NOTES_PER_MINUTE,
  estimateMinutes,
  nextNotesPerMinute,
} from './template/update-rate';
import { CitekeyRenameModal } from './modals/citekeyRenameModal';
import { CitekeyReconcileModal } from './modals/citekeyReconcileModal';
import type { CitekeyReconcilePlan } from './template/note-lookup';
import { isZotLitManaged } from './template/note-lookup';
import { ConflictModal } from './modals/conflictModal';
import {
  SW_ZOTLIT_FOLDER,
  installZotlitTemplates,
  installZotlitTemplatesWithNotice,
} from './zotlitTemplates';
import { getLitNoteForCitekey, getZotlitLiteratureFolder } from './zotlit';
import { zotlitIsNoteImportPath } from './template/import-path';
import { detectNoteFormat } from './template/note-format';
import {
  markRelatedMigrated,
  needsRelatedMigration,
  parseMigrationState,
  serializeMigrationState,
  type RelatedMigrationState,
} from './template/related-migration';
import {
  DEFAULT_LITERATURE_NOTE_FOLDER,
  lastFolderName,
  literatureNoteFolderFor,
  rememberFolderName,
  resolveLiteratureNoteFolder,
} from './template/lit-folder';
import { shouldRefreshOnRefocus } from './template/refocus';
import { readTemplate } from './template/note-template-io';
import { isNoteStale } from './template/template-history';
import { parseTimestamp } from './template/note-helpers';
import {
  DEFAULT_MIN_CHARS,
  detectCitationTrigger,
} from './template/cite-trigger';
import { installTemplaterTemplatesWithNotice } from './templaterTemplates';
import { insertZoteroNotesVaultWide } from './zoteroNotes';

/**
 * Heuristic: is this plugin another reference-list provider of the same
 * lineage? Matched on id + display name so we don't need to enumerate every
 * sibling's id (the ancestral "Pandoc Reference List", Bripey/Briley Citation
 * Suite, Alias/Linked Citations, earlier ScholarWeave, …). Kept deliberately
 * narrow — "reference list" or a known family name — so unrelated citation
 * plugins (e.g. ZotLit) are never flagged.
 */
function looksLikeReferenceListPlugin(id: string, name: string): boolean {
  const s = `${id} ${name}`.toLowerCase();
  return (
    /reference[\s_-]*list/.test(s) ||
    /(bripey|briley)/.test(s) ||
    /(alias|linked)[\s_-]*citations/.test(s) ||
    /scholar[\s_-]*weave/.test(s)
  );
}
import { convertActiveNote, convertVault } from './pandocToLinked';
import { convertNoteToPandoc, convertVaultToPandoc } from './linkedToPandoc';
import { setupAssets } from './assetSetup';
import { applyYamlFormatting } from './yamlFormatting';

const bibliographyExtensions = new Set(['bib', 'json', 'yaml', 'yml']);

function isBibliographyFile(file: TAbstractFile): file is TFile {
  return file instanceof TFile && bibliographyExtensions.has(file.extension);
}

// Minimal posix-style path helpers for vault paths (always forward-slash).
function posixDirname(p: string): string {
  const idx = p.lastIndexOf('/');
  return idx <= 0 ? '' : p.slice(0, idx);
}

function posixBasename(p: string): string {
  return p.split('/').pop() ?? p;
}

function posixRelative(from: string, to: string): string {
  const a = from.split('/').filter(Boolean);
  const b = to.split('/').filter(Boolean);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/') || '.';
}

function getFileRelativePath(sourceFile: TFile, targetPath: string) {
  const sourceDir = posixDirname(sourceFile.path);
  const rel = posixRelative(sourceDir, targetPath);
  return rel || posixBasename(targetPath);
}

function bibliographyMatchesPath(
  sourceFile: TFile,
  bibliography: string,
  targetPath: string
) {
  const sourceDir = posixDirname(sourceFile.path);
  const normalizedBibliography = normalizePath(bibliography);
  const noteRelativePath = normalizePath(`${sourceDir}/${normalizedBibliography}`);
  const vaultRelativePath = normalizePath(normalizedBibliography);

  if (noteRelativePath === targetPath || vaultRelativePath === targetPath) {
    return true;
  }

  if (isAbsolutePath(bibliography)) {
    // Absolute path: compare normalised strings directly.
    const vaultRoot = (app.vault.adapter as any).getBasePath?.() ?? '';
    const targetAbs = vaultRoot ? `${vaultRoot}/${targetPath}` : targetPath;
    return bibliography.replace(/\\/g, '/') === targetAbs.replace(/\\/g, '/');
  }

  return false;
}

function updateBibliographyPath(
  sourceFile: TFile,
  bibliography: unknown,
  oldPath: string,
  newPath: string
) {
  const getUpdatedPath = (value: unknown) => {
    if (
      typeof value === 'string' &&
      bibliographyMatchesPath(sourceFile, value, oldPath)
    ) {
      return getFileRelativePath(sourceFile, newPath);
    }

    return value;
  };

  if (Array.isArray(bibliography)) {
    let changed = false;
    const updated = bibliography.map((value) => {
      const next = getUpdatedPath(value);
      changed ||= next !== value;
      return next;
    });

    return changed ? updated : bibliography;
  }

  return getUpdatedPath(bibliography);
}

type UpdateResult =
  | { ok: true; changed?: boolean; reason?: undefined }
  | { ok: false; reason: string };

export default class ReferenceList extends Plugin {
  api: LinkedCitationsApi;
  settings: ReferenceListSettings;
  emitter: Events;
  tooltipManager: TooltipManager;
  bibManager: BibManager;
  private citeSuggest: CiteSuggest;
  private _pendingCitedKeysIndex?: {
    version?: number;
    mdCount?: number;
    builtAt?: number;
    files?: Record<string, string[]>;
  };
  cacheDir = SW_CACHE_DIR;
  _initPromise: PromiseCapability<void>;
  private processReferencesRun = 0;

  get initPromise() {
    if (!this._initPromise) {
      return (this._initPromise = new PromiseCapability());
    }
    return this._initPromise;
  }

  /**
   * One-time migration of the cache folder from the ancestral `.pandoc` name to
   * `.scholar-weft`. Only runs when the new folder is absent and the old one
   * exists, so it never clobbers a fresh cache.
   */
  private async migrateCacheDir(): Promise<void> {
    const adapter = this.app.vault.adapter;
    const next = normalizePath(SW_CACHE_DIR);
    const prev = normalizePath(SW_CACHE_DIR_LEGACY);
    try {
      if (await adapter.exists(next)) return;
      if (!(await adapter.exists(prev))) return;
      await adapter.rename(prev, next);
      debugLog(`ScholarWeft: migrated cache folder ${prev} → ${next}`);
    } catch (e) {
      console.warn('ScholarWeft: cache folder migration failed', e);
    }
  }

  async onload() {
    const { app } = this;

    await this.loadSettings();

    // Rename the ancestral `.pandoc` cache folder to `.scholar-weft` once, so
    // existing installs keep their library/style/render caches.
    await this.migrateCacheDir();

    // Extract bundled scripts and templates into the plugin directory so
    // users who installed via BRAT get everything they need automatically.
    await setupAssets(this);

    // Re-assert the YAML-formatting snippet when the addon is on (regenerates
    // the file if the user deleted it, and keeps it enabled). Never disables it
    // when the addon is off — that is an explicit choice at the toggle.
    if (this.settings.yamlFormattingEnabled === true) {
      await applyYamlFormatting(this, true);
    }

    // Register the sidebar view, but tolerate the view type already existing —
    // e.g. the OLD "scholar-weave" plugin (same code, same view type) is still
    // enabled alongside this one. Without this guard, registerView throws and
    // Obsidian marks the plugin as failed (toggle disabled, settings
    // unavailable). Whichever copy loads first owns the view; this one still
    // loads and works.
    const viewRegistry = (this.app as any).viewRegistry;
    if (viewRegistry?.viewByType && viewType in viewRegistry.viewByType) {
      console.warn(
        `ScholarWeft: view type "${viewType}" is already registered — the ancestral "Pandoc Reference List" plugin (or an earlier ScholarWeft) is enabled. Disable it and restart Obsidian to restore ScholarWeft's reference sidebar.`
      );
    } else {
      this.registerView(
        viewType,
        (leaf: WorkspaceLeaf) => new ReferenceListView(leaf, this)
      );
    }

    // The data explorer is new to ScholarWeft (no ancestral plugin uses the
    // type), but guard anyway so a second copy of ScholarWeft loaded alongside
    // this one can't make registerView throw and disable the whole plugin.
    if (viewRegistry?.viewByType && dataExplorerViewType in viewRegistry.viewByType) {
      console.warn(
        `ScholarWeft: view type "${dataExplorerViewType}" is already registered — another ScholarWeft copy is enabled.`
      );
    } else {
      this.registerView(
        dataExplorerViewType,
        (leaf: WorkspaceLeaf) => new DataExplorerView(leaf, this)
      );
    }

    this.emitter = new Events();
    this.bibManager = new BibManager(this);
    // Restore the persisted citation index now that bibManager exists.
    if (this._pendingCitedKeysIndex) {
      this.bibManager.deserializeCitedKeysIndex(this._pendingCitedKeysIndex);
      this._pendingCitedKeysIndex = undefined;
    }

    // Load the persistent rendered-citation cache from disk IMMEDIATELY —
    // before the workspace layout is ready and any note paints. Rendering
    // (postprocessor + live-preview CM field) lazy-hydrates from this via
    // bibManager.getCacheForPath(), so the FIRST frame of a cached note
    // already shows formatted citations. No raw [@key] flash, no forced
    // re-render. This does not depend on the Zotero engine (still loading);
    // validity uses the file mtime + persisted library version.
    await this.bibManager.loadRenderedCache();
    // Restore the persisted Zotero select-link / PDF maps so cold starts
    // skip the per-citekey HTTP fetch entirely.
    await this.bibManager.loadZLinks();
    // Restore the MRU list that drives the 0/1/2-character autocomplete.
    await this.bibManager.loadRecentKeys();
    // Restore the Zotero child-delta watermark for auto note-update.
    await this.bibManager.loadSyncState();
    // Restore the fetched-children cache (skip re-fetching unchanged items).
    await this.bibManager.loadChildrenCache();
    // Restore the template-hash timeline.
    await this.bibManager.loadTemplateHistory();
    this.api = {
      version: API_VERSION,
      focusReferenceListView: () => this.initLeaf(),
      getCitekeysForFile: (file?: TFile) => this.getCitekeysForFile(file),
    };

    debugLog('[sw:main] loaded settings:', JSON.stringify({
      bibliographyPaths: this.settings.bibliographyPaths,
      pullFromZotero: this.settings.pullFromZotero,
      zoteroGroups: this.settings.zoteroGroups,
      useNativeZoteroAPI: this.settings.useNativeZoteroAPI,
      zoteroPort: this.settings.zoteroPort,
      enableCiteKeyCompletion: this.settings.enableCiteKeyCompletion,
    }));

    this.initPromise.promise
      .then(async () => {
        const { settings, bibManager } = this;
        debugLog('[sw:main] initPromise.then fired — starting bib load');
        // Load sources in priority order: .bib first (lower priority),
        // Zotero on top (higher priority, wins on conflicts).
        //
        // The WHOLE load can take minutes on the FIRST run, and Zotero may not
        // even be running yet. Progress is shown two ways: a persistent status
        // bar item (the reliable one — it survives clicks and is always
        // visible) and a Notice (which is easy to miss). `loadAllSources` does
        // not resolve the library as "ready" on an empty/unreachable result —
        // it retries until entries arrive — so what we report here is truthful.
        const hasSources =
          (settings.bibliographyPaths?.length ?? 0) > 0 || settings.pullFromZotero;
        const loadNotice = hasSources ? new Notice('ScholarWeft: preparing your references…', 0) : null;
        const setNotice = (msg: string) => {
          try {
            loadNotice?.setMessage(`ScholarWeft: ${msg}`);
          } catch {
            /* older Obsidian: keep the original message */
          }
        };
        try {
          await bibManager.loadAllSources({
            fromCache: true,
            onStatus: (msg) => {
              setNotice(msg);
              this.setStatusBarMessage(msg);
            },
          });
        } finally {
          loadNotice?.hide();
          this.setStatusBarIdle();
        }
        // Force all open reading-mode views to re-render now that the citation
        // engine is ready. The markdown post-processor runs synchronously when
        // Obsidian first paints a reading view — if the engine wasn't done yet
        // the file cache was empty and the citations stayed as raw text.
        // Calling rerender(true) triggers a full re-parse so formatted citations
        // appear without the user having to switch away and back.
        this.app.workspace.getLeavesOfType('markdown').forEach((leaf) => {
          const mv = leaf.view as any;
          if (mv?.getMode?.() === 'preview') {
            mv.previewMode?.rerender?.(true);
          }
        });
        debugLog('[sw:main] bib load complete, bibManager.initPromise resolving');
        // Incremental Zotero refresh runs async after the engine is ready.
        // If renames are detected, refreshGlobalZBib() schedules the
        // confirmation modal itself (works for startup and mid-session refreshes).
        if (settings.pullFromZotero) {
          bibManager.refreshGlobalZBib().catch(console.error);
        }
      })
      .catch((e) => {
        console.error('scholar-weft: bibliography load failed:', e);
      });
    // NOTE: there is deliberately NO `.finally { markBackendReady() }` here.
    // `loadAllSources` owns that transition and only makes it once the library
    // genuinely loaded — an unconditional call is what previously declared a
    // failed (empty) first load "ready", disarming the on-demand render path
    // and leaving citations unformatted until a manual "Refresh bibliography".

    this.addSettingTab(new ReferenceListSettingsTab(this));
    this.citeSuggest = new CiteSuggest(app, this);
    this.registerEditorSuggest(this.citeSuggest);
    this.positionSuggest();
    // Re-position CiteSuggest in Obsidian's EditorSuggest queue as the user
    // types: front while typing a citation ([[@ / [@), back for plain "[["
    // wikilinks so Obsidian's native link suggest stays fast.
    this.registerEvent(
      app.workspace.on('editor-change', () => this.positionSuggest())
    );

    // Refresh the Zotero library when Obsidian itself regains focus, so edits
    // made in Zotero (a new tag, a changed title) reach ScholarWeft without
    // waiting for a restart or for the `@@` popup to open.
    //
    // Deliberately NOT `window`'s 'focus' event: Obsidian's window contains its
    // own tab and pane system, so that fires when you switch tabs or panes as
    // well — a Zotero edit cannot have happened in those cases. `document`'s
    // visibility plus `document.hasFocus()` means "the app window was hidden or
    // unfocused and is now back", which is the only time Zotero could have
    // changed underneath us.
    this.registerDomEvent(document, 'visibilitychange', () => {
      if (document.visibilityState === 'visible') this.refreshOnAppRefocus();
      else this._lastAwayAt = Date.now();
    });
    this.registerDomEvent(window, 'focus', () => this.refreshOnAppRefocus());
    this.registerDomEvent(window, 'blur', () => {
      this._lastAwayAt = Date.now();
    });
    this.tooltipManager = new TooltipManager(this);
    this.registerMarkdownPostProcessor(processCiteKeys(this));
    this.registerEditorExtension([
      bibManagerField.init(() => this.bibManager),
      citeKeyCacheField,
      // Prec.highest: our replace-widgets must WIN over Obsidian's built-in
      // live-preview link widget. Both decorate the same [[@key]] range; CM
      // renders only the higher-precedence one. Without this, Obsidian's link
      // widget takes precedence and our rendered citations stay invisible in
      // live preview (plain brackets and ⟦…⟧ containers have no competing
      // Obsidian decoration, so they always worked).
      Prec.highest(citeKeyPlugin),
      editorTooltipHandler(this.tooltipManager),
    ]);

    // Attempt to auto-detect Pandoc on desktop if not already configured.
    findPandoc().then((found) => {
      if (found && !this.settings.pathToPandoc) {
        this.settings.pathToPandoc = found;
        this.saveSettings();
      }
    });

    this.initPromise.resolve();
    this.app.workspace.trigger('parse-style-settings');

    // Auto-open the reference panel on first launch or on mobile (where workspace
    // state isn't reliably persisted between sessions). On desktop after the first
    // open we let the workspace manage the panel's lifecycle — if the user closed
    // it we don't force it back open on every restart.
    //
    // We also guard against duplicate leaves: check getLeavesOfType() directly
    // rather than this.view, because the view's instanceof check returns null while
    // the workspace is still initializing a restored leaf (which would cause a
    // second leaf to be created alongside the restored one).
    // Open the reference list whenever it isn't already in the workspace
    // (e.g. on every app start / plugin enable). The user wants the panel
    // available without running "Show reference list" after each restart.
    this.app.workspace.onLayoutReady(() => {
      const hasLeaf = this.app.workspace.getLeavesOfType(viewType).length > 0;
      if (!hasLeaf) {
        this.initLeaf();
      }
      this.checkConflictingPlugins();
      void this.applyPendingSetup();
      void this.autoConfigureZotlitTemplates();
      void this.ensureZotlitJsTemplates();
    });

    this.addCommand({
      id: 'focus-reference-list-view',
      name: t('Show reference list'),
      callback: async () => {
        this.initLeaf();
      },
    });

    this.addCommand({
      id: 'open-data-explorer',
      name: t('Open Zotero data explorer'),
      callback: async () => {
        this.initDataExplorerLeaf();
      },
    });

    this.addCommand({
      id: 'add-literature-notes',
      name: t('Add Literature Notes from Zotero (search and filter)'),
      callback: async () => {
        const { AddLiteratureNotesModal } = await import(
          './modals/addLiteratureNotesModal'
        );
        new AddLiteratureNotesModal(this.app, this).open();
      },
    });

    this.addCommand({
      id: 'import-literature-notes-from-zotero',
      name: t('Import literature notes from Zotero…'),
      callback: async () => {
        await this.importLiteratureNotesFromZotero();
      },
    });

    this.addCommand({
      id: 'file-group-notes',
      name: t('File literature notes into their library folders'),
      callback: async () => {
        await this.offerGroupNoteMove(true);
      },
    });

    this.addCommand({
      id: 'update-literature-note',
      name: t('Update this literature note'),
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        const stable =
          file &&
          this.app.metadataCache.getFileCache(file)?.frontmatter?.[
            'zotero-key'
          ];
        if (typeof stable !== 'string' || !stable) return false;
        if (!checking) void this.updateActiveLiteratureNote();
        return true;
      },
    });

    // NOTE: "Update all literature notes in the vault" is deliberately NOT a
    // command — it is a button on the Literature note import settings page, so
    // the command list stays focused on per-note actions. Users with auto-update
    // on rarely need it at all.

    this.addCommand({
      id: 'insert-bibliography',
      name: t('Insert bibliography at cursor'),
      editorCallback: (editor: Editor, view: MarkdownView | MarkdownFileInfo) => {
        if (!view.file) return;
        const cache = this.bibManager.fileCache.get(view.file);
        if (!cache?.bib) return;

        const entries = cache.bib.findAll('.csl-entry');
        if (!entries.length) return;

        const text = entries
          .map((e) => htmlToMarkdown(e.innerHTML).trim())
          .join('\n\n');

        editor.replaceSelection(text);
      },
    });

    this.addCommand({
      id: 'snapshot-bibliography',
      name: t('Save bibliography snapshot for this note'),
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view?.file) return false;
        const entries = this.bibManager.snapshotEntries(view.file);
        if (!entries?.length) return false;
        if (!checking) this.openSnapshot(view.file, entries);
        return true;
      },
    });

    this.addCommand({
      id: 'create-missing-lit-notes-note',
      name: t('Create literature notes for citations lacking notes (current note)'),
      callback: async () => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view?.file) return;
        const progress = new Notice('Creating literature notes…', 0);
        // Force the progress bar visible immediately (indeterminate until the
        // first item completes).
        (progress as any).setProgress?.(0, 0);
        const { created, missingKeys } = await this.bibManager.createMissingLitNotes(
          { file: view.file },
          (done, total) => (progress as any).setProgress?.(done, total)
        );
        progress.hide();
        // Fill any freshly created notes with their Zotero child notes.
        await this.fillZoteroNotesForCitekeys(missingKeys, view.file);
        // Re-render the sidebar reference list so per-entry buttons flip from
        // "Create literature note" to "Open literature note".
        this.processReferences();
        new Notice(
          missingKeys.length
            ? `Created literature notes for ${created}/${missingKeys.length} missing citations.`
            : 'All citations in this note already have literature notes.',
          6000
        );
      },
    });

    this.addCommand({
      id: 'create-missing-lit-notes-vault',
      name: t('Create literature notes for citations lacking notes (vault)'),
      callback: async () => {
        const progress = new Notice('Creating literature notes…', 0);
        // Force the progress bar visible immediately (indeterminate until the
        // first item completes).
        (progress as any).setProgress?.(0, 0);
        const { created, missingKeys } = await this.bibManager.createMissingLitNotes(
          { allVault: true },
          (done, total) => (progress as any).setProgress?.(done, total)
        );
        progress.hide();
        // Fill any freshly created notes with their Zotero child notes.
        await this.fillZoteroNotesForCitekeys(missingKeys, null);
        // Re-render the sidebar so entry buttons reflect the new notes.
        this.processReferences();
        new Notice(
          missingKeys.length
            ? `Created literature notes for ${created}/${missingKeys.length} missing citations vault-wide.`
            : 'All cited works in the vault already have literature notes.',
          6000
        );
      },
    });

    // Insert the Zotero child notes of every literature note whose "## Notes"
    // section is still empty (ZotLit imports them as separate files and never
    // hands their text to a template, so we do it ourselves). ZotLit-only: the
    // command is hidden unless ZotLit is the import path; the settings page
    // exposes it as a button in the ZotLit section.
    const run = async () => {
      const progress = new Notice('Inserting Zotero notes…', 0);
      (progress as any).setProgress?.(0, 0);
      const r = await insertZoteroNotesVaultWide(this.app, {
        zoteroPort: this.settings.zoteroPort,
        notesHeadingLevel: this.settings.ownNoteNotesHeadingLevel ?? 3,
        onProgress: (done, total) =>
          (progress as any).setProgress?.(done, total),
      });
      progress.hide();
      const lines = [
        `Inserted Zotero notes into ${r.inserted} literature note(s).`,
        `${r.noNotes.length} had no Zotero notes.`,
      ];
      if (r.skipped.length) {
        lines.push(
          `${r.skipped.length} skipped (the "## Notes" section already had content).`
        );
      }
      if (r.failed.length) {
        lines.push(
          `${r.failed.length} could not be read from Zotero — is Zotero running? (see the developer console)`
        );
      }
      new Notice(`ScholarWeft: ${lines.join('\n')}`, 10000);
      if (r.skipped.length) {
        debugLog(
          'ScholarWeft: notes skipped because "## Notes" already had content:\n' +
            r.skipped.join('\n')
        );
      }
    };
    // ZotLit-only: the on-demand insert lives in the ZotLit section of the
    // literature-note settings, and the command is registered only while ZotLit
    // is the import path — a `checkCallback` returning false still lists the
    // command in the palette, so the command is added/removed instead.
    this._runInsertZoteroNotes = run;
    this.registerZoteroNotesCommand();
    // Document Compiler — outline → markdown, and outline/markdown → docx.
    // Desktop only: runs the bundled scripts/DocumentCompiler.py with Python 3.
    // A single command opens a modal with the TOC / footnotes / output-folder
    // options (template-aware defaults) and Compile / Export buttons.
    if (Platform.isDesktop) {
      this.addCommand({
        id: 'compile-export-book',
        name: t('Compile / Export Document (DOCX, ODT, PDF, LaTeX)'),
        // Always listed (no checkCallback gating) so it's discoverable; if no
        // note is active when it runs, explain instead of doing nothing.
        callback: () => {
          const file = app.workspace.getActiveViewOfType(MarkdownView)?.file;
          if (!file) {
            new Notice(
              t('Open the note you want to export, then run this command again.'),
              6000
            );
            return;
          }
          new ExportModal(app, this, file).open();
        },
      });
    }

    // Import a DOCX or ODT file with Zotero citation fields into the vault
    // as a Markdown note, then optionally link citations and create lit notes.
    if (Platform.isDesktop) {
      this.addCommand({
        id: 'import-document',
        name: t('Import a Word or ODT document with Zotero citations'),
        callback: () => {
          new ImportModal(app, this).open();
        },
      });
    }

    // Convert pandoc citations ([@key]) in the current note to linked
    // citations ([[@key]]), resolving keys against the plugin's Zotero index.
    this.addCommand({
      id: 'convert-pandoc-to-linked',
      name: t('Convert pandoc citations to linked citations (current note)'),
      checkCallback: (checking) => {
        const file = app.workspace.getActiveViewOfType(MarkdownView)?.file;
        if (!file) return false;
        if (!checking) {
          void convertActiveNote(this, file);
        }
        return true;
      },
    });

    // Convert pandoc citations in every vault note to linked citations.
    this.addCommand({
      id: 'convert-pandoc-to-linked-vault',
      name: t('Convert pandoc citations to linked citations (vault)'),
      callback: () => { void convertVault(this); },
    });

    // Revert linked citations back to pandoc-style in the current note.
    this.addCommand({
      id: 'revert-to-pandoc-current-note',
      name: t('Revert linked citations to pandoc-style citations (current note)'),
      checkCallback: (checking) => {
        const file = app.workspace.getActiveViewOfType(MarkdownView)?.file;
        if (!file) return false;
        if (!checking) void convertNoteToPandoc(this, file);
        return true;
      },
    });

    // Revert linked citations back to pandoc-style across the entire vault.
    this.addCommand({
      id: 'revert-to-pandoc-vault',
      name: t('Revert linked citations to pandoc-style citations (vault)'),
      callback: () => { void convertVaultToPandoc(this); },
    });

    // Match literature notes to their Zotero items by stable `zotero-key` and
    // rename the note + associated files where the citekey changed. No stored
    // rename history: the note itself records its old name. Also runs
    // automatically after a Zotero refresh (see scheduleCitekeyReconcile).
    this.addCommand({
      id: 'reconcile-citekeys',
      name: t('Review and update citekeys from Zotero'),
      callback: () => { void this.reviewCitekeyChanges(); },
    });

    // Report-only view of the same reconcile: pending renames, notes that
    // cannot be renamed (name taken), and notes not in the loaded library.
    this.addCommand({
      id: 'list-citekey-discrepancies',
      name: t('List citekey discrepancies'),
      callback: () => { void this.listCitekeyDiscrepancies(); },
    });

    document.body.toggleClass(
      'sw-tooltips',
      this.settings.showCitekeyTooltips !== false
    );
    document.body.toggleClass(
      'sw-decorations',
      this.settings.showCitationDecorations ?? true
    );
    this.applyCitationColors();

    this.registerEvent(
      app.metadataCache.on(
        'changed',
        debounce(
          async (file) => {
            await this.initPromise.promise;
            await this.bibManager.initPromise.promise;

            const activeView = app.workspace.getActiveViewOfType(MarkdownView);
            if (activeView && file === activeView.file) {
              this.processReferences();
            }
          },
          100,
          true
        )
      )
    );

    this.registerEvent(
      app.workspace.on(
        'active-leaf-change',
        debounce(
          async (leaf) => {
            await this.initPromise.promise;
            await this.bibManager.initPromise.promise;

            app.workspace.iterateRootLeaves((rootLeaf) => {
              if (rootLeaf === leaf) {
                if (leaf.view instanceof MarkdownView) {
                  this.processReferences();
                } else {
                  this.view?.setNoContentMessage();
                }
              }
            });
          },
          100,
          true
        )
      )
    );

    this.registerEvent(
      app.vault.on(
        'rename',
        debounce(
          async (file, oldPath) => {
            await this.initPromise.promise;
            await this.bibManager.initPromise.promise;

            if (isBibliographyFile(file)) {
              await this.updateBibliographyFrontmatter(oldPath, file.path);
            }

            // Keep the citation index in sync across renames.
            this.bibManager.removeFromCitedKeysIndex(oldPath);
            if (file instanceof TFile) {
              await this.bibManager.updateCitedKeysIndex(file);
              this.persistCitedKeysIndex();
            }
            this.persistRenderedCache();

            const activeView = app.workspace.getActiveViewOfType(MarkdownView);
            if (activeView?.file instanceof TFile) {
              this.bibManager.fileCache.delete(activeView.file);
              this.processReferences();
            }
          },
          100,
          true
        )
      )
    );

    // Keep the citation index current as files are created / modified.
    this.registerEvent(
      app.vault.on(
        'modify',
        debounce(
          async (file) => {
            if (!(file instanceof TFile)) return;
            // The note TEMPLATE changed: re-record its hash and re-check
            // staleness, so a template edit is picked up without a restart.
            if (file.path === this.settings.noteTemplatePath) {
              void this.recordTemplateAndCheck();
            }
            await this.bibManager.updateCitedKeysIndex(file);
            this.persistCitedKeysIndex();
            this.persistRenderedCache();
            // Re-render the modified note: the in-memory cache + dispatched
            // hash are stale after an edit, so without this the citations
            // keep showing the OLD render (or stay as regular links) until
            // the next file switch — and a stale widget can corrupt the
            // live-preview viewport (vanishing paragraphs).
            if (this.app.workspace.getActiveFile()?.path === file.path) {
              this.bibManager.invalidateFile(file);
              this.processReferences();
            }
          },
          150,
          true
        )
      )
    );
    this.registerEvent(
      app.vault.on(
        'create',
        debounce(
          async (file) => {
            if (!(file instanceof TFile)) return;
            await this.bibManager.updateCitedKeysIndex(file);
            this.persistCitedKeysIndex();
            this.persistRenderedCache();
          },
          150,
          true
        )
      )
    );
    this.registerEvent(
      app.vault.on(
        'delete',
        (file) => {
          this.bibManager.removeFromCitedKeysIndex(file.path);
          this.persistCitedKeysIndex();
        }
      )
    );

    (async () => {
      this.initStatusBar();
      this.setStatusBarLoading();

      await this.initPromise.promise;
      await this.bibManager.initPromise.promise;

      this.setStatusBarIdle();
      // The first reading-mode render runs before the bib engine is ready, so
      // the post-processor has no cache and leaves container citations as raw
      // text.  getCacheForPath then hydrates from the persisted cache and
      // stamps dispatchedHashes — which causes dispatchResult to skip the
      // re-render that would fix the formatting.  Clear the hash guard for the
      // active file so dispatchResult triggers a fresh DOM re-render once
      // processReferences() finishes.
      const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (activeView?.file) {
        this.bibManager.invalidateFile(activeView.file);
      }
      this.processReferences();
    })();
  }

  /**
   * On every startup: if another plugin of the reference-list lineage is
   * enabled (Pandoc Reference List, Bripey/Briley Citation Suite, Alias/Linked
   * Citations, an earlier ScholarWeave), tell the user and offer to disable it.
   * Detected by the plugin's id/name, not a fixed id list, so it catches
   * siblings we don't know about. Shown again each startup while the conflict
   * remains — the user asked to be reminded rather than have it silenced.
   */
  private checkConflictingPlugins(): void {
    const pm = (this.app as any).plugins;
    if (!pm) return;
    const acked = new Set(this.settings.conflictKeepPlugins ?? []);
    const enabled: string[] = Array.from(pm.enabledPlugins ?? []);
    const conflicts = enabled
      .filter((id) => id !== this.manifest.id && !acked.has(id))
      .filter((id) => looksLikeReferenceListPlugin(id, pm.manifests?.[id]?.name ?? ''))
      .map((id) => ({ id, name: pm.manifests?.[id]?.name ?? id }));
    if (conflicts.length === 0) return;
    new ConflictModal(this.app, conflicts, async (disableIds, dontAskAgain) => {
      if (dontAskAgain) {
        this.settings.conflictKeepPlugins = Array.from(new Set([
          ...(this.settings.conflictKeepPlugins ?? []),
          ...conflicts.map((c) => c.id),
        ]));
        await this.saveSettings();
      }
      for (const id of disableIds) {
        try {
          // `disablePlugin` only stops the plugin for this session — Obsidian
          // re-enables it on the next launch because community-plugins.json
          // still lists it. `disablePluginAndSave` also records the change.
          const disable =
            pm.disablePluginAndSave?.bind(pm) ?? pm.disablePlugin.bind(pm);
          await disable(id);
        } catch (e) {
          console.error('ScholarWeft: could not disable conflicting plugin', id, e);
        }
      }
    }).open();
  }

  /** The ZotLit indexed key ("ITEMKEY" / "ITEMKEYgGROUPID") for a note. */
  private async zoteroKeyForFile(file: TFile): Promise<string | null> {
    // A literature note is identified by the "## Notes" section our ZotLit
    // template emits — NOT by `%%zt-managed%%`, which ScholarWeft itself writes
    // only once it has inserted notes (so a freshly exported note wouldn't have
    // it). `insertZoteroNotesForFiles` skips a section that already has content
    // and no-ops on already-recorded keys, so this stays safe to call.
    const content = await this.app.vault.cachedRead(file);
    if (!/^##[ \t]+Notes[ \t]*$/m.test(content)) return null;
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const raw = fm?.['zotero-key'] ?? fm?.zoteroKey ?? fm?.citekey;
    if (typeof raw !== 'string' || !raw.trim()) return null;
    return /^([A-Za-z0-9]+)(?:g(\d+))?$/.test(raw.trim()) ? raw.trim() : null;
  }

  /**
   * After notes are created for `citekeys`, insert their Zotero child notes.
   *
   * Delegates to BibManager so every creation path shares ONE implementation
   * (the single-note sidebar/tooltip path calls it directly). Kept as a thin
   * wrapper because the bulk commands already know the citekeys.
   */
  private async fillZoteroNotesForCitekeys(
    citekeys: string[],
    sourceFile: TFile | null
  ): Promise<void> {
    for (const key of citekeys) {
      await this.bibManager.fillZoteroNotesForCitekey(key, sourceFile);
    }
  }

  /**
   * The installer writes plugins to disk (with Obsidian closed) but can't
   * safely touch their settings from outside. So it records what it deferred in
   * `pendingSetup`; here — inside Obsidian, once the plugins are loaded — we run
   * the same routines the settings buttons run. Items whose plugin hasn't
   * loaded yet are retried briefly, then left for the next launch.
   */
  private async applyPendingSetup(attempt = 0): Promise<void> {
    const pending = this.settings.pendingSetup ?? [];
    if (pending.length === 0) return;
    const loaded = (this.app as any).plugins?.plugins ?? {};
    const ready: string[] = [];
    const waiting: string[] = [];
    for (const item of pending) {
      const id =
        item === 'templater'
          ? 'templater-obsidian'
          : null;
      if (id === null) continue;
      (loaded[id] ? ready : waiting).push(item);
    }
    if (ready.includes('templater')) {
      try {
        await installTemplaterTemplatesWithNotice(this);
      } catch {
        /* leave for the next launch */
      }
    }
    if (waiting.length > 0 && attempt < 5) {
      this.settings.pendingSetup = waiting;
      await this.saveSettings();
      setTimeout(() => void this.applyPendingSetup(attempt + 1), 2000);
      return;
    }
    this.settings.pendingSetup = [];
    await this.saveSettings();
  }

  /**
   * Keep ZotLit's device-local "JavaScript templates" gate ON.
   *
   * The local key is written when the templates are installed, but ZotLit only
   * reads it at ITS load time, so writing it mid-session did nothing until the
   * next restart (which made the templates look broken after a fresh install).
   * Retry briefly until ZotLit is loaded, then flip its live flag so it applies
   * without a restart. Never turns it OFF — if the user later disables it, we
   * leave that choice alone once we've seen it off while ZotLit was loaded.
   */
  private async ensureZotlitJsTemplates(attempt = 0) {
    const zotlit = (this.app as any).plugins?.plugins?.['zotlit'];
    const svc = zotlit?.services?.template;
    if (!svc?.setJavascriptTemplatesEnabled) {
      if (attempt < 5) {
        setTimeout(() => void this.ensureZotlitJsTemplates(attempt + 1), 2000);
      }
      return;
    }
    try {
      if (!svc.javascriptTemplatesEnabled) {
        await svc.setJavascriptTemplatesEnabled(true);
      }
    } catch {
      /* the local key still applies on the next Obsidian load */
    }
  }

  /**
   * If ZotLit is installed and its "Template folder" is still the default
   * ("templates"), and our `sw-zotlit-templates/` folder exists, point ZotLit
   * at ours automatically. Uses the same safe routine as the settings button
   * (disable ZotLit → back up → write → re-enable), so we never race ZotLit's
   * own settings save. Never overrides a non-default choice the user made.
   * ZotLit may not be loaded yet when the layout is ready, so retry briefly.
   */
  private async autoConfigureZotlitTemplates(attempt = 0): Promise<void> {
    const zotlit = (this.app as any).plugins?.plugins?.['zotlit'];
    const folder = zotlit?.settings?.current?.['template.folder'];
    if (!zotlit || folder === undefined) {
      if (attempt < 5) setTimeout(() => void this.autoConfigureZotlitTemplates(attempt + 1), 2000);
      return;
    }
    if (folder === SW_ZOTLIT_FOLDER) return;
    if (folder && folder !== 'templates') return; // respect a custom choice
    if (!(await this.app.vault.adapter.exists(SW_ZOTLIT_FOLDER))) return;
    const res = await installZotlitTemplates(this);
    if (res.folderConfigured) {
      new Notice(`ScholarWeft: pointed ZotLit's “Template folder” at ${SW_ZOTLIT_FOLDER}/`);
    }
  }

  onunload() {
    activeDocument.body.removeClass('sw-tooltips');
    // Obsidian detaches this plugin's own leaves automatically on unload; do
    // NOT call detach()/detachLeavesOfType() here (a review-flagged mistake).
    // Guard: onload may have failed before bibManager existed, and unload must
    // not throw on top of that.
    this.unregisterZoteroNotesCommand();
    if (this.bibManager) {
      void this.bibManager.saveRenderedCache();
      void this.bibManager.saveZLinks();
      this.bibManager.destroy();
    }
  }

  /** The vault-wide Zotero-notes insert, wired to the palette command. */
  private _runInsertZoteroNotes: (() => Promise<void>) | null = null;
  /** Whether the ZotLit-only insert command is currently registered. */
  private _zoteroNotesCommandAdded = false;

  /**
   * ZotLit-only command: shown in the command palette only while ZotLit is the
   * selected import path.
   *
   * A `checkCallback` that returns false still LISTS the command (greyed at
   * best), so the command is registered and removed instead. The settings page
   * calls this after a save so the palette follows the choice immediately.
   */
  registerZoteroNotesCommand(): void {
    if (!this._runInsertZoteroNotes) return;
    const wanted = zotlitIsNoteImportPath(this.settings);
    if (wanted === this._zoteroNotesCommandAdded) return;
    if (wanted) {
      this.addCommand({
        id: 'insert-zotero-notes',
        name: t('Insert Zotero notes into literature notes (vault)'),
        callback: () => void this._runInsertZoteroNotes?.(),
      });
    } else {
      this.unregisterZoteroNotesCommand();
    }
    this._zoteroNotesCommandAdded = wanted;
  }

  private unregisterZoteroNotesCommand(): void {
    if (!this._zoteroNotesCommandAdded) return;
    // `commands` is internal (not in the public typings), like viewRegistry.
    (this.app as any).commands?.removeCommand?.(
      'scholar-weft:insert-zotero-notes'
    );
    this._zoteroNotesCommandAdded = false;
  }

  async updateBibliographyFrontmatter(oldPath: string, newPath: string) {
    oldPath = normalizePath(oldPath);
    newPath = normalizePath(newPath);

    for (const file of this.app.vault.getMarkdownFiles()) {
      const metadata = this.app.metadataCache.getFileCache(file);
      if (!metadata?.frontmatter?.bibliography) continue;

      let changed = false;
      try {
        await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
          const nextBibliography = updateBibliographyPath(
            file,
            frontmatter.bibliography,
            oldPath,
            newPath
          );

          if (nextBibliography !== frontmatter.bibliography) {
            frontmatter.bibliography = nextBibliography;
            changed = true;
          }
        });

        if (changed) {
          this.bibManager.fileCache.delete(file);
        }
      } catch (e) {
        console.error(e);
      }
    }
  }

  statusBarIcon: HTMLElement;
  statusBarText: HTMLElement | null = null;
  initStatusBar() {
    const ico = (this.statusBarIcon = this.addStatusBarItem());
    ico.addClass('sw-status-icon', 'clickable-icon');
    ico.setAttr('aria-label', t('ScholarWeft settings'));
    ico.setAttr('data-tooltip-position', 'top');
    // A sibling span carries the loading message. Kept separate from the icon
    // so the icon stays a stable click target (settings menu) while the text
    // appears and disappears.
    const text = (this.statusBarText = ico.createSpan({ cls: 'sw-status-text sw-status-hidden' }));
    text.setAttr('aria-hidden', 'true');
    this.setStatusBarIdle();
    let isOpen = false;
    ico.addEventListener('click', () => {
      if (isOpen) return;
      const { settings } = this;
      const menu = (new Menu() as any)
        .addSections(['settings', 'actions'])
        .addItem((item: any) =>
          item
            .setSection('settings')
            .setIcon('lucide-message-square')
            .setTitle(t('Show citekey tooltips'))
            .setChecked(!!settings.showCitekeyTooltips)
            .onClick(() => {
              this.settings.showCitekeyTooltips = !settings.showCitekeyTooltips;
              this.saveSettings();
            })
        )
        .addItem((item: any) =>
          item
            .setSection('settings')
            .setIcon('lucide-at-sign')
            .setTitle(t('Trigger reference search with [@ or [[@'))
            .setChecked(!!settings.enableCiteKeyCompletion)
            .onClick(() => {
              this.settings.enableCiteKeyCompletion =
                !settings.enableCiteKeyCompletion;
              this.saveSettings();
            })
        )
        .addItem((item: any) =>
          item
            .setSection('actions')
            .setIcon('lucide-rotate-cw')
            .setTitle(t('Refresh bibliography'))
            .onClick(async () => {
              const activeView =
                this.app.workspace.getActiveViewOfType(MarkdownView);
              if (activeView) {
                const file = activeView.file;

                if (this.bibManager.fileCache.has(file)) {
                  const cache = this.bibManager.fileCache.get(file);
                  if (cache.source !== this.bibManager) {
                    this.bibManager.fileCache.delete(file);
                    this.processReferences();
                    return;
                  }
                }
              }

              this.bibManager.reinit(true);
              await this.bibManager.initPromise.promise;
              this.processReferences();
            })
        );

      const rect = ico.getBoundingClientRect();
      menu.onHide(() => {
        isOpen = false;
      });
      menu.setParentElement(ico).showAtPosition({
        x: rect.x,
        y: rect.top - 5,
        width: rect.width,
        overlap: true,
        left: false,
      });
      isOpen = true;
    });
  }

  setStatusBarLoading() {
    this.statusBarIcon.addClass('is-loading');
    setIcon(this.statusBarIcon, 'lucide-loader');
  }

  /**
   * Show a persistent status-bar message beside the icon while the library
   * loads. The Notice is easy to miss (and vanishes when clicked), so this is
   * the durable indicator: it stays until `setStatusBarIdle()`, so a load that
   * takes minutes — or that is waiting for Zotero to start — is always visible.
   */
  setStatusBarMessage(msg: string) {
    this.setStatusBarLoading();
    const el = this.statusBarText;
    if (!el) return;
    el.setText(msg);
    el.removeClass('sw-status-hidden');
    this.statusBarIcon.setAttr('aria-label', `ScholarWeft: ${msg}`);
  }

  setStatusBarIdle() {
    this.statusBarIcon.removeClass('is-loading');
    setIcon(this.statusBarIcon, 'lucide-at-sign');
    this.statusBarIcon.setAttr('aria-label', t('ScholarWeft settings'));
    const el = this.statusBarText;
    if (el) {
      el.setText('');
      el.addClass('sw-status-hidden');
    }
  }

  get view() {
    const leaves = this.app.workspace.getLeavesOfType(viewType);
    if (!leaves?.length) return null;
    const v = leaves[0].view;
    return v instanceof ReferenceListView ? v : null;
  }

  async initLeaf() {
    // Guard against duplicates using getLeavesOfType rather than this.view:
    // this.view's instanceof check returns null while the workspace is still
    // initialising a restored leaf, which would otherwise create a second leaf.
    if (this.app.workspace.getLeavesOfType(viewType).length) {
      return this.revealLeaf();
    }

    // getRightLeaf(false) can return null on mobile or when the workspace
    // isn't fully ready yet — guard before chaining .setViewState().
    const leaf = this.app.workspace.getRightLeaf(false);
    if (!leaf) return;

    await leaf.setViewState({ type: viewType });

    this.revealLeaf();

    // Remember that we've opened the panel at least once so that the
    // onLayoutReady auto-open doesn't fire on every subsequent desktop restart.
    if (!this.settings.panelAutoOpened) {
      this.settings.panelAutoOpened = true;
      this.saveSettings();
    }

    await this.initPromise.promise;
    await this.bibManager.initPromise.promise;

    // Rebuild the citation index on startup if the persisted one is missing,
    // empty, or stale — otherwise a failed load would silently shrink it.
    void this.ensureCitedKeysIndex();
    // Template staleness: record the CURRENT template in the timeline (always —
    // even if updates are declined, so re-enabling catches up), then offer.
    void (async () => {
      try {
        const src = await readTemplate(this);
        const changed = await this.bibManager.recordCurrentTemplate(src ?? '');
        if (changed) this.scheduleTemplateUpdateCheck();
      } catch (e) {
        console.warn('[sw:template] startup record failed', e);
      }
    })();
    // File any group-library notes under their library folder. Runs after the
    // library is loaded (below), and again after every refresh — not a one-shot
    // startup timer, which could fire before groups were known and then record
    // itself as done.
    window.setTimeout(() => {
      void this.offerGroupNoteMove();
    }, 4000);

    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (activeView) {
      this.processReferences();
    }

    // Background warm-up: pre-render citations for files not currently open
    // so the first open of any cited note is instant. Safe to run while the
    // user works (each render is fast; small yields keep the UI responsive;
    // PDF lookups are skipped while warming).
    setTimeout(() => {
      void this.bibManager.warmCitedFiles();
    }, 2500);
  }

  revealLeaf() {
    const leaves = this.app.workspace.getLeavesOfType(viewType);
    if (!leaves?.length) return;
    this.app.workspace.revealLeaf(leaves[0]);
  }

  /** Open (or reveal) the Zotero data explorer in the right sidebar. */
  async initDataExplorerLeaf() {
    const existing = this.app.workspace.getLeavesOfType(dataExplorerViewType);
    if (existing.length) {
      this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    // getRightLeaf(false) can be null on mobile / before the workspace is ready.
    const leaf = this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({ type: dataExplorerViewType });
    this.app.workspace.revealLeaf(leaf);
  }

  /**
   * Let the user pick one or more items in Zotero's native dialog (Better
   * BibTeX CAYW) and import or refresh a literature note for each. Each item
   * goes through the normal creation path, so `useOwnNoteTemplate` (and the
   * ZotLit/fallback routes) are honoured.
   */
  async importLiteratureNotesFromZotero() {
    const port = this.settings.zoteroPort || DEFAULT_ZOTERO_PORT;
    if (!(await isZoteroRunning(port))) {
      new Notice(
        'Zotero’s picker isn’t responding. Make sure Zotero is running with ' +
          'Better BibTeX installed (the picker needs it). If it is, another ' +
          'integration may be holding the picker — close any open Zotero ' +
          'citation dialog, or disable the other plugin (e.g. Zotero ' +
          'Integration), then try again.',
        12000
      );
      return;
    }

    // Any file works as the link anchor; prefer the active note.
    const anchor =
      this.app.workspace.getActiveFile() ?? this.app.vault.getMarkdownFiles()[0];
    if (!anchor) {
      new Notice('Open a note first — the import needs a file to anchor links to.');
      return;
    }

    const waiting = new Notice('Pick one or more items in Zotero…', 0);
    let picked;
    try {
      picked = await pickZoteroItems(port);
    } catch (e) {
      waiting.hide();
      new Notice(`Zotero picker: ${(e as Error).message}`, 8000);
      return;
    }
    waiting.hide();

    if (!picked.length) {
      new Notice('No items selected.');
      return;
    }

    const citekeys: string[] = [];
    for (const p of picked) {
      const ck =
        p.citekey && this.bibManager.bibCache.has(p.citekey)
          ? p.citekey
          : this.findCitekeyByZoteroKey(p.zoteroKey);
      if (ck && !citekeys.includes(ck)) citekeys.push(ck);
      else if (!ck) {
        console.warn('[sw:import] picked item is not in the loaded library', p);
      }
    }
    if (!citekeys.length) {
      new Notice('The selected item(s) are not in the loaded Zotero library.');
      return;
    }

    const run = new Notice(`Importing ${citekeys.length} literature note(s)…`, 0);
    const importedKeys: string[] = [];
    // Open the note when the user picked exactly one (and the setting allows).
    const open = citekeys.length === 1 && this.settings.openImportedNote !== false;
    for (const ck of citekeys) {
      try {
        await this.bibManager.createLiteratureNote(ck, anchor, { open });
        importedKeys.push(ck);
      } catch (e) {
        console.warn('[sw:import] picker import failed for', ck, e);
      }
    }
    run.hide();
    new Notice(
      formatImportSummary(importedKeys.map((k) => `@${k}`)),
      8000
    );
  }

  private findCitekeyByZoteroKey(zoteroKey: string | null): string | null {
    if (!zoteroKey) return null;
    for (const [citekey, entry] of this.bibManager.bibCache) {
      if ((entry as { _zoteroKey?: string })?._zoteroKey === zoteroKey) {
        return citekey;
      }
    }
    return null;
  }

  /**
   * Resolve a `zotero-key` frontmatter value — `KEY` (My Library) or
   * `KEYgGROUPID` (a group library) — to a citekey in the loaded library. The
   * group suffix is checked too, so the same item key in two libraries is not
   * confused.
   */
  private findCitekeyByStableKey(stable: string): string | null {
    return this.bibManager.findCitekeyByStableKey(stable);
  }

  /**
   * Re-render ONE literature note from our own template, locating it by its
   * stable `zotero-key` (so a renamed note updates in place).
   *
   * The note's format (not the current setting) decides whether a warning is
   * shown: an update renders with whichever import path is selected, so a note
   * in the other format — or one whose region will be added or removed — is
   * confirmed first.
   *
   * Returns a RESULT so a batch can report WHICH note was skipped and WHY,
   * instead of a bare count.
   */
  async updateLiteratureNoteResult(
    file: TFile,
    opts?: { confirm?: boolean; skipChildCache?: boolean; force?: boolean }
  ): Promise<UpdateResult> {
    const stable =
      this.app.metadataCache.getFileCache(file)?.frontmatter?.['zotero-key'];
    if (typeof stable !== 'string' || !stable) {
      return { ok: false, reason: 'no zotero-key' };
    }
    const citekey = this.findCitekeyByStableKey(stable);
    if (!citekey) {
      return { ok: false, reason: `item ${stable} is not in the loaded library` };
    }

    if (opts?.confirm !== false) {
      const proceed = await this.confirmFormatChange(file);
      if (!proceed) return { ok: false, reason: 'declined the format-change prompt' };
    }

    try {
      const res = await this.bibManager.createLiteratureNote(citekey, file, {
        open: false,
        stableKey: stable,
        skipChildCache: opts?.skipChildCache === true,
        force: opts?.force === true,
      });
      return { ok: true, changed: res.changed };
    } catch (e) {
      console.warn('[sw:update] failed for', file.path, e);
      return { ok: false, reason: (e as Error)?.message ?? 'update failed' };
    }
  }

  /** Boolean convenience wrapper around {@link updateLiteratureNoteResult}. */
  async updateLiteratureNote(
    file: TFile,
    opts?: { confirm?: boolean; skipChildCache?: boolean; force?: boolean }
  ): Promise<boolean> {
    return (await this.updateLiteratureNoteResult(file, opts)).ok;
  }

  /**
   * Ask before an update that changes a note's formatting.
   *
   * Only prompted when it is a real risk: the note is in ZotLit's format while
   * we are importing with ScholarWeft (the conversion case), or the note has no
   * managed region yet because its item had nothing to annotate.
   */
  private async confirmFormatChange(file: TFile): Promise<boolean> {
    let source: string;
    try {
      source = await this.app.vault.cachedRead(file);
    } catch {
      return true; // unreadable: let the normal path report the failure
    }
    const format = detectNoteFormat(source, true);
    const importingWithZotLit = this.settings.useOwnNoteTemplate !== true;

    // Same format on both sides means a plain refresh; no prompt needed.
    if (importingWithZotLit ? format === 'zotlit' : format === 'sw') return true;

    const { FormatChangeModal } = await import('./modals/formatChangeModal');
    return new Promise<boolean>((resolve) => {
      new FormatChangeModal(this.app, {
        noteName: file.basename,
        noteFormat: format,
        importingWithZotLit,
        onChoose: resolve,
      }).open();
    });
  }

  /** "Update this literature note" — the active note, located by `zotero-key`. */
  private async updateActiveLiteratureNote(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file) return;
    const ok = await this.updateLiteratureNote(file);
    new Notice(
      ok
        ? `Updated ${file.basename}.`
        : `“${file.basename}” was not updated (no zotero-key, or its item is not in the loaded library).`,
      8000
    );
  }

  /** The active note must exist and carry a `zotero-key` to be updateable. */
  private activeNoteIsLiteratureNote(): boolean {
    const file = this.app.workspace.getActiveFile();
    const stable =
      file &&
      this.app.metadataCache.getFileCache(file)?.frontmatter?.['zotero-key'];
    return typeof stable === 'string' && !!stable;
  }

  /**
   * Re-render EVERY literature note (a vault-wide maintenance action). Exposed
   * for the button on the Literature note import settings page — deliberately
   * NOT a command, to keep the command list focused on per-note actions. With
   * auto-update on it is rarely needed; unchanged items are served from the
   * children cache, so it is fast when nothing changed.
   */
  async updateAllLiteratureNotes(): Promise<void> {
    const files = this.app.vault.getMarkdownFiles().filter((f) => {
      const stable =
        this.app.metadataCache.getFileCache(f)?.frontmatter?.['zotero-key'];
      return typeof stable === 'string' && !!stable;
    });
    if (!files.length) {
      new Notice('No literature notes with a “zotero-key” were found.');
      return;
    }

    const progress = new Notice(
      `Updating literature notes… 0/${files.length} (you can keep working)`,
      0
    );
    let updated = 0;
    let processed = 0;
    const skipped: Array<{ path: string; reason: string }> = [];
    const startedAt = Date.now();
    for (const file of files) {
      processed++;
      const res = await this.updateLiteratureNoteResult(file);
      // A note whose re-render is identical (res.changed === false) is left
      // untouched and is not counted as updated.
      if (res.ok && res.changed !== false) {
        updated++;
      } else if (!res.ok) {
        skipped.push({ path: file.path, reason: res.reason });
      }
      progress.setMessage(
        `Updating literature notes… ${processed}/${files.length} (you can keep working)`
      );
      // Yield so typing/scrolling stays responsive during a long pass.
      await new Promise((r) => setTimeout(r, 0));
    }
    progress.hide();
    this.recordUpdateRate(updated, Date.now() - startedAt);
    this.reportBatchResult(updated, skipped);
  }

  // ── Auto note-update (Zotero-driven) ────────────────────────────────────────

  private _pendingAutoUpdate = new Set<string>();
  private _autoUpdateTimer: number | null = null;
  private _autoUpdateRunning = false;
  private _autoUpdatePrompting = false;

  /**
   * Queue citekeys for an automatic note refresh. NOTHING is modified until the
   * setting is YES: if it is UNSET the user is asked FIRST (and the answer
   * becomes the setting); if NO the change is ignored.
   */
  scheduleAutoUpdate(citekeys: Iterable<string>): void {
    if (this.settings.autoUpdateNotes === false) return;
    for (const k of citekeys) if (k) this._pendingAutoUpdate.add(k);
    if (this.settings.autoUpdateNotes === undefined) {
      void this.promptAutoUpdateConsent();
      return;
    }
    this.armAutoUpdate();
  }

  /** Debounce (3 s) + coalesce the pending update run. */
  private armAutoUpdate(): void {
    if (this._autoUpdateTimer != null) return;
    this._autoUpdateTimer = window.setTimeout(() => {
      this._autoUpdateTimer = null;
      void this.runAutoUpdate();
    }, 3000);
  }

  /** Ask once, BEFORE any note is modified; the answer becomes the setting. */
  private async promptAutoUpdateConsent(): Promise<void> {
    if (this._autoUpdatePrompting || this.settings.autoUpdateNotes !== undefined) {
      return;
    }
    this._autoUpdatePrompting = true;
    try {
      const { AutoUpdateConsentModal } = await import(
        './modals/autoUpdateConsentModal'
      );
      const yes = await new Promise<boolean>((resolve) =>
        new AutoUpdateConsentModal(this.app, resolve).open()
      );
      this.settings.autoUpdateNotes = yes;
      await this.saveSettings();
      if (yes) {
        if (this._pendingAutoUpdate.size) this.armAutoUpdate();
      } else {
        this._pendingAutoUpdate.clear();
      }
    } finally {
      this._autoUpdatePrompting = false;
    }
  }

  private async runAutoUpdate(): Promise<void> {
    if (this.settings.autoUpdateNotes !== true) return;
    if (this._autoUpdateRunning) return;
    const pending = this._pendingAutoUpdate;
    this._pendingAutoUpdate = new Set();
    if (!pending.size) return;
    this._autoUpdateRunning = true;
    try {
      await this.autoUpdateNotesForCitekeys(pending);
    } catch (e) {
      console.warn('[sw:auto-update] failed:', e);
    } finally {
      this._autoUpdateRunning = false;
    }
    if (this._pendingAutoUpdate.size) this.armAutoUpdate();
  }

  /**
   * Update the literature notes for `citekeys`. Non-destructive (managed fields
   * + region only). ZotLit-managed notes are updated only when the setting is
   * "Always convert" — otherwise they are skipped here rather than prompting
   * mid-batch (the manual commands still prompt).
   */
  private async autoUpdateNotesForCitekeys(citekeys: Set<string>): Promise<void> {
    const targets = await this.collectAutoUpdateFiles(citekeys);
    if (!targets.length) return;

    const progress = new Notice(
      `Updating literature notes from Zotero… 0/${targets.length}`,
      0
    );
    const updatedKeys: string[] = [];
    let skipped = 0;
    for (const { file, citekey } of targets) {
      // Zotero told us this item CHANGED, so fetch its children even if the
      // cached snapshot's version happens to match.
      const res = await this.updateLiteratureNoteResult(file, {
        confirm: false,
        skipChildCache: true,
      });
      if (res.ok && res.changed !== false) {
        updatedKeys.push(citekey);
      } else if (!res.ok) {
        skipped++;
      }
      // res.ok && changed === false: re-rendered to identical content (e.g. a
      // PDF's `lastRead` bumped its version) — nothing changed, so nothing to
      // report and the note was left untouched.
      progress.setMessage(
        `Updating literature notes from Zotero… ${updatedKeys.length + skipped}/${targets.length}`
      );
    }
    progress.hide();
    if (updatedKeys.length) this.showAutoUpdateNotice(updatedKeys, skipped);
  }

  /** "Updated N notes:" followed by the citekeys, so the reader sees WHAT changed. */
  private showAutoUpdateNotice(keys: string[], skipped: number): void {
    const notice = new Notice('', 8000);
    const el =
      (notice as unknown as { noticeEl?: HTMLElement }).noticeEl ??
      notice.containerEl;
    if (!el) return;
    el.createEl('div', {
      text: `Updated ${keys.length} literature note${
        keys.length !== 1 ? 's' : ''
      }${skipped ? ` (skipped ${skipped})` : ''}:`,
    });
    const MAX = 20;
    for (const k of keys.slice(0, MAX)) {
      el.createEl('div', { cls: 'sw-auto-update-key', text: `@${k}` });
    }
    if (keys.length > MAX) {
      el.createEl('div', { text: `…and ${keys.length - MAX} more.` });
    }
  }

  /** Literature-note files for `citekeys`, honouring the ZotLit setting. */
  private async collectAutoUpdateFiles(
    citekeys: Set<string>
  ): Promise<Array<{ file: TFile; citekey: string }>> {
    const setting = this.settings.ownNoteZotLitHandling ?? 'ask';
    const out: Array<{ file: TFile; citekey: string }> = [];
    const seen = new Set<string>();
    for (const f of this.app.vault.getMarkdownFiles()) {
      const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
      let ck: string | null = null;
      if (fm) {
        if (typeof fm.citekey === 'string' && fm.citekey) ck = fm.citekey;
        else if (typeof fm['zotero-key'] === 'string')
          ck = this.findCitekeyByStableKey(fm['zotero-key']);
      }
      if (!ck && f.basename.startsWith('@')) ck = f.basename.slice(1);
      if (!ck || !citekeys.has(ck) || seen.has(f.path)) continue;
      // ZotLit-managed notes: only when explicitly told to convert, so a batch
      // never opens a modal.
      if (setting !== 'convert') {
        try {
          const content = await this.app.vault.cachedRead(f);
          if (isZotLitManaged(content)) continue;
        } catch {
          /* unreadable — let updateLiteratureNote report it */
        }
      }
      seen.add(f.path);
      out.push({ file: f, citekey: ck });
    }
    return out;
  }

  /**
   * One-time offer to file existing group-library notes under their library's
   * auto-named subfolder. Nothing moves without consent; files are moved with
   * `fileManager.renameFile`, so Obsidian rewrites `[[…]]` links automatically.
   *
   * `force` re-runs it regardless of the recorded flag (the palette command).
   */
  async offerGroupNoteMove(force = false): Promise<void> {
    if (this.settings.groupNoteMoveOffered && !force) return;
    const base = this.bibManager.resolveBaseNoteFolder();
    if (base == null) return;

    // Notes needing a move, AND stale library folders to rename (created before
    // a group's name was known — e.g. a "Group 6667607" folder whose library is
    // now "Andrea Lickacz readings").
    const { byGroup, staleFolders, diagnostic } = await this.planGroupNoteMove(base);
    // Diagnostic: dump the actual decision so a failed scan can be diagnosed
    // from the console rather than by guessing. Includes the child-folder list.
    debugLog('[sw:move] DIAGNOSTIC\n' + diagnostic);
    try {
      await this.app.vault.adapter.write('tmp/sw-move-diagnostic.txt', diagnostic);
    } catch {
      /* best effort */
    }
    const total = [...byGroup.values()].reduce((n, a) => n + a.length, 0);
    const totalMoves = total + staleFolders.length;
    if (!totalMoves) {
      // Record ONLY when the library was actually loaded (a group name is known
      // for every configured group). Otherwise a scan that ran before groups
      // were known would mark itself done and never run again.
      const groups = this.settings.zoteroGroups ?? [];
      const namesKnown =
        groups.length === 0 ||
        groups.every((g) => g.id === 1 || !!this.bibManager.libraryNameFor(g.id));
      if (namesKnown) {
        this.settings.groupNoteMoveOffered = true;
        await this.saveSettings();
      }
      if (force) {
        new Notice(
          namesKnown
            ? 'All literature notes are already in their library folders.'
            : 'Group libraries not loaded yet — try again after Zotero loads.'
        );
      }
      return;
    }

    const nameOf = (gid: number) => this.bibManager.libraryNameFor(gid) ?? `Group ${gid}`;
    const notice = new Notice('', 0);
    const el =
      (notice as unknown as { noticeEl?: HTMLElement }).noticeEl ??
      notice.containerEl;
    if (!el) return;
    el.createEl('div', {
      text:
        (total
          ? `${total} literature note${total !== 1 ? 's' : ''} outside ${
              total !== 1 ? 'their' : 'its'
            } library folder. `
          : '') +
        (staleFolders.length
          ? `${staleFolders.length} library folder${
              staleFolders.length !== 1 ? 's' : ''
            } need renaming (${staleFolders
              .map((f) => `${f.from.split('/').pop()} → ${f.to.split('/').pop()}`)
              .join(', ')}).`
          : ''),
    });
    const move = el.createEl('button', { text: 'Fix folders', cls: 'mod-cta' });
    const dismiss = el.createEl('button', { text: 'Not now' });
    dismiss.addEventListener('click', () => notice.hide());
    move.addEventListener('click', () => {
      notice.hide();
      void this.moveGroupNotes(byGroup, staleFolders);
      void nameOf;
    });
  }

  /** Plan: which notes to move, and which library folders to rename. */
  private async planGroupNoteMove(base: string): Promise<{
    byGroup: Map<number, TFile[]>;
    staleFolders: Array<{ from: string; to: string }>;
    diagnostic: string;
  }> {
    const lines: string[] = [`base=${JSON.stringify(base)}`];
    const byGroup = new Map<number, TFile[]>();
    for (const f of this.app.vault.getMarkdownFiles()) {
      const zk =
        this.app.metadataCache.getFileCache(f)?.frontmatter?.['zotero-key'];
      if (typeof zk !== 'string') continue;
      const m = /^.*?g(\d+)$/.exec(zk.trim());
      if (!m) continue;
      const gid = Number(m[1]);
      if (gid === 1) continue;
      const target = literatureNoteFolderFor({
        base,
        groupID: gid,
        groupName: this.bibManager.libraryNameFor(gid),
      });
      if (f.parent?.path === target) continue;
      (byGroup.get(gid) ?? byGroup.set(gid, []).get(gid)!).push(f);
    }

    // Group folders whose name no longer matches the library name. Detected by
    // LISTING the base folder child folders (not `adapter.exists`, which did not
    // see a folder that was plainly on disk) and matching either the legacy
    // `Group N` name OR the PREVIOUS library name (the group was renamed in
    // Zotero: 'AL Readings' → 'AL MA project'), then renamed directly so the
    // notes follow.
    const staleFolders: Array<{ from: string; to: string }> = [];
    const childFolders = await this.listChildFolders(base);
    const childNames = new Set(
      childFolders.map((p) => p.split('/').pop() ?? '')
    );
    const otherTargets = new Set(
      [...(this.settings.zoteroGroups ?? []).map((g) => g.id), ...byGroup.keys()]
        .map((gid) =>
          literatureNoteFolderFor({
            base,
            groupID: gid,
            groupName: this.bibManager.libraryNameFor(gid),
          })
        )
        .filter((p) => childNames.has(p.split('/').pop() ?? ''))
    );

    for (const gid of new Set([
      ...(this.settings.zoteroGroups ?? []).map((g) => g.id),
      ...byGroup.keys(),
    ])) {
      const target = literatureNoteFolderFor({
        base,
        groupID: gid,
        groupName: this.bibManager.libraryNameFor(gid),
      });
      const targetName = target.split('/').pop() ?? '';
      if (targetName.startsWith('Group ')) continue;

      // A folder for this group that is NOT the current target: the legacy
      // `Group N` name, or the previously-recorded folder name (a rename).
      const candidates = [
        `Group ${gid}`,
        lastFolderName(gid) ?? '',
      ].filter((n) => n && n !== targetName);
      const oldPath = childFolders.find((p) => {
        const name = p.split('/').pop() ?? '';
        if (!candidates.includes(name)) return false;
        // Do not steal a folder that IS another group's current target.
        return !otherTargets.has(p);
      });
      lines.push(
        `group ${gid}: target=${JSON.stringify(target)} ` +
          `targetName=${JSON.stringify(targetName)} ` +
          `prevName=${JSON.stringify(lastFolderName(gid) ?? null)} ` +
          `oldFolder=${JSON.stringify(oldPath ?? null)} ` +
          `childNames=${JSON.stringify([...childNames])} ` +
          `nameFor=${JSON.stringify(this.bibManager.libraryNameFor(gid))}`
      );
      if (oldPath && oldPath !== target) {
        staleFolders.push({ from: oldPath, to: target });
      } else if (oldPath && oldPath === target) {
        // Current name confirmed — remember it as the folder's name so a later
        // Zotero rename can be detected.
        rememberFolderName(gid, targetName);
      } else if (childNames.has(targetName)) {
        rememberFolderName(gid, targetName);
      }
    }
    lines.push(
      `byGroup=${JSON.stringify(
        [...byGroup.entries()].map(([g, fs]) => [g, fs.map((f) => f.path)])
      )}`
    );
    lines.push(`staleFolders=${JSON.stringify(staleFolders)}`);
    return { byGroup, staleFolders, diagnostic: lines.join('\n') };
  }

  /** Vault-relative paths of the immediate child FOLDERS of `folder`. */
  private async listChildFolders(folder: string): Promise<string[]> {
    try {
      const norm = folder.replace(/\/+$/, '');
      const listing = await this.app.vault.adapter.list(norm || '/');
      return listing.folders ?? [];
    } catch (e) {
      console.warn('[sw:move] could not list', folder, e);
      return [];
    }
  }

  private async moveGroupNotes(
    byGroup: Map<number, TFile[]>,
    staleFolders: Array<{ from: string; to: string }> = []
  ): Promise<void> {
    const fm = this.app.fileManager;
    let moved = 0;
    let renamed = 0;
    let failed = 0;

    // 1. Rename stale library FOLDERS first, so notes already inside follow the
    //    folder instead of being moved file by file (and the target exists).
    for (const { from, to } of staleFolders) {
      try {
        const folder = this.app.vault.getAbstractFileByPath(from);
        debugLog('[sw:move] rename folder', from, '->', to, 'found=', !!folder);
        if (folder) {
          await fm.renameFile(folder as never, to);
          renamed++;
        }
      } catch (e) {
        console.warn('[sw:move] failed to rename folder', from, e);
        failed++;
      }
    }

    // 2. Move any note still outside its folder.
    const base = this.bibManager.resolveBaseNoteFolder();
    for (const [gid, files] of byGroup) {
      const folder = literatureNoteFolderFor({
        base,
        groupID: gid,
        groupName: this.bibManager.libraryNameFor(gid),
      });
      for (const f of files) {
        // Already under the target (e.g. the folder was just renamed)?
        if (f.path.startsWith(folder + '/')) continue;
        try {
          if (!(await this.app.vault.adapter.exists(folder))) {
            await this.app.vault.adapter.mkdir(folder);
          }
          const target = `${folder}/${f.name}`;
          if (target === f.path) continue;
          await fm.renameFile(f, target);
          moved++;
        } catch (e) {
          console.warn('[sw:move] failed to move', f.path, e);
          failed++;
        }
      }
    }

    this.settings.groupNoteMoveOffered = true;
    await this.saveSettings();
    if (!moved && !renamed && !failed) {
      new Notice('All literature notes are already in their library folders.');
      return;
    }
    new Notice(
      `Moved ${moved} note${moved !== 1 ? 's' : ''}` +
        (renamed ? `, renamed ${renamed} folder${renamed !== 1 ? 's' : ''}` : '') +
        (failed ? `, ${failed} failed (see console)` : '') +
        '.',
      8000
    );
  }

  /**
   * Template-staleness pass: find own-template notes rendered with an OLDER
   * template hash and, per the tri-state setting, ask-then-apply, apply, or
   * skip. The timeline is always updated BEFORE this runs, so a decline never
   * stops tracking — re-enabling later catches up.
   */
  async offerTemplateUpdate(): Promise<void> {
    const timeline = this.bibManager.templateTimeline;
    if (!this.bibManager.currentTemplateHash) return;

    // Only ScholarWeft's own-template notes carry `updated`.
    const stale: TFile[] = [];
    for (const f of this.app.vault.getMarkdownFiles()) {
      const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
      if (!fm) continue;
      if (fm['document-type'] !== '[[zotero-import]]') continue;
      const updatedMs = parseTimestamp(fm['updated']);
      if (isNoteStale(timeline, updatedMs)) stale.push(f);
    }
    if (!stale.length) return;

    if (this.settings.autoUpdateTemplate === true) {
      await this.updateNotesForTemplate(stale);
      return;
    }
    if (this.settings.autoUpdateTemplate === false) return;

    const { TemplateUpdateConsentModal } = await import(
      './modals/templateUpdateConsentModal'
    );
    const answer = await new Promise<'yes' | 'no' | 'ask'>((resolve) =>
      new TemplateUpdateConsentModal(
        this.app,
        stale.length,
        resolve,
        this._notesPerMinute
      ).open()
    );
    if (answer === 'ask') return;
    this.settings.autoUpdateTemplate = answer === 'yes';
    await this.saveSettings();
    if (answer === 'yes') await this.updateNotesForTemplate(stale);
  }

  private async updateNotesForTemplate(files: TFile[]): Promise<void> {
    // Tell the user the SCALE first: a first-run pass can be hundreds of notes
    // and several minutes. Reassure that it is non-destructive and that they can
    // keep working (updates are sequential and yield between notes, so the UI
    // stays responsive; only the managed fields and region change).
    const est = this.estimateMinutes(files.length);
    new Notice(
      `Updating ${files.length} literature note${
        files.length !== 1 ? 's' : ''
      } to the current template — about ${est} minute${
        est !== 1 ? 's' : ''
      }. You can keep working; your own writing is never overwritten.`,
      10000
    );

    const progress = new Notice(
      `Updating notes… 0/${files.length} (you can keep working)`,
      0
    );
    let updated = 0;
    const skipped: Array<{ path: string; reason: string }> = [];
    const startedAt = Date.now();
    for (const f of files) {
      // A template update must advance each note's `updated` stamp even when the
      // output is unchanged, so `isNoteStale` stops flagging it — hence `force`.
      const res = await this.updateLiteratureNoteResult(f, {
        confirm: false,
        force: true,
      });
      if (res.ok) {
        updated++;
      } else {
        skipped.push({ path: f.path, reason: res.reason });
      }
      progress.setMessage(
        `Updating notes… ${updated + skipped.length}/${files.length} (you can keep working)`
      );
      // Yield so typing/scrolling stays responsive during a long pass.
      await new Promise((r) => setTimeout(r, 0));
    }
    progress.hide();
    this.recordUpdateRate(updated, Date.now() - startedAt);
    this.reportBatchResult(updated, skipped, 'to the current template');
  }

  /** Notes-per-minute for estimates, learned from real passes.
   *
   *  The default reflects the fetched-children CACHE: a template-only pass
   *  re-renders unchanged items from cache (no Zotero round trips), which is
   *  ~10x a cold pass — a few hundred notes is a minute, not ten. A measured
   *  rate replaces it after the first real pass (see `update-rate.ts`). */
  private _notesPerMinute = DEFAULT_NOTES_PER_MINUTE;

  private estimateMinutes(count: number): number {
    return estimateMinutes(count, this._notesPerMinute);
  }

  private recordUpdateRate(updated: number, elapsedMs: number): void {
    if (updated >= 10 && elapsedMs > 0) {
      this._notesPerMinute = nextNotesPerMinute(
        this._notesPerMinute,
        updated / (elapsedMs / 60000)
      );
      debugLog(
        `[sw:template] measured ${this._notesPerMinute.toFixed(0)} notes/min`
      );
    }
  }

  /**
   * Final summary listing WHICH notes were skipped and WHY, so a bare
   * "skipped 1" can't leave the user guessing.
   */
  private reportBatchResult(
    updated: number,
    skipped: Array<{ path: string; reason: string }>,
    suffix = ''
  ): void {
    const head = `Updated ${updated} literature note${updated !== 1 ? 's' : ''}${
      suffix ? ' ' + suffix : ''
    }.`;
    if (!skipped.length) {
      new Notice(head, 8000);
      return;
    }
    const notice = new Notice('', 12000);
    const el =
      (notice as unknown as { noticeEl?: HTMLElement }).noticeEl ??
      notice.containerEl;
    if (!el) return;
    el.createEl('div', { text: head });
    el.createEl('div', {
      text: `Skipped ${skipped.length}:`,
    });
    for (const s of skipped.slice(0, 20)) {
      const name = s.path.split('/').pop() ?? s.path;
      el.createEl('div', { cls: 'sw-auto-update-key', text: `${name} — ${s.reason}` });
    }
    if (skipped.length > 20) {
      el.createEl('div', { text: `…and ${skipped.length - 20} more (see console).` });
    }
    console.warn('[sw:template] skipped notes:', skipped);
  }

  private _templateCheckTimer: number | null = null;

  /** Debounced template-staleness check (coalesces startup + file events). */
  scheduleTemplateUpdateCheck(): void {
    if (this._templateCheckTimer != null) return;
    this._templateCheckTimer = window.setTimeout(() => {
      this._templateCheckTimer = null;
      void this.offerTemplateUpdate().catch((e) =>
        console.warn('[sw:template] offer failed', e)
      );
    }, 3000);
  }

  /** Record the current template (when it changed) and re-check staleness. */
  async recordTemplateAndCheck(): Promise<void> {
    try {
      const src = await readTemplate(this);
      if (await this.bibManager.recordCurrentTemplate(src ?? '')) {
        this.scheduleTemplateUpdateCheck();
      }
    } catch (e) {
      console.warn('[sw:template] record failed', e);
    }
  }

  async getCitekeysForFile(file?: TFile) {
    const target = file ?? this.app.workspace.getActiveFile();
    if (!target) return [];

    const cached = this.bibManager.fileCache.get(target);
    if (cached?.keys) return Array.from(cached.keys);

    try {
      const content = await this.app.vault.cachedRead(target);
      await this.bibManager.getReferenceList(target, content);
      return Array.from(this.bibManager.fileCache.get(target)?.keys ?? []);
    } catch (error) {
      console.error('ScholarWeft: failed to read citekeys for API consumer', error);
      return [];
    }
  }

  async loadSettings() {
    const saved = (await this.loadData()) ?? {};

    // Restore the persisted citation index from its own file (.scholar-weft/
    // cited-keys.json) — NOT from data.json, which saveSettings() rewrites and
    // would otherwise clobber the index. Loaded lazily after bibManager exists.
    try {
      const indexPath = normalizePath(`${this.cacheDir}/cited-keys.json`);
      const cached = await this.app.vault.adapter.read(indexPath);
      const parsed = JSON.parse(cached);
      // A v1 index (no `builtAt`) predates the incremental reconciler. Infer a
      // scan watermark from the index file's own mtime — it was last written
      // after every entry was scanned — so the first reconcile after upgrading
      // reads only files changed since, instead of re-reading the whole vault
      // once. If the stat is unavailable, builtAt stays 0 and one full scan
      // runs, which is still correct.
      if (parsed && typeof parsed === 'object' && !parsed.builtAt) {
        try {
          const stat = await this.app.vault.adapter.stat?.(indexPath);
          if (stat?.mtime) {
            parsed.builtAt = stat.mtime;
            parsed.version = 2;
          }
        } catch {
          // leave builtAt at 0 — forces a single full scan
        }
      }
      this._pendingCitedKeysIndex = parsed;
    } catch {
      // no persisted index yet — first build will populate it
    }

    // One-time `related` → `sw-related` bookkeeping (see related-migration.ts).
    // Kept out of data.json for the same reason as the citation index.
    try {
      const migPath = normalizePath(`${this.cacheDir}/related-migrated.json`);
      this._relatedMigration = parseMigrationState(
        await this.app.vault.adapter.read(migPath)
      );
    } catch {
      // absent or unreadable: treat every note as unmigrated
      this._relatedMigration = parseMigrationState(null);
    }

    // Migration: these settings defaulted to false in older builds due to a bug
    // (undefined was treated as false in the UI, so the toggle appeared off and
    // may have been saved as false). Since the feature was never reliably on,
    // we reset any saved false so the new default (true) takes effect.
    // Users who intentionally disable these can still do so via the settings tab.
    if (saved.enableCiteKeyCompletion === false) delete saved.enableCiteKeyCompletion;
    if (saved.showCitekeyTooltips === false) delete saved.showCitekeyTooltips;
    // formatLinkAliases is now on by default (merged into the single
    // "Process linked citations" toggle). Reset any saved false so the new
    // default (true) takes effect for existing users.
    if (saved.formatLinkAliases === false) delete saved.formatLinkAliases;

    // Migrate single pathToBibliography → bibliographyPaths array.
    if (saved.pathToBibliography && !saved.bibliographyPaths?.length) {
      saved.bibliographyPaths = [saved.pathToBibliography];
      delete saved.pathToBibliography;
    }

    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);
  }

  // Keep CiteSuggest in the right place in Obsidian's shared EditorSuggest
  // queue, based on what the user is actually typing:
  //   - "[[@..." — an unambiguous citation. MUST be at the front, or
  //     Obsidian's native link suggester (which fires on "[[") wins and the
  //     plugin never sees the trigger (native search can't show unimported
  //     references).
  //   - "[@..." — a pandoc citation. Front when prioritizeCiteKeyCompletion
  //     is on, so we win over any other plugin's "@" suggester (e.g. ZotLit).
  //   - anything else (plain "[[note", prose) — pushed to the BACK so
  //     Obsidian's native link suggest is consulted first. Keeping us at the
  //     front unconditionally made plain "[[" wikilinks slow: the native
  //     suggest only ran after our onTrigger (which returns null for non-@
  //     text), delaying its popup and resetting its query window.
  // Called on load, on setting change, and on every editor-change.
  private suggestPosition: 'front' | 'back' | null = null;

  private positionSuggest() {
    const suggests = (this.app.workspace as any).editorSuggest?.suggests as unknown[] | undefined;
    if (!Array.isArray(suggests) || !this.citeSuggest) return;
    const idx = suggests.indexOf(this.citeSuggest);
    if (idx === -1) return;

    const wantFront = this.suggestWantsFront();
    const target: 'front' | 'back' = wantFront ? 'front' : 'back';
    if (this.suggestPosition === target) return; // already positioned
    this.suggestPosition = target;

    suggests.splice(idx, 1);
    if (target === 'front') suggests.unshift(this.citeSuggest);
    else suggests.push(this.citeSuggest);
  }

  /** Does the current typing context need CiteSuggest at the front of the
   *  EditorSuggest queue? Yes for any citation trigger — `@`, `@@`, `[@`, `[[@`
   *  — past the user's minimum-characters setting. Decided by the SAME detector
   *  the trigger uses, so we never front a context we would refuse. A bare `@`
   *  outside a bracket still yields to ZotLit when prioritization is off. */
  private suggestWantsFront(): boolean {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const editor = view?.editor;
    if (!editor) return false;
    if (this.settings.enableCiteKeyCompletion === false) return false;
    const cursor = editor.getCursor();
    const line = editor.getLine(cursor.line).slice(0, cursor.ch);

    const trigger = detectCitationTrigger(line, {
      minChars: this.settings.citeSearchMinChars ?? DEFAULT_MIN_CHARS,
      allowSpaces: this.settings.citeSearchAllowSpaces !== false,
    });
    if (!trigger) return false;

    if (!trigger.isDoubleAt) {
      const beforeAt = line.substring(0, trigger.atPos);
      const inBracketCite = beforeAt.lastIndexOf('[') > beforeAt.lastIndexOf(']');
      if (!inBracketCite && this.settings.prioritizeCiteKeyCompletion === false) {
        return false;
      }
    }
    return true;
  }

  /**
   * Is the citation autocomplete popup currently open? The background
   * re-render (typing → modify → processReferences) uses this to avoid
   * dispatching a CodeMirror transaction that would prematurely dismiss it.
   */
  isCitationSuggestOpen(): boolean {
    const suggest = this.citeSuggest as unknown as
      | { isPopupOpen?: () => boolean }
      | undefined;
    return typeof suggest?.isPopupOpen === 'function'
      ? suggest.isPopupOpen() === true
      : false;
  }

  /** Apply the three decoration underline colors from settings as CSS custom
   *  properties on document.body, overriding the stylesheet defaults.
   *  Only fires when a value has been explicitly saved; unset keys leave the
   *  stylesheet default intact. */
  private applyCitationColors() {
    const { decorationColorUnlinked, decorationColorLinked, decorationColorUnimported } =
      this.settings;
    if (decorationColorUnlinked) {
      document.body.style.setProperty('--sw-citation-underline-color-unlinked', decorationColorUnlinked);
    }
    if (decorationColorLinked) {
      document.body.style.setProperty('--sw-wikilink-linked-color', decorationColorLinked);
    }
    if (decorationColorUnimported) {
      document.body.style.setProperty('--sw-wikilink-unimported-color', decorationColorUnimported);
    }
  }

  async saveSettings(cb?: () => void) {
    document.body.toggleClass(
      'sw-tooltips',
      this.settings.showCitekeyTooltips !== false
    );
    document.body.toggleClass(
      'sw-decorations',
      this.settings.showCitationDecorations ?? true
    );
    this.applyCitationColors();

    this.positionSuggest();

    // Show/hide the ZotLit-only insert command to match the import path.
    this.registerZoteroNotesCommand();

    // Refresh the reference list when settings change
    this.emitSettingsUpdate(cb);
    await this.saveData(this.settings);
  }

  /** Persist the citation index to its own file (`.scholar-weft/cited-keys.json`),
   *  so settings saves (saveData) can never clobber it. Debounced. */
  persistCitedKeysIndex = debounce(async () => {
    if (!this.bibManager.citedKeysIndexDirty) return;
    // Never write an index that hasn't been fully built (mdCount 0 means the
    // persisted index failed to load or was never built). Writing it would
    // clobber a good on-disk index with a near-empty one.
    if (this.bibManager.indexMdCount <= 0) return;
    try {
      const path = normalizePath(`${this.cacheDir}/cited-keys.json`);
      if (!(await this.app.vault.adapter.exists(normalizePath(this.cacheDir)))) {
        await this.app.vault.adapter.mkdir(normalizePath(this.cacheDir));
      }
      await this.app.vault.adapter.write(
        path,
        JSON.stringify(this.bibManager.serializeCitedKeysIndex())
      );
      this.bibManager.citedKeysIndexDirty = false;
    } catch (e) {
      console.warn('[lc] persistCitedKeysIndex: error', e);
    }
  }, 2000);

  /** Debounced flush of the persistent rendered-citation cache. */
  persistRenderedCache = debounce(async () => {
    await this.bibManager.saveRenderedCache();
  }, 3000);

  /** Throttle for the app-refocus library refresh (see onload). */
  private _lastRefocusRefreshAt = 0;
  /** Timestamp of the last time the app window was seen unfocused/hidden. */
  private _lastAwayAt = 0;

  /**
   * Refresh the Zotero library after Obsidian regains focus.
   *
   * Guarded so a refocus that could not have changed anything is a no-op:
   * Zotero only changes while the user is AWAY, so without a recorded absence
   * (an internal pane/tab switch, say) there is nothing to re-fetch. Also
   * throttled, so bouncing between the two apps doesn't pull the whole library
   * on every switch — `refreshGlobalZBib` itself guards against overlap.
   */
  private refreshOnAppRefocus(): void {
    if (this.settings.pullFromZotero === false) return;

    const away = this._lastAwayAt;
    this._lastAwayAt = 0;
    const now = Date.now();
    if (
      !shouldRefreshOnRefocus({
        hasFocus: document.hasFocus(),
        awayAt: away,
        lastRefreshAt: this._lastRefocusRefreshAt,
        now,
      })
    ) {
      return;
    }
    this._lastRefocusRefreshAt = now;
    void this.bibManager.refreshGlobalZBib().catch(console.error);
  }

  /** One-time `related` → `sw-related` bookkeeping (see related-migration.ts). */
  private _relatedMigration: RelatedMigrationState = parseMigrationState(null);

  /** Debounced persist of the migration registry (same pattern as cited-keys). */
  persistRelatedMigration = debounce(async () => {
    try {
      const dir = normalizePath(this.cacheDir);
      if (!(await this.app.vault.adapter.exists(dir))) {
        await this.app.vault.adapter.mkdir(dir);
      }
      await this.app.vault.adapter.write(
        normalizePath(`${this.cacheDir}/related-migrated.json`),
        serializeMigrationState(this._relatedMigration)
      );
    } catch (e) {
      console.warn('[sw:import] could not persist related-migration state', e);
    }
  }, 2000);

  /** Does this note still need its one-time `related` transfer? */
  shouldMigrateRelated(zoteroKey: string | null | undefined): boolean {
    return needsRelatedMigration(this._relatedMigration, zoteroKey);
  }

  /** Record a note's `related` transfer as done, and persist it. */
  markRelatedMigrationDone(zoteroKey: string | null | undefined): void {
    const next = markRelatedMigrated(this._relatedMigration, zoteroKey);
    if (next === this._relatedMigration) return;
    this._relatedMigration = next;
    this.persistRelatedMigration();
  }

  /** Debounced flush of the Zotero select-link / PDF maps. */
  persistZLinks = debounce(async () => {
    await this.bibManager.saveZLinks();
  }, 5000);

  /**
   * Bring the persisted citation index up to date at startup. This is
   * incremental: only files newer than the index's scan watermark are read
   * (plus the one-time full scan when no v2 index exists yet). Guards against
   * a transient read/parse failure leaving a near-empty index that would
   * otherwise overwrite the good one via incremental modify/create events.
   */
  async ensureCitedKeysIndex() {
    const { bibManager } = this;
    await bibManager.reconcileCitedKeysIndex();
    this.persistCitedKeysIndex();
  }

  emitSettingsUpdate = debounce(
    (cb?: () => void) => {
      if (this.initPromise.settled) {
        this.view?.contentEl.toggleClass(
          'collapsed-links',
          !!this.settings.hideLinks
        );

        cb && cb();

        this.processReferences();
      }
    },
    5000,
    true
  );

  openSnapshot(file: TFile, entries: import('./bib/types').PartialCSLEntry[]) {
    new BibSnapshotModal(this.app, this, file, entries).open();
  }

  /** Set while an automatic reconcile pass is queued. */
  private _reconcileQueued = false;

  /**
   * Queue a citekey reconcile pass after a Zotero load/refresh. Debounced and
   * coalesced so a burst of refreshes cannot show more than one dialog. The
   * pass is a cheap metadata scan and only prompts when it finds a change, so
   * the user never has to run a command.
   */
  scheduleCitekeyReconcile() {
    if (this._reconcileQueued) return;
    this._reconcileQueued = true;
    setTimeout(() => {
      this._reconcileQueued = false;
      void this.reviewCitekeyChanges(false).catch(console.error);
    }, 2000);
  }

  /**
   * Match every literature note to its Zotero item by stable `zotero-key` and,
   * when the citekey changed, offer to rename the note, its derived files
   * (transcriptions/translations), and stale citations. The note itself is the
   * record of its old name, so no rename history is consulted. Interactive runs
   * report when there is nothing to do; automatic runs stay silent.
   *
   * Returns true when a change was found (a dialog was opened).
   */
  async reviewCitekeyChanges(interactive = true): Promise<boolean> {
    // Never reconcile against a PARTIAL library: while the backend is still
    // loading, group libraries may not be in `bibCache` yet, and every note from
    // them would be reported as "not in the loaded library". The refresh path
    // schedules another pass once the load completes.
    if (this.bibManager.isBackendLoading) return false;
    let plan: CitekeyReconcilePlan;
    try {
      plan = await this.bibManager.planCitekeyReconcile();
    } catch (e) {
      console.error('[sw:reconcile] planning failed', e);
      if (interactive) new Notice('Could not check for citekey changes.');
      return false;
    }

    const actionable =
      plan.renames.length > 0 ||
      plan.derived.length > 0 ||
      plan.citeOnly.length > 0;
    if (!actionable) {
      if (interactive) {
        // Nothing to apply, but there may be notes to resolve by hand.
        if (plan.blocked.length || plan.unresolved.length) {
          new CitekeyReconcileModal(this.app, plan, async () => {}).open();
        } else {
          new Notice('All literature note citekeys are up to date.');
        }
      }
      return false;
    }

    // Once the answer is YES, apply automatically — like note auto-update, so
    // the modal is asked ONCE rather than every time a citekey changes.
    if (this.settings.autoUpdateCitekeys === true) {
      await this.applyReconcile(plan);
      return true;
    }
    if (this.settings.autoUpdateCitekeys === false) {
      return false;
    }

    // autoUpdateCitekeys is UNSET: ask before the first rename. A "Skip" here
    // turns it off for good; dismissing leaves it unset so we ask again.
    const { CitekeyConsentModal } = await import('./modals/citekeyConsentModal');
    const answer = await new Promise<'yes' | 'no' | 'ask'>((resolve) =>
      new CitekeyConsentModal(this.app, resolve).open()
    );
    if (answer === 'ask') return false;
    this.settings.autoUpdateCitekeys = answer === 'yes';
    await this.saveSettings();
    if (answer === 'no') return false;
    await this.applyReconcile(plan);
    return true;
  }

  /**
   * Command: report every citekey discrepancy — pending renames, notes that
   * cannot be renamed because the name is taken, and notes whose `zotero-key`
   * is not in the current library — so the user knows where to go, without
   * applying anything.
   */
  async listCitekeyDiscrepancies(): Promise<void> {
    let plan: CitekeyReconcilePlan;
    try {
      plan = await this.bibManager.planCitekeyReconcile();
    } catch (e) {
      console.error('[sw:reconcile] planning failed', e);
      new Notice('Could not list citekey discrepancies.');
      return;
    }

    if (
      !plan.renames.length &&
      !plan.citeOnly.length &&
      !plan.derived.length &&
      !plan.blocked.length &&
      !plan.unresolved.length
    ) {
      new Notice('No citekey discrepancies found.');
      return;
    }

    new CitekeyReconcileModal(this.app, plan, () => this.applyReconcile(plan)).open();
  }

  /** Apply a reconcile plan and report what changed. */
  private async applyReconcile(plan: CitekeyReconcilePlan): Promise<void> {
    const res = await this.bibManager.applyCitekeyReconcile(plan);

    // Re-render our own notes so annotations and excerpt images
    // (`@<key>_p…_<annotationKey>.png`) follow the new citekey.
    let refreshed = 0;
    if (this.settings.useOwnNoteTemplate === true) {
      for (const r of plan.renames) {
        const file = this.app.vault.getAbstractFileByPath(r.newPath);
        if (
          file instanceof TFile &&
          (await this.updateLiteratureNote(file, { confirm: false }))
        ) {
          refreshed++;
        }
      }
    }

    const parts: string[] = [];
    if (res.notesRenamed) {
      parts.push(
        `Updated ${res.notesRenamed} literature note${res.notesRenamed !== 1 ? 's' : ''}`
      );
    }
    if (res.derivedRenamed) {
      parts.push(
        `renamed ${res.derivedRenamed} associated file${res.derivedRenamed !== 1 ? 's' : ''}`
      );
    }
    if (res.citeOnlyRewritten) {
      parts.push(
        `updated ${res.citeOnlyRewritten} cite-only key${res.citeOnlyRewritten !== 1 ? 's' : ''} (no literature note)`
      );
    }
    if (res.filesWithCitations) {
      parts.push(
        `citations updated in ${res.filesWithCitations} file${res.filesWithCitations !== 1 ? 's' : ''}`
      );
    }
    let msg = parts.length ? parts.join('; ') : 'No citekey changes applied';
    if (refreshed) msg += `; refreshed ${refreshed}`;
    if (res.skipped.length) {
      msg += `\nSkipped ${res.skipped.length} name${res.skipped.length !== 1 ? 's' : ''} already in use.`;
    }
    new Notice(msg + '.', 8000);
  }

  /**
   * Open a modal for the unresolved-citation badge in the reference panel.
   *
   * A citekey changed in Zotero is the usual cause: the note still carries the
   * old name, so `[[@old]]` looks unresolved. Try the stable-key reconcile
   * first; when that finds nothing, list the keys that have no known
   * replacement.
   */
  async showUnresolvedCitekeyDialog(file: TFile) {
    const fileCache = this.bibManager.fileCache.get(file);
    if (!fileCache || !fileCache.unresolvedKeys.size) {
      new Notice('No unresolved citations in the current note.');
      return;
    }

    if (await this.reviewCitekeyChanges(false)) return;

    new CitekeyRenameModal(
      this.app,
      new Map(),
      async () => {},
      false,
      [...fileCache.unresolvedKeys]
    ).open();
  }

  processReferences = async () => {
    const run = ++this.processReferencesRun;
    const isCurrent = () => run === this.processReferencesRun;
    const { settings, view } = this;
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    const scopedSettings = activeView
      ? getScopedSettings(activeView.file)
      : null;

    if (
      !settings.bibliographyPaths?.length &&
      !settings.pullFromZotero &&
      !scopedSettings?.bibliography?.length
    ) {
      return view?.setMessage(
        t(
          'Please provide the path to your bibliography file in the ScholarWeft plugin settings.'
        )
      );
    }

    if (activeView) {
      try {
        const fileContent = await this.app.vault.cachedRead(activeView.file);
        if (!isCurrent()) return;
        const bib = await this.bibManager.getReferenceList(
          activeView.file,
          fileContent,
          isCurrent
        );
        if (!isCurrent()) return;
        const cache = this.bibManager.fileCache.get(activeView.file);

        // Only warn about Zotero being unreachable when there is no .bib
        // fallback and some keys are genuinely unresolved.
        if (
          !bib &&
          settings.pullFromZotero &&
          !settings.bibliographyPaths?.length &&
          !(await this.bibManager.isZoteroAvailable()) &&
          isCurrent() &&
          cache?.keys.size
        ) {
          view?.setMessage(t('Cannot connect to Zotero'));
        } else {
          view?.setViewContent(bib);
        }
      } catch (e) {
        console.error(e);
        view?.setMessage((e as Error).message);
      }
    } else {
      view?.setNoContentMessage();
    }
  };
}

/** Modal that lets the user choose a filename and location for the snapshot,
 *  then writes the CSL-JSON file and wires it into the note's frontmatter. */
class BibSnapshotModal extends Modal {
  private plugin: ReferenceList;
  private file: TFile;
  private entries: import('./bib/types').PartialCSLEntry[];

  constructor(
    app: import('obsidian').App,
    plugin: ReferenceList,
    file: TFile,
    entries: import('./bib/types').PartialCSLEntry[]
  ) {
    super(app);
    this.plugin = plugin;
    this.file = file;
    this.entries = entries;
  }

  onOpen() {
    const { contentEl } = this;
    setModalTitle(this, t('Save Bibliography Snapshot'));
    contentEl.createEl('p', {
      text: `${this.entries.length} entries will be saved as a .bib file. The file path will be added to this note's frontmatter "bibliography" key.`,
    });

    const folder = this.file.parent?.path ?? '';
    const stem = this.file.basename;
    const defaultPath = normalizePath(
      (folder ? folder + '/' : '') + stem + '-bibliography.bib'
    );

    const inputWrap = contentEl.createDiv({ cls: 'sw-snapshot-input-wrap' });
    inputWrap.createEl('label', { text: t('Save as') });
    const input = inputWrap.createEl('input', {
      type: 'text',
      value: defaultPath,
      cls: 'sw-snapshot-input',
    });
    input.style.width = '100%';

    const btnRow = contentEl.createDiv({ cls: 'sw-snapshot-btn-row' });
    btnRow.style.display = 'flex';
    btnRow.style.justifyContent = 'flex-end';
    btnRow.style.gap = '8px';
    btnRow.style.marginTop = '12px';

    const cancelBtn = btnRow.createEl('button', { text: t('Cancel') });
    cancelBtn.addEventListener('click', () => this.close());

    const saveBtn = btnRow.createEl('button', {
      text: t('Save'),
      cls: 'mod-cta',
    });
    saveBtn.addEventListener('click', () => this.doSave(input.value.trim()));

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.doSave(input.value.trim());
      if (e.key === 'Escape') this.close();
    });

    setTimeout(() => { input.select(); }, 50);
  }

  private async doSave(rawPath: string) {
    if (!rawPath) return;
    const savePath = normalizePath(rawPath);

    try {
      // Ensure parent directory exists.
      const dir = savePath.includes('/')
        ? savePath.substring(0, savePath.lastIndexOf('/'))
        : '';
      if (dir && !(await this.app.vault.adapter.exists(dir))) {
        await this.app.vault.adapter.mkdir(dir);
      }

      // Serialize to BibTeX and write.
      await this.app.vault.adapter.write(savePath, cslToBibTeX(this.entries));

      // Compute vault-relative path for the frontmatter link.
      const noteDir = this.file.parent?.path ?? '';
      const relPath = noteDir
        ? normalizePath(savePath).replace(normalizePath(noteDir) + '/', '')
        : savePath;

      // Add path to the note's bibliography frontmatter key.
      // Pandoc and other tools read this; the plugin uses it for colour comparison.
      await this.app.fileManager.processFrontMatter(this.file, (fm) => {
        const existing: string[] = Array.isArray(fm.bibliography)
          ? fm.bibliography
          : fm.bibliography ? [fm.bibliography] : [];
        if (!existing.includes(relPath) && !existing.includes(savePath)) {
          existing.push(relPath);
        }
        fm.bibliography = existing.length === 1 ? existing[0] : existing;
      });

      new Notice(`Bibliography saved to ${savePath}`);
      this.plugin.bibManager.reinit(true);
      this.close();
    } catch (e) {
      new Notice(`Failed to save bibliography: ${(e as Error).message}`);
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}
