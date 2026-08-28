import { describe, expect, it } from 'vitest';

import {
  LEDGER_CACHE_KEY,
  clearLedgerCache,
  loadLedgerCache,
  saveLedgerCache,
  updateLedgerCache,
  type StorageLike,
} from '../src/lib/cache.js';
import { createDefaultLedger, createDefaultRow } from '../src/lib/ledger.js';

class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

describe('persistent ledger cache', () => {
  it('persists all sync metadata and survives a fresh read', () => {
    const storage = new MemoryStorage();
    const data = createDefaultLedger();
    data.rows.push(createDefaultRow({ id: 'cached-row', amount: 88 }));
    const cachedAt = new Date('2026-08-28T10:00:00.000Z');

    const written = saveLedgerCache(
      {
        data,
        remoteSha: 'abc123',
        dirty: true,
        lastSyncedAt: '2026-08-28T09:00:00.000Z',
      },
      storage,
      cachedAt,
    );
    const reloaded = loadLedgerCache(storage);

    expect(written.cachedAt).toBe('2026-08-28T10:00:00.000Z');
    expect(written.persisted).toBe(true);
    expect(reloaded).toMatchObject({
      remoteSha: 'abc123',
      dirty: true,
      cachedAt: '2026-08-28T10:00:00.000Z',
      lastSyncedAt: '2026-08-28T09:00:00.000Z',
    });
    expect(reloaded?.data.rows[0]).toMatchObject({ id: 'cached-row', amount: 88 });
  });

  it('updates one field without losing the working copy', () => {
    const storage = new MemoryStorage();
    const data = createDefaultLedger();
    data.rows.push(createDefaultRow({ id: 'one' }));
    saveLedgerCache({ data, remoteSha: 'old', dirty: true, lastSyncedAt: null }, storage);

    const synced = updateLedgerCache(
      { remoteSha: 'new', dirty: false, lastSyncedAt: '2026-08-28T10:01:00Z' },
      storage,
    );

    expect(synced.data.rows[0].id).toBe('one');
    expect(synced).toMatchObject({ remoteSha: 'new', dirty: false });
  });

  it('safely degrades corrupt and partially damaged cache values', () => {
    const storage = new MemoryStorage();
    storage.values.set(LEDGER_CACHE_KEY, '{broken');
    expect(loadLedgerCache(storage)).toBeNull();

    storage.values.set(
      LEDGER_CACHE_KEY,
      JSON.stringify({
        data: { rows: [{ nope: true }] },
        remoteSha: 42,
        dirty: 'yes',
        cachedAt: 'not-a-date',
        lastSyncedAt: {},
      }),
    );
    const recovered = loadLedgerCache(storage, new Date('2026-08-28T12:00:00Z'));
    expect(recovered).toMatchObject({
      remoteSha: null,
      dirty: false,
      cachedAt: '2026-08-28T12:00:00.000Z',
      lastSyncedAt: null,
    });
    expect(recovered?.data.rows).toEqual([]);
  });

  it('clears only the ledger key and tolerates blocked storage', () => {
    const storage = new MemoryStorage();
    storage.values.set(LEDGER_CACHE_KEY, '{}');
    storage.values.set('other', 'keep');
    expect(clearLedgerCache(storage)).toBe(true);
    expect(storage.values.get('other')).toBe('keep');

    const blocked: StorageLike = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadLedgerCache(blocked)).toBeNull();
    expect(clearLedgerCache(blocked)).toBe(false);
    const blockedWrite = saveLedgerCache(
        { data: createDefaultLedger(), remoteSha: null, dirty: false, lastSyncedAt: null },
        blocked,
      );
    expect(blockedWrite.persisted).toBe(false);
  });
});
