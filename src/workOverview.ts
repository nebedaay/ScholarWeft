// Optional AI-written overview for a literature note (work). Uses the same
// LLM settings as the author overview and inserts the same unmanaged heading.

import { Modal, Notice, TFile } from 'obsidian';

import type ReferenceList from './main';
import { withAuthorOverview } from './authorOverview';
import { completeOpenAiCompatible } from './llm';
import { t } from './lang/helpers';

export const DEFAULT_WORK_OVERVIEW_PROMPT =
  'Generate a blurb in markdown format, about 50 words, identifying and summarizing this work, including its topic and examples, main arguments, and interlocutors. Identify the author\'s school of thought and their theoretical influences. Mention this work\'s influence on other works and peer reception if relevant. If this is a major work that has elicited significant commentary, add a "## Relevant links" subsection listing some non-paywalled links (such as Wikipedia or scholarly introductions). Tone: scholarly, analytical, concrete, factual, and balanced. If you have limited knowledge of the work, limit your description to what you can say confidently and don\'t insert any filler description.';

function noteCitekey(file: TFile, frontmatter: Record<string, unknown> | undefined): string {
  const value = frontmatter?.['citekey'];
  if (typeof value === 'string' && value.trim()) return value.trim();
  return file.basename.startsWith('@') ? file.basename.slice(1) : '';
}

function cslName(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const name = value as { family?: unknown; given?: unknown; literal?: unknown };
  if (typeof name.literal === 'string' && name.literal.trim()) return name.literal.trim();
  const family = typeof name.family === 'string' ? name.family.trim() : '';
  const given = typeof name.given === 'string' ? name.given.trim() : '';
  return [family, given].filter(Boolean).join(', ');
}

/** A bibliographic reference for the modal prompt, editable by the user. */
export async function workOverviewContext(
  plugin: ReferenceList,
  file: TFile
): Promise<string> {
  const frontmatter = plugin.app.metadataCache.getFileCache(file)?.frontmatter as
    | Record<string, unknown>
    | undefined;
  const key = noteCitekey(file, frontmatter);
  if (key) {
    try {
      // Reuse the exporter's CSL reference renderer rather than inventing a
      // second citation formatter.
      const rendered = await plugin.bibManager.renderReferenceMarkdown([key]);
      const reference = rendered.get(key)?.trim();
      if (reference) return `Reference: ${reference}`;
    } catch (e) {
      console.warn('[sw:overview] could not render reference', key, e);
    }
  }
  const entry = key ? plugin.bibManager.bibCache.get(key) : undefined;
  const title =
    (typeof entry?.title === 'string' && entry.title.trim()) ||
    (typeof frontmatter?.['title'] === 'string' && frontmatter['title'].trim()) ||
    key ||
    file.basename;
  const authors = Array.isArray(entry?.author)
    ? entry.author.map(cslName).filter(Boolean).join('; ')
    : '';
  const year = entry?.issued?.['date-parts']?.[0]?.[0];
  const container =
    (typeof entry?.['container-title'] === 'string' &&
      entry['container-title'].trim()) ||
    (typeof entry?.publisher === 'string' && entry.publisher.trim()) ||
    '';
  const parts: string[] = [];
  if (authors) parts.push(`${authors}.`);
  if (year !== undefined && year !== null && String(year).trim()) {
    parts.push(`${String(year)}.`);
  }
  parts.push(`“${title}”.`);
  if (container) parts.push(`${container}.`);
  return `Reference: ${parts.join(' ')}`;
}

/** Render the reference, then open the editable prompt modal. */
export async function openWorkOverview(
  plugin: ReferenceList,
  file: TFile
): Promise<void> {
  const context = await workOverviewContext(plugin, file);
  new WorkOverviewModal(plugin, file, context).open();
}

/** Generate and insert a work overview using the full editable prompt. */
export async function generateWorkOverview(
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

/** Prompt editor for a work overview. */
export class WorkOverviewModal extends Modal {
  constructor(
    private readonly plugin: ReferenceList,
    private readonly file: TFile,
    private readonly context: string
  ) {
    super(plugin.app);
  }

  onOpen(): void {
    this.titleEl.setText(t('Generate work overview'));
    this.contentEl.createEl('p', {
      text: t(
        'The whole prompt is editable. Change the reference or instructions below before generating.'
      ),
      cls: 'setting-item-description',
    });

    const prompt = this.contentEl.createEl('textarea', {
      cls: 'sw-author-overview-prompt',
    });
    prompt.rows = 10;
    const instructions =
      (this.plugin.settings.workOverviewPrompt ?? '').trim() ||
      DEFAULT_WORK_OVERVIEW_PROMPT;
    prompt.value = `${this.context}\n\n${instructions}`;

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
          await generateWorkOverview(this.plugin, this.file, prompt.value);
          this.close();
          new Notice(t('Work overview added.'), 6000);
        } catch (e) {
          new Notice(`ScholarWeft: ${(e as Error).message}`, 12000);
          generate.disabled = false;
          generate.setText(t('Generate'));
        }
      })();
    };
  }
}

