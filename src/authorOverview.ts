// Optional AI-written author overview. The result is deliberately NOT a
// managed region: it is written once under `# Overview (AI generated)`, and the
// user may edit or remove it afterwards.

import { Modal, Notice, TFile } from 'obsidian';

import type ReferenceList from './main';
import { authorWorksForPage, variantsOf } from './authorNotes';
import { completeOpenAiCompatible } from './llm';
import { joinNote, splitNote } from './template/merge';
import { t } from './lang/helpers';

export const DEFAULT_AUTHOR_OVERVIEW_PROMPT =
  'Generate a blurb, about 100 words, identifying this author and summarizing their written work, school of thought, and contribution to their field(s).';

export const AUTHOR_OVERVIEW_HEADING = '# Overview (AI generated)';

/** Context prefixed to the user's prompt so the model knows who is meant. */
export function authorOverviewContext(plugin: ReferenceList, file: TFile): string {
  const variants = variantsOf(plugin.app, file);
  const works = authorWorksForPage(plugin, file);
  const aliases = variants.length
    ? ` (also published as ${variants.join(', ')})`
    : '';
  const titles = works.length
    ? `, author of ${works.map((work) => `“${work.title}”`).join(' and ')}`
    : '';
  return `Author name: ${file.basename}${aliases}${titles}.`;
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
  instructions: string
): Promise<void> {
  const context = authorOverviewContext(plugin, file);
  const prompt = `${context}\n\n${instructions.trim()}`;
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
      text: authorOverviewContext(this.plugin, this.file),
      cls: 'setting-item-description',
    });

    const prompt = this.contentEl.createEl('textarea', {
      cls: 'sw-author-overview-prompt',
    });
    prompt.rows = 7;
    prompt.value =
      (this.plugin.settings.authorOverviewPrompt ?? '').trim() ||
      DEFAULT_AUTHOR_OVERVIEW_PROMPT;

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
