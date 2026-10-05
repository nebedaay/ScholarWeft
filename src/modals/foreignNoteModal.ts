import { App, Modal, Setting } from 'obsidian';

import type { ForeignNoteChoice } from '../template/note-lookup';
import { setModalTitle } from './modalTitle';

/**
 * Shown when a note carrying the item's stable `zotero-key` is found under a
 * filename that is not the item's current citekey — e.g. a note imported by
 * another plugin with its own naming scheme, or one left under an obsolete
 * citekey. The note IS this reference's note, so the user chooses whether to
 * convert and rename it, convert it but leave its `## Notes` section alone,
 * create a fresh note and leave the found one, or cancel.
 *
 * Asking each time (rather than remembering) keeps us from silently reworking
 * a file the user may have named and organised deliberately.
 */
export class ForeignNoteModal extends Modal {
  private noteName: string;
  private citekey: string;
  private noteCitekey: string | null;
  private onChoose: (choice: ForeignNoteChoice) => void;
  private chosen = false;

  constructor(
    app: App,
    opts: {
      noteName: string;
      citekey: string;
      /** The note's own `citekey:` frontmatter, when it records one. */
      noteCitekey?: string | null;
      onChoose: (choice: ForeignNoteChoice) => void;
    }
  ) {
    super(app);
    this.noteName = opts.noteName;
    this.citekey = opts.citekey;
    this.noteCitekey = opts.noteCitekey ?? null;
    this.onChoose = opts.onChoose;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    setModalTitle(this, 'A Note Already Exists for This Reference');

    contentEl.createEl('p', {
      text:
        `“${this.noteName}” is already associated with this Zotero item ` +
        `(its “zotero-key” matches), but its filename is not this item's ` +
        `current citekey, “@${this.citekey}”.`,
    });
    if (this.noteCitekey && this.noteCitekey !== this.citekey) {
      contentEl.createEl('p', {
        text: `The note itself records the citekey “${this.noteCitekey}”.`,
      });
    }
    contentEl.createEl('p', {
      text: 'What would you like to do with it? Your own writing outside the managed region is kept in every case.',
    });

    const options: Array<[ForeignNoteChoice, string, string]> = [
      [
        'convert',
        'Convert and rename',
        'Update/add the metadata and annotations, and append any Zotero notes to the existing “## Notes” section (your own notes there are kept).',
      ],
      [
        'convertIfEmpty',
        'Convert, add notes only if empty',
        'Same, but add Zotero notes only when the “## Notes” section is empty — the normal import behaviour.',
      ],
      [
        'new',
        'Create a new literature note',
        'Leave the found note exactly as it is and write a fresh “@' +
          this.citekey +
          '.md”.',
      ],
      ['cancel', 'Cancel', 'Change nothing.'],
    ];
    for (const [choice, label, desc] of options) {
      new Setting(contentEl)
        .setName(label)
        .setDesc(desc)
        .addButton((b) => {
          b.setButtonText(label).onClick(() => this.choose(choice));
          if (choice === 'convert') b.setCta();
        });
    }
  }

  private choose(choice: ForeignNoteChoice): void {
    this.chosen = true;
    this.onChoose(choice);
    this.close();
  }

  onClose(): void {
    this.contentEl.empty();
    // Dismissing means "not now": change nothing.
    if (!this.chosen) this.onChoose('cancel');
  }
}
