// Zotero data explorer: browse the loaded Zotero library and preview exactly
// what the note template would produce for an item, without writing a file.
//
// The list is the in-memory `bibCache` (already merged from Zotero/BBT); the
// preview fetches the item's children live and runs the real render pipeline, so
// what you see here is what an import would write.

import { ItemView, WorkspaceLeaf, setIcon } from 'obsidian';

import type ReferenceList from './main';
import { fetchChildren, readTemplate, resolveZoteroDataDir } from './noteImport';
import { buildNoteContextWithChildren } from './template/children';
import type { CachedEntry } from './template/context';
import { prepareTemplateData } from './template/note-helpers';
import { renderNote } from './template/render';
import {
  buildExplorerList,
  filterExplorerEntries,
  type ExplorerEntry,
} from './template/explorer';

export const dataExplorerViewType = 'scholar-weft-data-explorer';

type PreviewKind = 'render' | 'data';

export class DataExplorerView extends ItemView {
  plugin: ReferenceList;
  private entries: ExplorerEntry[] = [];
  private query = '';
  private selected: string | null = null;
  private previewKind: PreviewKind = 'render';
  private listEl!: HTMLElement;
  private previewEl!: HTMLElement;
  private tabButtons: Record<PreviewKind, HTMLElement> = {} as never;

  constructor(leaf: WorkspaceLeaf, plugin: ReferenceList) {
    super(leaf);
    this.plugin = plugin;
    this.contentEl.addClass('sw-data-explorer');
    this.navigation = false;
  }

  getViewType(): string {
    return dataExplorerViewType;
  }

  getDisplayText(): string {
    return 'Zotero data explorer';
  }

  getIcon(): string {
    return 'library';
  }

  async onOpen(): Promise<void> {
    this.render();
  }

  private reloadEntries(): void {
    this.entries = buildExplorerList(
      (this.plugin.bibManager?.bibCache ?? new Map()) as Map<string, CachedEntry>
    );
  }

  private render(): void {
    this.reloadEntries();
    const root = this.contentEl;
    root.empty();

    const header = root.createDiv({ cls: 'sw-data-explorer__header' });
    header.createDiv({ cls: 'sw-data-explorer__title', text: 'Zotero explorer' });
    const reload = header.createDiv({
      cls: 'clickable-icon',
      attr: { 'aria-label': 'Reload list from the loaded library' },
    });
    setIcon(reload, 'lucide-refresh-cw');
    reload.onClickEvent(() => this.render());

    const search = root.createEl('input', {
      cls: 'sw-data-explorer__search',
      attr: { type: 'search', placeholder: 'Filter by title, author, citekey…' },
    });
    search.value = this.query;
    search.addEventListener('input', () => {
      this.query = search.value;
      this.renderList();
    });

    this.listEl = root.createDiv({ cls: 'sw-data-explorer__list' });

    const panel = root.createDiv({ cls: 'sw-data-explorer__panel' });
    const tabs = panel.createDiv({ cls: 'sw-data-explorer__tabs' });
    for (const [kind, label] of [
      ['render', 'Preview'],
      ['data', 'Data'],
    ] as Array<[PreviewKind, string]>) {
      const btn = tabs.createEl('button', {
        cls: 'sw-data-explorer__tab',
        text: label,
      });
      this.tabButtons[kind] = btn;
      btn.onClickEvent(() => {
        this.previewKind = kind;
        this.updateTabs();
        void this.renderPreview();
      });
    }
    this.previewEl = panel.createDiv({ cls: 'sw-data-explorer__preview' });

    this.updateTabs();
    this.renderList();
  }

  private updateTabs(): void {
    for (const [kind, btn] of Object.entries(this.tabButtons)) {
      btn.toggleClass('is-active', kind === this.previewKind);
    }
  }

  private renderList(): void {
    this.listEl.empty();
    const shown = filterExplorerEntries(this.entries, this.query);
    if (!shown.length) {
      this.listEl.createDiv({
        cls: 'sw-data-explorer__empty',
        text: this.entries.length
          ? 'No items match the filter.'
          : 'No Zotero items loaded yet — is Zotero running?',
      });
      return;
    }

    for (const entry of shown) {
      const item = this.listEl.createDiv({
        cls: 'sw-data-explorer__item',
      });
      item.toggleClass('is-selected', entry.citekey === this.selected);
      item.createDiv({ cls: 'sw-data-explorer__item-title', text: entry.title });
      const meta = item.createDiv({ cls: 'sw-data-explorer__item-meta' });
      meta.createSpan({ text: entry.citekey });
      if (entry.itemType) {
        meta.createSpan({ cls: 'sw-data-explorer__badge', text: entry.itemType });
      }
      if (entry.creatorNames) {
        meta.createSpan({ text: entry.creatorNames });
      }
      item.onClickEvent(() => {
        this.selected = entry.citekey;
        this.renderList();
        void this.renderPreview();
      });
    }
  }

  private setPreview(text: string, isError = false): void {
    this.previewEl.empty();
    this.previewEl.toggleClass('is-error', isError);
    this.previewEl.createEl('pre', { text });
  }

  private async renderPreview(): Promise<void> {
    const citekey = this.selected;
    if (!citekey) {
      this.setPreview('Select an item to preview its note.');
      return;
    }
    this.setPreview('Rendering…');

    const entry = (this.plugin.bibManager?.bibCache?.get(citekey) ?? null) as
      | CachedEntry
      | null;
    if (!entry) {
      this.setPreview(`Item “${citekey}” is no longer in the library.`, true);
      return;
    }

    try {
      const children = await fetchChildren(this.plugin, entry);
      if (this.selected !== citekey) return; // selection moved on

      const groupID = entry.groupID && entry.groupID !== 1 ? entry.groupID : null;
      const dataDir = resolveZoteroDataDir(this.plugin.settings.zoteroDataDir);
      const noteHeadingLevel =
        this.plugin.settings.ownNoteNotesHeadingLevel ?? 3;

      if (this.previewKind === 'data') {
        const ctx = buildNoteContextWithChildren(entry, children, {
          groupID,
          dataDir,
          noteHeadingLevel,
        });
        prepareTemplateData(ctx, {});
        this.setPreview(
          JSON.stringify(
            ctx,
            (_k, v) => (typeof v === 'function' ? undefined : v),
            2
          )
        );
        return;
      }

      const templateSource = await readTemplate(this.plugin);
      if (this.selected !== citekey) return;
      if (!templateSource) {
        this.setPreview(
          'Own note template not found in the plugin folder (sw-note-templates/sw-note.eta.md).',
          true
        );
        return;
      }

      const { content } = renderNote(entry, children, {
        templateSource,
        groupID,
        dataDir,
        noteHeadingLevel,
      });
      if (this.selected !== citekey) return;
      this.setPreview(content);
    } catch (e) {
      this.setPreview(`Render failed: ${(e as Error)?.message ?? e}`, true);
    }
  }
}
