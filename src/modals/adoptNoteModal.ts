import { App, Modal, Setting } from 'obsidian';

import { setModalTitle } from './modalTitle';

/** The remembered answer for an existing `@citekey.md` with no `sw-zotero-id`. */
export type AdoptNoteChoice = 'adopt' | 'new' | 'cancel';

export interface AdoptNoteAnswer {
  choice: AdoptNoteChoice;
  /** Apply this choice to every such note from now on, without asking. */
  remember: boolean;
}

/**
 * Shown when a note already sits at the conventional `@citekey.md` but carries
 * no `sw-zotero-id`, so ScholarWeft cannot tell whether it is this reference's
 * note (a user's own, or one from before ScholarWeft) or a different file that
 * happens to be named after the citekey.
 *
 * Adopting takes it over: the managed frontmatter and annotations region are
 * written into it, and it gains `sw-zotero-id`. Creating a new note leaves it
 * untouched and writes a suffixed sibling. The choice can be remembered, since
 * once the user has opted into ScholarWeft a stray `@citekey.md` is almost
 * always the reference's own note.
 */
export class AdoptNoteModal extends Modal {
  private noteName: string;
  private citekey: string;
  private onChoose: (answer: AdoptNoteAnswer) => void;
  private chosen = false;
  private remember = true;

  constructor(
    app: App,
    opts: {
      noteName: string;
      citekey: string;
      onChoose: (answer: AdoptNoteAnswer) => void;
    }
  ) {
    super(app);
    this.noteName = opts.noteName;
    this.citekey = opts.citekey;
    this.onChoose = opts.onChoose;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    setModalTitle(this, 'A Note With This Citekey Already Exists');

    contentEl.createEl('p', {
      text:
        `“${this.noteName}” already exists, but it has no “sw-zotero-id”, so ` +
        `ScholarWeft does not know whether it is this reference's note or a ` +
        `different file. Adopt it — ScholarWeft writes its managed metadata ` +
        `and annotations into it — or leave it untouched and create a separate ` +
        `note.`,
    });

    new Setting(contentEl)
      .addButton((b) =>
        b
          .setButtonText('Adopt it as this reference’s note')
          .setCta()
          .onClick(() => this.choose('adopt'))
      )
      .addButton((b) =>
        b
          .setButtonText('Create a separate note')
          .onClick(() => this.choose('new'))
      )
      .addButton((b) => b.setButtonText('Cancel').onClick(() => this.choose('cancel')));

    new Setting(contentEl)
      .setName('Always do this')
      .setDesc(
        'Apply this choice to every such note from now on, without asking again.'
      )
      .addToggle((t) =>
        t.setValue(this.remember).onChange((v) => {
          this.remember = v;
        })
      );
  }

  private choose(choice: AdoptNoteChoice): void {
    this.chosen = true;
    this.onChoose({ choice, remember: this.remember });
    this.close();
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.chosen) this.onChoose({ choice: 'cancel', remember: false });
  }
}
