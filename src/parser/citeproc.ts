import { Citation, CitationGroup, RenderedCitation } from './parser';

export type CiteMode = 'suppress-author' | 'composite' | 'author-only';
export interface CiteProps {
  noteIndex: number;
  mode?: CiteMode;
  infix?: string;
  makeOnly?: boolean;
}

export interface CiteprocCite {
  citationID: string;
  citationItems: Citation[];
  properties: CiteProps;
}

/**
 * Render the inline Markdown pandoc allows in a citation prefix/suffix
 * (`[see *also* @doe, p. 30 and *passim*]`) as HTML. citeproc-js passes
 * `<em>`/`<strong>` in a prefix/suffix straight through, but it does not parse
 * Markdown itself, so without this the asterisks/underscores show literally.
 * Only emphasis and strong are handled — the common cases in a citation; the
 * export path needs none of this because pandoc parses the aliases natively.
 */
export function renderInlineMarkdown(text: string): string {
  if (!text || (!text.includes('*') && !text.includes('_'))) return text;
  return text
    .replace(
      /\*\*(?=\S)([\s\S]*?\S)\*\*|__(?=\S)([\s\S]*?\S)__/g,
      (_m, a, b) => `<strong>${a ?? b}</strong>`
    )
    .replace(
      /\*(?=\S)([\s\S]*?\S)\*|(?<![\w])_(?=\S)([\s\S]*?\S)_(?![\w])/g,
      (_m, a, b) => `<em>${a ?? b}</em>`
    );
}

function genUid(length: number): string {
  const array = [];
  for (let i = 0; i < length; i++) {
    array.push(((Math.random() * 16) | 0).toString(16));
  }
  return `${Date.now()}-${array.join('')}`;
}

export function getCiteprocCites(
  groups: CitationGroup[],
  style: 'note' | 'in-text',
  ids: string[] = []
) {
  const output: CiteprocCite[] = [];
  const idToGroup: Record<string, number> = {};
  let noteIndex = 1;

  groups.forEach((group, gIdx) => {
    let mode: CiteMode;
    let infix: string;
    const id = ids[gIdx] ?? genUid(6);
    const citationItems: Citation[] = [];

    const pushMakeAuthorOnly = (cite: Citation, i: number) => {
      const cid = id + i.toString();
      idToGroup[cid] = gIdx;
      output.push({
        citationID: cid,
        citationItems: [
          {
            ...cite,
            ['author-only']: true,
          },
        ],
        properties: {
          noteIndex: 0,
          makeOnly: true,
        },
      });
    };

    const transferProps = (from: Citation, to: Citation) => {
      if (from.label) to.label = from.label;
      if (from.locator) to.locator = from.locator;
      // Prefix/suffix are free text in the source and may carry Markdown
      // emphasis; citeproc renders them verbatim, so convert it to HTML here.
      if (from.prefix) to.prefix = renderInlineMarkdown(from.prefix);
      if (from.suffix) to.suffix = renderInlineMarkdown(from.suffix);
    };

    group.citations.forEach((g, i) => {
      const cite: Citation = {
        id: g.id,
      };

      const next = group.citations[i + 1];
      if (i === 0 && g.composite) {
        if (g.suffix) {
          const nextCite = {
            ...cite,
            ['suppress-author']: style !== 'note',
          };
          pushMakeAuthorOnly(cite, i);
          transferProps(g, nextCite);
          citationItems.push(nextCite);
          return;
        } else if (style === 'note' && g.composite) {
          const nextCite = {
            ...cite,
          };
          pushMakeAuthorOnly(cite, i);
          transferProps(g, nextCite);
          citationItems.push(nextCite);
          return;
        } else {
          if (g.composite) mode = 'composite';
          if (g.infix) infix = g.infix;
        }
      } else if (
        i === 0 &&
        (g['author-only'] || g.composite) &&
        next &&
        next['suppress-author']
      ) {
        pushMakeAuthorOnly(cite, i);
        return;
      } else {
        if (g['suppress-author']) cite['suppress-author'] = style !== 'note';
        else if (g['author-only']) cite['author-only'] = true;
      }

      transferProps(g, cite);
      citationItems.push(cite);
    });

    const properties: CiteProps = {
      noteIndex: noteIndex++,
    };

    if (mode) properties.mode = mode;
    if (infix) properties.infix = renderInlineMarkdown(infix);

    idToGroup[id] = gIdx;
    output.push({
      citationID: id,
      citationItems,
      properties,
    });
  });

  return { output, idToGroup };
}

function decodeHtml(str: string) {
  const txt = document.createElement('textarea');
  txt.innerHTML = str;
  return txt.value;
}

function sanitize(val: string) {
  if (typeof val !== 'string') return '';
  return decodeHtml(val.replace(/\[NO_PRINTED_FORM\] */g, ''));
}

export function cite(
  engine: any,
  group: CitationGroup[],
  uncitedItemIDs?: string[]
) {
  const { output, idToGroup } = getCiteprocCites(group, engine.opt.xclass);

  const makeCites: CiteprocCite[] = [];
  const realCites: CiteprocCite[] = [];

  output.forEach((o) => {
    if (o.properties.makeOnly) {
      makeCites.push(o);
    } else {
      realCites.push(o);
    }
  });

  const bakedCites = engine.rebuildProcessorState(realCites, 'html', uncitedItemIDs);
  const cites: Record<string, RenderedCitation> = {};
  const makes: Record<string, RenderedCitation> = {};

  makeCites.forEach((cite) => {
    const cluster = engine.makeCitationCluster(cite.citationItems);
    const gid = idToGroup[cite.citationID];
    makes[gid] = {
      ...group[gid],
      val: sanitize(cluster),
    };
  });

  realCites.forEach((cite, i) => {
    const [id, noteIndex, str] = bakedCites[i];
    const gid = idToGroup[id];
    cites[gid] = {
      ...group[gid],
      val: sanitize(str),
      noteIndex,
    };
  });

  const out: RenderedCitation[] = [];
  const keys = Object.keys(cites);

  keys.sort();
  keys.forEach((k) => {
    const cite = cites[k];
    const isNoteStyle = engine.opt.xclass === 'note';
    if (makes[k]) {
      if (isNoteStyle) {
        cite.note = cite.val;
        cite.val = `${makes[k].val}<sup>${cite.noteIndex}</sup>`;
      } else {
        cite.val = `${makes[k].val} ${cite.val}`;
      }
    } else if (isNoteStyle) {
      cite.note = cite.val;
      cite.val = `<sup>${cite.noteIndex}</sup>`;
    }
    out.push(cite);
  });

  return out;
}
