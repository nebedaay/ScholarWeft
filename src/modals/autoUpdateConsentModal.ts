import { App, Modal, Setting } from 'obsidian';

import { t } from '../lang/helpers';

/**
 * First-run consent for automatic literature-note updates. Shown the first time
 * a Zotero change is detected while the setting is UNSET — i.e. BEFORE any note
 * is modified. Yes/No sets the setting; dismissing counts as No.
 */
export class AutoUpdateConsentModal extends Modal {
  private answered = false;

  constructor(app: App, private readonly onChoose: (yes: boolean) => void) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl('h3', {
      text: t('Update literature notes automatically?'),
    });
    contentEl.createEl('p', {
      text: t(
        'ScholarWeft can update a literature note automatically whenever its Zotero item changes — its metadata, or one of its annotations or attachments. Your own writing is never touched: only the managed frontmatter fields and the annotations region are refreshed.'
      ),
    });
    new Setting(contentEl)
      .addButton((b) =>
        b
          .setButtonText(t('Yes'))
          .setCta()
          .onClick(() => this.choose(true))
      )
      .addButton((b) => b.setButtonText(t('No')).onClick(() => this.choose(false)));
  }

  private choose(yes: boolean): void {
    if (this.answered) return;
    this.answered = true;
    this.close();
    this.onChoose(yes);
  }

  onClose(): void {
    this.contentEl.empty();
    // Dismissing without answering = No (and it becomes the setting, so we
    // never prompt again).
    if (!this.answered) {
      this.answered = true;
      this.onChoose(false);
    }
  }
}
