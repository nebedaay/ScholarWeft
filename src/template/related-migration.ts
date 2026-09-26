/**
 * One-time `related` → `sw-related` migration bookkeeping.
 *
 * The split into `sw-related` left notes made by earlier releases with Zotero's
 * tags and related links mixed into `related:`. Tidying that up has to happen
 * EXACTLY ONCE per note: any rule that re-derives "which entries are Zotero's"
 * on every update cannot tell a link the user added by hand from one we wrote,
 * so it will eventually delete the user's own work.
 *
 * So the transition is recorded. The first time a `zotero-key` is touched after
 * this release, `related:` is reconciled against Zotero's list (the entries
 * Zotero still supplies move out, everything else stays). After that the key is
 * marked migrated and `related:` is never written to again.
 *
 * Pure data + rules here; the plugin owns reading/writing the file.
 */

export interface RelatedMigrationState {
  /** Format marker, so a future change can migrate the file itself. */
  version: 1;
  /** `zotero-key`s whose `related:` has already been transferred. */
  migrated: string[];
}

export const EMPTY_MIGRATION_STATE: RelatedMigrationState = {
  version: 1,
  migrated: [],
};

/** Parse the persisted file, tolerating anything malformed or absent. */
export function parseMigrationState(raw: string | null): RelatedMigrationState {
  if (!raw) return { ...EMPTY_MIGRATION_STATE, migrated: [] };
  try {
    const data = JSON.parse(raw) as Partial<RelatedMigrationState>;
    const migrated = Array.isArray(data?.migrated)
      ? data.migrated.filter((k): k is string => typeof k === 'string' && !!k)
      : [];
    return { version: 1, migrated };
  } catch {
    // A corrupt file must not block imports: treat every note as unmigrated
    // (worst case the one-time tidy runs again, which is non-destructive by
    // design — it only removes entries Zotero still supplies).
    return { ...EMPTY_MIGRATION_STATE, migrated: [] };
  }
}

export function serializeMigrationState(state: RelatedMigrationState): string {
  return JSON.stringify({ version: 1, migrated: [...new Set(state.migrated)] });
}

/**
 * Does `zoteroKey` still need its one-time `related` → `sw-related` transfer?
 *
 * An empty key (a note with no stable id) is never migrated: there would be no
 * way to record it, so the tidy would repeat on every update.
 */
export function needsRelatedMigration(
  state: RelatedMigrationState,
  zoteroKey: string | null | undefined
): boolean {
  if (!zoteroKey) return false;
  return !state.migrated.includes(zoteroKey);
}

/** Record a key as migrated. Returns the same object when nothing changed. */
export function markRelatedMigrated(
  state: RelatedMigrationState,
  zoteroKey: string | null | undefined
): RelatedMigrationState {
  if (!zoteroKey || state.migrated.includes(zoteroKey)) return state;
  return { version: 1, migrated: [...state.migrated, zoteroKey] };
}
