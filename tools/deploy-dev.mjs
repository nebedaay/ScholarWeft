#!/usr/bin/env node
/**
 * Deploy a DEV copy of the plugin alongside the community-installed one.
 *
 * Obsidian's community updater matches plugins by manifest `id`, so a dev copy
 * with a DIFFERENT id is never touched by "Check for updates" — you can keep a
 * local build and the released one side by side and enable whichever you want.
 *
 * The dev manifest gets a `-dev` version suffix so the two are obvious in the
 * plugin list. It is written ONLY to the dev folder: the community directory
 * reads the repo's `manifest.json` at HEAD, so a dev version must never be
 * committed there (it would advertise a version with no release).
 *
 * Usage:
 *   SW_PLUGIN_DIR=<vault>/.obsidian/plugins/scholar-weft npm run deploy:dev
 *
 * The dev copy goes next to the stable one (`scholar-weft-dev`) unless
 * SW_DEV_PLUGIN_DIR says otherwise.
 *
 * Two things to know once it is running:
 *   - Settings live per plugin id, so the dev copy starts with defaults. This
 *     seeds its `data.json` from the stable copy the first time, so both behave
 *     the same; delete the dev `data.json` to start clean.
 *   - The plugin's own "conflicting plugin" check matches anything named
 *     like ScholarWeft, so it will offer to disable the dev copy (or the
 *     stable one). Choose "keep" and it stops asking.
 */

import fs from 'node:fs';
import path from 'node:path';

const stable = process.env.SW_PLUGIN_DIR;
if (!stable) {
  console.error(
    'Set SW_PLUGIN_DIR to your vault\'s .obsidian/plugins/scholar-weft folder.'
  );
  process.exit(1);
}
if (!fs.existsSync('main.js')) {
  console.error('main.js is missing — run `npm run build` first.');
  process.exit(1);
}

const dev =
  process.env.SW_DEV_PLUGIN_DIR ??
  path.join(path.dirname(stable), 'scholar-weft-dev');
fs.mkdirSync(dev, { recursive: true });

const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
const devManifest = {
  ...manifest,
  id: `${manifest.id}-dev`,
  name: `${manifest.name} (dev)`,
  version: `${manifest.version}-dev`,
};
fs.writeFileSync(
  path.join(dev, 'manifest.json'),
  JSON.stringify(devManifest, null, '\t') + '\n'
);

for (const file of ['main.js', 'styles.css']) {
  fs.copyFileSync(file, path.join(dev, file));
}

// Carry the settings across the first time, so the dev copy behaves the same.
const devData = path.join(dev, 'data.json');
if (!fs.existsSync(devData)) {
  const stableData = path.join(stable, 'data.json');
  if (fs.existsSync(stableData)) fs.copyFileSync(stableData, devData);
}

console.log(
  `dev copy  -> ${dev}\n` +
    `            id ${devManifest.id}, version ${devManifest.version}`
);
