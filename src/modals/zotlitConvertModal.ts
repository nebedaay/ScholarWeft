import { App, Modal, Setting } from 'obsidian';

import type { ZotLitChoice } from '../template/note-lookup';

/**
 * Shown when our own template is about to render a note that ZotLit created.
 * Converting replaces ZotLit's `%%zt-managed%%` region (and its empty region
 * when there are no annotations) with ours, so the user is asked rather than
 * having their ZotLit notes silently reworked. "…and other notes" remembers the
 * decision as a setting (`ownNoteZotLitHandling`).
 */
export class ZotLitConvertModal extends Modal {
  private noteName: string;
  private onChoose: (choice: ZotLitChoice) => void;
  private chosen = false;

  constructor(
    app: App,
    noteName: string,
    onChoose: (choice: ZotLitChoice) => void
  ) {
    super(app);
    this.noteName = noteName;
    this.onChoose = onChoose;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h2', { text: 'This note was made by ZotLit' });
    contentEl.createEl('p', {
      text:
        `“${this.noteName}” has a ZotLit-managed area. Convert it to ` +
        `ScholarWeft's format (frontmatter plus a %%sw-managed%% annotations ` +
        `region), or leave ZotLit's area as it is? Converting applies to other ` +
        `ZotLit notes you update; leaving only affects this one.`,
    });
    new Setting(contentEl)
      .addButton((b) =>
        b
          .setButtonText('Convert to ScholarWeft’s format')
          .setCta()
          .onClick(() => this.choose('convert'))
      )
      .addButton((b) =>
        b
          .setButtonText('Leave ZotLit’s area as it is')
          .onClick(() => this.choose('leave'))
      );
  }

  private choose(choice: ZotLitChoice): void {
    this.chosen = true;
    this.onChoose(choice);
    this.close();
  }

  onClose(): void {
    this.contentEl.empty();
    // Dismissing the dialog leaves this note alone, without remembering.
    if (!this.chosen) this.onChoose('leave');
  }
}
