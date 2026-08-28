import { z } from 'zod';

import type { EntryType, LedgerData, LedgerRow, LedgerSettings } from '../types.js';
import {
  MAX_LEDGER_AMOUNT,
  MAX_LEDGER_DESCRIPTION_LENGTH,
  MAX_LEDGER_ID_LENGTH,
  MAX_LEDGER_LIST_ITEMS,
  MAX_LEDGER_NOTE_LENGTH,
  MAX_LEDGER_ROWS,
  MAX_LEDGER_SETTINGS_TITLE_LENGTH,
  MAX_LEDGER_SHORT_TEXT_LENGTH,
} from '../../shared/ledger-limits.js';

export const DEFAULT_EXPENSE_CATEGORIES = [
  '餐饮',
  '交通',
  '购物',
  '居住',
  '娱乐',
  '健康',
  '学习',
  '人情',
  '其他',
] as const;

export const DEFAULT_INCOME_CATEGORIES = [
  '工资',
  '奖金',
  '副业',
  '投资',
  '报销',
  '其他',
] as const;

export const DEFAULT_ACCOUNTS = ['微信', '支付宝', '银行卡', '现金', '信用卡'] as const;

export const DEFAULT_LEDGER_SETTINGS: Readonly<LedgerSettings> = Object.freeze({
  title: 'Brclio Ledger',
  currency: 'CNY',
  expenseCategories: Object.freeze([...DEFAULT_EXPENSE_CATEGORIES]) as unknown as string[],
  incomeCategories: Object.freeze([...DEFAULT_INCOME_CATEGORIES]) as unknown as string[],
  accounts: Object.freeze([...DEFAULT_ACCOUNTS]) as unknown as string[],
});

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_PATTERN = /^\d{4}-\d{2}$/;

function isCalendarDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;

  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export const ledgerRowSchema = z.object({
  id: z.string().trim().min(1).max(MAX_LEDGER_ID_LENGTH),
  date: z.string().refine(isCalendarDate, '日期必须是有效的 YYYY-MM-DD'),
  type: z.enum(['income', 'expense']),
  category: z.string().max(MAX_LEDGER_SHORT_TEXT_LENGTH),
  description: z.string().max(MAX_LEDGER_DESCRIPTION_LENGTH),
  account: z.string().max(MAX_LEDGER_SHORT_TEXT_LENGTH),
  amount: z.number().finite().nonnegative().max(MAX_LEDGER_AMOUNT),
  note: z.string().max(MAX_LEDGER_NOTE_LENGTH),
});

export const ledgerSettingsSchema = z.object({
  title: z.string().trim().min(1).max(MAX_LEDGER_SETTINGS_TITLE_LENGTH),
  currency: z.string().trim().min(1).max(8),
  expenseCategories: z.array(z.string().trim().min(1).max(MAX_LEDGER_SHORT_TEXT_LENGTH)).min(1).max(MAX_LEDGER_LIST_ITEMS),
  incomeCategories: z.array(z.string().trim().min(1).max(MAX_LEDGER_SHORT_TEXT_LENGTH)).min(1).max(MAX_LEDGER_LIST_ITEMS),
  accounts: z.array(z.string().trim().min(1).max(MAX_LEDGER_SHORT_TEXT_LENGTH)).min(1).max(MAX_LEDGER_LIST_ITEMS),
});

export const ledgerDataSchema = z.object({
  version: z.literal(1),
  settings: ledgerSettingsSchema,
  rows: z.array(ledgerRowSchema).max(MAX_LEDGER_ROWS),
  meta: z.object({
    updatedAt: z.string().nullable(),
    updatedBy: z.string().nullable(),
  }),
});

function createId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  return `row-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function todayAsLocalIsoDate(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeText(value: unknown, fallback = '', maxLength = Number.POSITIVE_INFINITY): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : fallback;
}

function normalizeStringList(value: unknown, fallback: readonly string[]): string[] {
  if (!Array.isArray(value)) return [...fallback];

  const seen = new Set<string>();
  const normalized = value
    .map((item) => normalizeText(item, '', MAX_LEDGER_SHORT_TEXT_LENGTH))
    .filter((item) => {
      if (!item || seen.has(item)) return false;
      seen.add(item);
      return true;
    });

  return normalized.length > 0 ? normalized.slice(0, MAX_LEDGER_LIST_ITEMS) : [...fallback];
}

function normalizeSettings(value: unknown): LedgerSettings {
  const input = isRecord(value) ? value : {};

  return {
    title: normalizeText(input.title, DEFAULT_LEDGER_SETTINGS.title, MAX_LEDGER_SETTINGS_TITLE_LENGTH) || DEFAULT_LEDGER_SETTINGS.title,
    currency:
      normalizeText(input.currency, DEFAULT_LEDGER_SETTINGS.currency, 8).toUpperCase() ||
      DEFAULT_LEDGER_SETTINGS.currency,
    expenseCategories: normalizeStringList(
      input.expenseCategories,
      DEFAULT_EXPENSE_CATEGORIES,
    ),
    incomeCategories: normalizeStringList(input.incomeCategories, DEFAULT_INCOME_CATEGORIES),
    accounts: normalizeStringList(input.accounts, DEFAULT_ACCOUNTS),
  };
}

function normalizeAmount(value: unknown): number | null {
  const amount =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : Number.NaN;

  return Number.isFinite(amount) && amount >= 0 && amount <= MAX_LEDGER_AMOUNT ? amount : null;
}

function normalizeRow(value: unknown): LedgerRow | null {
  if (!isRecord(value)) return null;

  const date = normalizeText(value.date);
  const type = value.type;
  const amount = normalizeAmount(value.amount);
  if (!isCalendarDate(date) || (type !== 'income' && type !== 'expense') || amount === null) {
    return null;
  }

  const candidate: LedgerRow = {
    id: normalizeText(value.id, '', MAX_LEDGER_ID_LENGTH) || createId(),
    date,
    type,
    category: normalizeText(value.category, '', MAX_LEDGER_SHORT_TEXT_LENGTH),
    description: normalizeText(value.description, '', MAX_LEDGER_DESCRIPTION_LENGTH),
    account: normalizeText(value.account, '', MAX_LEDGER_SHORT_TEXT_LENGTH),
    amount,
    note: normalizeText(value.note, '', MAX_LEDGER_NOTE_LENGTH),
  };

  return ledgerRowSchema.safeParse(candidate).success ? candidate : null;
}

/** Create a new, independent ledger object. */
export function createDefaultLedger(): LedgerData {
  return {
    version: 1,
    settings: {
      title: DEFAULT_LEDGER_SETTINGS.title,
      currency: DEFAULT_LEDGER_SETTINGS.currency,
      expenseCategories: [...DEFAULT_EXPENSE_CATEGORIES],
      incomeCategories: [...DEFAULT_INCOME_CATEGORIES],
      accounts: [...DEFAULT_ACCOUNTS],
    },
    rows: [],
    meta: {
      updatedAt: null,
      updatedBy: null,
    },
  };
}

/** Create an editable blank row. Runtime-invalid overrides are safely replaced. */
export function createDefaultRow(
  overrides: Partial<LedgerRow> = {},
  now = new Date(),
): LedgerRow {
  const type: EntryType = overrides.type === 'income' ? 'income' : 'expense';
  const defaultCategory =
    type === 'income' ? DEFAULT_INCOME_CATEGORIES[0] : DEFAULT_EXPENSE_CATEGORIES[0];
  const amount = normalizeAmount(overrides.amount);

  return {
    id: normalizeText(overrides.id, '', MAX_LEDGER_ID_LENGTH) || createId(),
    date: isCalendarDate(normalizeText(overrides.date))
      ? normalizeText(overrides.date)
      : todayAsLocalIsoDate(now),
    type,
    category: normalizeText(overrides.category, '', MAX_LEDGER_SHORT_TEXT_LENGTH) || defaultCategory,
    description: normalizeText(overrides.description, '', MAX_LEDGER_DESCRIPTION_LENGTH),
    account: normalizeText(overrides.account, '', MAX_LEDGER_SHORT_TEXT_LENGTH) || DEFAULT_ACCOUNTS[0],
    amount: amount ?? 0,
    note: normalizeText(overrides.note, '', MAX_LEDGER_NOTE_LENGTH),
  };
}

/**
 * Convert untrusted cached/remote JSON into the current ledger shape.
 * Invalid rows are discarded instead of making the whole ledger unusable.
 */
export function normalizeLedgerData(value: unknown): LedgerData {
  if (!isRecord(value)) return createDefaultLedger();

  const rows = Array.isArray(value.rows) ? value.rows.slice(0, MAX_LEDGER_ROWS) : [];
  const normalizedRows: LedgerRow[] = [];
  const usedIds = new Set<string>();

  for (const rawRow of rows) {
    const row = normalizeRow(rawRow);
    if (!row) continue;

    if (usedIds.has(row.id)) row.id = createId();
    usedIds.add(row.id);
    normalizedRows.push(row);
  }

  const meta = isRecord(value.meta) ? value.meta : {};
  const updatedAt = typeof meta.updatedAt === 'string' ? meta.updatedAt : null;
  const updatedBy = typeof meta.updatedBy === 'string' ? meta.updatedBy.trim() || null : null;

  return {
    version: 1,
    settings: normalizeSettings(value.settings),
    rows: normalizedRows,
    meta: { updatedAt, updatedBy },
  };
}

/** Clone a ledger without sharing any nested arrays or objects. */
export function cloneLedgerData(value: unknown): LedgerData {
  const ledger = normalizeLedgerData(value);
  return {
    version: 1,
    settings: {
      ...ledger.settings,
      expenseCategories: [...ledger.settings.expenseCategories],
      incomeCategories: [...ledger.settings.incomeCategories],
      accounts: [...ledger.settings.accounts],
    },
    rows: ledger.rows.map((row) => ({ ...row })),
    meta: { ...ledger.meta },
  };
}

export interface LedgerSummary {
  income: number;
  expense: number;
  balance: number;
  count: number;
  incomeCount: number;
  expenseCount: number;
}

export function summarizeLedger(rows: readonly LedgerRow[]): LedgerSummary {
  let income = 0;
  let expense = 0;
  let incomeCount = 0;
  let expenseCount = 0;

  for (const row of rows) {
    if (!Number.isFinite(row.amount)) continue;
    if (row.type === 'income') {
      income += row.amount;
      incomeCount += 1;
    } else if (row.type === 'expense') {
      expense += row.amount;
      expenseCount += 1;
    }
  }

  return {
    income,
    expense,
    balance: income - expense,
    count: incomeCount + expenseCount,
    incomeCount,
    expenseCount,
  };
}

export interface MonthlySummary extends LedgerSummary {
  month: string;
  label: string;
}

function referenceMonth(reference: Date | string): { year: number; monthIndex: number } {
  if (typeof reference === 'string' && MONTH_PATTERN.test(reference.slice(0, 7))) {
    const [year, month] = reference.slice(0, 7).split('-').map(Number);
    if (month >= 1 && month <= 12) return { year, monthIndex: month - 1 };
  }

  if (reference instanceof Date && !Number.isNaN(reference.getTime())) {
    return { year: reference.getFullYear(), monthIndex: reference.getMonth() };
  }

  const now = new Date();
  return { year: now.getFullYear(), monthIndex: now.getMonth() };
}

/** Return calendar-month buckets, oldest first, including months with no entries. */
export function getRecentMonthlySummary(
  rows: readonly LedgerRow[],
  reference: Date | string = new Date(),
  monthCount = 6,
): MonthlySummary[] {
  const count = Math.max(1, Math.min(120, Math.trunc(monthCount) || 6));
  const current = referenceMonth(reference);
  const buckets: MonthlySummary[] = [];
  const byMonth = new Map<string, LedgerRow[]>();

  for (const row of rows) {
    const month = row.date.slice(0, 7);
    if (!MONTH_PATTERN.test(month)) continue;
    const bucket = byMonth.get(month) ?? [];
    bucket.push(row);
    byMonth.set(month, bucket);
  }

  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const monthDate = new Date(current.year, current.monthIndex - offset, 1);
    const year = monthDate.getFullYear();
    const monthNumber = monthDate.getMonth() + 1;
    const month = `${year}-${String(monthNumber).padStart(2, '0')}`;
    const summary = summarizeLedger(byMonth.get(month) ?? []);
    buckets.push({
      month,
      label: `${year}年${monthNumber}月`,
      ...summary,
    });
  }

  return buckets;
}

export interface ExpenseCategoryRanking {
  category: string;
  amount: number;
  count: number;
  /** Share of all expenses, from 0 through 100. */
  percentage: number;
}

export function getExpenseCategoryRanking(
  rows: readonly LedgerRow[],
  limit = Number.POSITIVE_INFINITY,
): ExpenseCategoryRanking[] {
  const grouped = new Map<string, { amount: number; count: number }>();
  let total = 0;

  for (const row of rows) {
    if (row.type !== 'expense' || !Number.isFinite(row.amount)) continue;
    const category = row.category.trim() || '未分类';
    const current = grouped.get(category) ?? { amount: 0, count: 0 };
    current.amount += row.amount;
    current.count += 1;
    total += row.amount;
    grouped.set(category, current);
  }

  const normalizedLimit = Number.isFinite(limit) ? Math.max(0, Math.trunc(limit)) : grouped.size;
  return [...grouped.entries()]
    .map(([category, value]) => ({
      category,
      amount: value.amount,
      count: value.count,
      percentage: total > 0 ? (value.amount / total) * 100 : 0,
    }))
    .sort((a, b) => b.amount - a.amount || b.count - a.count || a.category.localeCompare(b.category, 'zh-CN'))
    .slice(0, normalizedLimit);
}

export interface LedgerFilters {
  search?: string;
  type?: EntryType | 'all' | '';
  month?: string | 'all' | '';
  category?: string | 'all' | '';
}

export function filterLedgerRows(
  rows: readonly LedgerRow[],
  filters: LedgerFilters = {},
): LedgerRow[] {
  const query = filters.search?.trim().toLocaleLowerCase('zh-CN') ?? '';
  const type = filters.type && filters.type !== 'all' ? filters.type : null;
  const month = filters.month && filters.month !== 'all' ? filters.month : null;
  const category = filters.category && filters.category !== 'all' ? filters.category : null;

  return rows.filter((row) => {
    if (type && row.type !== type) return false;
    if (month && row.date.slice(0, 7) !== month) return false;
    if (category && row.category !== category) return false;
    if (!query) return true;

    const searchable = [
      row.date,
      row.type,
      row.type === 'income' ? '收入' : '支出',
      row.category,
      row.description,
      row.account,
      row.note,
      String(row.amount),
    ]
      .join('\n')
      .toLocaleLowerCase('zh-CN');

    return searchable.includes(query);
  });
}

// Compact aliases make the utilities pleasant to consume from UI code.
export const createEmptyLedger = createDefaultLedger;
export const createEmptyRow = createDefaultRow;
export const cloneLedger = cloneLedgerData;
export const getLedgerSummary = summarizeLedger;
export const getMonthlySummary = getRecentMonthlySummary;
export const getExpenseRanking = getExpenseCategoryRanking;
export const filterRows = filterLedgerRows;
