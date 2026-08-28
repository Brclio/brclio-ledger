import { describe, expect, it } from 'vitest';

import type { LedgerRow } from '../src/types.js';
import {
  cloneLedgerData,
  createDefaultLedger,
  createDefaultRow,
  filterLedgerRows,
  getExpenseCategoryRanking,
  getRecentMonthlySummary,
  normalizeLedgerData,
  summarizeLedger,
} from '../src/lib/ledger.js';

function row(overrides: Partial<LedgerRow>): LedgerRow {
  return {
    id: 'row-id',
    date: '2026-08-01',
    type: 'expense',
    category: '餐饮',
    description: '午餐',
    account: '微信',
    amount: 20,
    note: '',
    ...overrides,
  };
}

describe('ledger defaults and normalization', () => {
  it('creates independent default ledgers and rows', () => {
    const first = createDefaultLedger();
    const second = createDefaultLedger();
    first.settings.accounts.push('新账户');

    expect(second.settings.accounts).not.toContain('新账户');
    expect(
      createDefaultRow(
        { type: 'income', category: '', amount: -5 },
        new Date(2026, 7, 28),
      ),
    ).toMatchObject({
      date: '2026-08-28',
      type: 'income',
      category: '工资',
      amount: 0,
    });
  });

  it('salvages good untrusted data and discards unsafe rows', () => {
    const ledger = normalizeLedgerData({
      version: 99,
      settings: {
        title: '  家庭账本  ',
        currency: 'cny',
        expenseCategories: ['餐饮', '', '餐饮'],
        incomeCategories: null,
        accounts: [],
      },
      rows: [
        row({ id: 'same', amount: 12 }),
        { ...row({ id: 'same' }), amount: '18.5', description: '  地铁  ' },
        row({ id: 'bad-date', date: '2026-02-30' }),
        row({ id: 'bad-amount', amount: Number.POSITIVE_INFINITY }),
      ],
      meta: { updatedAt: 123, updatedBy: '  Esther  ' },
    });

    expect(ledger.version).toBe(1);
    expect(ledger.settings.title).toBe('家庭账本');
    expect(ledger.settings.currency).toBe('CNY');
    expect(ledger.settings.expenseCategories).toEqual(['餐饮']);
    expect(ledger.settings.incomeCategories.length).toBeGreaterThan(1);
    expect(ledger.rows).toHaveLength(2);
    expect(ledger.rows[1]).toMatchObject({ amount: 18.5, description: '地铁' });
    expect(ledger.rows[0].id).not.toBe(ledger.rows[1].id);
    expect(ledger.meta).toEqual({ updatedAt: null, updatedBy: 'Esther' });
  });

  it('clones all nested data without shared references', () => {
    const source = createDefaultLedger();
    source.rows = [row({ id: 'one' })];
    const copy = cloneLedgerData(source);

    copy.rows[0].description = '已修改';
    copy.settings.expenseCategories.push('新分类');
    copy.meta.updatedBy = 'editor';

    expect(source.rows[0].description).toBe('午餐');
    expect(source.settings.expenseCategories).not.toContain('新分类');
    expect(source.meta.updatedBy).toBeNull();
  });
});

describe('ledger statistics', () => {
  const rows = [
    row({ id: '1', date: '2026-03-03', type: 'income', category: '工资', amount: 10_000 }),
    row({ id: '2', date: '2026-03-08', category: '餐饮', amount: 800 }),
    row({ id: '3', date: '2026-02-18', category: '交通', amount: 300 }),
    row({ id: '4', date: '2025-12-02', category: '餐饮', amount: 200 }),
  ];

  it('calculates income, expense, balance and counts', () => {
    expect(summarizeLedger(rows)).toEqual({
      income: 10_000,
      expense: 1_300,
      balance: 8_700,
      count: 4,
      incomeCount: 1,
      expenseCount: 3,
    });
  });

  it('returns six calendar months oldest-first and includes empty months', () => {
    const months = getRecentMonthlySummary(rows, '2026-03', 6);

    expect(months.map((item) => item.month)).toEqual([
      '2025-10',
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
      '2026-03',
    ]);
    expect(months[3]).toMatchObject({ income: 0, expense: 0, balance: 0, count: 0 });
    expect(months[5]).toMatchObject({ income: 10_000, expense: 800, balance: 9_200 });
  });

  it('ranks expense categories and calculates percentage', () => {
    const ranking = getExpenseCategoryRanking(rows);

    expect(ranking.map((item) => item.category)).toEqual(['餐饮', '交通']);
    expect(ranking[0]).toMatchObject({ amount: 1_000, count: 2 });
    expect(ranking[0].percentage).toBeCloseTo((1_000 / 1_300) * 100);
  });
});

describe('ledger filters', () => {
  const rows = [
    row({ id: '1', date: '2026-08-01', type: 'income', category: '工资', description: '八月工资', amount: 12_000 }),
    row({ id: '2', date: '2026-08-02', category: '餐饮', description: '咖啡,早餐', note: '与 Alice 聊天', amount: 42 }),
    row({ id: '3', date: '2026-07-20', category: '交通', description: '高铁', account: '银行卡', amount: 560 }),
  ];

  it('combines type, month and category filters', () => {
    expect(
      filterLedgerRows(rows, { type: 'expense', month: '2026-08', category: '餐饮' }),
    ).toEqual([rows[1]]);
  });

  it('searches descriptions, notes, accounts, amounts and Chinese type names', () => {
    expect(filterLedgerRows(rows, { search: 'alice' })).toEqual([rows[1]]);
    expect(filterLedgerRows(rows, { search: '银行卡' })).toEqual([rows[2]]);
    expect(filterLedgerRows(rows, { search: '12000' })).toEqual([rows[0]]);
    expect(filterLedgerRows(rows, { search: '收入' })).toEqual([rows[0]]);
  });
});
