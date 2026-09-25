import { FileSystemAdapter, normalizePath, requestUrl } from 'obsidian';
import { debugLog, SW_CACHE_DIR } from 'src/helpers';
import { CSLList, PartialCSLEntry } from './types';
import { parseBibFile } from './bibtex';
import { bibToCSLViaPandoc } from './pandoc';
export { zoteroItemToCSL } from './zotero-csl';

export const DEFAULT_ZOTERO_PORT = '23119';

// ─── Path utilities (replaces node:path) ────────────────────────────────────

export function isAbsolutePath(p: string): boolean {
  return p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p);
}

export function pathBasename(p: string): string {
  return p.replace(/\\/g, '/').split('/').pop() ?? p;
}

// ─── Vault adapter helpers ───────────────────────────────────────────────────

async function ensureVaultDir(vaultRelPath: string): Promise<void> {
  if (!(await app.vault.adapter.exists(vaultRelPath))) {
    await app.vault.adapter.mkdir(vaultRelPath);
  }
}

// Read a file from disk. Handles both absolute paths (desktop) and
// vault-relative paths (cross-platform).
async function readFileText(filePath: string): Promise<string> {
  if (isAbsolutePath(filePath)) {
    // FileSystemAdapter.readLocalFile works for any absolute path on desktop.
    const buffer = await FileSystemAdapter.readLocalFile(filePath);
    return new TextDecoder('utf-8').decode(buffer);
  }
  return app.vault.adapter.read(normalizePath(filePath));
}

// ─── Bibliography file resolution ───────────────────────────────────────────

/**
 * Resolve a stored bibliography path to a form we can read, trying both
 * absolute and vault-relative forms so the plugin survives a vault move or an
 * absolute path that is really inside the vault.
 *
 * Resolution order:
 *  1. Absolute path inside vault → return vault-relative form (more portable).
 *  2. Absolute path outside vault → return as-is.
 *  3. Vault-relative path that exists → return normalized.
 *  4. Vault-relative path missing → try prepending the vault root (absolute).
 *
 * The returned path may differ from the input; callers that want to persist
 * the canonical form should compare the two and save if different.
 */
export async function getBibPath(bibPath: string): Promise<string> {
  const adapter = app.vault.adapter;
  // getBasePath() is only available on desktop (FileSystemAdapter).
  const vaultBase: string | undefined =
    typeof (adapter as any).getBasePath === 'function'
      ? ((adapter as any).getBasePath() as string)
      : undefined;
  const fwd = (p: string) => p.replace(/\\/g, '/'); // normalise Windows separators

  if (isAbsolutePath(bibPath)) {
    // If the file lives inside the vault, prefer the portable vault-relative form.
    if (vaultBase) {
      const absForward = fwd(bibPath);
      const baseForward = fwd(vaultBase).replace(/\/+$/, '');
      if (absForward.startsWith(baseForward + '/')) {
        const rel = normalizePath(absForward.slice(baseForward.length + 1));
        if (await adapter.exists(rel)) return rel;
        // File should be here but isn't — fall through to use the absolute path
        // so the subsequent read surfaces a meaningful OS-level error.
      }
    }
    // Outside vault, or vault base not available (mobile) — return as-is.
    return bibPath;
  }

  // Vault-relative path.
  const normalized = normalizePath(bibPath);
  if (await adapter.exists(normalized)) return normalized;

  // Fallback: prepend vault root in case the path is correct but the vault
  // has moved to a new location since the setting was saved.
  if (vaultBase) {
    return fwd(vaultBase).replace(/\/+$/, '') + '/' + fwd(bibPath);
    // readFileText will surface a clear error if this also fails to exist.
  }

  throw new Error(
    `scholar-weft: cannot find bibliography file "${bibPath}". ` +
      'Provide an absolute path or a path relative to the vault root.'
  );
}

export async function bibToCSL(
  bibPath: string,
  pathToPandoc?: string
): Promise<PartialCSLEntry[]> {
  const resolved = await getBibPath(bibPath);
  const ext = (resolved.split('.').pop() ?? '').toLowerCase();

  // Use Pandoc when configured (desktop opt-in) for .bib/.yaml files.
  // Falls back to the JS parser if Pandoc fails so existing configs keep working.
  if (pathToPandoc && (ext === 'bib' || ext === 'yaml' || ext === 'yml')) {
    try {
      // Pandoc runs from its own working directory, so it can't resolve
      // vault-relative paths. Always pass an absolute path.
      let pandocPath = resolved;
      if (!isAbsolutePath(pandocPath)) {
        const vaultBase: string | undefined =
          typeof (app.vault.adapter as any).getBasePath === 'function'
            ? ((app.vault.adapter as any).getBasePath() as string)
            : undefined;
        if (vaultBase) {
          pandocPath = vaultBase.replace(/\/+$/, '').replace(/\\/g, '/') +
            '/' + pandocPath.replace(/\\/g, '/');
        }
      }
      return await bibToCSLViaPandoc(pandocPath, pathToPandoc);
    } catch (e) {
      console.warn(
        'scholar-weft: Pandoc failed, falling back to JS parser:',
        e
      );
    }
  }

  const raw = await readFileText(resolved);
  return parseBibFile(raw, resolved);
}

export async function bibPathsToCSL(
  bibPaths: string[],
  pathToPandoc?: string
): Promise<PartialCSLEntry[]> {
  const resolved = await Promise.all(bibPaths.map((path) => getBibPath(path)));
  const ext = (path: string) => (path.split('.').pop() ?? '').toLowerCase();
  const allBib = resolved.every((path) => ['bib', 'bibtex'].includes(ext(path)));

  if (allBib) {
    const raw = (await Promise.all(resolved.map(readFileText))).join('\n\n');
    return parseBibFile(raw, resolved[0]);
  }

  const entries: PartialCSLEntry[] = [];
  for (const bibPath of bibPaths) {
    entries.push(...(await bibToCSL(bibPath, pathToPandoc)));
  }
  return entries;
}

// ─── CSL locale + style caching ─────────────────────────────────────────────

const CACHE_DIR = normalizePath(SW_CACHE_DIR);

export async function getCSLLocale(
  localeCache: Map<string, string>,
  _cacheDir: string,
  lang: string
): Promise<string> {
  if (localeCache.has(lang)) return localeCache.get(lang)!;

  const url = `https://raw.githubusercontent.com/citation-style-language/locales/master/locales-${lang}.xml`;
  const cachePath = normalizePath(`${CACHE_DIR}/locales-${lang}.xml`);

  await ensureVaultDir(CACHE_DIR);

  if (await app.vault.adapter.exists(cachePath)) {
    const data = await app.vault.adapter.read(cachePath);
    localeCache.set(lang, data);
    return data;
  }

  const resp = await requestUrl({ url, throw: false });
  if (resp.status !== 200) {
    throw new Error(`Error downloading CSL locale ${lang}: HTTP ${resp.status}`);
  }
  const str = resp.text;
  if (str.startsWith('404')) {
    throw new Error(`Error downloading CSL locale: 404 Not Found for ${lang}`);
  }

  await app.vault.adapter.write(cachePath, str);
  localeCache.set(lang, str);
  return str;
}

export async function getCSLStyle(
  styleCache: Map<string, string>,
  _cacheDir: string,
  url: string,
  explicitPath?: string
): Promise<string> {
  const key = explicitPath ?? url;

  if (styleCache.has(key)) return styleCache.get(key)!;

  if (explicitPath) {
    const raw = await readFileText(explicitPath);
    styleCache.set(key, raw);
    return raw;
  }

  // Normalize bare ids (e.g. "chicago-author-date") to full Zotero repository
  // URLs. Older data.json files stored only the id; passing the raw id to
  // requestUrl() throws "TypeError: Invalid URL" on Obsidian 1.13+.
  const ZOTERO_STYLE_BASE = 'https://www.zotero.org/styles/';
  const fullUrl = url.startsWith('http') ? url : `${ZOTERO_STYLE_BASE}${url}`;

  const filename = pathBasename(fullUrl);
  const cachePath = normalizePath(`${CACHE_DIR}/${filename}`);

  await ensureVaultDir(CACHE_DIR);

  if (await app.vault.adapter.exists(cachePath)) {
    const data = await app.vault.adapter.read(cachePath);
    // Reject stale error responses — valid CSL starts with '<'.
    if (data.trimStart().startsWith('<')) {
      styleCache.set(key, data);
      return data;
    }
    await app.vault.adapter.remove(cachePath);
  }

  const resp = await requestUrl({ url: fullUrl, throw: false });
  if (resp.status !== 200) {
    throw new Error(`Error downloading CSL style: HTTP ${resp.status} from ${fullUrl}`);
  }
  const str = resp.text;
  await app.vault.adapter.write(cachePath, str);
  styleCache.set(key, str);
  return str;
}

// ─── Zotero (Better BibTeX) ──────────────────────────────────────────────────

export const defaultHeaders = {
  'Content-Type': 'application/json',
  'User-Agent': 'obsidian/zotero',
  Accept: 'application/json',
  // Zotero 10 drops any request carrying an `Origin` header (Obsidian's
  // requestUrl sends one) unless it also carries this header — see
  // https://www.zotero.org/support/dev/zotero_10_for_developers. Without it
  // the local HTTP server closes the connection with no response.
  'Zotero-Allowed-Request': '1',
};

export async function isZoteroRunning(
  port: string = DEFAULT_ZOTERO_PORT
): Promise<boolean> {
  try {
    const result = await Promise.race<{ status: number; text: string } | null>([
      requestUrl({
        url: `http://127.0.0.1:${port}/better-bibtex/cayw?probe=true`,
        headers: { 'Zotero-Allowed-Request': '1' },
        throw: false,
      }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 150)),
    ]);
    return result?.text === 'ready';
  } catch {
    return false;
  }
}

async function bbtPost(port: string, body: object): Promise<any> {
  const resp = await requestUrl({
    url: `http://127.0.0.1:${port}/better-bibtex/json-rpc`,
    method: 'POST',
    headers: defaultHeaders,
    body: JSON.stringify(body),
    throw: false,
  });
  if (resp.status !== 200) {
    throw new Error(`Zotero BBT: HTTP ${resp.status}`);
  }
  return resp.json;
}

export async function getZUserGroups(
  port: string = DEFAULT_ZOTERO_PORT
): Promise<Array<{ id: number; name: string }> | null> {
  if (!(await isZoteroRunning(port))) return null;
  const data = await bbtPost(port, { jsonrpc: '2.0', method: 'user.groups' });
  return data.result ?? null;
}

function panNum(n: number) {
  return n < 10 ? `0${n}` : String(n);
}

function timestampToZDate(ts: number) {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${panNum(d.getUTCMonth() + 1)}-${panNum(d.getUTCDate())} ${panNum(d.getUTCHours())}:${panNum(d.getUTCMinutes())}:${panNum(d.getUTCSeconds())}`;
}

export async function getZModified(
  port: string = DEFAULT_ZOTERO_PORT,
  groupId: number,
  since: number
): Promise<CSLList | null> {
  if (!(await isZoteroRunning(port))) return null;
  const data = await bbtPost(port, {
    jsonrpc: '2.0',
    method: 'item.search',
    params: [[['dateModified', 'isAfter', timestampToZDate(since)]], groupId],
  });
  return data.result ?? null;
}

function applyGroupID(list: CSLList, groupId: number): CSLList {
  return list.map((item) => ({ ...item, groupID: groupId }));
}

export async function getZBib(
  port: string = DEFAULT_ZOTERO_PORT,
  _cacheDir: string,
  groupId: number,
  loadCached?: boolean
): Promise<CSLList | null> {
  const isRunning = await isZoteroRunning(port);
  const cachePath = normalizePath(`${CACHE_DIR}/zotero-library-${groupId}.json`);

  await ensureVaultDir(CACHE_DIR);

  if (loadCached || !isRunning) {
    if (await app.vault.adapter.exists(cachePath)) {
      return applyGroupID(
        JSON.parse(await app.vault.adapter.read(cachePath)) as CSLList,
        groupId
      );
    }
    if (!isRunning) return null;
  }

  const resp = await requestUrl({
    url: `http://127.0.0.1:${port}/better-bibtex/export/library?/${groupId}/library.json`,
    headers: { 'Zotero-Allowed-Request': '1' },
    throw: false,
  });
  if (resp.status !== 200) throw new Error(`Zotero BBT export: HTTP ${resp.status}`);

  const str = resp.text;
  await app.vault.adapter.write(cachePath, str);
  return applyGroupID(JSON.parse(str) as CSLList, groupId);
}

export async function refreshZBib(
  port: string = DEFAULT_ZOTERO_PORT,
  _cacheDir: string,
  groupId: number,
  since: number
): Promise<{ list: CSLList; modified: Map<string, PartialCSLEntry> } | null> {
  if (!(await isZoteroRunning(port))) return null;

  const cachePath = normalizePath(`${CACHE_DIR}/zotero-library-${groupId}.json`);
  if (!(await app.vault.adapter.exists(cachePath))) return null;

  const mList = (await getZModified(port, groupId, since)) as CSLList;
  if (!mList?.length) return null;

  const modified = new Map<string, PartialCSLEntry>();
  const newKeys = new Set<string>();

  for (const mod of mList) {
    mod.id = (mod as any).citekey || (mod as any)['citation-key'];
    if (!mod.id) continue;
    // BBT's item.search response includes `key` (the stable 8-char Zotero
    // item key). Promote it to _zoteroKey so stale-citekey detection works.
    if (!mod._zoteroKey && (mod as any).key) mod._zoteroKey = (mod as any).key;
    modified.set(mod.id, mod);
    newKeys.add(mod.id);
  }

  // Build zoteroKey → new citekey for entries that carry a stable item key.
  const zoteroKeyToNewId = new Map<string, string>();
  for (const [id, entry] of modified.entries()) {
    if (entry._zoteroKey) zoteroKeyToNewId.set(entry._zoteroKey, id);
  }

  const rawList = JSON.parse(await app.vault.adapter.read(cachePath)) as CSLList;

  // Drop stale entries: same Zotero item (_zoteroKey) but old citekey.
  const list = rawList.filter((item) => {
    if (!item._zoteroKey) return true; // no stable key — keep it
    const newId = zoteroKeyToNewId.get(item._zoteroKey);
    return !newId || newId === item.id;
  });

  for (let i = 0; i < list.length; i++) {
    if (modified.has(list[i].id)) {
      newKeys.delete(list[i].id);
      list[i] = modified.get(list[i].id)!;
    }
  }
  for (const key of newKeys) list.push(modified.get(key)!);

  await app.vault.adapter.write(cachePath, JSON.stringify(list));
  return { list: applyGroupID(list, groupId), modified };
}

// ─── Zotero native REST API (Zotero 7/8, no Better BibTeX) ──────────────────

async function zoteroNativeGet(
  port: string,
  apiPath: string
): Promise<{ data: any; version: number; totalResults?: number }> {
  const resp = await requestUrl({
    url: `http://127.0.0.1:${port}${apiPath}`,
    method: 'GET',
    headers: defaultHeaders,
    throw: false,
  });
  if (resp.status !== 200) throw new Error(`Zotero native: HTTP ${resp.status} for ${apiPath}`);
  const headers = resp.headers ?? {};
  const version = Number(
    headers['last-modified-version'] ?? headers['Last-Modified-Version'] ?? 0
  );
  const totalRaw = headers['total-results'] ?? headers['Total-Results'];
  const totalResults = totalRaw != null ? Number(totalRaw) : undefined;
  return { data: resp.json, version, totalResults };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Fetch one page, retrying transient failures with exponential backoff. */
async function fetchNativePageWithRetry(
  port: string,
  apiPath: string,
  attempts = 4
): Promise<{ data: any; version: number; totalResults?: number }> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await zoteroNativeGet(port, apiPath);
    } catch (e) {
      lastErr = e;
      await sleep(500 * 2 ** i); // 0.5s, 1s, 2s …
    }
  }
  throw lastErr;
}

async function fetchAllZoteroItemsNative(
  port: string,
  libraryType: 'users' | 'groups',
  libraryId: number | string,
  since?: number
): Promise<{ items: any[]; version: number }> {
  const limit = 100;
  let start = 0;
  const allItems: any[] = [];
  let libraryVersion = 0;
  const sinceParam = since !== undefined ? `&since=${since}` : '';
  let hasMore = true;
  let expectedTotal: number | undefined;

  while (hasMore) {
    const { data, version, totalResults } = await fetchNativePageWithRetry(
      port,
      `/api/${libraryType}/${libraryId}/items?format=json&itemType=-attachment&limit=${limit}&start=${start}${sinceParam}`
    );
    libraryVersion = version;
    if (expectedTotal === undefined && totalResults != null) {
      expectedTotal = totalResults;
    }
    if (!Array.isArray(data) || data.length === 0) {
      hasMore = false;
      continue;
    }
    allItems.push(...data);
    if (data.length < limit) {
      hasMore = false;
    }
    start += limit;
  }

  // Guard against a silently-truncated fetch: a partial library would build a
  // partial index that is treated as complete until the next restart. Throwing
  // here means getZBibNative() never writes a partial cache, and loadGlobalZBib
  // schedules a retry instead of accepting the short result.
  if (expectedTotal != null && allItems.length < expectedTotal) {
    throw new Error(
      `Zotero native: incomplete library fetch (${allItems.length}/${expectedTotal} items)`
    );
  }

  return { items: allItems, version: libraryVersion };
}

import { zoteroItemToCSL as _zoteroItemToCSL } from './zotero-csl';

function nativeLibraryCoords(groupId: number): {
  libraryType: 'users' | 'groups';
  libraryId: number | string;
} {
  return groupId === 1
    ? { libraryType: 'users', libraryId: 0 }
    : { libraryType: 'groups', libraryId: groupId };
}

export async function isZoteroRunningNative(
  port: string = DEFAULT_ZOTERO_PORT
): Promise<boolean> {
  try {
    const result = await Promise.race<{ data: any; version: number } | null>([
      zoteroNativeGet(port, '/api/users/0/items?limit=1'),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000)),
    ]);
    return result !== null && Array.isArray(result.data);
  } catch {
    return false;
  }
}

export async function getZUserGroupsNative(
  port: string = DEFAULT_ZOTERO_PORT
): Promise<Array<{ id: number; name: string }> | null> {
  if (!(await isZoteroRunningNative(port))) return null;

  const groups: Array<{ id: number; name: string }> = [
    { id: 1, name: 'My Library' },
  ];

  try {
    const { data } = await zoteroNativeGet(port, '/api/users/0/groups');
    if (Array.isArray(data)) {
      for (const g of data) {
        groups.push({ id: g.id, name: g.data?.name ?? `Group ${g.id}` });
      }
    }
  } catch (e) {
    console.error('scholar-weft: error fetching Zotero groups:', e);
  }

  return groups;
}

export async function getZBibNative(
  port: string = DEFAULT_ZOTERO_PORT,
  _cacheDir: string,
  groupId: number,
  loadCached?: boolean
): Promise<{ list: CSLList | null; version: number }> {
  const isRunning = await isZoteroRunningNative(port);
  const cachePath = normalizePath(`${CACHE_DIR}/zotero-native-library-${groupId}.json`);

  await ensureVaultDir(CACHE_DIR);

  if (loadCached || !isRunning) {
    if (await app.vault.adapter.exists(cachePath)) {
      const cacheData = JSON.parse(await app.vault.adapter.read(cachePath));
      return {
        list: applyGroupID(cacheData.items as CSLList, groupId),
        version: cacheData.version ?? 0,
      };
    }
    if (!isRunning) return { list: null, version: 0 };
  }

  const { libraryType, libraryId } = nativeLibraryCoords(groupId);
  const { items: rawItems, version } = await fetchAllZoteroItemsNative(
    port,
    libraryType,
    libraryId
  );

  const cslItems: PartialCSLEntry[] = [];
  for (const rawItem of rawItems) {
    const cslItem = _zoteroItemToCSL(rawItem, groupId);
    if (cslItem) cslItems.push(cslItem);
  }

  await app.vault.adapter.write(
    cachePath,
    JSON.stringify({ items: cslItems, version })
  );

  return { list: applyGroupID(cslItems, groupId), version };
}

export async function refreshZBibNative(
  port: string = DEFAULT_ZOTERO_PORT,
  _cacheDir: string,
  groupId: number,
  sinceVersion: number
): Promise<{ list: CSLList; modified: Map<string, PartialCSLEntry> } | null> {
  if (!(await isZoteroRunningNative(port))) return null;

  const cachePath = normalizePath(`${CACHE_DIR}/zotero-native-library-${groupId}.json`);
  if (!(await app.vault.adapter.exists(cachePath))) return null;

  // One-time migration: caches written before per-item `_version` tracking
  // have no versions on most entries, so per-key render-cache invalidation
  // can't work. Force a full re-fetch (since=0) so every entry gets its
  // version written back. Cheap enough to run once; skipped once migrated.
  const cacheData = JSON.parse(await app.vault.adapter.read(cachePath));
  const list0 = cacheData.items as CSLList;
  let versionedCount = 0;
  for (const it of list0) if (it._version != null) versionedCount++;
  if (list0.length && versionedCount < list0.length) {
    sinceVersion = 0;
  }

  const { libraryType, libraryId } = nativeLibraryCoords(groupId);
  const { items: rawItems, version } = await fetchAllZoteroItemsNative(
    port,
    libraryType,
    libraryId,
    sinceVersion
  );

  if (!rawItems?.length) return null;

  const modified = new Map<string, PartialCSLEntry>();
  const newKeys = new Set<string>();

  for (const rawItem of rawItems) {
    const cslItem = _zoteroItemToCSL(rawItem, groupId);
    if (!cslItem?.id) continue;
    modified.set(cslItem.id, cslItem);
    newKeys.add(cslItem.id);
  }

  // Build zoteroKey → new citekey. _zoteroKey is always set by zoteroItemToCSL.
  const zoteroKeyToNewId = new Map<string, string>();
  for (const [id, entry] of modified.entries()) {
    if (entry._zoteroKey) zoteroKeyToNewId.set(entry._zoteroKey, id);
  }

  const rawList = cacheData.items as CSLList;

  // Drop stale entries: same Zotero item (_zoteroKey) but old citekey.
  const list = rawList.filter((item) => {
    if (!item._zoteroKey) return true; // legacy entries without key — keep
    const newId = zoteroKeyToNewId.get(item._zoteroKey);
    return !newId || newId === item.id;
  });

  for (let i = 0; i < list.length; i++) {
    if (modified.has(list[i].id)) {
      newKeys.delete(list[i].id);
      list[i] = modified.get(list[i].id)!;
    }
  }
  for (const key of newKeys) list.push(modified.get(key)!);

  await app.vault.adapter.write(
    cachePath,
    JSON.stringify({ items: list, version })
  );

  return { list: applyGroupID(list, groupId), modified };
}

export async function getItemJSONFromCiteKeysNative(
  port: string = DEFAULT_ZOTERO_PORT,
  citeKeys: string[],
  libraryID: number
): Promise<any[] | null> {
  if (!(await isZoteroRunningNative(port))) return null;

  const { libraryType, libraryId } = nativeLibraryCoords(libraryID);
  const results: any[] = [];

  // Parallelize per-key fetches (concurrency ~6) — sequential HTTP to the
  // local Zotero API for 30+ keys is what made cold renders take minutes.
  const CONCURRENCY = 6;
  const queue = [...citeKeys];
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length) {
      const citeKey = queue.shift()!;
      try {
        const { data } = await zoteroNativeGet(
          port,
          `/api/${libraryType}/${libraryId}/items?format=json&q=${encodeURIComponent(citeKey)}&limit=10`
        );
        if (!Array.isArray(data)) continue;

        const match = data.find((item: any) => item.data?.citationKey === citeKey);
        if (!match) continue;

        const itemKey = match.key;
        const selectUrl =
          libraryID === 1
            ? `zotero://select/library/items/${itemKey}`
            : `zotero://select/groups/${libraryID}/items/${itemKey}`;

        const { data: children } = await zoteroNativeGet(
          port,
          `/api/${libraryType}/${libraryId}/items/${itemKey}/children?format=json&itemType=attachment`
        );

        // PDF file path: the LOCAL Zotero API (localhost:23119) exposes it in
        // `links.enclosure.href` (file:///...), NOT in `data.path` (which is
        // absent here — it only exists via the JSON-RPC/BBT endpoint). The
        // original Pandoc Reference List used the BBT endpoint, which is why
        // PDF links "used to work". Support both shapes.
        const attachments = Array.isArray(children)
          ? children
              .filter((c: any) => {
                if (c.data?.contentType !== 'application/pdf') return false;
                const href = c.links?.enclosure?.href;
                return href || c.data?.path;
              })
              .map((c: any) => {
                const href = c.links?.enclosure?.href as string | undefined;
                const path = c.data?.path as string | undefined;
                // Normalize file:///... → plain filesystem path; strip query.
                const raw = href ?? path;
                const clean = raw.replace(/^file:\/\//, '').split('?')[0];
                return { path: decodeURIComponent(clean) };
              })
          : [];

        results.push({ citekey: citeKey, citationKey: citeKey, select: selectUrl, attachments });
      } catch {
        // skip individual failures
      }
    }
  });
  await Promise.all(workers);

  return results.length ? results : null;
}

/** The item's children, bucketed the way the note-context mappers want them. */
export interface RawZoteroChildren {
  attachments: any[];
  annotations: any[];
  notes: any[];
}

/**
 * Fetch every child of an item — attachments, child notes, and the
 * annotations that hang off those attachments — for the note-import path.
 *
 * Two calls, because Zotero's `children` endpoint returns only DIRECT children
 * unless an `itemType` filter is given: the unfiltered call yields the item's
 * notes and attachments, while `itemType=annotation` resolves annotations at
 * any depth (its response carries each annotation's `parentItem`, so they
 * re-attach to the right attachment). The local server also lists an
 * annotation under its attachment when queried directly, so duplicates are
 * de-duplicated by key.
 *
 * Returns `null` when Zotero isn't running, so the caller can degrade instead
 * of throwing.
 */
export async function fetchItemChildrenNative(
  port: string = DEFAULT_ZOTERO_PORT,
  itemKey: string,
  libraryID: number
): Promise<RawZoteroChildren | null> {
  if (!itemKey) return { attachments: [], annotations: [], notes: [] };
  if (!(await isZoteroRunningNative(port))) return null;

  const { libraryType, libraryId } = nativeLibraryCoords(libraryID);
  const base = `/api/${libraryType}/${libraryId}/items/${itemKey}/children`;
  const safeGet = async (
    path: string
  ): Promise<{ data: any } | null> => {
    try {
      return await zoteroNativeGet(port, path);
    } catch {
      return null;
    }
  };
  const [direct, annotationOnly] = await Promise.all([
    safeGet(`${base}?format=json`),
    safeGet(`${base}?itemType=annotation&format=json`),
  ]);

  const attachments: any[] = [];
  const annotations: any[] = [];
  const notes: any[] = [];
  const seen = new Set<string>();

  for (const item of [
    ...(Array.isArray(direct?.data) ? direct.data : []),
    ...(Array.isArray(annotationOnly?.data) ? annotationOnly.data : []),
  ]) {
    const type = item?.data?.itemType;
    if (type === 'attachment') {
      attachments.push(item);
    } else if (type === 'annotation') {
      const key = String(item?.key ?? item?.data?.key ?? '');
      if (key && !seen.has(key)) {
        seen.add(key);
        annotations.push(item);
      }
    } else if (type === 'note') {
      notes.push(item);
    }
  }

  return { attachments, annotations, notes };
}

/**
 * Fetch CSL entries for specific citekeys from the native Zotero API — used to
 * render a note's citations BEFORE the full library has finished loading.
 * Mirrors `getItemJSONFromCiteKeysNative` but returns the CSL entry itself.
 * Parallelised (~6), and best-effort: a key that isn't found is simply skipped.
 */
export async function getCSLEntriesForCiteKeysNative(
  port: string = DEFAULT_ZOTERO_PORT,
  citeKeys: string[],
  groupId: number
): Promise<PartialCSLEntry[]> {
  if (!(await isZoteroRunningNative(port))) return [];

  const { libraryType, libraryId } = nativeLibraryCoords(groupId);
  const out: PartialCSLEntry[] = [];
  const seen = new Set<string>();
  const queue = [...citeKeys];
  const CONCURRENCY = 6;

  const workers = Array.from(
    { length: Math.min(CONCURRENCY, queue.length) },
    async () => {
      while (queue.length) {
        const citeKey = queue.shift()!;
        if (seen.has(citeKey)) continue;
        seen.add(citeKey);
        try {
          const { data } = await zoteroNativeGet(
            port,
            `/api/${libraryType}/${libraryId}/items?format=json&itemType=-attachment&limit=25&q=${encodeURIComponent(citeKey)}`
          );
          if (!Array.isArray(data)) continue;
          const match = data.find(
            (it: any) => it.data?.citationKey === citeKey
          );
          if (!match) continue;
          const csl = _zoteroItemToCSL(match, groupId);
          if (csl) out.push(csl);
        } catch {
          // skip individual failures
        }
      }
    }
  );
  await Promise.all(workers);
  return out;
}

export async function getItemJSONFromCiteKeys(
  port: string = DEFAULT_ZOTERO_PORT,
  citeKeys: string[],
  libraryID: number
): Promise<any[] | null> {
  if (!(await isZoteroRunning(port))) return null;

  try {
    const data = await bbtPost(port, {
      jsonrpc: '2.0',
      method: 'item.export',
      params: [citeKeys, '36a3b0b5-bad0-4a04-b79b-441c7cef77db', libraryID],
    });

    if (data.error?.message) {
      console.error(new Error(data.error.message));
      return null;
    }

    return Array.isArray(data.result)
      ? JSON.parse(data.result[2]).items
      : JSON.parse(data.result).items;
  } catch (e) {
    console.error(e);
    return null;
  }
}

/**
 * Search Zotero (native API) for items matching `query`.
 *
 * Used for live autocomplete — like ZotLit, this queries Zotero in real-time
 * so suggestions work even when no groups have been pre-loaded into the fuse
 * index. When `groupIds` is empty, "My Library" (group 1) is searched.
 *
 * Throws if Zotero is unreachable — callers should catch.
 */
export async function searchZoteroNative(
  port: string = DEFAULT_ZOTERO_PORT,
  query: string,
  groupIds: number[] = [],
  limit = 20
): Promise<PartialCSLEntry[]> {
  const encoded = encodeURIComponent(query);
  const targets = groupIds.length ? groupIds : [1];
  const results: PartialCSLEntry[] = [];

  debugLog('[sw:zotero-search] searchZoteroNative called, port=', port, 'query=', query, 'targets=', targets);

  for (const groupId of targets) {
    const libraryType = groupId === 1 ? 'users' : 'groups';
    const libraryId = groupId === 1 ? 0 : groupId;
    const url = `/api/${libraryType}/${libraryId}/items?q=${encoded}&format=json&itemType=-attachment&limit=${limit}`;
    debugLog('[sw:zotero-search] GET', `http://127.0.0.1:${port}${url}`);
    try {
      const { data } = await zoteroNativeGet(port, url);
      debugLog('[sw:zotero-search] response type=', typeof data, Array.isArray(data) ? `array[${data.length}]` : String(data)?.slice(0, 100));
      if (!Array.isArray(data)) continue;
      for (const item of data) {
        const cslItem = _zoteroItemToCSL(item, groupId);
        if (cslItem) results.push(cslItem);
      }
    } catch (e) {
      debugLog('[sw:zotero-search] request threw:', e);
      throw e;
    }
  }

  debugLog('[sw:zotero-search] returning', results.length, 'CSL items');
  return results;
}

/**
 * Search the library through Better BibTeX's JSON-RPC `item.search`. Unlike the
 * native `?q=` search — which returns child notes/attachments and can bury the
 * citeable item — this searches real item fields (`citationKey`, `title`,
 * `author`, …) and returns one rich entry per matching item, so it's reliable
 * for citekey autocomplete and works before the full library has loaded.
 *
 * `conditions` is a list of `[field, operator, value]` triples, ANDed together
 * (e.g. `[['citationKey', 'contains', 'smith']]`). Best-effort: returns [] when
 * BBT isn't reachable.
 */
export async function searchZoteroBBT(
  port: string = DEFAULT_ZOTERO_PORT,
  conditions: Array<[string, string, string]>,
  groupIds: number[] = [],
  limit = 20
): Promise<PartialCSLEntry[]> {
  const targets = groupIds.length ? groupIds : [1];
  const out: PartialCSLEntry[] = [];
  const seen = new Set<string>();

  for (const groupId of targets) {
    try {
      const data = await bbtPost(port, {
        jsonrpc: '2.0',
        method: 'item.search',
        params: [conditions, groupId],
      });
      if (!Array.isArray(data?.result)) continue;
      for (const it of data.result) {
        const id: string = it?.citekey ?? it?.['citation-key'] ?? '';
        if (!id || seen.has(id)) continue;
        seen.add(id);
        // Spread first, then overwrite the URI `id` with the citekey.
        out.push({ ...it, id, groupID: groupId } as PartialCSLEntry);
      }
    } catch (e) {
      debugLog('[sw:zotero-search] BBT item.search failed:', e);
    }
  }

  return out.slice(0, limit);
}
