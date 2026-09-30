jest.mock(
  'obsidian',
  () => ({
    normalizePath: (path: string) =>
      path.replace(/\\/g, '/').replace(/\/+/g, '/'),
  }),
  { virtual: true }
);

import { readTemplate, copyDefaultTemplateToVault } from '../note-template-io';

const PLUG = '.obsidian/plugins/scholar-weft';
const BUNDLED = `${PLUG}/sw-literature-note-templates/sw-note.eta.md`;

/** A plugin whose adapter serves the given vault-relative files. */
function makePlugin(
  settings: Record<string, unknown>,
  files: Record<string, string> = {}
) {
  const adapter = {
    exists: jest.fn(async (p: string) => p in files),
    read: jest.fn(async (p: string) => {
      if (!(p in files)) throw new Error(`not found: ${p}`);
      return files[p];
    }),
    write: jest.fn(async (p: string, data: string) => {
      files[p] = data;
    }),
    mkdir: jest.fn(async () => undefined),
  };
  const plugin = {
    settings,
    manifest: { dir: PLUG },
    app: {
      vault: {
        adapter,
        getFiles: () => Object.keys(files).map((path) => ({ path })),
      },
    },
  } as any;
  return { plugin, adapter, files };
}

describe('readTemplate', () => {
  it('reads the bundled template by default', async () => {
    const { plugin, adapter } = makePlugin({}, { [BUNDLED]: 'BUNDLED' });
    expect(await readTemplate(plugin)).toBe('BUNDLED');
    expect(adapter.read).toHaveBeenCalledWith(BUNDLED);
  });

  it('reads the custom vault file when the default template is off', async () => {
    const { plugin, adapter } = makePlugin(
      { useDefaultNoteTemplate: false, noteTemplatePath: 'Templates/sw-note.eta.md' },
      { [BUNDLED]: 'BUNDLED', 'Templates/sw-note.eta.md': 'CUSTOM' }
    );
    expect(await readTemplate(plugin)).toBe('CUSTOM');
    expect(adapter.read).toHaveBeenCalledWith('Templates/sw-note.eta.md');
    expect(adapter.read).not.toHaveBeenCalledWith(BUNDLED);
  });

  it('falls back to the bundled template when the custom file is missing', async () => {
    const { plugin } = makePlugin(
      { useDefaultNoteTemplate: false, noteTemplatePath: 'Templates/gone.eta.md' },
      { [BUNDLED]: 'BUNDLED' }
    );
    expect(await readTemplate(plugin)).toBe('BUNDLED');
  });

  it('falls back to the bundled template when the custom file is empty', async () => {
    const { plugin } = makePlugin(
      { useDefaultNoteTemplate: false, noteTemplatePath: 'Templates/blank.eta.md' },
      { [BUNDLED]: 'BUNDLED', 'Templates/blank.eta.md': '   \n' }
    );
    expect(await readTemplate(plugin)).toBe('BUNDLED');
  });

  it('falls back to the bundled template when no custom path is set', async () => {
    const { plugin } = makePlugin(
      { useDefaultNoteTemplate: false, noteTemplatePath: '  ' },
      { [BUNDLED]: 'BUNDLED' }
    );
    expect(await readTemplate(plugin)).toBe('BUNDLED');
  });
});

describe('copyDefaultTemplateToVault', () => {
  it('writes the bundled template into the chosen folder', async () => {
    const { plugin, files } = makePlugin({}, { [BUNDLED]: 'BUNDLED' });
    expect(await copyDefaultTemplateToVault(plugin, 'Templates')).toBe(
      'Templates/sw-note.eta.md'
    );
    expect(files['Templates/sw-note.eta.md']).toBe('BUNDLED');
  });

  it('never overwrites an existing file', async () => {
    const { plugin } = makePlugin(
      {},
      {
        [BUNDLED]: 'BUNDLED',
        'Templates/sw-note.eta.md': 'MINE',
      }
    );
    expect(await copyDefaultTemplateToVault(plugin, 'Templates')).toBe(
      'Templates/sw-note-2.eta.md'
    );
  });

  it('returns null when the bundled template cannot be read', async () => {
    const { plugin } = makePlugin({}, {});
    expect(await copyDefaultTemplateToVault(plugin, 'Templates')).toBeNull();
  });
});
