import { App, Modal, Setting } from 'obsidian';

import { t } from '../lang/helpers';
import { setModalTitle } from './modalTitle';

/**
 * First-run consent for AUTOMATIC citekey updating (renaming a literature note
 * and its associated files, and updating citations, when Zotero gives a
 * reference a new citekey). Shown BEFORE the first rename while the setting is
 * unset. "Yes" applies now and every time after; "No" disables it; "Skip"
 * (dismissing) keeps the setting unset so the user can decide next time.
 */
export class CitekeyConsentModal extends Modal {
  private answered = false;

  constructor(
    app: App,
    private readonly onChoose: (answer: 'yes' | 'no' | 'ask') => void
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    setModalTitle(this, t('Citekey Changes Detected'));
    contentEl.createEl('p', {
      text: t(
        'Zotero has given one or more references a new citekey. ScholarWeft can rename the matching literature notes (and their associated files) and update citations across the vault. Do this automatically from now on?'
      ),
    });
    new Setting(contentEl)
      .addButton((b) =>
        b.setButtonText(t('Yes')).setCta().onClick(() => this.choose('yes'))
      )
      .addButton((b) =>
        b.setButtonText(t('No')).onClick(() => this.choose('no'))
      )
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
    // Dismissing leaves the setting UNSET, so the user is asked again.
    if (!this.answered) {
      this.answered = true;
      this.onChoose('ask');
    }
  }
}
