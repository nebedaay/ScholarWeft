import { App, Modal, Setting } from 'obsidian';

import { setModalTitle } from './modalTitle';

/**
 * Offered once, after a scan finds literature notes carrying a `zotero-key`
 * that live outside the configured import folder (typically notes left behind
 * by a previous tool, e.g. ZotLit). Accepting means each such note is moved into
 * the import folder the next time ScholarWeft updates it, which stops the
 * import from creating a duplicate beside it. Declining leaves them where they
 * are; the automatic offer is made only once.
 */
export class MoveNotesModal extends Modal {
  private count: number;
  private folder: string;
  private onChoose: (move: boolean) => void;
  private chosen = false;

  constructor(
    app: App,
    opts: { count: number; folder: string; onChoose: (move: boolean) => void }
  ) {
    super(app);
    this.count = opts.count;
    this.folder = opts.folder;
    this.onChoose = opts.onChoose;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    setModalTitle(this, 'Move Literature Notes Into the Import Folder');

    contentEl.createEl('p', {
      text:
        `${this.count} literature note${this.count === 1 ? '' : 's'} with a ` +
        `“zotero-key” live outside your literature-note folder, “${this.folder}”.`,
    });
    contentEl.createEl('p', {
      text:
        'Move each one into that folder the next time it is updated? This keeps ' +
        'them where ScholarWeft expects and prevents a duplicate note being ' +
        'created beside them. Your notes’ filenames and links are preserved.',
    });

    new Setting(contentEl)
      .addButton((b) =>
        b
          .setButtonText('Move on update')
          .setCta()
          .onClick(() => this.choose(true))
      )
      .addButton((b) =>
        b
          .setButtonText('Leave them where they are')
          .onClick(() => this.choose(false))
      );
  }

  private choose(move: boolean): void {
    this.chosen = true;
    this.onChoose(move);
    this.close();
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.chosen) this.onChoose(false);
  }
}
