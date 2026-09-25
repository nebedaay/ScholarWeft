// Annotation post-processing for the note context.
//
// Two transformations, both ported from the user's `zotlit-content.eta.md` so
// our own template and the ZotLit-compatible set produce identical regions:
//
//  1. ORDER — ZotLit (and Zotero's reader) show annotations in PDF reading
//     order (`annotationSortIndex`), but the local API returns them in
//     date-added order, which looked reversed.
//  2. "+" CONTINUATIONS — an annotation whose comment begins with "+" is a
//     continuation of the PREVIOUS annotation when ALL of these hold:
//       - it has content to join (excerpt text on highlight/underline, an image
//         on image/ink — a pure comment selects nothing and cannot join);
//       - it is the SAME type as the previous annotation;
//       - it is on the SAME attachment (PDF/document).
//     Its content is appended after " ... " (chaining across several "+"
//     annotations): excerpt text joins the previous text, image/ink content is
//     carried as extra blocks in the same callout (no separator line — the
//     blocks themselves show the break), page labels become a range, tags
//     union, and the marker itself is stripped. Any comment text after the "+"
//     joins the previous comment with " ... ". A "+" that cannot join is
//     still emitted, just without the marker.

import type { NoteContextAnnotation, NoteContextTag } from './context';

/** Leading plus, with any spaces after it. */
const CONTINUATION = /^\+\s*/;

/** Joins excerpt text / comments of merged annotations. */
export const CONTINUATION_SEPARATOR = ' ... ';

/**
 * Zotero's own reading order: `annotationSortIndex`, then date added, then key.
 * Annotations always carry a sort index; the fallbacks only matter for
 * hand-built contexts.
 */
export function sortAnnotations(
  annotations: NoteContextAnnotation[]
): NoteContextAnnotation[] {
  return [...annotations].sort((a, b) => {
    if (a.sortIndex && b.sortIndex && a.sortIndex !== b.sortIndex) {
      return a.sortIndex < b.sortIndex ? -1 : 1;
    }
    if (a.sortIndex && !b.sortIndex) return -1;
    if (!a.sortIndex && b.sortIndex) return 1;
    if (a.dateAdded !== b.dateAdded) return a.dateAdded < b.dateAdded ? -1 : 1;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
}

function unionTags(
  previous: NoteContextTag[] | undefined,
  extra: NoteContextTag[]
): NoteContextTag[] {
  const seen = new Set((previous ?? []).map((t) => t.name));
  return [...(previous ?? []), ...extra.filter((t) => !seen.has(t.name))];
}

function isMedia(a: NoteContextAnnotation): boolean {
  return a.type === 'image' || a.type === 'ink';
}

/**
 * Does this annotation carry content that can join a previous one? Excerpt text
 * for highlights/underlines, an image for image/ink annotations. A pure comment
 * (`text`/`note`, or a highlight with no excerpt) has nothing to join.
 */
export function hasMergeableContent(a: NoteContextAnnotation): boolean {
  if ((a.type === 'highlight' || a.type === 'underline') && a.text) return true;
  if (isMedia(a) && a.imgLink) return true;
  return false;
}

/**
 * Fold "+"-continuation annotations into the annotation they continue, in one
 * pass over the whole annotations list. A continuation joins only when it has
 * content, is the SAME type as the previous annotation, and shares its
 * attachment; otherwise it is emitted unchanged (marker stripped). Callers pass
 * the full annotations array — the function handles every annotation type
 * itself, so no template has to reimplement the rule.
 */
export function mergeContinuationAnnotations(
  annotations: NoteContextAnnotation[],
  separator: string = CONTINUATION_SEPARATOR
): NoteContextAnnotation[] {
  const merged: NoteContextAnnotation[] = [];
  let previous: NoteContextAnnotation | null = null;

  for (const original of annotations) {
    const a: NoteContextAnnotation = { ...original };
    const isContinuation =
      typeof a.comment === 'string' && CONTINUATION.test(a.comment);

    if (
      isContinuation &&
      previous &&
      a.type === previous.type &&
      a.parentAttachment?.key === previous.parentAttachment?.key &&
      hasMergeableContent(a)
    ) {
      a.comment = a.comment.replace(CONTINUATION, '');
      // Excerpt text joins the previous annotation's text...
      if (a.text) {
        previous.text =
          [previous.text?.trim(), a.text.trim()]
            .filter(Boolean)
            .join(separator) || null;
      }
      // ...and image/ink content is carried as an extra block in that callout.
      if (isMedia(a) && a.imgLink) {
        previous.continuationMedia = [...(previous.continuationMedia ?? []), a];
      }
      const comment = [previous.comment, a.comment]
        .filter((c) => c && c.trim())
        .join(separator);
      previous.comment = comment || null;
      if (
        a.pageLabel &&
        previous.pageLabel &&
        previous.pageLabel !== a.pageLabel
      ) {
        previous.pageLabel = `${previous.pageLabel.split('–')[0]}–${a.pageLabel}`;
      }
      if (a.tags?.length) {
        previous.tags = unionTags(previous.tags, a.tags);
      }
      continue;
    }

    // A lone "+" never reaches the output — even when it cannot merge.
    if (isContinuation) a.comment = a.comment.replace(CONTINUATION, '') || null;
    merged.push(a);
    previous = a;
  }

  return merged;
}

/** Sort into reading order, then fold continuations. */
export function processAnnotations(
  annotations: NoteContextAnnotation[]
): NoteContextAnnotation[] {
  return mergeContinuationAnnotations(sortAnnotations(annotations));
}
