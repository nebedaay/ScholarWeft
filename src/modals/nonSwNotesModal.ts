import { App, Modal, Setting } from 'obsidian';

import { setModalTitle } from './modalTitle';

/** The one-time answer for literature notes ScholarWeft does not manage. */
export type NonSwNotesChoice = 'convert' | 'leave' | 'ask';

/**
 * One-time offer, after the library loads, to take over literature notes
 * ScholarWeft does not manage — whether another plugin created them (ZotLit
 * writes a `%%zt-managed%%` region and a `zotero-key` property; Zotero
 * Integration writes a `citekey`), or they predate its own identity property.
 *
 * Why this exists: the automatic update deliberately never opens a modal
 * mid-batch, so it SKIPS such notes. Without this prompt they would be skipped
 * silently and could sit un-adopted forever. Asking once — and recording the
 * answer in the "Literature notes from other plugins" setting — turns that into
 * an explicit choice the user can change later.
 */
export class NonSwNotesModal extends Modal {
  private count: number;
  private onChoose: (choice: NonSwNotesChoice) => void;
  private chosen = false;

  constructor(
    app: App,
    count: number,
    onChoose: (choice: NonSwNotesChoice) => void
  ) {
    super(app);
    this.count = count;
    this.onChoose = onChoose;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    const n = this.count;
    const one = n === 1;
    setModalTitle(this, 'Literature Notes ScholarWeft Doesn’t Manage');
    contentEl.createEl('p', {
      text:
        `ScholarWeft found ${n} literature note${one ? '' : 's'} it does not ` +
        `manage — ${one ? 'it' : 'they'} may not have been created by ` +
        `ScholarWeft (perhaps by another plugin, or before ScholarWeft ` +
        `started recording its own identity). Adopting lets ScholarWeft take ` +
        `over and keep ${one ? 'it' : 'them'} up to date; leaving ` +
        `${one ? 'it' : 'them'} alone means ScholarWeft still links to ` +
        `${one ? 'it' : 'them'} for citations but never updates ` +
        `${one ? 'it' : 'them'}.`,
    });
    contentEl.createEl('p', {
      text:
        'You can change this any time under Settings → ScholarWeft → ' +
        'Literature note import.',
    });
    new Setting(contentEl)
      .addButton((b) =>
        b
          .setButtonText(one ? 'Adopt it' : 'Adopt them all')
          .setCta()
          .onClick(() => this.choose('convert'))
      )
      .addButton((b) =>
        b
          .setButtonText(one ? 'Leave it alone' : 'Leave them alone')
          .onClick(() => this.choose('leave'))
      )
      .addButton((b) =>
        b.setButtonText('Ask me each time').onClick(() => this.choose('ask'))
      );
  }

  private choose(choice: NonSwNotesChoice): void {
    this.chosen = true;
    this.onChoose(choice);
    this.close();
  }

  onClose(): void {
    this.contentEl.empty();
    // Dismissing keeps the current default (ask), so nothing is decided by
    // accident.
    if (!this.chosen) this.onChoose('ask');
  }
}
