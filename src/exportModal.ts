import { App, Modal, Notice, Platform, TFile } from 'obsidian';
import type ReferenceList from './main';
import type { StyleMapping } from './settings';
import { runDocumentCompiler } from './exportCompiler';
import { probeTools } from './tools';
import type { ToolProbe } from './tools';
import { DEPENDENCIES, renderDependencyNote } from './dependencies';
import type { DepKey } from './dependencies';
import {
  listZoteroInstalledStyles,
  resolveZoteroStylePath,
} from './settings/ZoteroStylePicker';

export type ExportFormat = 'md' | 'docx' | 'odt' | 'latex' | 'pdf';
export type DocType = 'book' | 'article' | 'custom';

export interface ExportOptions {
  format: ExportFormat;
  docType: DocType;
  /** Template filename (with extension, e.g. "book.docx"). Empty = no template. */
  template: string;
  toc: boolean;
  /** Deepest heading level the TOC shows (1 = chapters, 2 = chapters + sections). */
  tocLevels: number;
  /** true = include a table of figures (only rendered when the doc has figures). */
  tof: boolean;
  /** Levels to auto-number (0 = only @@-marked headings; 1 = chapters; 2 = chapters + sections). */
  numberingLevels: number;
  /** How notes render: 'none' footnotes, 'native' word-processor endnotes
   *  (DOCX/ODT) or a Notes section (Markdown/LaTeX), 'body' a Notes section
   *  divided by chapter. Set by the note's `endnotes` property. */
  endnotes: 'none' | 'native' | 'body';
  /** true = include a bibliography. When true, it is emitted whenever there
   *  are references; when false, only author-date citations keep it. Set by
   *  the note's `include-bibliography` property (default true). */
  includeBibliography: boolean;
  /** true = restart footnote AND figure numbering at each top-level heading (Figure C.N); false = continuous (Figure N). */
  restartFootnotes: boolean;
  /** true = each top-level heading starts on a new page. */
  newPageHeadings: boolean;
  /** true = insert today's date on the cover when the note has no `date:` property. */
  generatedDate: boolean;
  /** true = roman-numeral frontmatter page numbers, switching to arabic at the reset heading. */
  romanFrontmatter: boolean;
  /** Heading text that begins arabic 'page 1'. '' = auto (first Introduction / numbered chapter). */
  romanStart: string;
  /** Absolute or vault-relative output folder; '' = same folder as source. */
  outputDir: string;
  /** Desired output filename (basename + extension). */
  outputFilename: string;
  /** PDF only: keep the intermediate docx/odt/tex after conversion. */
  keepIntermediate: boolean;
  /** Non-md formats only: keep the compiled markdown instead of deleting it
   *  once the export is done. */
  keepIntermediateMd: boolean;
  /** Non-md exports only: when a compiled markdown already exists for this
   *  note, export from it instead of recompiling. Not persisted — a one-off
   *  choice for this export. */
  skipRecompile?: boolean;
  /** Absolute path of the existing compiled markdown to reuse (set with
   *  skipRecompile). */
  compiledMdPath?: string;
  /** IDs of StyleMappings enabled for this export (subset of settings.styleMappings). */
  enabledMappingIds: string[];
  /** true = apply `cslStyle`, overriding the template's own citation style;
   *  false = use the template's style (or the global default). */
  overrideCslStyle: boolean;
  /** Style applied when overrideCslStyle is true: a Zotero style name, a
   *  .csl path, or a URL. */
  cslStyle: string;
  /** Set at run time when the user proceeds without Zotero: DOCX/ODT leave
   *  citations as literal text instead of live Zotero fields. */
  rawCitations?: boolean;
  /** Set at run time when Zotero is unavailable: a CSL-JSON file (the loaded
   *  library) to render citations statically from. DOCX/ODT only. */
  staticBibliography?: string;
}

/** Per-file export history stored in plugin settings. */
interface FileExportHistory {
  format: ExportFormat;
  docType: DocType;
  template: string;
  toc: boolean;
  tocLevels?: number;
  tof: boolean;
  numberingLevels?: number;
  endnotes?: 'none' | 'native' | 'body';
  includeBibliography?: boolean;
  restartFootnotes: boolean;
  newPageHeadings: boolean;
  generatedDate: boolean;
  romanFrontmatter: boolean;
  romanStart: string;
  outputDir: string;
  outputFilename: string;
  keepIntermediate: boolean;
  keepIntermediateMd: boolean;
  enabledMappingIds: string[];
  overrideCslStyle?: boolean;
  cslStyle?: string;
  /** Raw YAML values of the property-backed options as they were when this
   *  file was last exported. On reopen, a property whose CURRENT YAML differs
   *  from its recorded value is a deliberate edit, so the new YAML wins over
   *  the last-used value (see changedYaml). */
  yamlObserved?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * List template filenames (WITH extension) from a directory that match the
 * given format, or [] on any error.
 *
 * format 'docx'  → only .docx files
 * format 'odt'   → only .odt files
 * format 'latex' → only .tex files
 * format 'pdf'   → all three (template is for the intermediate docx/odt/tex)
 * format 'md'    → all three (unlikely to be used, but show all)
 */
function listTemplates(dir: string, format: ExportFormat): string[] {
  try {
    const fs = require('fs') as typeof import('fs');
    if (!fs.existsSync(dir)) return [];
    const exts =
      format === 'docx'  ? ['.docx'] :
      format === 'odt'   ? ['.odt']  :
      format === 'latex' ? ['.tex']  :
      ['.docx', '.odt', '.tex']; // pdf, md — show all
    return (fs.readdirSync(dir) as string[])
      .filter((f) => exts.some((ext) => f.toLowerCase().endsWith(ext)))
      .sort();
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

/**
 * Modal for the "Compile / export document" command.
 *
 * Format selector comes first so the user knows which format they're targeting
 * before choosing a template.  Template list is filtered to show only files
 * whose extension matches the selected format (.docx for DOCX, .odt for ODT,
 * .tex for LaTeX, all three for MD/PDF).  Template filenames include their
 * extension so the user can tell them apart at a glance.  The template
 * selector is disabled for MD output since that mode compiles to markdown
 * only and uses no template.
 */
/** Built-in defaults for the three per-note export properties. */
const DEFAULT_NUMBERING_LEVELS = 0;
const DEFAULT_TOC_LEVELS = 2;
const DEFAULT_ENDNOTES: 'none' | 'native' | 'body' = 'none';
const DEFAULT_BIBLIOGRAPHY = true;
/** Highest heading level offered by the numbering / TOC-depth inputs. */
const MAX_LEVEL = 6;
/** Label for the per-chapter footnote/figure restart checkbox. */
const FOOTNOTE_RESTART_LABEL =
  'Restart footnote and figure numbering per chapter';
/** Shown when the restart option can't take effect (ODT native endnotes). */
const FOOTNOTE_RESTART_ODT_NOTE =
  ' (not available for ODT exports with native word-processor endnotes)';

type ZoteroChoice = 'retry' | 'proceed' | 'cancel';

/** Shown when Zotero is not running and the document cites works that can't
 *  be resolved from bibliography files. */
class ZoteroWarningModal extends Modal {
  constructor(
    app: App,
    private needCount: number,
    private liveFields: boolean,
    private decide: (choice: ZoteroChoice) => void
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h3', { text: 'Zotero is not running' });
    const n = this.needCount;
    const message = this.liveFields
      ? 'This export creates live Zotero citation fields, so it needs Zotero ' +
        'while exporting. Start Zotero and try again, or proceed — the ' +
        'citations are then written out as static plain text instead.'
      : `${n} citation${n === 1 ? '' : 's'} in this document can't be resolved ` +
        `from your bibliography files and need Zotero. Start Zotero and try ` +
        `again, or proceed.`;
    contentEl.createEl('p', { text: message });
    const row = contentEl.createDiv();
    row.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:14px';
    const cancel = row.createEl('button', { text: 'Cancel' });
    const proceed = row.createEl('button', { text: 'Proceed without Zotero' });
    const retry = row.createEl('button', {
      text: 'Try connecting again',
      cls: 'mod-cta',
    });
    cancel.onclick = () => { this.close(); this.decide('cancel'); };
    proceed.onclick = () => { this.close(); this.decide('proceed'); };
    retry.onclick = () => { this.close(); this.decide('retry'); };
  }

  onClose() {
    this.contentEl.empty();
  }
}

function askZotero(
  app: App,
  needCount: number,
  liveFields: boolean
): Promise<ZoteroChoice> {
  return new Promise((resolve) =>
    new ZoteroWarningModal(app, needCount, liveFields, resolve).open()
  );
}

export class ExportModal extends Modal {
  private plugin: ReferenceList;
  private file: TFile;

  private templateSelect!: HTMLSelectElement;
  private formatSelect!: HTMLSelectElement;
  private filenameInput!: HTMLInputElement;
  private outputDirInput!: HTMLInputElement;
  private sameSourceCb!: HTMLInputElement;
  private docTypeBook!: HTMLInputElement;
  private docTypeArticle!: HTMLInputElement;
  private docTypeCustom!: HTMLInputElement;
  private tocCb!: HTMLInputElement;
  private tocLevelsInput!: HTMLInputElement;
  private tocLevelsRow!: HTMLElement;
  private tofCb!: HTMLInputElement;
  private numberingLevelsInput!: HTMLInputElement;
  private notesModeFootnotes!: HTMLInputElement;
  private notesModeNative!: HTMLInputElement;
  private notesModeBody!: HTMLInputElement;
  private notesModeBodyRow!: HTMLElement;
  private bibliographyCb!: HTMLInputElement;
  private footnotesCb!: HTMLInputElement;
  private footnotesLabel!: HTMLElement;
  private newPageCb!: HTMLInputElement;
  private generatedDateCb!: HTMLInputElement;
  private romanFrontmatterCb!: HTMLInputElement;
  private romanStartRow!: HTMLElement;
  private romanStartInput!: HTMLInputElement;
  private keepIntermediateCb!: HTMLInputElement;
  private pdfNote!: HTMLElement;
  private keepIntermediateRow!: HTMLElement;
  private keepIntermediateMdCb!: HTMLInputElement;
  private keepIntermediateMdRow!: HTMLElement;
  private skipRecompileCb!: HTMLInputElement;
  private skipRecompileRow!: HTMLElement;
  private cslOverrideCb!: HTMLInputElement;
  private cslStyleRow!: HTMLElement;
  private cslStyleSelect!: HTMLSelectElement;
  private cslStyleInput!: HTMLInputElement;
  private cslStyleHasList = false;
  /** Map from StyleMapping.id → checkbox, for reading enabled state in options(). */
  private mappingCheckboxes: Map<string, HTMLInputElement> = new Map();
  private runButton!: HTMLButtonElement;
  private probe: ToolProbe | null = null;
  private depNote!: HTMLElement;

  /** Absolute paths to template directories (set in onOpen, used when rebuilding). */
  private pluginTplDir = '';
  private userTplDir = '';

  constructor(app: App, plugin: ReferenceList, file: TFile) {
    super(app);
    this.plugin = plugin;
    this.file = file;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('lc-export-modal');
    contentEl.createEl('h3', { text: 'Compile / export document' });

    const adapter = this.plugin.app.vault.adapter as any;
    const vaultBase: string =
      typeof adapter?.getBasePath === 'function' ? adapter.getBasePath() : '';

    // Absolute path of the note's containing folder — used as the fallback
    // output directory when no previous export directory has been saved.
    const noteFolder: string =
      vaultBase && this.file.parent && this.file.parent.path !== '/'
        ? `${vaultBase}/${this.file.parent.path}`
        : vaultBase;

    // Resolve template directories once; stored for rebuilding on format change.
    this.pluginTplDir =
      vaultBase && this.plugin.manifest.dir
        ? `${vaultBase}/${this.plugin.manifest.dir}/sw-export-templates`
        : '';
    const userTplDirRaw =
      this.plugin.settings.exportTemplatesDir || 'Export Templates';
    this.userTplDir =
      userTplDirRaw.startsWith('/') || userTplDirRaw.startsWith('~')
        ? userTplDirRaw
        : vaultBase
        ? `${vaultBase}/${userTplDirRaw}`
        : '';

    // ── Format selector (FIRST) ───────────────────────────────────────────
    const fmtWrap = contentEl.createDiv({ cls: 'lc-export-row' });
    fmtWrap.createEl('label', { text: 'Output format' });
    this.formatSelect = fmtWrap.createEl('select', {
      cls: 'lc-export-format-select',
    });
    this.formatSelect.style.cssText = 'width:100%;margin-top:4px';
    const formats: { value: ExportFormat; label: string }[] = [
      { value: 'md',    label: 'Compiled Markdown only (no export)' },
      { value: 'docx',  label: 'Word document (.docx)' },
      { value: 'odt',   label: 'LibreOffice document (.odt)' },
      { value: 'latex', label: 'LaTeX (.tex)' },
      { value: 'pdf',   label: 'PDF (via ODT, DOCX, or LaTeX)' },
    ];
    for (const { value, label } of formats) {
      const opt = this.formatSelect.createEl('option', { text: label });
      opt.value = value;
    }
    // Default to last used; when no history, use docx if a frontmatter template
    // is set, otherwise md.
    const fmTpl = this.templateFromFrontmatter();
    // Per-file history takes priority over global last-used settings.
    const fileHistory = this.getFileHistory();
    const lastFmt = this.plugin.settings.lastExportFormat;
    this.formatSelect.value = fileHistory?.format ?? lastFmt ?? (fmTpl ? 'docx' : 'md');

    this.pdfNote = fmtWrap.createEl('p', {
      text: 'PDF export requires either LibreOffice (for an ODT/DOCX template) '
        + 'or a LaTeX distribution with LuaLaTeX (for a .tex template) to be '
        + 'installed. An ODT template generally produces better results than '
        + 'DOCX for PDF (footnote numbering, figure references).',
      cls: 'lc-mapping-modal-note',
    });
    this.pdfNote.style.marginTop = '4px';

    // Requirement / missing-tool note, filled in by applyToolGating().
    this.depNote = contentEl.createDiv({ cls: 'lc-export-depnote' });

    // ── Template dropdown (SECOND, filtered by format) ────────────────────
    const tplWrap = contentEl.createDiv({ cls: 'lc-export-row' });
    tplWrap.style.marginTop = '10px';
    tplWrap.createEl('label', { text: 'Template' });
    this.templateSelect = tplWrap.createEl('select', {
      cls: 'lc-export-template-select',
    });
    this.templateSelect.style.cssText = 'width:100%;margin-top:4px';

    // Populate for the initially-selected format.
    // Priority: per-file history > last-used global > YAML frontmatter.
    // templateSwitched only applies when there is no file history AND the
    // note's frontmatter template differs from the globally last-used one.
    const lastTpl = fileHistory?.template ??
      (this.plugin.settings as any).lastTemplate ?? '';
    const lastTplStem = lastTpl.replace(/\.(docx|odt|tex)$/i, '');
    const templateSwitched = !fileHistory && !!fmTpl && fmTpl !== lastTplStem;
    this.buildTemplateDropdown(
      this.formatSelect.value as ExportFormat,
      fileHistory ? lastTpl : (templateSwitched ? fmTpl : (lastTpl || fmTpl)),
    );

    // ── Document type radio ───────────────────────────────────────────────
    const dtWrap = contentEl.createDiv({ cls: 'lc-export-row' });
    dtWrap.style.marginTop = '10px';
    dtWrap.createEl('label', { text: 'Document type' });
    const dtRow = dtWrap.createDiv();
    dtRow.style.cssText = 'display:flex;gap:16px;margin-top:4px';
    const makeRadio = (value: string, label: string): HTMLInputElement => {
      const wrap = dtRow.createDiv();
      wrap.style.cssText = 'display:flex;align-items:center;gap:4px';
      const r = wrap.createEl('input', { type: 'radio' });
      r.name = 'lc-doc-type';
      r.value = value;
      r.id = `lc-dt-${value}`;
      const lbl = wrap.createEl('label', { text: label });
      lbl.htmlFor = r.id;
      return r;
    };
    this.docTypeBook    = makeRadio('book',    'Book');
    this.docTypeArticle = makeRadio('article', 'Article');
    this.docTypeCustom  = makeRadio('custom',  'Custom');

    // ── Output filename ───────────────────────────────────────────────────
    const fnWrap = contentEl.createDiv({ cls: 'lc-export-row' });
    fnWrap.style.marginTop = '10px';
    fnWrap.createEl('label', { text: 'Output filename' });
    this.filenameInput = fnWrap.createEl('input', {
      type: 'text',
      cls: 'lc-export-filename-input',
    });
    this.filenameInput.style.cssText = 'width:100%;margin-top:4px';
    this.refreshFilename(); // sets initial value

    // ── Output directory ──────────────────────────────────────────────────
    const outWrap = contentEl.createDiv({ cls: 'lc-export-row' });
    outWrap.style.cssText =
      'margin-top:10px;display:flex;gap:6px;align-items:flex-end';
    const outLeft = outWrap.createDiv();
    outLeft.style.flex = '1';
    outLeft.createEl('label', { text: 'Output directory' });
    // Default: last-used directory; fall back to the current note's folder.
    const initialOutputDir =
      fileHistory?.outputDir ?? (this.plugin.settings as any).lastOutputDir ?? noteFolder;
    this.outputDirInput = outLeft.createEl('input', {
      type: 'text',
      value: initialOutputDir,
      placeholder: '(same folder as source)',
      cls: 'lc-export-outdir-input',
    });
    this.outputDirInput.style.cssText = 'width:100%;margin-top:4px';
    const chooseBtn = outWrap.createEl('button', { text: 'Choose…' });
    chooseBtn.style.cssText = 'white-space:nowrap;flex-shrink:0';
    chooseBtn.addEventListener('click', () => this.pickOutputDir());

    // "Same folder as source" checkbox — checked when the dir box is empty,
    // clears the box (→ same-as-source) when checked, unchecked on any edit.
    const sameSourceRow = contentEl.createDiv({ cls: 'lc-export-check-row' });
    sameSourceRow.style.marginTop = '4px';
    this.sameSourceCb = sameSourceRow.createEl('input', { type: 'checkbox' });
    this.sameSourceCb.id = 'lc-export-same-source';
    this.sameSourceCb.checked = !this.outputDirInput.value.trim();
    const sameSourceLbl = sameSourceRow.createEl('label', {
      text: 'Use same folder as source file',
    });
    sameSourceLbl.htmlFor = 'lc-export-same-source';
    this.sameSourceCb.addEventListener('change', () => {
      if (this.sameSourceCb.checked) {
        this.outputDirInput.value = '';
      }
      this.updateSkipRecompileRow();
    });
    this.outputDirInput.addEventListener('input', () => {
      this.sameSourceCb.checked = false;
      this.updateSkipRecompileRow();
    });

    // ── Checkboxes ────────────────────────────────────────────────────────
    const checksWrap = contentEl.createDiv({ cls: 'lc-export-checks' });
    checksWrap.style.marginTop = '12px';

    const makeCheckRow = (
      id: string,
      labelText: string
    ): HTMLInputElement => {
      const row = checksWrap.createDiv({ cls: 'lc-export-check-row' });
      const cb = row.createEl('input', { type: 'checkbox' });
      cb.id = id;
      const lbl = row.createEl('label', { text: labelText });
      lbl.htmlFor = id;
      return cb;
    };

    this.tocCb = makeCheckRow('lc-export-toc', 'Include table of contents (TOC)');
    this.tocLevelsRow = checksWrap.createDiv({ cls: 'lc-export-check-row' });
    this.tocLevelsRow.style.cssText = 'margin-left:22px';
    this.tocLevelsRow.createEl('label', {
      text: 'TOC depth (1 = chapters, 2 = chapters + sections):',
    });
    this.tocLevelsInput = this.tocLevelsRow.createEl('input', { type: 'number' });
    this.tocLevelsInput.style.cssText = 'width:56px;margin-left:6px';
    this.tocLevelsInput.min = '1';
    this.tocLevelsInput.max = String(MAX_LEVEL);

    this.tofCb = makeCheckRow('lc-export-tof', 'Include table of figures');

    // Auto-number headings by outline level (0 = only @@-marked headings).
    const numRow = checksWrap.createDiv({ cls: 'lc-export-check-row' });
    numRow.createEl('label', {
      text: 'Auto-number headings down to level (0 = only @@):',
    });
    this.numberingLevelsInput = numRow.createEl('input', { type: 'number' });
    this.numberingLevelsInput.style.cssText = 'width:56px;margin-left:6px';
    this.numberingLevelsInput.min = '0';
    this.numberingLevelsInput.max = String(MAX_LEVEL);

    // Notes rendering: footnotes (default) / native endnotes / body Notes
    // section divided by chapter. Native + body endnotes only differ for
    // DOCX/ODT with per-chapter numbering; body is otherwise greyed out.
    const notesLabel = checksWrap.createEl('label', { text: 'Notes' });
    notesLabel.style.cssText = 'display:block;margin-top:4px;font-weight:600';
    const notesRow = checksWrap.createDiv();
    // The radio→label gap is the radio's own margin-right (a flex `gap` was
    // applied inconsistently across the three rows), and a small margin-bottom
    // separates the stacked options.
    notesRow.style.cssText = 'display:block;margin:2px 0 6px 4px';
    const makeNotesRadio = (
      value: 'none' | 'native' | 'body',
      label: string
    ): { row: HTMLElement; cb: HTMLInputElement } => {
      const row = notesRow.createDiv();
      row.style.cssText = 'margin:0 0 4px 0;line-height:1.4';
      const cb = row.createEl('input', { type: 'radio' });
      cb.name = 'lc-notes-mode';
      cb.value = value;
      cb.id = `lc-notes-${value}`;
      cb.style.cssText = 'margin:0 8px 0 0;vertical-align:middle';
      const lbl = row.createEl('label', { text: label });
      lbl.htmlFor = cb.id;
      lbl.style.cssText = 'margin:0;padding:0;line-height:1.4';
      return { row, cb };
    };
    this.notesModeFootnotes = makeNotesRadio(
      'none', 'Footnotes (page-bottom)').cb;
    this.notesModeNative = makeNotesRadio(
      'native', 'Endnotes (native word-processor formatting)').cb;
    const _body = makeNotesRadio(
      'body', 'Endnotes (as body paragraphs in the Notes section)');
    this.notesModeBody = _body.cb;
    this.notesModeBodyRow = _body.row;

    this.bibliographyCb = makeCheckRow(
      'lc-export-bibl',
      'Include a bibliography (keeps it with a note/footnote citation style)'
    );
    this.bibliographyCb.title =
      'On: emit whenever the document has references. Off: keep it only for '
      + 'author-date citations (a note/footnote style omits it). Always omitted '
      + 'when there are no references.';

    // Non-persisted: reuse an already compiled markdown instead of recompiling.
    // Shown only when such a file exists for the current output folder.
    this.skipRecompileRow = checksWrap.createDiv({ cls: 'lc-export-check-row' });
    this.skipRecompileRow.style.marginTop = '4px';
    this.skipRecompileCb = this.skipRecompileRow.createEl('input', {
      type: 'checkbox',
    });
    this.skipRecompileCb.id = 'lc-export-skip-recompile';
    const skipLbl = this.skipRecompileRow.createEl('label', {
      text: 'Skip recompilation and use the already compiled markdown',
    });
    skipLbl.htmlFor = 'lc-export-skip-recompile';
    this.skipRecompileCb.title =
      'A compiled markdown already exists for this note. Check to export from '
      + 'it instead of recompiling (useful for making several formats from one '
      + 'compile). Not remembered between exports.';

    this.footnotesCb = makeCheckRow(
      'lc-export-fn',
      FOOTNOTE_RESTART_LABEL
    );
    this.footnotesLabel = this.footnotesCb.nextElementSibling as HTMLElement;
    this.generatedDateCb = makeCheckRow(
      'lc-export-gendate',
      "Use today's date if the note has no date property"
    );
    this.generatedDateCb.checked = true;
    this.newPageCb = makeCheckRow(
      'lc-export-np',
      'Top-level headings start on a new page'
    );

    this.romanFrontmatterCb = makeCheckRow(
      'lc-export-roman',
      'Roman-numeral frontmatter page numbering'
    );
    this.romanStartRow = checksWrap.createDiv({ cls: 'lc-export-check-row' });
    this.romanStartRow.style.cssText = 'margin-left:22px';
    this.romanStartInput = this.romanStartRow.createEl('input', {
      type: 'text',
      placeholder: 'Page 1 starts with (default: Introduction or Chapter 1)',
    });
    this.romanStartInput.style.cssText = 'width:100%';
    this.romanFrontmatterCb.addEventListener('change', () => {
      this.romanStartRow.style.display = this.romanFrontmatterCb.checked ? '' : 'none';
    });

    // ── PDF-specific: keep the intermediate ODT/DOCX (hidden unless format
    //    = pdf). The intermediate format itself is not a choice — it's
    //    whatever format the chosen template is.
    this.keepIntermediateRow = checksWrap.createDiv({ cls: 'lc-export-check-row' });
    this.keepIntermediateCb = this.keepIntermediateRow.createEl('input', { type: 'checkbox' });
    this.keepIntermediateCb.id = 'lc-export-keep-inter';
    const keepInterLbl = this.keepIntermediateRow.createEl('label', {
      text: 'Keep intermediate file (ODT/DOCX/LaTeX)',
    });
    keepInterLbl.htmlFor = 'lc-export-keep-inter';
    this.keepIntermediateCb.checked = fileHistory?.keepIntermediate ?? false;

    // ── Keep the compiled markdown (hidden when format = md — there it IS
    //    the output, not an intermediate) ─────────────────────────────────
    this.keepIntermediateMdRow = checksWrap.createDiv({ cls: 'lc-export-check-row' });
    this.keepIntermediateMdCb = this.keepIntermediateMdRow.createEl('input', { type: 'checkbox' });
    this.keepIntermediateMdCb.id = 'lc-export-keep-inter-md';
    const keepInterMdLbl = this.keepIntermediateMdRow.createEl('label', {
      text: 'Keep intermediate compiled markdown',
    });
    keepInterMdLbl.htmlFor = 'lc-export-keep-inter-md';
    this.keepIntermediateMdCb.checked = fileHistory?.keepIntermediateMd ?? false;

    // ── Citation style override ─────────────────────────────────────────
    this.buildCslStyleSection(checksWrap, fileHistory);

    // ── Style mappings (collapsible, only when mappings exist) ───────────
    this.buildMappingsSection(contentEl, fileHistory?.enabledMappingIds);

    // Initialise document-type radio and checkboxes from file history or
    // template defaults.  templateSwitched drives the fallback when there
    // is no file-level history for this note.
    this.applyDocSettings(templateSwitched);
    // And reflect whether the initial format requires the template select.
    this.syncFormatState(this.formatSelect.value as ExportFormat);

    // ── Event wiring ──────────────────────────────────────────────────────
    this.formatSelect.addEventListener('change', () => {
      const fmt = this.formatSelect.value as ExportFormat;
      const prevTpl = this.templateSelect.value;
      this.buildTemplateDropdown(fmt, prevTpl);
      this.applyDocSettings();
      this.refreshFilename();
      this.syncFormatState(fmt);
      this.updateSkipRecompileRow();
    });
    this.templateSelect.addEventListener('change', () =>
      this.applyDocSettings()
    );
    // Radio → preset checkboxes; checkboxes → auto-switch to Custom.
    [this.docTypeBook, this.docTypeArticle, this.docTypeCustom].forEach(r => {
      r.addEventListener('change', () => {
        if (r.checked) this.applyDocTypePreset(r.value as DocType);
      });
    });
    [this.tocCb, this.tofCb, this.footnotesCb, this.newPageCb, this.generatedDateCb,
     this.romanFrontmatterCb].forEach(cb => {
      cb.addEventListener('change', () => {
        this.docTypeBook.checked    = false;
        this.docTypeArticle.checked = false;
        this.docTypeCustom.checked  = true;
      });
    });
    [this.notesModeFootnotes, this.notesModeNative, this.notesModeBody]
      .forEach(r => {
        r.addEventListener('change', () => {
          this.docTypeBook.checked    = false;
          this.docTypeArticle.checked = false;
          this.docTypeCustom.checked  = true;
          this.syncFormatState(this.formatSelect.value as ExportFormat);
        });
      });
    [this.tocLevelsInput, this.numberingLevelsInput].forEach(inp => {
      inp.addEventListener('change', () => {
        this.docTypeBook.checked    = false;
        this.docTypeArticle.checked = false;
        this.docTypeCustom.checked  = true;
      });
    });
    // Keep the TOC-depth row visible only while a TOC is requested.
    this.tocCb.addEventListener('change', () => {
      this.tocLevelsRow.style.display =
        this.tocCb.disabled || !this.tocCb.checked ? 'none' : '';
    });
    // The "body" endnote option requires per-chapter (discontinuous) numbering.
    this.footnotesCb.addEventListener('change', () => {
      this.syncFormatState(this.formatSelect.value as ExportFormat);
    });

    // ── Buttons ───────────────────────────────────────────────────────────
    const btnRow = contentEl.createDiv({ cls: 'lc-export-btn-row' });
    btnRow.style.cssText =
      'display:flex;justify-content:flex-end;gap:8px;margin-top:14px';
    // Reset the YAML-backed options to the note's own properties, discarding
    // the values remembered from the last export (see resetToNoteProperties).
    const resetBtn = btnRow.createEl('button', {
      text: 'Reset to note properties',
    });
    resetBtn.style.marginRight = 'auto';
    resetBtn.title =
      "Re-read this note's YAML export settings (template, csl, toc-levels, "
      + 'numbering-levels, endnotes, include-bibliography) and forget the '
      + 'values remembered for them from the last export. Settings with no '
      + 'YAML property are left untouched.';
    resetBtn.addEventListener('click', () => this.resetToNoteProperties());
    const cancelBtn = btnRow.createEl('button', { text: 'Cancel' });
    cancelBtn.addEventListener('click', () => this.close());
    this.runButton = btnRow.createEl('button', {
      text: 'Compile',
      cls: 'mod-cta',
    });
    this.runButton.addEventListener('click', () => this.run());
    this.filenameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.run();
      if (e.key === 'Escape') this.close();
    });

    setTimeout(() => this.runButton.focus(), 50);
    this.updateSkipRecompileRow();

    // Probe installed tools and grey out formats/templates that can't run yet.
    void this.applyToolGating();
  }

  // ── Dependency gating ──────────────────────────────────────────────────────

  /** Dependencies a given output format needs that were NOT found. */
  private formatMissing(fmt: ExportFormat): DepKey[] {
    const p = this.probe;
    if (!p) return [];
    const missing: DepKey[] = [];
    if (!p.python) missing.push('python');
    if (fmt === 'md') return missing;
    if (!p.pandoc) missing.push('pandoc');
    if (fmt === 'latex') {
      if (!p.latex) missing.push('latex');
    } else if (fmt === 'pdf') {
      // PDF goes through ODT/DOCX (LibreOffice) or .tex (LaTeX) — either works.
      if (!p.soffice && !p.latex) missing.push('libreoffice', 'latex');
    }
    return missing;
  }

  private async applyToolGating(): Promise<void> {
    this.probe = await probeTools(this.plugin);

    for (const opt of Array.from(this.formatSelect.options)) {
      const missing = this.formatMissing(opt.value as ExportFormat);
      opt.disabled = missing.length > 0;
      opt.title = missing.length
        ? `Requires ${missing.map((k) => DEPENDENCIES[k].label).join(', ')}`
        : '';
    }
    if ((this.formatSelect.selectedOptions[0] as HTMLOptionElement | undefined)?.disabled) {
      const firstOk = Array.from(this.formatSelect.options).find((o) => !o.disabled);
      if (firstOk) this.formatSelect.value = firstOk.value;
    }

    const fmt = this.formatSelect.value as ExportFormat;
    this.buildTemplateDropdown(
      fmt,
      this.templateSelect.value || this.templateFromFrontmatter()
    );
    this.applyDocSettings();
    this.refreshFilename();
    this.syncFormatState(fmt);
    this.updateSkipRecompileRow();
  }

  /** Show which dependencies the selected format still needs (if any). */
  private refreshDepNote(): void {
    if (!this.depNote) return;
    this.depNote.empty();
    const fmt = this.formatSelect.value as ExportFormat;
    const missing = this.formatMissing(fmt);
    if (missing.length > 0) {
      renderDependencyNote(
        this.depNote,
        missing,
        'This output format needs the following, which was not found on this computer:'
      );
    }
    if (this.runButton) this.runButton.disabled = missing.length > 0;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  /** The note's own `csl:` / `citation-style:` frontmatter value, or ''. */
  private frontmatterCsl(): string {
    const fm = this.app.metadataCache.getFileCache(this.file)?.frontmatter as
      | Record<string, unknown>
      | undefined;
    const v = fm?.csl ?? fm?.['citation-style'];
    return typeof v === 'string' ? v.trim() : '';
  }

  /**
   * "Apply the selected citation style, overriding the template's style"
   * checkbox + a dropdown of installed Zotero styles (shown only when
   * checked). Auto-checked when the note has a `csl:` property or a previous
   * export of this file set a style.
   */
  private buildCslStyleSection(
    container: HTMLElement,
    fileHistory: FileExportHistory | null
  ): void {
    const row = container.createDiv({ cls: 'lc-export-check-row' });
    this.cslOverrideCb = row.createEl('input', { type: 'checkbox' });
    this.cslOverrideCb.id = 'lc-export-csl';
    const lbl = row.createEl('label', {
      text: "Apply the selected citation style, overriding the template's style if it exists",
    });
    lbl.htmlFor = 'lc-export-csl';

    this.cslStyleRow = container.createDiv({ cls: 'lc-export-check-row' });
    this.cslStyleRow.style.cssText = 'margin-left:22px';

    const styles = listZoteroInstalledStyles(this.plugin.settings.zoteroDataDir);
    this.cslStyleHasList = styles.length > 0;

    const fmCsl = this.frontmatterCsl();
    const savedStyle =
      (fileHistory?.cslStyle ?? '') || fmCsl || '';

    this.cslStyleSelect = this.cslStyleRow.createEl('select');
    this.cslStyleSelect.style.cssText = 'width:100%';
    this.cslStyleInput = this.cslStyleRow.createEl('input', {
      type: 'text',
      placeholder: 'Citation style name, .csl path, or URL',
    });
    this.cslStyleInput.style.cssText = 'width:100%';

    if (this.cslStyleHasList) {
      this.cslStyleInput.hidden = true;
      // If the saved/frontmatter choice isn't a listed file, surface it too.
      const listedPaths = new Set(styles.map((s) => s.path));
      const resolved =
        savedStyle &&
        (resolveZoteroStylePath(savedStyle, this.plugin.settings.zoteroDataDir) ??
          savedStyle);
      if (resolved && !listedPaths.has(resolved)) {
        const opt = this.cslStyleSelect.createEl('option', {
          text: `${savedStyle} (not in Zotero folder)`,
        });
        opt.value = resolved;
      }
      for (const s of styles) {
        const opt = this.cslStyleSelect.createEl('option', { text: s.title });
        opt.value = s.path;
      }
      if (resolved) this.cslStyleSelect.value = resolved;
    } else {
      this.cslStyleSelect.hidden = true;
      this.cslStyleInput.value = savedStyle;
      const note = this.cslStyleRow.createEl('p', {
        text: 'No installed Zotero styles found — set the Zotero data folder in Settings, or enter a style name/path/URL.',
        cls: 'lc-mapping-modal-note',
      });
      note.style.marginTop = '2px';
    }

    // Checked when the file history says so, or (no history) the note carries
    // a csl: property.
    this.cslOverrideCb.checked = fileHistory
      ? !!fileHistory.overrideCslStyle
      : !!fmCsl;

    const sync = () => {
      this.cslStyleRow.style.display = this.cslOverrideCb.checked ? '' : 'none';
    };
    this.cslOverrideCb.addEventListener('change', sync);
    sync();
  }

  /** Current citation-style value from the dropdown or the free-text input. */
  private cslStyleValue(): string {
    return (
      this.cslStyleHasList ? this.cslStyleSelect.value : this.cslStyleInput.value
    ).trim();
  }

  /**
   * Build the collapsible "Style mappings" section at the bottom of the modal.
   * Hidden entirely when no mappings exist (or global toggle is off in settings).
   * `savedIds` is the set of IDs that were enabled last time this file was exported.
   */
  private buildMappingsSection(
    container: HTMLElement,
    savedIds: string[] | undefined
  ): void {
    const mappings: StyleMapping[] = this.plugin.settings.styleMappings ?? [];
    const globalEnabled = this.plugin.settings.styleMappingsEnabled ?? true;
    if (!globalEnabled || mappings.length === 0) return;

    this.mappingCheckboxes.clear();

    // Default: if no saved state, use each mapping's own `enabled` default.
    const savedSet = savedIds ? new Set(savedIds) : null;

    const details = container.createEl('details', { cls: 'lc-mapping-details' });
    const enabledCount = mappings.filter(
      m => savedSet ? savedSet.has(m.id) : m.enabled
    ).length;
    const summary = details.createEl('summary');
    const updateSummaryText = () => {
      const on = Array.from(this.mappingCheckboxes.values()).filter(cb => cb.checked).length;
      summary.setText(`Style mappings (${on} of ${mappings.length} enabled)`);
    };

    const listEl = details.createDiv({ cls: 'lc-mapping-modal-list' });
    for (const m of mappings) {
      if (!m.source || !m.styleName) continue; // skip incomplete entries
      const row = listEl.createDiv({ cls: 'lc-mapping-modal-row' });
      const cb = row.createEl('input', { type: 'checkbox' });
      cb.id = `lc-map-${m.id}`;
      cb.checked = savedSet ? savedSet.has(m.id) : m.enabled;
      cb.addEventListener('change', updateSummaryText);
      const lbl = row.createEl('label', { text: `${m.source} → ${m.styleName}` });
      lbl.htmlFor = cb.id;
      this.mappingCheckboxes.set(m.id, cb);
    }

    if (this.mappingCheckboxes.size === 0) {
      details.remove(); // all entries were incomplete
      return;
    }

    listEl.createEl('p', {
      text: 'Manage mappings in Settings → Custom style mappings.',
      cls: 'lc-mapping-modal-note',
    });

    updateSummaryText();
  }

  /**
   * Disable template selector (and TOC / new-page checkboxes) when the format
   * is MD, since that mode compiles to markdown only and skips pandoc entirely.
   */
  private syncFormatState(format: ExportFormat): void {
    const isMd  = format === 'md';
    const isPdf = format === 'pdf';
    this.templateSelect.disabled = isMd;
    this.tocCb.disabled      = isMd;
    this.tofCb.disabled      = isMd;
    this.newPageCb.disabled  = isMd;
    this.generatedDateCb.disabled = isMd;
    this.romanFrontmatterCb.disabled = isMd;
    this.romanStartRow.style.display =
      !isMd && this.romanFrontmatterCb.checked ? '' : 'none';
    // TOC depth only matters when a TOC will be emitted (not for md output).
    this.tocLevelsInput.disabled = isMd;
    this.tocLevelsRow.style.display =
      !isMd && this.tocCb.checked ? '' : 'none';
    // Native endnotes are a DOCX/ODT word-processor feature; Markdown/LaTeX
    // have no native endnote objects and always use the body form instead.
    const nativeOk = format === 'docx' || format === 'odt' || format === 'pdf';
    this.notesModeNative.disabled = !nativeOk;
    this.notesModeNative.parentElement!.style.opacity = nativeOk ? '' : '0.55';
    // The body form is always available: with per-chapter numbering its Notes
    // section is divided by chapter; with continuous numbering it is one list.
    this.notesModeBodyRow.style.display = '';
    // Per-chapter restart cannot take effect for ODT native endnotes — the word
    // processor numbers endnotes continuously — so grey the option out. Its
    // value is kept (not cleared), since it still applies to DOCX/LaTeX or if
    // the user switches format.
    const odtNativeEndnotes =
      (format === 'odt'
        || (format === 'pdf' && /\.odt$/i.test(this.templateSelect.value)))
      && this.notesModeNative.checked;
    this.footnotesCb.disabled = odtNativeEndnotes;
    if (this.footnotesLabel) {
      this.footnotesLabel.setText(
        FOOTNOTE_RESTART_LABEL
        + (odtNativeEndnotes ? FOOTNOTE_RESTART_ODT_NOTE : ''));
    }
    // footnotesCb stays active — the compile step still uses it.
    // PDF-specific row: show only when format is pdf.
    this.keepIntermediateRow.style.display = isPdf ? '' : 'none';
    this.pdfNote.style.display = isPdf ? '' : 'none';
    // Compiled-markdown row: show for any exported (non-md) format.
    this.keepIntermediateMdRow.style.display = isMd ? 'none' : '';
    // Citation-style override: meaningless for markdown-only output.
    this.cslOverrideCb.parentElement!.style.display = isMd ? 'none' : '';
    this.cslStyleRow.style.display =
      !isMd && this.cslOverrideCb.checked ? '' : 'none';
    this.refreshDepNote();
  }

  /**
   * Rebuild the template <select> options for the given format.
   *
   * `preferredValue` may be a full filename ("book.docx") or a bare stem
   * ("book") from a previous session or frontmatter.  We try an exact match
   * first, then a stem match so old stem-only values still work.
   *
   * IMPORTANT: this method deliberately does NOT call applyTemplateDefaults(),
   * because it may be invoked before the checkboxes are created.  Callers must
   * call applyTemplateDefaults() themselves once checkboxes exist.
   */
  private buildTemplateDropdown(format: ExportFormat, preferredValue = ''): void {
    this.templateSelect.empty();

    // Built-in plugin templates.
    const pluginTpls = this.pluginTplDir
      ? listTemplates(this.pluginTplDir, format)
      : [];
    if (pluginTpls.length > 0) {
      const grp = this.templateSelect.createEl('optgroup') as HTMLOptGroupElement;
      grp.label = 'Built-in templates';
      for (const t of pluginTpls) {
        const o = grp.createEl('option', { text: t });
        o.value = t;
      }
    }

    // User templates.
    const userTpls = this.userTplDir
      ? listTemplates(this.userTplDir, format)
      : [];
    if (userTpls.length > 0) {
      const grp = this.templateSelect.createEl('optgroup') as HTMLOptGroupElement;
      grp.label = 'Your templates';
      for (const t of userTpls) {
        const o = grp.createEl('option', { text: t });
        o.value = t;
      }
    }

    // Try to restore the preferred selection (exact match, then stem match).
    const trySelect = (val: string): boolean => {
      if (!val) return false;
      this.templateSelect.value = val;
      if (this.templateSelect.value === val) return true;
      // Stem match: "book" selects "book.docx".
      const stem = val.replace(/\.(docx|odt|tex)$/i, '');
      for (const opt of Array.from(this.templateSelect.options)) {
        if (opt.value.replace(/\.(docx|odt|tex)$/i, '') === stem) {
          this.templateSelect.value = opt.value;
          return true;
        }
      }
      return false;
    };

    if (!trySelect(preferredValue)) {
      trySelect(this.templateFromFrontmatter());
    }

    // PDF only: a template's engine must be installed (ODT/DOCX → LibreOffice,
    // .tex → LaTeX). Disable options whose engine is missing.
    if (format === 'pdf' && this.probe) {
      for (const opt of Array.from(this.templateSelect.options)) {
        const ext = (opt.value.match(/\.(docx|odt|tex)$/i)?.[1] ?? '').toLowerCase();
        if ((ext === 'docx' || ext === 'odt') && !this.probe.soffice) {
          opt.disabled = true;
          opt.title = 'Requires LibreOffice';
        } else if (ext === 'tex' && !this.probe.latex) {
          opt.disabled = true;
          opt.title = 'Requires a LaTeX distribution (LuaLaTeX)';
        }
      }
      if ((this.templateSelect.selectedOptions[0] as HTMLOptionElement | undefined)?.disabled) {
        const firstOk = Array.from(this.templateSelect.options).find((o) => !o.disabled);
        if (firstOk) this.templateSelect.value = firstOk.value;
      }
    }
  }

  private templateFromFrontmatter(): string {
    const cache = this.app.metadataCache.getFileCache(this.file);
    const tpl = (cache?.frontmatter as Record<string, unknown> | undefined)
      ?.template;
    // Return the stem (no extension) so callers can do stem matching.
    return typeof tpl === 'string' ? tpl.replace(/\.(docx|odt|tex)$/i, '') : '';
  }

  /** Absolute path where DocumentCompiler would write this note's compiled
   *  markdown ("<stem> - compiled.md" in the output folder, else beside the
   *  note), or null when not on desktop. Mirrors write_intermediate(). */
  private compiledMdPath(): string | null {
    const adapter = this.plugin.app.vault.adapter as any;
    if (typeof adapter?.getBasePath !== 'function') return null;
    const vaultBase: string = adapter.getBasePath();
    const raw = this.outputDirInput?.value.trim() ?? '';
    let dir: string;
    if (!raw) {
      dir =
        this.file.parent && this.file.parent.path !== '/'
          ? `${vaultBase}/${this.file.parent.path}`
          : vaultBase;
    } else if (raw === '~' || raw.startsWith('~/') || raw.startsWith('~\\')) {
      dir = (require('os') as typeof import('os')).homedir() + raw.slice(1);
    } else if (raw.startsWith('/')) {
      dir = raw;
    } else {
      dir = `${vaultBase}/${raw}`;
    }
    return `${dir}/${this.file.basename} - compiled.md`;
  }

  /** Show the "skip recompilation" row only when a compiled markdown exists
   *  for the current output folder and the output is not markdown-only. */
  private updateSkipRecompileRow(): void {
    if (!this.skipRecompileRow) return;
    const fmt = this.formatSelect.value as ExportFormat;
    let exists = false;
    if (fmt !== 'md') {
      const p = this.compiledMdPath();
      if (p) {
        try {
          exists = (require('fs') as typeof import('fs')).existsSync(p);
        } catch {
          exists = false;
        }
      }
    }
    this.skipRecompileRow.style.display = exists ? '' : 'none';
    if (!exists) this.skipRecompileCb.checked = false;
  }

  /** A raw frontmatter property value as a string, or undefined. */
  private frontmatterValue(key: string): string | undefined {
    const fm = this.app.metadataCache.getFileCache(this.file)?.frontmatter as
      | Record<string, unknown>
      | undefined;
    const v = fm?.[key];
    if (v === undefined || v === null) return undefined;
    return String(v);
  }

  /** An integer frontmatter property (handles Obsidian's quoted "2" form). */
  private frontmatterInt(key: string, fallback: number): number {
    const raw = this.frontmatterValue(key);
    if (raw === undefined) return fallback;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : fallback;
  }

  /** A boolean frontmatter property (true/false, yes/no, on/off, 1/0). */
  private frontmatterBool(key: string, fallback: boolean): boolean {
    const raw = this.frontmatterValue(key)?.trim().toLowerCase();
    if (raw === undefined) return fallback;
    if (['true', 'yes', 'on', '1'].includes(raw)) return true;
    if (['false', 'no', 'off', '0'].includes(raw)) return false;
    return fallback;
  }

  /** The note's `endnotes` mode (none / native / body), accepting the
   *  historical boolean form (true → native). */
  private frontmatterNotesMode(): 'none' | 'native' | 'body' {
    const raw = this.frontmatterValue('endnotes')?.trim().toLowerCase();
    if (raw === undefined) return DEFAULT_ENDNOTES;
    if (raw === 'native' || ['true', 'yes', 'on', '1'].includes(raw)) {
      return 'native';
    }
    if (['body', 'paragraphs', 'chapters'].includes(raw)) return 'body';
    return 'none';
  }

  /** The current YAML value to honour for a property-backed option, or
   *  undefined to fall back to the last-used value.
   *
   *  A property whose CURRENT YAML differs from the value recorded at last
   *  export is a deliberate edit, so the new YAML wins. Unchanged YAML (or no
   *  YAML at all) leaves the last-used value in charge; a first-ever export
   *  with YAML present uses the YAML. */
  private changedYaml(key: string, hist: FileExportHistory | null): string | undefined {
    const cur = this.frontmatterValue(key);
    const seen = hist?.yamlObserved?.[key];
    if (cur !== undefined && cur !== seen) return cur;
    return undefined;
  }

  /** The property-backed options' CURRENT YAML values (key → raw string),
   *  recorded in the export history so a later change is detectable. Only keys
   *  actually present in the frontmatter are recorded. */
  private observedYaml(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const key of ['toc-levels', 'numbering-levels', 'endnotes', 'include-bibliography']) {
      const v = this.frontmatterValue(key);
      if (v !== undefined) out[key] = v;
    }
    return out;
  }

  /** Parse a raw string to an endnotes mode (shared by YAML + fallback). */
  private parseNotesMode(raw: string): 'none' | 'native' | 'body' {
    const v = raw.trim().toLowerCase();
    if (v === 'native' || ['true', 'yes', 'on', '1'].includes(v)) return 'native';
    if (['body', 'paragraphs', 'chapters'].includes(v)) return 'body';
    return 'none';
  }

  /** Parse a raw string to a boolean (true/false, yes/no, on/off, 1/0). */
  private parseBool(raw: string, fallback: boolean): boolean {
    const v = raw.trim().toLowerCase();
    if (['true', 'yes', 'on', '1'].includes(v)) return true;
    if (['false', 'no', 'off', '0'].includes(v)) return false;
    return fallback;
  }

  /** Parse and clamp a raw level string to [min, MAX_LEVEL]. */
  private parseLevel(raw: string, min: number, fallback: number): number {
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(MAX_LEVEL, n));
  }

  /** Clamp a level input to [min, max], falling back on a blank/invalid box. */
  private readLevel(input: HTMLInputElement, min: number, fallback: number): number {
    const n = parseInt(input.value, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(MAX_LEVEL, n));
  }

  /** Read this file's export history entry, or null if none exists. */
  private getFileHistory(): FileExportHistory | null {
    const hist = (this.plugin.settings as any).fileExportHistory as
      Record<string, FileExportHistory> | undefined;
    return hist?.[this.file.path] ?? null;
  }

  /**
   * Apply preset checkbox values for a given document type.
   * 'custom' is a no-op — leave whatever is already checked.
   */
  private applyDocTypePreset(docType: DocType): void {
    if (docType === 'book') {
      this.tocCb.checked       = true;
      this.tofCb.checked       = true;
      this.footnotesCb.checked = true;
      this.newPageCb.checked   = true;
      this.romanFrontmatterCb.checked = true;
    } else if (docType === 'article') {
      this.tocCb.checked       = false;
      this.tofCb.checked       = false;
      this.footnotesCb.checked = false;
      this.newPageCb.checked   = false;
      this.romanFrontmatterCb.checked = false;
    }
    this.romanStartRow.style.display = this.romanFrontmatterCb.checked ? '' : 'none';
  }

  /**
   * Initialise the document-type radio and checkboxes.
   *
   * Priority order:
   *   1. Per-file history (restored exactly as last used)
   *   2. YAML property on the note (for the numbering-levels / toc-levels /
   *      endnotes options, which have no document-type preset)
   *   3. Built-in default
   *
   * Callers must ensure both the radio buttons and the inputs exist.
   */
  private applyDocSettings(fresh = false): void {
    const history = this.getFileHistory();
    if (history && !fresh) {
      // Restore everything exactly as it was last time this file was exported.
      this.docTypeBook.checked    = history.docType === 'book';
      this.docTypeArticle.checked = history.docType === 'article';
      this.docTypeCustom.checked  = history.docType === 'custom';
      this.tocCb.checked          = history.toc;
      this.tofCb.checked          = history.tof ?? false;
      this.footnotesCb.checked    = history.restartFootnotes;
      this.newPageCb.checked      = history.newPageHeadings;
      this.generatedDateCb.checked = history.generatedDate ?? true;
      this.romanFrontmatterCb.checked = history.romanFrontmatter ?? false;
      this.romanStartInput.value = history.romanStart ?? '';
      this.romanStartRow.style.display = this.romanFrontmatterCb.checked ? '' : 'none';
    } else {
      // Derive document type from template name stem.
      const stem = this.templateSelect.value.replace(/\.(docx|odt|tex)$/i, '');
      const docType: DocType =
        stem.startsWith('book')    ? 'book' :
        stem.startsWith('article') ? 'article' : 'custom';
      this.docTypeBook.checked    = docType === 'book';
      this.docTypeArticle.checked = docType === 'article';
      this.docTypeCustom.checked  = docType === 'custom';
      this.applyDocTypePreset(docType);
    }
    // Property-backed options, precedence: NEW/changed YAML > last-used value
    // > default. A YAML value that differs from the one recorded at last
    // export (or any YAML on a first export) is a deliberate edit, so it wins.
    const hist = history && !fresh ? history : null;

    const yToc = this.changedYaml('toc-levels', hist);
    this.tocLevelsInput.value = String(
      yToc !== undefined
        ? this.parseLevel(yToc, 1, DEFAULT_TOC_LEVELS)
        : (hist?.tocLevels ?? DEFAULT_TOC_LEVELS));

    const yNum = this.changedYaml('numbering-levels', hist);
    this.numberingLevelsInput.value = String(
      yNum !== undefined
        ? this.parseLevel(yNum, 0, DEFAULT_NUMBERING_LEVELS)
        : (hist?.numberingLevels ?? DEFAULT_NUMBERING_LEVELS));

    const yEnd = this.changedYaml('endnotes', hist);
    this.setNotesMode(
      yEnd !== undefined ? this.parseNotesMode(yEnd) : (hist?.endnotes ?? DEFAULT_ENDNOTES));

    const yBib = this.changedYaml('include-bibliography', hist);
    this.bibliographyCb.checked =
      yBib !== undefined ? this.parseBool(yBib, DEFAULT_BIBLIOGRAPHY)
                         : (hist?.includeBibliography ?? DEFAULT_BIBLIOGRAPHY);

    this.tocLevelsRow.style.display =
      this.tocCb.disabled || !this.tocCb.checked ? 'none' : '';
    this.syncFormatState(this.formatSelect.value as ExportFormat);
  }

  /**
   * "Reset to note properties": re-read every export setting the note can
   * specify in YAML — template, citation style, TOC depth, auto-numbering,
   * notes, bibliography — and forget the values remembered from the last
   * export, so the note's properties win again. A setting with no YAML
   * property is left untouched, and its remembered value is kept.
   */
  private resetToNoteProperties(): void {
    const s = this.plugin.settings as any;
    const hist = s.fileExportHistory?.[this.file.path] as
      | FileExportHistory
      | undefined;
    let applied = 0;

    // ── Template (frontmatter `template:`; a `compile-` prefix is ignored) ──
    const yTpl = this.frontmatterValue('template');
    if (yTpl !== undefined) {
      const stem = yTpl
        .replace(/^compile-/, '')
        .replace(/\.(docx|odt|tex)$/i, '');
      this.buildTemplateDropdown(this.formatSelect.value as ExportFormat, stem);
      const dt: DocType =
        stem.startsWith('book') ? 'book' :
        stem.startsWith('article') ? 'article' : 'custom';
      this.docTypeBook.checked = dt === 'book';
      this.docTypeArticle.checked = dt === 'article';
      this.docTypeCustom.checked = dt === 'custom';
      this.applyDocTypePreset(dt);
      if (hist) delete hist.template;
      applied++;
    }

    // ── Citation style (frontmatter `csl:` / `citation-style:`) ─────────────
    const yCsl =
      this.frontmatterValue('csl') ?? this.frontmatterValue('citation-style');
    if (yCsl !== undefined) {
      this.cslOverrideCb.checked = true;
      const resolved =
        resolveZoteroStylePath(yCsl, this.plugin.settings.zoteroDataDir) ?? yCsl;
      if (this.cslStyleHasList) this.cslStyleSelect.value = resolved;
      else this.cslStyleInput.value = yCsl;
      this.cslStyleRow.style.display = '';
      if (hist) {
        delete hist.overrideCslStyle;
        delete hist.cslStyle;
      }
      applied++;
    }

    /** Apply one YAML property and drop its remembered last-used value. */
    const yamlLevel = (
      key: string,
      field: 'tocLevels' | 'numberingLevels',
      input: HTMLInputElement,
      min: number,
      fallback: number
    ): void => {
      const raw = this.frontmatterValue(key);
      if (raw === undefined) return;
      input.value = String(this.parseLevel(raw, min, fallback));
      if (hist) {
        delete hist[field];
        if (hist.yamlObserved) delete hist.yamlObserved[key];
      }
      applied++;
    };

    yamlLevel('toc-levels', 'tocLevels', this.tocLevelsInput, 1, DEFAULT_TOC_LEVELS);
    yamlLevel('numbering-levels', 'numberingLevels', this.numberingLevelsInput, 0, DEFAULT_NUMBERING_LEVELS);

    const yEnd = this.frontmatterValue('endnotes');
    if (yEnd !== undefined) {
      this.setNotesMode(this.parseNotesMode(yEnd));
      if (hist) {
        delete hist.endnotes;
        if (hist.yamlObserved) delete hist.yamlObserved['endnotes'];
      }
      applied++;
    }

    const yBib = this.frontmatterValue('include-bibliography');
    if (yBib !== undefined) {
      this.bibliographyCb.checked = this.parseBool(yBib, DEFAULT_BIBLIOGRAPHY);
      if (hist) {
        delete hist.includeBibliography;
        if (hist.yamlObserved) delete hist.yamlObserved['include-bibliography'];
      }
      applied++;
    }

    if (applied > 0) {
      void this.plugin.saveSettings();
      new Notice("Reset to this note's properties.");
    } else {
      new Notice('This note has no export properties to reset to.');
    }
    this.syncFormatState(this.formatSelect.value as ExportFormat);
  }

  /** Check the radio matching an endnotes mode. */
  private setNotesMode(mode: 'none' | 'native' | 'body'): void {
    this.notesModeFootnotes.checked = mode === 'none';
    this.notesModeNative.checked = mode === 'native';
    this.notesModeBody.checked = mode === 'body';
  }

  /** The notes mode currently selected. */
  private notesMode(): 'none' | 'native' | 'body' {
    if (this.notesModeBody.checked) return 'body';
    if (this.notesModeNative.checked) return 'native';
    return 'none';
  }

  /**
   * Keep the filename input in sync with the format selector.
   * Only auto-updates while the name still looks like the auto-generated
   * default (avoids clobbering a name the user typed manually).
   */
  private refreshFilename(): void {
    const fmt = this.formatSelect.value as ExportFormat;
    const ext =
      fmt === 'odt' ? 'odt' :
      fmt === 'md' ? 'md' :
      fmt === 'pdf' ? 'pdf' :
      fmt === 'latex' ? 'tex' : 'docx';
    const noteBase = this.file.basename;
    // Use saved filename stem from per-file history when available.
    const history = this.getFileHistory();
    const savedStem = history?.outputFilename
      ? history.outputFilename.replace(/\.[^.]+$/, '')
      : noteBase;
    const current = this.filenameInput?.value ?? '';
    const looksDefault =
      !current ||
      current === `${savedStem}.md` ||
      current === `${savedStem}.docx` ||
      current === `${savedStem}.odt` ||
      current === `${savedStem}.tex` ||
      current === `${savedStem}.pdf` ||
      current === `${noteBase}.md` ||
      current === `${noteBase}.docx` ||
      current === `${noteBase}.odt` ||
      current === `${noteBase}.tex` ||
      current === `${noteBase}.pdf`;
    if (looksDefault && this.filenameInput) {
      this.filenameInput.value = `${savedStem}.${ext}`;
    }
  }

  private async pickOutputDir(): Promise<void> {
    try {
      // Obsidian on macOS/Windows ships with @electron/remote for dialog access.
      // Try the modern package first, then fall back to the legacy remote API.
      let dialog: any = null;
      try { dialog = require('@electron/remote').dialog; } catch { /* not bundled */ }
      if (!dialog) dialog = (require('electron') as any).remote?.dialog ?? null;
      if (!dialog) throw new Error('no remote dialog');
      // Start the browser at the current input value, then the last-used
      // directory, so the user doesn't have to navigate from Downloads each time.
      const startPath =
        this.outputDirInput.value.trim() ||
        this.getFileHistory()?.outputDir ||
        (this.plugin.settings as any).lastOutputDir ||
        '';
      const result = await dialog.showOpenDialog({
        title: 'Select output directory',
        properties: ['openDirectory', 'createDirectory'],
        ...(startPath ? { defaultPath: startPath } : {}),
      });
      if (!result.canceled && result.filePaths.length > 0) {
        this.outputDirInput.value = result.filePaths[0];
        this.sameSourceCb.checked = false;
      }
    } catch {
      new Notice(
        'Directory picker unavailable — type the path into the box above.'
      );
    }
  }

  /** The notes mode selected in the dialogue. */
  private effectiveNotesMode(): 'none' | 'native' | 'body' {
    return this.notesMode();
  }

  private options(): ExportOptions {
    const docType: DocType =
      this.docTypeBook.checked ? 'book' :
      this.docTypeArticle.checked ? 'article' : 'custom';
    return {
      format: this.formatSelect.value as ExportFormat,
      docType,
      template: this.templateSelect.value,
      toc: this.tocCb.checked,
      tocLevels: this.readLevel(this.tocLevelsInput, 1, DEFAULT_TOC_LEVELS),
      tof: this.tofCb.checked,
      numberingLevels: this.readLevel(
        this.numberingLevelsInput, 0, DEFAULT_NUMBERING_LEVELS),
      endnotes: this.effectiveNotesMode(),
      includeBibliography: this.bibliographyCb.checked,
      restartFootnotes: this.footnotesCb.checked,
      newPageHeadings: this.newPageCb.checked,
      generatedDate: this.generatedDateCb.checked,
      romanFrontmatter: this.romanFrontmatterCb.checked,
      romanStart: this.romanStartInput.value.trim(),
      outputDir: this.outputDirInput.value.trim(),
      outputFilename: this.filenameInput.value.trim(),
      keepIntermediate: this.keepIntermediateCb.checked,
      keepIntermediateMd: this.keepIntermediateMdCb.checked,
      skipRecompile: this.skipRecompileCb.checked,
      compiledMdPath: this.compiledMdPath() ?? undefined,
      enabledMappingIds: Array.from(this.mappingCheckboxes.entries())
        .filter(([, cb]) => cb.checked)
        .map(([id]) => id),
      overrideCslStyle: this.cslOverrideCb.checked,
      cslStyle: this.cslStyleValue(),
    };
  }

  private async run() {
    if (!Platform.isDesktop) {
      new Notice('Document compile/export is only available on desktop.');
      return;
    }
    const opts = this.options();

    const missing = this.formatMissing(opts.format);
    if (missing.length > 0) {
      new Notice(
        `This export needs ${missing.map((k) => DEPENDENCIES[k].label).join(', ')}. ` +
          `Install it, then reopen this dialogue.`,
        8000
      );
      return;
    }

    // Zotero pre-check. Probe FRESH so a Zotero stopped after the dialogue
    // opened is caught. A cited key resolves "without Zotero" only when it comes
    // from a bibliography file (`bibCache._source === 'bib'`); keys sourced from
    // (or missing from) Zotero need it. Only the latter trigger the prompt.
    let tempBiblio: string | null = null;
    if (opts.format !== 'md') {
      const probe = await probeTools(this.plugin, true);
      if (!probe.zotero) {
        const cache = this.plugin.bibManager.fileCache.get(this.file);
        const keys = cache?.keys
          ? Array.from(cache.keys)
          : await this.citedKeysFromText();
        const usesLiveFields = opts.format === 'docx' || opts.format === 'odt';
        let needsZotero = 0;
        for (const k of keys) {
          if (this.plugin.bibManager.bibCache.get(k)?._source !== 'bib') needsZotero++;
        }
        if (needsZotero > 0) {
          let choice: ZoteroChoice = 'cancel';
          for (;;) {
            choice = await askZotero(this.app, needsZotero, usesLiveFields);
            if (choice !== 'retry') break;
            if ((await probeTools(this.plugin, true)).zotero) break;
            // still not running — ask again
          }
          if (choice === 'cancel') return;
        }
        // Without Zotero, DOCX/ODT can't build live fields — render citations
        // statically from the loaded library (.bib entries, plus any cached
        // Zotero data); fall back to literal citations if there are none.
        if (usesLiveFields) {
          tempBiblio = await this.writeStaticBibliography(keys);
          if (tempBiblio) opts.staticBibliography = tempBiblio;
          else opts.rawCitations = true;
        }
      }
    }

    // Persist settings: per-file history (keyed by vault path) plus
    // global lastExportFormat for files with no history yet.
    const entry: FileExportHistory = {
      format:           opts.format,
      docType:          opts.docType,
      template:         opts.template,
      toc:              opts.toc,
      tocLevels:        opts.tocLevels,
      tof:              opts.tof,
      numberingLevels:  opts.numberingLevels,
      endnotes:         opts.endnotes,
      includeBibliography: opts.includeBibliography,
      restartFootnotes: opts.restartFootnotes,
      newPageHeadings:  opts.newPageHeadings,
      generatedDate:    opts.generatedDate,
      romanFrontmatter: opts.romanFrontmatter,
      romanStart:       opts.romanStart,
      outputDir:        opts.outputDir,
      outputFilename:   opts.outputFilename,
      keepIntermediate: opts.keepIntermediate,
      keepIntermediateMd: opts.keepIntermediateMd,
      enabledMappingIds: opts.enabledMappingIds,
      overrideCslStyle: opts.overrideCslStyle,
      cslStyle: opts.cslStyle,
      // Record the YAML values seen now, so a later change to any of them is
      // recognised as a deliberate edit and overrides the remembered value.
      yamlObserved: this.observedYaml(),
    };
    const s = this.plugin.settings as any;
    if (!s.fileExportHistory) s.fileExportHistory = {};
    s.fileExportHistory[this.file.path] = entry;
    // Keep history bounded (oldest-first; drop entries beyond 200).
    const entries = Object.entries(s.fileExportHistory as Record<string, unknown>);
    if (entries.length > 200)
      s.fileExportHistory = Object.fromEntries(entries.slice(entries.length - 200));
    // Also update global last-used format for new-file defaults.
    this.plugin.settings.lastExportFormat = opts.format;
    s.lastTemplate = opts.template;
    await this.plugin.saveSettings();

    this.close();

    const label =
      opts.format === 'md'    ? 'Compiling outline…' :
      opts.format === 'odt'   ? 'Compiling + exporting to ODT…' :
      opts.format === 'latex' ? 'Compiling + exporting to LaTeX…' :
      opts.format === 'pdf'   ? 'Compiling + exporting to PDF…' :
                                'Compiling + exporting to DOCX…';
    const progress = new Notice(label, 0);

    const res = await runDocumentCompiler(this.plugin, this.file, opts).finally(() => {
      if (tempBiblio) {
        try {
          (require('fs') as typeof import('fs')).unlinkSync(tempBiblio);
        } catch { /* ignore */ }
      }
    });
    progress.hide();

    if (!res.ok) {
      new Notice(`Document compiler failed:\n${res.stderr}`, 8000);
      console.error('[scholar-weft] DocumentCompiler failed:', res.stderr);
      return;
    }

    const outPath =
      res.outputPath ?? res.stdout.trim().split('\n').pop() ?? '';
    const doneLabel =
      opts.format === 'md' ? `Compiled: ${outPath}` : `Exported: ${outPath}`;
    new Notice(doneLabel, 6000);
  }

  /**
   * CSL-JSON for the cited keys, taken from the plugin's loaded bibliography
   * (private `_`-prefixed fields stripped), written to a temp file. Returns
   * null when no entries are available. Used for the static fallback when
   * Zotero is unavailable.
   */
  private async writeStaticBibliography(keys: string[]): Promise<string | null> {
    const entries: Record<string, unknown>[] = [];
    for (const k of keys) {
      const e = this.plugin.bibManager.bibCache.get(k) as unknown as
        | Record<string, unknown>
        | undefined;
      if (!e) continue;
      const copy: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(e)) {
        if (!key.startsWith('_')) copy[key] = val;
      }
      entries.push(copy);
    }
    if (entries.length === 0) return null;
    const fs = require('fs') as typeof import('fs');
    const os = require('os') as typeof import('os');
    const nodePath = require('path') as typeof import('path');
    const p = nodePath.join(os.tmpdir(), `sw-static-${Date.now()}.json`);
    fs.writeFileSync(p, JSON.stringify(entries), 'utf-8');
    return p;
  }

  /** Cited keys scanned from the note text (fallback when never rendered). */
  private async citedKeysFromText(): Promise<string[]> {
    const text = await this.app.vault.cachedRead(this.file);
    const keys = new Set<string>();
    const re = /\[\[@([^|\]\s]+)|(?:^|[^\w@])@([A-Za-z][\w:.#$%&+?<>~/-]*)/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) keys.add(m[1] ?? m[2]);
    return Array.from(keys);
  }

  onClose() {
    this.contentEl.empty();
  }
}
