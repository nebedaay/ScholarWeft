/**
 * Canonical metadata about ScholarWeft's external dependencies, shared by the
 * settings sub-pages (requirement notes) and the export/import modals.
 *
 * Keep in sync with docs/dependencies.md.
 */
import { openDocs } from './docs';

export interface DependencyInfo {
  /** Short label, e.g. "Pandoc". */
  label: string;
  /** What it enables, in one short clause (lowercase, no trailing period). */
  enables: string;
  /** Download / install page. */
  url: string;
}

export const DEPENDENCIES = {
  python: {
    label: 'Python 3',
    enables: 'compiling and exporting documents, and importing',
    url: 'https://www.python.org/downloads/',
  },
  pandoc: {
    label: 'Pandoc',
    enables: 'exporting to DOCX / ODT / LaTeX / PDF, and importing',
    url: 'https://pandoc.org/installing.html',
  },
  zotero: {
    label: 'Zotero',
    enables: 'live citation fields, citekey lookup, and importing',
    url: 'https://www.zotero.org/download/',
  },
  bbt: {
    label: 'Better BibTeX',
    enables: 'automatic citekeys (and Zotero 6 support)',
    url: 'https://retorque.re/zotero-better-bibtex/installation/',
  },
  libreoffice: {
    label: 'LibreOffice',
    enables: 'PDF export through an ODT / DOCX template',
    url: 'https://www.libreoffice.org/download/',
  },
  latex: {
    label: 'LaTeX (LuaLaTeX)',
    enables: 'PDF export through a .tex template',
    url: 'https://tug.org/texlive/',
  },
  zotlit: {
    label: 'ZotLit',
    enables: 'richer literature notes and @@ full-text search',
    url: 'https://github.com/PKM-er/obsidian-zotlit',
  },
} as const;

export type DepKey = keyof typeof DEPENDENCIES;

/**
 * The Better BibTeX "Citation key formula" ScholarWeft recommends, so citekeys
 * are short, stable, and free of punctuation: first author, a two-letter short
 * title, year (e.g. `smithSo2020`). Set it in Zotero → Settings → Better BibTeX.
 * Keep in sync with docs/setup.md and the install scripts.
 */
export const BBT_CITEKEY_FORMULA =
  'auth(15).lower.alphanum.nopunct + shorttitle(2,2).nopunct.alphanum + year.alphanum.nopunct';

export const DEPENDENCIES_DOC_URL =
  'https://github.com/nebedaay/ScholarWeft/blob/main/docs/dependencies.md';

/**
 * Render a bordered note under a settings section explaining what it needs.
 * `deps` may be empty for a "nothing extra required" reassurance. The optional
 * `extra` callback appends project-specific content to the note's list (before
 * the docs links) — used for the Better BibTeX citekey-formula suggestion.
 */
export function renderDependencyNote(
  containerEl: HTMLElement,
  deps: DepKey[],
  intro: string,
  extra?: (noteEl: HTMLElement, listEl: HTMLElement) => void
): void {
  const note = containerEl.createDiv({ cls: 'sw-dependency-note' });
  note.createDiv({ cls: 'sw-dependency-note-intro', text: intro });
  // Created lazily so a note with no list items keeps no empty <ul>.
  let ul: HTMLElement | null = null;
  const list = (): HTMLElement =>
    (ul ??= note.createEl('ul', { cls: 'sw-dependency-note-list' }));
  for (const key of deps) {
    const d = DEPENDENCIES[key];
    const li = list().createEl('li');
    li.createEl('a', { text: d.label, href: d.url }).setAttr('target', '_blank');
    li.createSpan({ text: ` — ${d.enables}` });
  }
  extra?.(note, list());
  const links = note.createDiv({ cls: 'sw-dependency-note-links' });
  const read = links.createEl('a', {
    cls: 'sw-dependency-note-more',
    text: 'Read the docs in the app',
  });
  read.addEventListener('click', (e) => {
    e.preventDefault();
    openDocs('dependencies.md');
  });
  links.createSpan({ text: ' · ' });
  links
    .createEl('a', {
      cls: 'sw-dependency-note-more',
      text: 'Open on GitHub',
      href: DEPENDENCIES_DOC_URL,
    })
    .setAttr('target', '_blank');
}
