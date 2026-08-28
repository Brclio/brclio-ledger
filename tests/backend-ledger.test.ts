import { describe, expect, it } from 'vitest';

import { contentApiUrl, normalizeHistory } from '../server/github.js';
import {
  ledgerJsonByteLength,
  parseLedgerData,
  parseLedgerPut,
  stampAndValidateLedger,
  stampLedger,
} from '../server/ledger.js';
import { MAX_LEDGER_BYTES } from '../shared/ledger-limits.js';

function ledger() {
  return {
    version: 1 as const,
    settings: {
      title: '家庭账本',
      currency: 'CNY',
      expenseCategories: ['餐饮'],
      incomeCategories: ['工资'],
      accounts: ['银行卡'],
    },
    rows: [
      {
        id: 'row-1',
        date: '2026-08-28',
        type: 'expense' as const,
        category: '餐饮',
        description: '午餐',
        account: '银行卡',
        amount: 35.5,
        note: '',
      },
    ],
    meta: { updatedAt: null, updatedBy: null },
  };
}

describe('ledger validation', () => {
  it('accepts a strict valid ledger and optimistic lock request', () => {
    const input = parseLedgerPut({
      data: ledger(),
      expectedSha: 'a'.repeat(40),
      force: false,
    });
    expect(input.data.rows).toHaveLength(1);
  });

  it('requires an expected SHA unless force is explicit', () => {
    expect(() => parseLedgerPut({ data: ledger(), expectedSha: null })).toThrow();
    expect(parseLedgerPut({ data: ledger(), expectedSha: null, force: true }).force).toBe(true);
  });

  it('rejects unknown properties, duplicate IDs, invalid dates and negative amounts', () => {
    expect(() => parseLedgerData({ ...ledger(), surprise: true })).toThrow();

    const duplicate = ledger();
    duplicate.rows.push({ ...duplicate.rows[0] });
    expect(() => parseLedgerData(duplicate)).toThrow();

    const badDate = ledger();
    badDate.rows[0].date = '2026-02-30';
    expect(() => parseLedgerData(badDate)).toThrow();

    const badAmount = ledger();
    badAmount.rows[0].amount = -0.01;
    expect(() => parseLedgerData(badAmount)).toThrow();
  });

  it('overwrites client meta with a server timestamp and editor', () => {
    const data = parseLedgerData(ledger());
    const stamped = stampLedger(data, 'owner', new Date('2026-08-28T09:00:00.000Z'));
    expect(stamped.meta).toEqual({
      updatedAt: '2026-08-28T09:00:00.000Z',
      updatedBy: 'owner',
    });
  });

  it('rejects a payload when trusted save metadata would cross the byte limit', () => {
    const candidate = {
      ...ledger(),
      rows: Array.from({ length: 2_000 }, (_, index) => ({
        ...ledger().rows[0],
        id: `row-${index}`,
        note: '',
      })),
    };
    let remaining = MAX_LEDGER_BYTES - ledgerJsonByteLength(candidate);
    expect(remaining).toBeGreaterThan(0);

    for (const row of candidate.rows) {
      const added = Math.min(1_000, remaining);
      row.note = 'x'.repeat(added);
      remaining -= added;
      if (remaining === 0) break;
    }

    expect(remaining).toBe(0);
    expect(ledgerJsonByteLength(candidate)).toBe(MAX_LEDGER_BYTES);
    const parsed = parseLedgerData(candidate);
    expect(() =>
      stampAndValidateLedger(parsed, 'owner', new Date('2026-08-28T09:00:00.000Z')),
    ).toThrow();
  });
});

describe('GitHub normalization', () => {
  it('encodes each path segment in the Contents API URL', () => {
    expect(
      contentApiUrl({
        owner: 'Brclio',
        repo: 'brclio-ledger',
        branch: 'main',
        dataPath: 'data/my ledger.json',
      }),
    ).toBe(
      'https://api.github.com/repos/Brclio/brclio-ledger/contents/data/my%20ledger.json',
    );
  });

  it('normalizes commit fields and uses the first message line', () => {
    const items = normalizeHistory([
      {
        sha: 'abc',
        html_url: 'https://github.com/example/commit/abc',
        author: { login: 'octocat' },
        commit: {
          message: 'ledger: save\n\nMore detail',
          author: { name: 'Fallback', date: '2026-08-28T09:00:00Z' },
        },
      },
      { malformed: true },
    ]);

    expect(items).toEqual([
      {
        sha: 'abc',
        message: 'ledger: save',
        author: 'octocat',
        date: '2026-08-28T09:00:00Z',
        url: 'https://github.com/example/commit/abc',
      },
    ]);
  });
});
