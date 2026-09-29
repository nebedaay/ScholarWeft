import { App, Modal, Setting } from 'obsidian';

import { t } from '../lang/helpers';
import { estimateMinutes } from '../template/update-rate';
import { setModalTitle } from './modalTitle';

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
    private readonly onChoose: (answer: 'yes' | 'no' | 'ask') => void,
    /** The learned notes-per-minute, so the estimate matches the batch notice. */
    private readonly notesPerMinute?: number
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    const estimate = estimateMinutes(this.count, this.notesPerMinute);
    setModalTitle(this, t('The Note Template Has Changed'));
    contentEl.createEl('p', {
      text:
        `${this.count} literature note${this.count !== 1 ? 's were' : ' was'} ` +
        `rendered with an older template. Updating ${
          this.count !== 1 ? 'them' : 'it'
        } takes about ${estimate} minute${estimate !== 1 ? 's' : ''}.`,
    });
    contentEl.createEl('p', {
      text: t(
        'Only the managed frontmatter fields and the annotations region change — your own writing is never overwritten, and you can keep working while it runs.'
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
