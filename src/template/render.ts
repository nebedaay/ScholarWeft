// One-call note render: cached entry + raw Zotero children → final note text.
//
// Pure (no vault, no network): the caller fetches the entry and children, reads
// the template source, and writes the result. Keeping it here means the whole
// "context → render → re-import merge → filename" pipeline is unit-testable
// without Obsidian's file layer.

import { buildNoteContextWithChildren, type RawZoteroChildren } from './children';
import type { CachedEntry } from './context';
import { makeEta } from './engine';
import {
  prepareTemplateData,
  type NoteImportOptions,
} from './note-helpers';

export interface RenderNoteOptions {
  /** The `.eta.md` template source. */
  templateSource: string;
  /** Import behaviour (notes mode/level, creator/annotation defaults). */
  options?: NoteImportOptions;
  /** Deterministic tests; defaults to today. */
  importDate?: string;
  /** Library scope; defaults from the entry. */
  groupID?: number | null;
  /** Zotero data directory, for attachment paths + excerpt images. */
  dataDir?: string | null;
  /** Zotero `baseAttachmentPath` pref, for `attachments:`-relative files. */
  baseAttachmentPath?: string | null;
  /** Vault-relative note path; enables `note_link`. */
  notePath?: string | null;
  /** Level a child note's shallowest heading lands at (default 3). */
  noteHeadingLevel?: number;
  /**
   * The note as it already exists (or `null` for a first import). When set, the
   * managed frontmatter fields and managed region are refreshed and everything
   * else is preserved.
   */
  existingContent?: string | null;
}

export interface RenderedNote {
  /** The full note text to write (already merged when `existingContent` was given). */
  content: string;
  /** Filename from `set_file_name()`, else `@<citekey>`. */
  fileName: string;
}

/** Render a literature note from a cached entry and its raw Zotero children. */
export function renderNote(
  entry: CachedEntry | null | undefined,
  children: RawZoteroChildren,
  opts: RenderNoteOptions
): RenderedNote {
  const ctx = buildNoteContextWithChildren(entry, children, {
    groupID: opts.groupID,
    dataDir: opts.dataDir,
    baseAttachmentPath: opts.baseAttachmentPath,
    notePath: opts.notePath,
    noteHeadingLevel: opts.noteHeadingLevel,
  });

  prepareTemplateData(ctx, {
    options: opts.options,
    importDate: opts.importDate,
  });

  const engine = makeEta();
  const rendered = engine.renderString(opts.templateSource, ctx);
  const content = engine.noteHelpers.mergeInto(
    ctx,
    opts.existingContent ?? null,
    rendered
  );
  return { content, fileName: engine.noteHelpers.fileName(ctx) };
}
