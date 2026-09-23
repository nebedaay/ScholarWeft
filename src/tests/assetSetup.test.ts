/* eslint-disable @typescript-eslint/ban-ts-comment */

jest.mock(
  'obsidian',
  () => ({
    normalizePath: (path: string) =>
      path.replace(/\\/g, '/').replace(/\/+/g, '/'),
  }),
  { virtual: true }
);

jest.mock(
  'bundled:assets',
  () => ({
    BUNDLED_ASSETS: {
      'scripts/a.py': { content: 'print(1)', binary: false, hash: 'h1' },
      'scripts/b.py': { content: 'print(2)', binary: false, hash: 'h2' },
      'sw-export-templates/x.docx': { content: 'AA==', binary: true, hash: 'h3' },
      // Never extracted (used from the bundle / written by settings buttons):
      'docs/readme.md': { content: 'doc', binary: false, hash: 'h4' },
      'sw-zotlit-templates/t.md': { content: 't', binary: false, hash: 'h5' },
      'sw-markdown-templates/m.md': { content: 'm', binary: false, hash: 'h6' },
      'README.md': { content: 'r', binary: false, hash: 'h7' },
      'images/i.png': { content: 'AA==', binary: true, hash: 'h8' },
    },
  }),
  { virtual: true }
);

import { setupAssets } from '../assetSetup';
import { BUNDLED_ASSETS } from 'bundled:assets';

const PLUG = '.obsidian/plugins/scholar-weft';

function makePlugin() {
  const files: Record<string, string> = {};
  const written: string[] = [];
  const adapter = {
    mkdir: jest.fn(async () => undefined),
    exists: jest.fn(async (p: string) => p in files),
    read: jest.fn(async (p: string) => {
      if (!(p in files)) throw new Error('not found');
      return files[p];
    }),
    write: jest.fn(async (p: string, data: string) => {
      files[p] = data;
      written.push(p);
    }),
    writeBinary: jest.fn(async (p: string, _buf: ArrayBuffer) => {
      files[p] = '<binary>';
      written.push(p);
    }),
    remove: jest.fn(async () => undefined),
  };
  const plugin = {
    app: { vault: { adapter } },
    manifest: { dir: PLUG, version: '1.0.0' },
  } as any;
  return { plugin, adapter, files, written };
}

beforeEach(() => {
  // Undo mutations from a previous test (the mock object is shared).
  (BUNDLED_ASSETS as any)['scripts/a.py'].hash = 'h1';
});

describe('setupAssets content-aware extraction', () => {
  it('writes only the extractable assets on first run and records a stamp', async () => {
    const { plugin, written, files } = makePlugin();

    await setupAssets(plugin);

    expect(written).toContain(`${PLUG}/scripts/a.py`);
    expect(written).toContain(`${PLUG}/scripts/b.py`);
    expect(written).toContain(`${PLUG}/sw-export-templates/x.docx`);
    // Never extracted:
    expect(written).not.toContain(`${PLUG}/docs/readme.md`);
    expect(written).not.toContain(`${PLUG}/sw-zotlit-templates/t.md`);
    expect(written).not.toContain(`${PLUG}/sw-markdown-templates/m.md`);
    expect(written).not.toContain(`${PLUG}/README.md`);
    expect(written).not.toContain(`${PLUG}/images/i.png`);

    const stamp = JSON.parse(files[`${PLUG}/.sw-assets.json`]);
    expect(stamp.version).toBe(1);
    expect(stamp.hashes['scripts/a.py']).toBe('h1');
    expect(stamp.hashes['docs/readme.md']).toBeUndefined();
  });

  it('rewrites nothing on a second load when the stamp matches', async () => {
    const { plugin, adapter } = makePlugin();
    await setupAssets(plugin);
    adapter.write.mockClear();
    adapter.writeBinary.mockClear();

    await setupAssets(plugin);

    expect(adapter.write).not.toHaveBeenCalled();
    expect(adapter.writeBinary).not.toHaveBeenCalled();
  });

  it('rewrites only the asset whose bundled content changed', async () => {
    const { plugin, adapter, files } = makePlugin();
    await setupAssets(plugin);
    adapter.write.mockClear();

    // Simulate a new build that changed scripts/a.py.
    (BUNDLED_ASSETS as any)['scripts/a.py'].hash = 'h1-new';
    await setupAssets(plugin);

    const assetWrites = adapter.write.mock.calls
      .map((c) => c[0])
      .filter((p) => p !== `${PLUG}/.sw-assets.json`);
    expect(assetWrites).toEqual([`${PLUG}/scripts/a.py`]);
    const stamp = JSON.parse(files[`${PLUG}/.sw-assets.json`]);
    expect(stamp.hashes['scripts/a.py']).toBe('h1-new');
  });

  it('restores an asset that was deleted by hand', async () => {
    const { plugin, adapter, files } = makePlugin();
    await setupAssets(plugin);
    adapter.write.mockClear();

    delete files[`${PLUG}/scripts/b.py`];
    await setupAssets(plugin);

    expect(adapter.write).toHaveBeenCalledTimes(1);
    expect(adapter.write.mock.calls[0][0]).toBe(`${PLUG}/scripts/b.py`);
  });
});
