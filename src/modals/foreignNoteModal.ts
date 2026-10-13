import { App, Modal, Setting } from 'obsidian';

import type { ForeignNoteChoice } from '../template/note-lookup';
import { setModalTitle } from './modalTitle';

/**
 * Shown when a note carrying the item's stable `sw-zotero-id` is found under a
 * filename that is not the item's current citekey — e.g. a note imported by
 * another plugin with its own naming scheme, or one left under an obsolete
 * citekey. The note IS this reference's note, so the user chooses whether to
 * convert and rename it, convert it but leave its `## Notes` section alone,
 * create a fresh note and leave the found one, or cancel.
 *
 * Once the user has opted into ScholarWeft, note names other than `@citekey`
 * make little sense, so the choice can be REMEMBERED ("Always do this") and
 * applied silently from then on. The checkbox is pre-ticked for that reason;
 * untick it to be asked again next time.
 */
export interface ForeignNoteAnswer {
  choice: ForeignNoteChoice;
  /** Apply this choice to every such note from now on, without asking. */
  remember: boolean;
}

export class ForeignNoteModal extends Modal {
  private noteName: string;
  private citekey: string;
  private noteCitekey: string | null;
  private onChoose: (answer: ForeignNoteAnswer) => void;
  private chosen = false;
  private remember = true;

  constructor(
    app: App,
    opts: {
      noteName: string;
      citekey: string;
      /** The note's own `citekey:` frontmatter, when it records one. */
      noteCitekey?: string | null;
      onChoose: (answer: ForeignNoteAnswer) => void;
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
        `(its “sw-zotero-id” matches), but its filename is not this item's ` +
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

    new Setting(contentEl)
      .setName('Always do this')
      .setDesc(
        'Apply this choice to every note found under a non-citekey name from now on, without asking again. Untick to be asked next time.'
      )
      .addToggle((t) =>
        t.setValue(this.remember).onChange((v) => {
          this.remember = v;
        })
      );
  }

  private choose(choice: ForeignNoteChoice): void {
    this.chosen = true;
    this.onChoose({ choice, remember: this.remember });
    this.close();
  }

  onClose(): void {
    this.contentEl.empty();
    // Dismissing means "not now": change nothing, and remember nothing.
    if (!this.chosen) this.onChoose({ choice: 'cancel', remember: false });
  }
}
