import { App, Modal, Setting } from 'obsidian';

import { noteFormatLabel, type NoteFormat } from '../template/note-format';

/**
 * Shown before an update that may change a note's formatting.
 *
 * Updating re-renders a note with whichever import path is selected, so a note
 * in the other tool's format — or one already in the selected format — can gain
 * or lose a managed region. Rather than silently reworking the file, say which
 * format the note is in and which one the update will apply, and offer both
 * "proceed" and "change the setting first".
 */
export class FormatChangeModal extends Modal {
  private noteName: string;
  private noteFormat: NoteFormat;
  private importingWithZotLit: boolean;
  private onChoose: (proceed: boolean) => void;
  private chosen = false;

  constructor(
    app: App,
    opts: {
      noteName: string;
      noteFormat: NoteFormat;
      importingWithZotLit: boolean;
      onChoose: (proceed: boolean) => void;
    }
  ) {
    super(app);
    this.noteName = opts.noteName;
    this.noteFormat = opts.noteFormat;
    this.importingWithZotLit = opts.importingWithZotLit;
    this.onChoose = opts.onChoose;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    const target = this.importingWithZotLit
      ? "ZotLit's format"
      : "ScholarWeft's format";

    contentEl.createEl('h2', { text: 'This note will be reformatted' });
    contentEl.createEl('p', {
      text:
        `“${this.noteName}” is in ${noteFormatLabel(this.noteFormat)}, but ` +
        `your import setting updates notes with ${target}. Updating it may ` +
        `change how the note is structured — including its managed annotations ` +
        `region. Your own writing outside that region is kept either way.`,
    });
    contentEl.createEl('p', {
      text:
        'Proceed with the update, or change the import setting under ' +
        'Settings → ScholarWeft → Literature note import before trying again?',
    });

    new Setting(contentEl)
      .addButton((b) =>
        b
          .setButtonText(`Proceed and update as ${target}`)
          .setCta()
          .onClick(() => this.choose(true))
      )
      .addButton((b) =>
        b.setButtonText('Change the setting first').onClick(() => this.choose(false))
      );
  }

  private choose(proceed: boolean): void {
    this.chosen = true;
    this.onChoose(proceed);
    this.close();
  }

  onClose(): void {
    this.contentEl.empty();
    // Dismissing is a "not now": leave the note alone.
    if (!this.chosen) this.onChoose(false);
  }
}
