// Zotero item picker via Better BibTeX's "Cite As You Write" (CAYW) endpoint.
//
// CAYW opens Zotero's NATIVE item/citation dialog and returns the picked items
// on the SAME HTTP response, so we import exactly what the user selects. It
// needs no Zotero add-on of our own; `isZoteroRunning` already probes this
// endpoint (it answers "ready"). This is the same mechanism Obsidian's Zotero
// Integration uses for its "Import notes" command.

import { requestUrl } from 'obsidian';

import { DEFAULT_ZOTERO_PORT, defaultHeaders } from './bib/helpers';

export interface PickedZoteroItem {
  /** Better BibTeX citekey, when the pick carries one. */
  citekey: string | null;
  /** The 8-char Zotero item key. */
  zoteroKey: string | null;
  /** 1 for the personal library, else the group id. */
  libraryID: number | null;
  title: string | null;
}

/** Parse `zotero://select/(library|groups/<id>)/items/<key>`. */
export function parseSelectUri(uri: unknown): {
  key: string | null;
  libraryID: number | null;
} {
  if (typeof uri !== 'string') return { key: null, libraryID: null };
  const m = /zotero:\/\/select\/(?:library|groups\/(\d+))\/items\/([A-Za-z0-9]+)/.exec(
    uri
  );
  if (!m) return { key: null, libraryID: null };
  return { key: m[2], libraryID: m[1] ? Number(m[1]) : 1 };
}

/**
 * Open Zotero's picker and resolve with the selected items. Resolves to an
 * empty array if the user cancels; throws on an HTTP error so the caller can
 * tell the user what went wrong.
 */
export async function pickZoteroItems(
  port: string = DEFAULT_ZOTERO_PORT
): Promise<PickedZoteroItem[]> {
  const res = await requestUrl({
    url: `http://127.0.0.1:${port}/better-bibtex/cayw?format=json`,
    headers: defaultHeaders,
    throw: false,
  });

  if (res.status === 503) {
    throw new Error(
      'Zotero is already showing a picker or another integration is using it. ' +
        'Close any open Zotero citation dialog; if none is open, another plugin ' +
        '(for example Zotero Integration) may be holding the picker — disable it ' +
        'and try again.'
    );
  }
  if (res.status !== 200) {
    throw new Error(`Zotero picker failed (HTTP ${res.status}).`);
  }

  // `format=json` returns an array; `translate` returns `{ items: [...] }`.
  // Accept both rather than depending on one formatter's exact shape.
  let parsed: unknown = res.json;
  if (parsed == null) {
    try {
      parsed = JSON.parse(res.text || '[]');
    } catch {
      parsed = [];
    }
  }
  const items: any[] = Array.isArray(parsed)
    ? parsed
    : ((parsed as any)?.items ?? []);

  return items.map((it) => {
    const fromUri = parseSelectUri(it?.uri ?? it?.item?.uri);
    return {
      citekey: it?.citationKey ?? it?.citekey ?? it?.item?.citationKey ?? null,
      zoteroKey: it?.item?.key ?? fromUri.key,
      libraryID: it?.item?.libraryID ?? fromUri.libraryID,
      title: it?.item?.title ?? it?.title ?? null,
    };
  });
}
