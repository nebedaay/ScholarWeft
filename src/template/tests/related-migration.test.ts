import {
  EMPTY_MIGRATION_STATE,
  markRelatedMigrated,
  needsRelatedMigration,
  parseMigrationState,
  serializeMigrationState,
} from '../related-migration';

describe('parseMigrationState()', () => {
  it('reads a written state', () => {
    const state = parseMigrationState('{"version":1,"migrated":["A","B"]}');
    expect(state.migrated).toEqual(['A', 'B']);
  });

  it('treats absent, empty, or corrupt data as nothing migrated', () => {
    expect(parseMigrationState(null).migrated).toEqual([]);
    expect(parseMigrationState('').migrated).toEqual([]);
    expect(parseMigrationState('not json').migrated).toEqual([]);
    expect(parseMigrationState('{"migrated":"nope"}').migrated).toEqual([]);
    // A corrupt file must not block imports; re-running is non-destructive.
  });

  it('drops non-string entries', () => {
    expect(
      parseMigrationState('{"migrated":["A",1,null,"B"]}').migrated
    ).toEqual(['A', 'B']);
  });
});

describe('serializeMigrationState()', () => {
  it('round-trips and de-duplicates', () => {
    const state = { version: 1 as const, migrated: ['A', 'A', 'B'] };
    const restored = parseMigrationState(serializeMigrationState(state));
    expect(restored.migrated).toEqual(['A', 'B']);
  });
});

describe('needsRelatedMigration() / markRelatedMigrated()', () => {
  it('needs migrating until recorded', () => {
    expect(needsRelatedMigration(EMPTY_MIGRATION_STATE, 'KEY1')).toBe(true);
    const after = markRelatedMigrated(EMPTY_MIGRATION_STATE, 'KEY1');
    expect(needsRelatedMigration(after, 'KEY1')).toBe(false);
    // Other keys are unaffected.
    expect(needsRelatedMigration(after, 'KEY2')).toBe(true);
  });

  it('never migrates a note with no stable key', () => {
    // Without a key there is nowhere to record it, so the tidy would repeat.
    expect(needsRelatedMigration(EMPTY_MIGRATION_STATE, null)).toBe(false);
    expect(needsRelatedMigration(EMPTY_MIGRATION_STATE, '')).toBe(false);
    expect(needsRelatedMigration(EMPTY_MIGRATION_STATE, undefined)).toBe(false);
  });

  it('returns the same object when nothing changes (no needless write)', () => {
    const state = markRelatedMigrated(EMPTY_MIGRATION_STATE, 'KEY1');
    expect(markRelatedMigrated(state, 'KEY1')).toBe(state);
    expect(markRelatedMigrated(state, null)).toBe(state);
  });
});
