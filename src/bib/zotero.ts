// Zotero adapter layer — wraps the helper functions in bib/helpers.ts behind a
// uniform interface so BibManager can work with both Better BibTeX (Zotero ≤6)
// and the native Zotero 7/8 REST API without conditionals scattered everywhere.

import { PartialCSLEntry } from './types';
import {
  isZoteroRunning,
  isZoteroRunningNative,
  getZBib,
  getZBibNative,
  refreshZBib,
  refreshZBibNative,
  getItemJSONFromCiteKeys,
  getItemJSONFromCiteKeysNative,
  getCSLEntriesForCiteKeysNative,
} from './helpers';

export interface ZoteroAdapter {
  isRunning(): Promise<boolean>;

  /**
   * Fetch the full bibliography for `groupId`.
   * Returns `{ list, version }` — `version` is the Zotero library version
   * (native API only; always 0 for BBT).
   */
  getBib(
    _url: string,
    groupId: number,
    fromCache?: boolean
  ): Promise<{ list: PartialCSLEntry[] | null; version: number }>;

  /**
   * Fetch only items modified since `lastUpdate` (BBT) or `libraryVersion`
   * (native).  Returns `{ list, modified }` or null when nothing changed.
   */
  refreshBib(
    _url: string,
    groupId: number,
    libraryVersion: number,
    lastUpdate?: number
  ): Promise<{
    list?: PartialCSLEntry[];
    modified: Map<string, PartialCSLEntry>;
  } | null>;

  /**
   * Fetch Zotero item metadata (select links, PDF attachments) for a list of
   * citekeys.  Returns null when Zotero is unreachable.
   */
  getItemsForCiteKeys(
    citekeys: string[],
    groupId: number
  ): Promise<any[] | null>;

  /**
   * Fetch CSL entries for specific citekeys. Used to render a note's citations
   * immediately on a cold start, before the full library has loaded. Best-effort:
   * keys that can't be found are omitted.
   */
  getCSLEntriesForCiteKeys(
    citekeys: string[],
    groupId: number
  ): Promise<PartialCSLEntry[]>;
}

// ─── Better BibTeX adapter (Zotero ≤6, or ≥7 with BBT installed) ────────────

export class BBTAdapter implements ZoteroAdapter {
  constructor(private readonly port: string) {}

  isRunning(): Promise<boolean> {
    return isZoteroRunning(this.port);
  }

  async getBib(
    _url: string,
    groupId: number,
    fromCache?: boolean
  ): Promise<{ list: PartialCSLEntry[] | null; version: number }> {
    const list = await getZBib(this.port, '', groupId, fromCache);
    return { list, version: 0 };
  }

  async refreshBib(
    _url: string,
    groupId: number,
    _libraryVersion: number,
    lastUpdate?: number
  ): Promise<{
    list?: PartialCSLEntry[];
    modified: Map<string, PartialCSLEntry>;
  } | null> {
    return refreshZBib(this.port, '', groupId, lastUpdate ?? 0);
  }

  getItemsForCiteKeys(
    citekeys: string[],
    groupId: number
  ): Promise<any[] | null> {
    return getItemJSONFromCiteKeys(this.port, citekeys, groupId);
  }

  async getCSLEntriesForCiteKeys(
    citekeys: string[],
    groupId: number
  ): Promise<PartialCSLEntry[]> {
    const items = await getItemJSONFromCiteKeys(this.port, citekeys, groupId);
    if (!Array.isArray(items)) return [];
    return items
      .filter((it) => it && typeof it.id === 'string' && it.id)
      .map((it) => ({ ...it, groupID: groupId }) as PartialCSLEntry);
  }
}

// ─── Native Zotero 7/8 REST API adapter ─────────────────────────────────────

export class NativeAdapter implements ZoteroAdapter {
  constructor(private readonly port: string) {}

  isRunning(): Promise<boolean> {
    return isZoteroRunningNative(this.port);
  }

  async getBib(
    _url: string,
    groupId: number,
    fromCache?: boolean
  ): Promise<{ list: PartialCSLEntry[] | null; version: number }> {
    return getZBibNative(this.port, '', groupId, fromCache);
  }

  async refreshBib(
    _url: string,
    groupId: number,
    libraryVersion: number,
    _lastUpdate?: number
  ): Promise<{
    list?: PartialCSLEntry[];
    modified: Map<string, PartialCSLEntry>;
  } | null> {
    return refreshZBibNative(this.port, '', groupId, libraryVersion);
  }

  getItemsForCiteKeys(
    citekeys: string[],
    groupId: number
  ): Promise<any[] | null> {
    return getItemJSONFromCiteKeysNative(this.port, citekeys, groupId);
  }

  getCSLEntriesForCiteKeys(
    citekeys: string[],
    groupId: number
  ): Promise<PartialCSLEntry[]> {
    return getCSLEntriesForCiteKeysNative(this.port, citekeys, groupId);
  }
}
