import { App, Modal } from 'obsidian';
import type { CitekeyReconcilePlan } from '../template/note-lookup';

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

    const { renames, derived, blocked, unresolved } = this.plan;
    const actionable = renames.length > 0 || derived.length > 0;

    contentEl.createEl('h2', {
      text: actionable ? 'Citekey changes detected' : 'Citekey discrepancies',
    });

    if (actionable) {
      contentEl.createEl('p', {
        text:
          `Zotero has a new citekey for ${renames.length} reference` +
          `${renames.length !== 1 ? 's' : ''}. ScholarWeft will update the ` +
          `matching literature note${renames.length !== 1 ? 's' : ''}` +
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

      if (derived.length) {
        const details = contentEl.createEl('details', { cls: 'sw-rename-details' });
        details.createEl('summary', {
          text: `Associated files (${derived.length})`,
        }).style.cursor = 'pointer';
        const ul = details.createEl('ul');
        ul.style.maxHeight = '200px';
        ul.style.overflowY = 'auto';
        for (const d of derived) {
          const li = ul.createEl('li');
          this.link(li, d.path, d.path.split('/').pop());
          li.createSpan({
            text: `  →  ${d.newPath.split('/').pop()}`,
          });
        }
      }
    }

    // ── Could not be renamed: the target name is taken ────────────────────────
    if (blocked.length) {
      const heading = contentEl.createEl('p', {
        text:
          `Not renamed — the new name is already in use (${blocked.length}). ` +
          `Resolve the duplicate, then run this again:`,
      });
      heading.style.color = 'var(--text-warning, var(--text-error))';
      const ul = contentEl.createEl('ul', { cls: 'sw-unresolved-list' });
      ul.style.maxWidth = '100%';
      for (const r of blocked) {
        const li = ul.createEl('li');
        this.link(li, r.path, r.path.split('/').pop());
        li.createSpan({
          text: `  wants @${r.toKey}  (zotero-key ${r.zoteroKey})`,
        });
      }
    }

    // ── Not in the current Zotero library ─────────────────────────────────────
    if (unresolved.length) {
      const heading = contentEl.createEl('p', {
        text:
          `Not in the loaded Zotero library (${unresolved.length}) — the item ` +
          `was deleted, or its library is not loaded right now:`,
      });
      heading.style.color = 'var(--text-warning, var(--text-error))';
      const ul = contentEl.createEl('ul', { cls: 'sw-unresolved-list' });
      ul.style.maxWidth = '100%';
      for (const n of unresolved) {
        const li = ul.createEl('li');
        this.link(li, n.path, n.path.split('/').pop());
        li.createSpan({
          text: `  (zotero-key ${n.zoteroKey})`,
        });
      }
    }

    // ── Buttons ───────────────────────────────────────────────────────────────
    const buttonRow = contentEl.createDiv({ cls: 'sw-rename-buttons' });
    buttonRow.style.display = 'flex';
    buttonRow.style.justifyContent = 'flex-end';
    buttonRow.style.gap = '8px';
    buttonRow.style.marginTop = '16px';

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
