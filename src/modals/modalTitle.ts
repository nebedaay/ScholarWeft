import { Modal } from 'obsidian';

/**
 * Set a modal's title the STANDARD Obsidian way.
 *
 * `Modal.titleEl` is the `.modal-title` element in the modal's top bar, level
 * with the close button — themed by the app (centred, `--font-ui-medium`,
 * medium weight). Creating an `<h3>`/`<h2>` in `contentEl` instead wastes a
 * content row and renders in the body font, which is why every modal here uses
 * this (the ZotLit prompt in `bib/bibManager.ts` already did).
 *
 * `sw-modal-title` is added so our own weight/spacing can be tuned in ONE place
 * without overriding the theme's heading treatment.
 */
export function setModalTitle(modal: Modal, title: string): void {
  modal.titleEl.setText(title);
  modal.titleEl.addClass('sw-modal-title');
}
