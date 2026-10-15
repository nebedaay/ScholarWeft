/**
 * Obsidian's DOM helpers, reached through the window that owns the document.
 *
 * Obsidian declares `createEl` / `createDiv` / `createSpan` / `createFragment`
 * as globals AND hangs them on the window, which is the popout-safe form the
 * community-directory review asks for in place of `document.createElement`.
 * The published typings only cover the global declarations, so this accessor
 * types what is there at runtime — no `any`, and no per-site cast.
 */
export type ObsidianWindow = Window & {
  createEl: typeof createEl;
  createDiv: typeof createDiv;
  createSpan: typeof createSpan;
  createFragment: typeof createFragment;
};

/** The Obsidian-aware window for a document (a popout has its own). */
export function winOf(doc: Document): ObsidianWindow {
  return doc.win as ObsidianWindow;
}
