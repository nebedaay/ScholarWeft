import { App, Modal, Setting } from 'obsidian';

import { noteFormatLabel, type NoteFormat } from '../template/note-format';
import { setModalTitle } from './modalTitle';

/**
 * Shown before an update that would change a note's formatting.
 *
 * A note in another tool's format — ZotLit's — gains a managed region when
 * ScholarWeft updates it. Rather than silently reworking the file, say which
 * format the note is in and that the update will convert it, and offer both
 * "proceed" and "leave it alone".
 */
export class FormatChangeModal extends Modal {
  private noteName: string;
  private noteFormat: NoteFormat;
  private onChoose: (proceed: boolean) => void;
  private chosen = false;

  constructor(
    app: App,
    opts: {
      noteName: string;
      noteFormat: NoteFormat;
      onChoose: (proceed: boolean) => void;
    }
  ) {
    super(app);
    this.noteName = opts.noteName;
    this.noteFormat = opts.noteFormat;
    this.onChoose = opts.onChoose;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    setModalTitle(this, 'This Note Will Be Reformatted');
    contentEl.createEl('p', {
      text:
        `“${this.noteName}” is in ${noteFormatLabel(this.noteFormat)}, but ` +
        `updating it will apply ScholarWeft's format. That may change how the ` +
        `note is structured — including its managed annotations region. Your ` +
        `own writing outside that region is kept either way.`,
    });
    contentEl.createEl('p', {
      text: 'Proceed with the update, or leave the note as it is?',
    });

    new Setting(contentEl)
      .addButton((b) =>
        b
          .setButtonText("Proceed and convert to ScholarWeft's format")
          .setCta()
          .onClick(() => this.choose(true))
      )
      .addButton((b) =>
        b.setButtonText('Leave it alone').onClick(() => this.choose(false))
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
