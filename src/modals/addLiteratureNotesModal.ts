import { App, Modal, Notice, TFile } from 'obsidian';

import type ReferenceList from '../main';
import { t } from '../lang/helpers';
import type { PartialCSLEntry } from '../bib/types';
import {
  defaultFilters,
  flagsFromChildren,
  passesImportFilters,
  type ImportFilters,
  type ImportItemFlags,
} from '../template/import-filters';
import { readChildren } from '../template/children-cache';
import type { RawZoteroChildren } from '../template/children';
import {
  excerptForResult,
  findTermSpans,
} from '../template/search-excerpt';

/**
 * Native "Add literature notes" dialogue.
 *
 * A sibling of the Better BibTeX picker ("Import literature notes from Zotero…"):
 * that one opens Zotero's own dialog; this one searches and filters WITHIN
 * Obsidian. Both stay available under distinct names.
 *
 * Search behaviour mirrors the editor popup: `@` (title/author) by default, or
 * `@@` (adds abstract + publication) when "Search abstracts" is checked.
 */

/** Rows rendered per batch; more load on scroll (Obsidian has no virtual list). */
const PAGE = 100;

export class AddLiteratureNotesModal extends Modal {
  private plugin: ReferenceList;
  private query = '';
  private searchAbstract = false;
  private filters: ImportFilters = defaultFilters();
  private selected = new Set<string>();
  private listEl!: HTMLElement;
  private statusEl!: HTMLElement;
  private searchInput!: HTMLInputElement;
  private confirmBtn: HTMLButtonElement | null = null;
  private rendered = 0;
  private matches: PartialCSLEntry[] = [];
  private termsByKey = new Map<string, string[]>();
  private litNotes = new Set<string>();

  constructor(app: App, plugin: ReferenceList) {
    super(app);
    this.plugin = plugin;
  }

  onOpen(): void {
    const { contentEl, modalEl } = this;
    contentEl.addClass('sw-add-notes');
    if (modalEl) modalEl.addClass('sw-add-notes-modal');

    contentEl.createEl('h3', { text: t('Add literature notes') });

    // Search box + the abstract toggle (the `@@` tier).
    const searchRow = contentEl.createDiv({ cls: 'sw-add-notes__searchrow' });
    this.searchInput = searchRow.createEl('input', {
      cls: 'sw-add-notes__search',
      attr: {
        type: 'search',
        placeholder: t('Search by citekey, author, title…'),
      },
    });
    this.searchInput.addEventListener('input', () => {
      this.query = this.searchInput.value;
      this.refresh();
    });
    const absLabel = searchRow.createEl('label', { cls: 'sw-add-notes__abstract' });
    const absBox = absLabel.createEl('input', { type: 'checkbox' });
    absBox.checked = this.searchAbstract;
    absBox.addEventListener('change', () => {
      this.searchAbstract = absBox.checked;
      this.searchInput.placeholder = absBox.checked
        ? t('Search citekey, author, title, abstract, publication…')
        : t('Search by citekey, author, title…');
      this.refresh();
    });
    absLabel.appendText(' ' + t('Search abstracts'));

    // Filters (left column) + list (right).
    const body = contentEl.createDiv({ cls: 'sw-add-notes__body' });
    const side = body.createDiv({ cls: 'sw-add-notes__filters' });
    this.renderFilters(side);
    const main = body.createDiv({ cls: 'sw-add-notes__pane' });
    this.listEl = main.createDiv({ cls: 'sw-add-notes__list' });
    main.addEventListener('scroll', () => {
      if (main.scrollTop + main.clientHeight >= main.scrollHeight - 200) {
        this.renderMore();
      }
    });
    // Fixed footer row INSIDE the pane: status left, actions right. Stays put
    // regardless of how long the list is.
    const footer = main.createDiv({ cls: 'sw-add-notes__footer' });
    this.statusEl = footer.createDiv({ cls: 'sw-add-notes__status' });
    const actions = footer.createDiv({ cls: 'sw-add-notes__actions' });
    const selectAll = actions.createEl('button', { text: t('Select all shown') });
    selectAll.addEventListener('click', () => {
      for (const e of this.matches) this.selected.add(e.id);
      this.redrawSelection();
      this.updateStatus();
    });
    const clear = actions.createEl('button', { text: t('Clear') });
    clear.addEventListener('click', () => {
      this.selected.clear();
      this.redrawSelection();
      this.updateStatus();
    });
    this.confirmBtn = actions.createEl('button', {
      text: t('Add notes'),
      cls: 'mod-cta',
    });
    this.confirmBtn.addEventListener('click', () => void this.createSelected());

    this.searchInput.focus();
    this.buildLitNoteIndex();
    this.refresh();
    // Build the library-wide presence index in the background (first open only),
    // then re-run the filters so the has-notes/PDF/annotations boxes are usable.
    if (!this.plugin.bibManager.presenceReady) {
      void this.plugin.bibManager
        .buildChildPresenceIndex()
        .then(() => {
          if (this.containerEl.isConnected) this.refresh();
        })
        .catch((e) => console.warn('[sw:add-notes] presence index failed', e));
    }
  }

  private renderFilters(side: HTMLElement): void {
    const mk = (label: string, key: keyof ImportFilters) => {
      const row = side.createEl('label', { cls: 'sw-add-notes__filter' });
      const input = row.createEl('input', { type: 'checkbox' });
      input.checked = this.filters[key];
      input.addEventListener('change', () => {
        this.filters = { ...this.filters, [key]: input.checked };
        this.refresh();
      });
      row.appendText(' ' + label);
    };
    mk(t('Items with Zotero notes'), 'hasNotes');
    mk(t('Items with a PDF or snapshot'), 'hasAttachment');
    mk(t('Items with annotations'), 'hasAnnotations');
    mk(t('Items without a literature note'), 'withoutLitNote');
  }

  /** Vault-wide literature-note existence, by citekey (one scan, cached). */
  private buildLitNoteIndex(): void {
    for (const f of this.app.vault.getMarkdownFiles()) {
      const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
      const ck =
        typeof fm?.citekey === 'string'
          ? fm.citekey
          : f.basename.startsWith('@')
            ? f.basename.slice(1)
            : null;
      if (ck) this.litNotes.add(ck);
    }
  }

  private stableKeyFor(entry: PartialCSLEntry): string {
    if (typeof entry._zoteroKey !== 'string') return '';
    const gid = entry.groupID && entry.groupID !== 1 ? entry.groupID : null;
    return gid ? `${entry._zoteroKey}g${gid}` : entry._zoteroKey;
  }

  private flagsFor(entry: PartialCSLEntry): ImportItemFlags {
    const stable = this.stableKeyFor(entry);
    const children = stable
      ? readChildren<RawZoteroChildren>(this.plugin.bibManager.childrenCache, stable)
      : null;
    return flagsFromChildren(children, this.litNotes.has(entry.id));
  }

  private refresh(): void {
    const q = this.query.trim();
    if (q) {
      const { entries } = this.plugin.bibManager.searchTier(
        this.searchAbstract ? 'abstract' : 'title',
        q,
        100000
      );
      this.matches = entries
        .map((e) => e.entry)
        .filter((e) => passesImportFilters(this.flagsFor(e), this.filters));
      this.termsByKey = new Map(entries.map((e) => [e.entry.id, e.terms]));
    } else {
      this.matches = Array.from(this.plugin.bibManager.bibCache.values()).filter(
        (e) => passesImportFilters(this.flagsFor(e), this.filters)
      );
      this.termsByKey = new Map();
    }
    this.rendered = 0;
    this.listEl.empty();
    this.renderMore();
    this.updateStatus();
  }

  private renderedRefs = new Map<string, string>();

  private renderMore(): void {
    const slice = this.matches.slice(this.rendered, this.rendered + PAGE);
    for (const entry of slice) this.renderRow(entry);
    this.rendered += slice.length;
    // Fill in formatted references for the rows just added, in ONE call (the
    // plugin's own renderer — the same one `[[@key|reference]]` uses).
    const unrendered = slice
      .map((e) => e.id)
      .filter((id) => !this.renderedRefs.has(id));
    if (unrendered.length) {
      void this.plugin.bibManager
        .renderReferenceMarkdown(unrendered)
        .then((map) => {
          for (const [k, v] of map) this.renderedRefs.set(k, v);
          if (this.containerEl.isConnected) this.fillReferences();
        })
        .catch((e) => console.warn('[sw:add-notes] reference render failed', e));
    }
  }

  /** Fill already-drawn rows with their rendered reference, when ready. */
  private fillReferences(): void {
    for (const row of Array.from(
      this.listEl.querySelectorAll('.sw-add-notes__row')
    ) as HTMLElement[]) {
      const key = row.dataset.citekey;
      if (!key) continue;
      const refEl = row.querySelector('.sw-add-notes__ref') as HTMLElement | null;
      const text = this.renderedRefs.get(key);
      if (refEl && text) refEl.setText(text);
    }
  }

  /** Rich row: citekey, creators, title, the rendered reference, an excerpt. */
  private renderRow(entry: PartialCSLEntry): void {
    const row = this.listEl.createDiv({ cls: 'sw-add-notes__row' });
    row.toggleClass('is-selected', this.selected.has(entry.id));
    row.dataset.citekey = entry.id;

    const info = row.createDiv({ cls: 'sw-add-notes__info' });
    const head = info.createDiv({ cls: 'sw-add-notes__head' });
    head.createSpan({ cls: 'sw-add-notes__citekey', text: `@${entry.id}` });
    const creators = this.creatorText(entry);
    if (creators) head.createSpan({ cls: 'sw-add-notes__authors', text: creators });
    if (entry.groupID && entry.groupID !== 1) {
      const name =
        this.plugin.settings.zoteroGroups?.find(
          (g: { id: number; name: string }) => g.id === entry.groupID
        )?.name ?? `Group ${entry.groupID}`;
      head.createSpan({ cls: 'sw-add-notes__library', text: `· ${name}` });
    }
    if (this.litNotes.has(entry.id)) {
      head.createSpan({ cls: 'sw-add-notes__has-note', text: `· ${t('has a note')}` });
    }

    // The rendered reference — the same thing the popup tooltip shows.
    const bib = this.plugin.bibManager.getBibForCiteKey(
      this.sourceFile(),
      entry.id
    ) as HTMLElement | null;
    if (bib) {
      const ref = info.createDiv({ cls: 'sw-add-notes__ref' });
      ref.setText(bib.textContent ?? '');
    } else if (entry.title) {
      info.createDiv({ cls: 'sw-add-notes__title', text: entry.title });
    }

    // An abstract excerpt around the matched terms, when searching.
    const terms = this.termsByKey.get(entry.id) ?? [];
    const excerpt = excerptForResult(
      entry as { abstract?: string | null },
      terms
    );
    if (excerpt) {
      const line = info.createDiv({ cls: 'sw-add-notes__excerpt' });
      this.appendHighlighted(line, excerpt.text, excerpt.matches);
    }

    row.addEventListener('click', () => {
      if (this.selected.has(entry.id)) this.selected.delete(entry.id);
      else this.selected.add(entry.id);
      row.toggleClass('is-selected', this.selected.has(entry.id));
      this.updateStatus();
    });
  }

  private appendHighlighted(
    el: HTMLElement,
    text: string,
    matches: Array<{ start: number; length: number }>
  ): void {
    let at = 0;
    for (const m of matches) {
      if (m.length <= 0 || m.start < at || m.start + m.length > text.length) continue;
      if (m.start > at) el.appendText(text.slice(at, m.start));
      el.append(
        createEl('strong', {
          cls: 'sw-suggest-match',
          text: text.slice(m.start, m.start + m.length),
        })
      );
      at = m.start + m.length;
    }
    if (at < text.length) el.appendText(text.slice(at));
  }

  private creatorText(entry: PartialCSLEntry): string {
    const lists = [entry.author, entry.editor];
    const parts: string[] = [];
    for (const list of lists) {
      for (const n of list ?? []) {
        const name =
          (n as { literal?: string }).literal ??
          [(n as { given?: string }).given, (n as { family?: string }).family]
            .filter(Boolean)
            .join(' ');
        if (name) parts.push(name);
      }
    }
    return parts.join('; ');
  }

  private sourceFile(): TFile {
    return (
      this.app.workspace.getActiveFile() ??
      (this.app.vault.getRoot() as unknown as TFile)
    );
  }

  private redrawSelection(): void {
    for (const row of Array.from(
      this.listEl.querySelectorAll('.sw-add-notes__row')
    ) as HTMLElement[]) {
      const key = row.dataset.citekey;
      row.toggleClass('is-selected', !!key && this.selected.has(key));
    }
  }

  private updateStatus(): void {
    const total = this.matches.length;
    const n = this.selected.size;
    this.statusEl.setText(
      `${total} ${total === 1 ? t('reference') : t('references')}` +
        (n ? ` · ${n} ${t('selected')}` : '')
    );
    if (this.confirmBtn) {
      this.confirmBtn.setText(`${t('Add notes')} (${n})`);
      this.confirmBtn.toggleClass('is-disabled', n === 0);
    }
  }

  private async createSelected(): Promise<void> {
    if (!this.selected.size) return;
    const citekeys = [...this.selected];
    this.close();
    const source = this.sourceFile();
    const progress = new Notice(`Creating literature notes… 0/${citekeys.length}`, 0);
    let created = 0;
    for (const ck of citekeys) {
      try {
        await this.plugin.bibManager.createLiteratureNote(ck, source, { open: false });
        created++;
      } catch (e) {
        console.warn('[sw:add-notes] failed for', ck, e);
      }
      progress.setMessage(`Creating literature notes… ${created}/${citekeys.length}`);
    }
    progress.hide();
    new Notice(
      `Created or refreshed ${created} literature note${created === 1 ? '' : 's'}.`,
      8000
    );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
