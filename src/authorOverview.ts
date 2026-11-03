// Optional AI-written author overview. The result is deliberately NOT a
// managed region: it is written once under `# Overview (AI generated)`, and the
// user may edit or remove it afterwards.

import { Modal, Notice, TFile } from 'obsidian';

import type ReferenceList from './main';
import { authorWorksForPage, variantsOf } from './authorNotes';
import { completeOpenAiCompatible } from './llm';
import { joinNote, splitNote } from './template/merge';
import { t } from './lang/helpers';

export const DEFAULT_AUTHOR_OVERVIEW_PROMPT = `Generate a blurb in markdown format, about 80 words, identifying this author and summarizing their work and contribution. Tone: scholarly, analytical, concrete, factual, and balanced. Identify the institution, movement, and/or school of thought they're associated with; theoretical influences; their best-known written work (not necessarily those listed above); contribution to their field(s); and peer reception. If this is an important historical figure, you may mention important works that discuss or respond to them.

Below the summary, add a subsection:

## Relevant links

and a bullet list of 2–4 of the top online resources about the author, such as a Wikipedia page and/or non-paywalled scholarly overviews of their work.`;

export const AUTHOR_OVERVIEW_HEADING = '# Overview (AI generated)';

/** A short all-caps note title is treated as a local acronym, not a name. */
export function isAcronymTitle(title: string): boolean {
  return /^[A-Z]{2,4}$/.test(title.trim());
}

/** Context prefixed to the user's prompt so the model knows who is meant. */
export function authorOverviewContext(plugin: ReferenceList, file: TFile): string {
  // The prompt only needs a couple of alternate names; the full variants list
  // is still used for works/publications.
  const variants = variantsOf(plugin.app, file).slice(0, 2);
  const works = authorWorksForPage(plugin, file);
  const acronym = isAcronymTitle(file.basename);
  const names = acronym
    ? [...new Set(variants)]
    : [...new Set([file.basename, ...variants])];
  // If an acronym note has no variants, there is nothing better to send; keep
  // the title as a last resort rather than an empty name.
  const primary = names[0] ?? file.basename;
  const aliases = names.slice(1);
  const aliasText = aliases.length
    ? ` (also published as ${aliases.join(', ')})`
    : '';
  const titles = works.length
    ? `, author of ${works.map((work) => `“${work.title}”`).join(' and ')}`
    : '';
  return `Author name: ${primary}${aliasText}${titles}.`;
}

/** Put the overview at the top of the body, replacing an earlier AI overview. */
export function withAuthorOverview(note: string, text: string): string {
  const { frontmatter, body } = splitNote(note);
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  const start = lines.findIndex((line) => /^# Overview \(AI generated\)\s*$/.test(line));
  if (start !== -1) {
    let end = start + 1;
    while (end < lines.length && !/^# /.test(lines[end])) end++;
    lines.splice(start, end - start);
  }
  const rest = lines.join('\n').replace(/^\n+/, '');
  const section = `${AUTHOR_OVERVIEW_HEADING}\n\n${text.trim()}\n`;
  const nextBody = rest ? `${section}\n${rest}` : section;
  return frontmatter === null ? nextBody : joinNote(frontmatter, nextBody);
}

/** Generate and insert the overview for one author note. */
export async function generateAuthorOverview(
  plugin: ReferenceList,
  file: TFile,
  prompt: string
): Promise<void> {
  const text = await completeOpenAiCompatible(
    {
      baseUrl: plugin.settings.llmBaseUrl ?? '',
      apiKey: plugin.settings.llmApiKey ?? '',
      model: plugin.settings.llmModel ?? '',
    },
    prompt
  );
  const content = await plugin.app.vault.read(file);
  await plugin.app.vault.modify(file, withAuthorOverview(content, text));
}

/** Prompt editor shown by the command. */
export class AuthorOverviewModal extends Modal {
  constructor(
    private readonly plugin: ReferenceList,
    private readonly file: TFile
  ) {
    super(plugin.app);
  }

  onOpen(): void {
    this.titleEl.setText(t('Generate author overview'));
    this.contentEl.createEl('p', {
      text: t(
        'The whole prompt is editable. Change the author name or works below if the library context is not quite right.'
      ),
      cls: 'setting-item-description',
    });

    const prompt = this.contentEl.createEl('textarea', {
      cls: 'sw-author-overview-prompt',
    });
    prompt.rows = 10;
    const instructions =
      (this.plugin.settings.authorOverviewPrompt ?? '').trim() ||
      DEFAULT_AUTHOR_OVERVIEW_PROMPT;
    prompt.value = `${authorOverviewContext(this.plugin, this.file)}\n\n${instructions}`;

    const buttons = this.contentEl.createDiv({ cls: 'modal-button-container' });
    buttons.createEl('button', { text: t('Cancel') }).onclick = () =>
      this.close();
    const generate = buttons.createEl('button', {
      text: t('Generate'),
      cls: 'mod-cta',
    });
    generate.onclick = () => {
      void (async () => {
        if (!(this.plugin.settings.llmApiKey ?? '').trim()) {
          new Notice(t('Set an LLM API key in Author notes settings first.'), 8000);
          return;
        }
        generate.disabled = true;
        generate.setText(t('Generating…'));
        try {
          await generateAuthorOverview(this.plugin, this.file, prompt.value);
          this.close();
          new Notice(t('Author overview added.'), 6000);
        } catch (e) {
          new Notice(`ScholarWeft: ${(e as Error).message}`, 12000);
          generate.disabled = false;
          generate.setText(t('Generate'));
        }
      })();
    };
  }
}
