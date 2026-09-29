import { App, Modal, Notice, Setting, TFile } from 'obsidian';

import type ReferenceList from '../main';
import { t } from '../lang/helpers';
import type { PartialCSLEntry } from '../bib/types';
import {
  countPassing,
  defaultFilters,
  flagsFromChildren,
  passesImportFilters,
  type ImportFilters,
  type ImportItemFlags,
} from '../template/import-filters';
import { readChildren } from '../template/children-cache';
import type { RawZoteroChildren } from '../template/children';

/**
 * Native "Add literature notes" dialogue.
 *
 * A sibling of the Better BibTeX picker ("Import literature notes from Zotero…"):
 * that one opens Zotero's own dialog; this one searches and filters WITHIN
 * Obsidian. Both stay available under distinct names.
 *
 * It searches the loaded library (ranked, paged), narrows with checkboxes, and
 * creates/refreshes literature notes for the checked references. Filters use
 * CACHED flags — nothing is fetched just to decide membership.
 */

/** Rows rendered per batch; more load on scroll (Obsidian has no virtual list). */
const PAGE = 100;

export class AddLiteratureNotesModal extends Modal {
  private plugin: ReferenceList;
  private query = '';
  private filters: ImportFilters = defaultFilters();
  private selected = new Set<string>();
  private listEl!: HTMLElement;
  private statusEl!: HTMLElement;
  private searchInput!: HTMLInputElement;
  private rendered = 0;
  private matches: PartialCSLEntry[] = [];
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

    // Search box at the top.
    this.searchInput = contentEl.createEl('input', {
      cls: 'sw-add-notes__search',
      attr: {
        type: 'search',
        placeholder: t('Search by citekey, author, title, abstract…'),
      },
    });
    this.searchInput.addEventListener('input', () => {
      this.query = this.searchInput.value;
      this.refresh();
    });

    // Filters (left column) + list (right).
    const body = contentEl.createDiv({ cls: 'sw-add-notes__body' });
    const side = body.createDiv({ cls: 'sw-add-notes__filters' });
    this.renderFilters(side);
    const main = body.createDiv({ cls: 'sw-add-notes__list' });
    this.listEl = main.createDiv({ cls: 'sw-add-notes__rows' });
    // Scroll = load more.
    main.addEventListener('scroll', () => {
      if (main.scrollTop + main.clientHeight >= main.scrollHeight - 200) {
        this.renderMore();
      }
    });
    this.statusEl = main.createDiv({ cls: 'sw-add-notes__status' });

    // Keyboard: Enter in the box refreshes (already bound); focus it.
    this.searchInput.focus();

    this.buildLitNoteIndex();
    this.refresh();
  }

  private renderFilters(side: HTMLElement): void {
    const mk = (
      label: string,
      key: keyof ImportFilters,
      desc?: string
    ) => {
      const row = side.createEl('label', { cls: 'sw-add-notes__filter' });
      const input = row.createEl('input', { type: 'checkbox' });
      input.checked = this.filters[key];
      input.addEventListener('change', () => {
        this.filters = { ...this.filters, [key]: input.checked };
        this.refresh();
      });
      row.appendText(' ' + label);
      if (desc) row.createEl('small', { text: desc, cls: 'sw-add-notes__hint' });
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

  private flagsFor(entry: PartialCSLEntry): ImportItemFlags {
    const stable =
      typeof entry._zoteroKey === 'string'
        ? entry.groupID && entry.groupID !== 1
          ? `${entry._zoteroKey}g${entry.groupID}`
          : entry._zoteroKey
        : '';
    const children = stable
      ? readChildren<RawZoteroChildren>(this.plugin.bibManager.childrenCache, stable)
      : null;
    return flagsFromChildren(children, this.litNotes.has(entry.id));
  }

  /** Re-run the search + filters and re-render the first page. */
  private refresh(): void {
    const q = this.query.trim();
    const limit = 100000; // score the whole library; we page for DISPLAY only
    const { entries } = q
      ? this.plugin.bibManager.searchTier('abstract', q, limit)
      : { entries: Array.from(this.plugin.bibManager.bibCache.values()).map((entry) => ({ entry, terms: [] as string[] })) };
    const all = entries
      .map((e: { entry: PartialCSLEntry }) => e.entry)
      .filter((e: PartialCSLEntry) => passesImportFilters(this.flagsFor(e), this.filters));
    this.matches = all;
    this.rendered = 0;
    this.listEl.empty();
    this.renderMore();
    this.updateStatus();
  }

  private renderMore(): void {
    const slice = this.matches.slice(this.rendered, this.rendered + PAGE);
    for (const entry of slice) this.renderRow(entry);
    this.rendered += slice.length;
    if (this.rendered < this.matches.length) {
      this.listEl.createDiv({ cls: 'sw-add-notes__more', text: t('Scroll for more…') });
    }
  }

  private renderRow(entry: PartialCSLEntry): void {
    const row = this.listEl.createDiv({ cls: 'sw-add-notes__row' });
    const check = row.createEl('input', { type: 'checkbox' });
    check.checked = this.selected.has(entry.id);
    check.addEventListener('click', (e) => e.stopPropagation());
    check.addEventListener('change', () => {
      if (check.checked) this.selected.add(entry.id);
      else this.selected.delete(entry.id);
      this.updateStatus();
    });

    const info = row.createDiv({ cls: 'sw-add-notes__info' });
    info.createDiv({ cls: 'sw-add-notes__title', text: entry.title ?? entry.id });
    const meta = info.createDiv({ cls: 'sw-add-notes__meta' });
    meta.createSpan({ text: `@${entry.id}` });
    if (entry.groupID && entry.groupID !== 1) {
      const name =
        this.plugin.settings.zoteroGroups?.find(
          (g: { id: number; name: string }) => g.id === entry.groupID
        )?.name ?? `Group ${entry.groupID}`;
      meta.createSpan({ cls: 'sw-add-notes__library', text: ` · ${name}` });
    }
    const flags = this.flagsFor(entry);
    if (flags.hasLitNote) {
      meta.createSpan({ cls: 'sw-add-notes__has-note', text: ` · ${t('has a note')}` });
    }

    row.addEventListener('click', () => {
      check.checked = !check.checked;
      check.dispatchEvent(new Event('change'));
    });
  }

  private updateStatus(): void {
    const total = this.matches.length;
    const n = this.selected.size;
    this.statusEl.setText(
      `${total} ${total === 1 ? t('reference') : t('references')}` +
        (n ? ` · ${n} ${t('selected')}` : '')
    );
    this.updateButtons();
  }

  private footerEl: HTMLElement | null = null;
  private updateButtons(): void {
    if (!this.footerEl) {
      this.footerEl = this.contentEl.createDiv({ cls: 'sw-add-notes__footer' });

      const selectAll = this.footerEl.createEl('button', { text: t('Select all shown') });
      selectAll.addEventListener('click', () => {
        for (const e of this.matches) this.selected.add(e.id);
        this.redrawChecks();
        this.updateStatus();
      });
      const clear = this.footerEl.createEl('button', { text: t('Clear') });
      clear.addEventListener('click', () => {
        this.selected.clear();
        this.redrawChecks();
        this.updateStatus();
      });

      const cancel = this.footerEl.createEl('button', { text: t('Close') });
      cancel.addEventListener('click', () => this.close());

      const confirm = this.footerEl.createEl('button', {
        text: t('Add notes'),
        cls: 'mod-cta',
      });
      confirm.addEventListener('click', () => void this.createSelected());
    }
    const confirm = this.footerEl.querySelector('.mod-cta') as HTMLButtonElement;
    if (confirm) confirm.setText(`${t('Add notes')} (${this.selected.size})`);
  }

  private redrawChecks(): void {
    const checks = this.listEl.querySelectorAll(
      'input[type=checkbox]'
    ) as NodeListOf<HTMLInputElement>;
    let i = 0;
    for (const entry of this.matches.slice(0, this.rendered)) {
      if (checks[i]) checks[i].checked = this.selected.has(entry.id);
      i++;
    }
  }

  private async createSelected(): Promise<void> {
    if (!this.selected.size) return;
    const citekeys = [...this.selected];
    this.close();
    const source =
      this.app.workspace.getActiveFile() ??
      (this.app.vault.getRoot() as unknown as TFile);
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
