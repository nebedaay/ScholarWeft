import { App, Modal, Setting } from 'obsidian';

import { t } from '../lang/helpers';

/**
 * First-run consent for updating notes when the TEMPLATE changes. Shown BEFORE
 * anything is re-rendered while the setting is unset. Yes applies now and every
 * time after; No disables it; Skip (dismiss) leaves the setting unset so the user
 * can decide next time.
 */
export class TemplateUpdateConsentModal extends Modal {
  private answered = false;

  constructor(
    app: App,
    private readonly count: number,
    private readonly onChoose: (answer: 'yes' | 'no' | 'ask') => void
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl('h3', { text: t('The note template has changed') });
    contentEl.createEl('p', {
      text:
        `${this.count} literature note${this.count !== 1 ? 's were' : ' was'} ` +
        `${this.count !== 1 ? 'rendered' : 'rendered'} with an older template. ` +
        t(
          'ScholarWeft can update them to the current template — only the managed frontmatter fields and the annotations region change; your own writing is untouched.'
        ),
    });
    new Setting(contentEl)
      .addButton((b) =>
        b.setButtonText(t('Yes')).setCta().onClick(() => this.choose('yes'))
      )
      .addButton((b) => b.setButtonText(t('No')).onClick(() => this.choose('no')))
      .addButton((b) =>
        b.setButtonText(t('Skip')).onClick(() => this.choose('ask'))
      );
  }

  private choose(answer: 'yes' | 'no' | 'ask'): void {
    if (this.answered) return;
    this.answered = true;
    this.close();
    this.onChoose(answer);
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.answered) {
      this.answered = true;
      this.onChoose('ask');
    }
  }
}
