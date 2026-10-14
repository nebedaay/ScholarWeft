import { App, Modal } from 'obsidian';
import type { CitekeyReconcilePlan } from '../template/note-lookup';
import { setModalTitle } from './modalTitle';

/**
 * Report + confirmation for a Zotero citekey reconcile pass.
 *
 * Always lists the discrepancies that cannot be fixed automatically — notes
 * whose target name is taken and notes whose `zotero-key` is not in the
 * loaded library — each as a clickable link, so the user knows exactly where
 * to go. When there is something to apply, an "Update citekeys" button
 * renames the notes, their derived files, and stale citations.
 */
export class CitekeyReconcileModal extends Modal {
  private plan: CitekeyReconcilePlan;
  private onConfirm: () => Promise<void>;

  constructor(
    app: App,
    plan: CitekeyReconcilePlan,
    onConfirm: () => Promise<void>
  ) {
    super(app);
    this.plan = plan;
    this.onConfirm = onConfirm;
  }

  /** A clickable internal link that opens the note. */
  private link(parent: HTMLElement, path: string, text?: string): void {
    const a = parent.createEl('a', {
      cls: 'internal-link',
      text: text ?? path,
      href: path,
    });
    a.addEventListener('click', (e) => {
      e.preventDefault();
      void this.app.workspace.openLinkText(path, '', false);
    });
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    const { renames, citeOnly, derived, blocked, unresolved, duplicateCitekeys } =
      this.plan;
    const actionable =
      renames.length > 0 || derived.length > 0 || citeOnly.length > 0;

    setModalTitle(
      this,
      actionable ? 'Citekey Changes Detected' : 'Citekey Discrepancies'
    );

    if (actionable) {
      contentEl.createEl('p', {
        text:
          `Zotero has new citekeys for ${renames.length + citeOnly.length} reference` +
          `${renames.length + citeOnly.length !== 1 ? 's' : ''}` +
          (citeOnly.length
            ? ` (${citeOnly.length} with no literature note)`
            : '') +
          `. ScholarWeft will update the matching literature note` +
          `${renames.length !== 1 ? 's' : ''}` +
          (derived.length
            ? ` and ${derived.length} associated file${derived.length !== 1 ? 's' : ''}`
            : '') +
          `, and update citations across the vault.`,
      });

      const mappingList = contentEl.createEl('ul', { cls: 'sw-rename-mapping' });
      for (const r of renames) {
        const li = mappingList.createEl('li');
        li.createSpan({
          text: `${r.fromKey ? `@${r.fromKey}` : r.path.split('/').pop()}  →  @${r.toKey}   `,
        });
        this.link(li, r.path, r.path.split('/').pop());
      }

      if (citeOnly.length) {
        const details = contentEl.createEl('details', {
          cls: 'sw-rename-details',
        });
        details.createEl('summary', {
          text: `Citations with no literature note (${citeOnly.length})`,
        }).setCssStyles({ cursor: 'pointer' });
        const ul = details.createEl('ul');
        ul.setCssStyles({ maxHeight: '200px' });
        ul.setCssStyles({ overflowY: 'auto' });
        for (const c of citeOnly) {
          ul.createEl('li', { text: `@${c.fromKey}  →  @${c.toKey}` });
        }
      }

      if (derived.length) {
        const details = contentEl.createEl('details', { cls: 'sw-rename-details' });
        details.createEl('summary', {
          text: `Associated files (${derived.length})`,
        }).setCssStyles({ cursor: 'pointer' });
        const ul = details.createEl('ul');
        ul.setCssStyles({ maxHeight: '200px' });
        ul.setCssStyles({ overflowY: 'auto' });
        for (const d of derived) {
          const li = ul.createEl('li');
          this.link(li, d.path, d.path.split('/').pop());
          li.createSpan({
            text: `  →  ${d.newPath.split('/').pop()}`,
          });
        }
      }
    }

    // ── Two items share one citekey ───────────────────────────────────────────
    if (duplicateCitekeys.length) {
      const heading = contentEl.createEl('p', {
        text:
          `Two or more items share the same citekey (${duplicateCitekeys.length}). ` +
          `A citekey must be unique, so this has to be fixed in Zotero — Better ` +
          `BibTeX adds a trailing letter automatically, but a hand-edited citekey ` +
          `can collide. Change one of them, then run this again:`,
      });
      heading.setCssStyles({ color: 'var(--text-warning, var(--text-error))' });
      const ul = contentEl.createEl('ul', { cls: 'sw-unresolved-list' });
      ul.setCssStyles({ maxWidth: '100%' });
      for (const d of duplicateCitekeys) {
        const li = ul.createEl('li');
        li.createSpan({ text: `@${d.citekey}: ` });
        d.paths.forEach((p, i) => {
          if (i > 0) li.createSpan({ text: ', ' });
          this.link(li, p, p.split('/').pop());
        });
      }
    }

    // ── Could not be renamed: the target name is taken ────────────────────────
    if (blocked.length) {
      const heading = contentEl.createEl('p', {
        text:
          `Not renamed — the new name is already in use (${blocked.length}). ` +
          `Resolve the duplicate, then run this again:`,
      });
      heading.setCssStyles({ color: 'var(--text-warning, var(--text-error))' });
      const ul = contentEl.createEl('ul', { cls: 'sw-unresolved-list' });
      ul.setCssStyles({ maxWidth: '100%' });
      for (const r of blocked) {
        const li = ul.createEl('li');
        this.link(li, r.path, r.path.split('/').pop());
        li.createSpan({
          text: `  wants @${r.toKey}  (sw-zotero-id ${r.zoteroKey})`,
        });
      }
    }

    // ── Not in the current Zotero library ─────────────────────────────────────
    if (unresolved.length) {
      const heading = contentEl.createEl('p', {
        text:
          `Not found in the loaded Zotero libraries (${unresolved.length}). ` +
          `This usually means the item was deleted, or the library it lives in ` +
          `is not currently enabled in ScholarWeft's settings:`,
      });
      heading.setCssStyles({ color: 'var(--text-warning, var(--text-error))' });
      const ul = contentEl.createEl('ul', { cls: 'sw-unresolved-list' });
      ul.setCssStyles({ maxWidth: '100%' });
      for (const n of unresolved) {
        const li = ul.createEl('li');
        this.link(li, n.path, n.path.split('/').pop());
        li.createSpan({
          text: `  (sw-zotero-id ${n.zoteroKey})`,
        });
      }
    }

    // ── Buttons ───────────────────────────────────────────────────────────────
    const buttonRow = contentEl.createDiv({ cls: 'sw-rename-buttons' });
    buttonRow.setCssStyles({ display: 'flex' });
    buttonRow.setCssStyles({ justifyContent: 'flex-end' });
    buttonRow.setCssStyles({ gap: '8px' });
    buttonRow.setCssStyles({ marginTop: '16px' });

    if (!actionable) {
      const closeBtn = buttonRow.createEl('button', { text: 'Close', cls: 'mod-cta' });
      closeBtn.addEventListener('click', () => this.close());
      return;
    }

    const cancelBtn = buttonRow.createEl('button', { text: 'Cancel' });
    cancelBtn.addEventListener('click', () => this.close());

    const confirmBtn = buttonRow.createEl('button', {
      text: 'Update citekeys',
      cls: 'mod-cta',
    });
    confirmBtn.addEventListener('click', async () => {
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Updating…';
      try {
        await this.onConfirm();
      } finally {
        this.close();
      }
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}
