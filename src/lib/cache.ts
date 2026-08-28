import { z } from 'zod';

import type { LedgerData } from '../types.js';
import { createDefaultLedger, normalizeLedgerData } from './ledger.js';

export const LEDGER_CACHE_KEY = 'brclio-ledger:cache:v1';

export interface LedgerCacheSnapshot {
  data: LedgerData;
  remoteSha: string | null;
  dirty: boolean;
  cachedAt: string;
  lastSyncedAt: string | null;
}

export interface LedgerCacheWriteResult extends LedgerCacheSnapshot {
  /** Whether this snapshot was actually persisted to the supplied storage. */
  persisted: boolean;
}

export type LedgerCacheInput = Omit<LedgerCacheSnapshot, 'cachedAt'> & {
  cachedAt?: string;
};

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const isoDateSchema = z.string().refine((value) => !Number.isNaN(Date.parse(value)));

export const ledgerCacheSchema = z.object({
  data: z.unknown(),
  remoteSha: z.string().nullable(),
  dirty: z.boolean(),
  cachedAt: isoDateSchema,
  lastSyncedAt: isoDateSchema.nullable(),
});

function defaultStorage(): StorageLike | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    // localStorage can throw when disabled or blocked by browser privacy settings.
    return null;
  }
}

function isoNow(now: Date): string {
  return Number.isNaN(now.getTime()) ? new Date().toISOString() : now.toISOString();
}

function safeTimestamp(value: unknown, fallback: string | null): string | null {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : fallback;
}

/**
 * Read the persistent working copy. Invalid JSON/storage failures never escape,
 * while valid portions of an older or partially damaged cache are recovered.
 */
export function loadLedgerCache(
  storage: StorageLike | null = defaultStorage(),
  now = new Date(),
): LedgerCacheSnapshot | null {
  if (!storage) return null;

  try {
    const raw = storage.getItem(LEDGER_CACHE_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;

    const input = value as Record<string, unknown>;
    if (!('data' in input)) return null;

    const cachedAt = safeTimestamp(input.cachedAt, isoNow(now));
    return {
      data: normalizeLedgerData(input.data),
      remoteSha: typeof input.remoteSha === 'string' ? input.remoteSha : null,
      dirty: input.dirty === true,
      cachedAt: cachedAt ?? isoNow(now),
      lastSyncedAt: safeTimestamp(input.lastSyncedAt, null),
    };
  } catch {
    return null;
  }
}

/** Persist the complete working copy. `cachedAt` always reflects this write. */
export function saveLedgerCache(
  input: LedgerCacheInput | LedgerCacheSnapshot,
  storage: StorageLike | null = defaultStorage(),
  now = new Date(),
): LedgerCacheWriteResult {
  const snapshot: LedgerCacheSnapshot = {
    data: normalizeLedgerData(input.data),
    remoteSha: typeof input.remoteSha === 'string' ? input.remoteSha : null,
    dirty: input.dirty === true,
    cachedAt: isoNow(now),
    lastSyncedAt: safeTimestamp(input.lastSyncedAt, null),
  };

  if (!storage) return { ...snapshot, persisted: false };

  try {
    storage.setItem(LEDGER_CACHE_KEY, JSON.stringify(snapshot));
    return { ...snapshot, persisted: true };
  } catch {
    // Keep the in-memory snapshot usable when storage is full or unavailable.
    return { ...snapshot, persisted: false };
  }
}

/** Merge a small update into the cached working copy and persist it. */
export function updateLedgerCache(
  patch: Partial<Omit<LedgerCacheSnapshot, 'cachedAt'>>,
  storage: StorageLike | null = defaultStorage(),
  now = new Date(),
): LedgerCacheWriteResult {
  const existing = loadLedgerCache(storage, now) ?? {
    data: createDefaultLedger(),
    remoteSha: null,
    dirty: false,
    cachedAt: isoNow(now),
    lastSyncedAt: null,
  };

  return saveLedgerCache(
    {
      data: patch.data ?? existing.data,
      remoteSha: patch.remoteSha === undefined ? existing.remoteSha : patch.remoteSha,
      dirty: patch.dirty ?? existing.dirty,
      lastSyncedAt:
        patch.lastSyncedAt === undefined ? existing.lastSyncedAt : patch.lastSyncedAt,
    },
    storage,
    now,
  );
}

export function clearLedgerCache(storage: StorageLike | null = defaultStorage()): boolean {
  if (!storage) return false;

  try {
    storage.removeItem(LEDGER_CACHE_KEY);
    return true;
  } catch {
    return false;
  }
}

export const readLedgerCache = loadLedgerCache;
export const writeLedgerCache = saveLedgerCache;
export const loadCache = loadLedgerCache;
export const saveCache = saveLedgerCache;
export const clearCache = clearLedgerCache;
