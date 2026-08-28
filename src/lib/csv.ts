import Papa from 'papaparse';

import type { EntryType, LedgerData, LedgerRow } from '../types.js';
import { createDefaultRow } from './ledger.js';
import {
  MAX_LEDGER_AMOUNT,
  MAX_LEDGER_DESCRIPTION_LENGTH,
  MAX_LEDGER_ID_LENGTH,
  MAX_LEDGER_NOTE_LENGTH,
  MAX_LEDGER_ROWS,
  MAX_LEDGER_SHORT_TEXT_LENGTH,
} from '../../shared/ledger-limits.js';

type CsvCell = string | number | null | undefined;

interface PapaParseError {
  message: string;
  row?: number;
}

interface PapaParseResult {
  data: Array<Record<string, CsvCell>>;
  errors: PapaParseError[];
  meta: { fields?: string[] };
}

interface PapaApi {
  parse<T>(csv: string, config: Record<string, unknown>): T;
  unparse(data: unknown, config?: Record<string, unknown>): string;
}

const papa = Papa as PapaApi;

type CsvField =
  | 'id'
  | 'date'
  | 'type'
  | 'category'
  | 'description'
  | 'account'
  | 'amount'
  | 'note';

const HEADER_ALIASES: Record<string, CsvField> = {
  id: 'id',
  ID: 'id',
  编号: 'id',
  序号: 'id',
  date: 'date',
  日期: 'date',
  记账日期: 'date',
  type: 'type',
  类型: 'type',
  收支: 'type',
  收支类型: 'type',
  category: 'category',
  分类: 'category',
  类别: 'category',
  description: 'description',
  描述: 'description',
  摘要: 'description',
  事项: 'description',
  项目: 'description',
  account: 'account',
  账户: 'account',
  账号: 'account',
  amount: 'amount',
  金额: 'amount',
  数额: 'amount',
  note: 'note',
  备注: 'note',
  说明: 'note',
};

const FIELD_LABELS: Record<CsvField, string> = {
  id: 'ID',
  date: '日期',
  type: '类型',
  category: '分类',
  description: '描述',
  account: '账户',
  amount: '金额',
  note: '备注',
};

function normalizeHeader(header: string): string {
  const cleaned = header.replace(/^\uFEFF/, '').trim();
  return HEADER_ALIASES[cleaned] ?? HEADER_ALIASES[cleaned.toLowerCase()] ?? cleaned;
}

function textCell(value: CsvCell): string {
  return value === null || value === undefined ? '' : String(value).trim();
}

function parseEntryType(value: CsvCell): EntryType | null {
  const normalized = textCell(value).toLowerCase().replace(/\s+/g, '');
  if (['income', '收入', '入账', '收', '+'].includes(normalized)) return 'income';
  if (['expense', '支出', '消费', '支', '-'].includes(normalized)) return 'expense';
  return null;
}

function parseAmount(value: CsvCell): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;

  let normalized = textCell(value)
    .replace(/^(?:CNY|RMB)\s*/i, '')
    .replace(/^[￥¥]\s*/, '')
    .replace(/\s+/g, '');

  if (!normalized) return null;
  if (normalized.includes(',')) {
    if (!/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(normalized)) return null;
    normalized = normalized.replace(/,/g, '');
  } else if (!/^(?:\d+|\d*\.\d+)$/.test(normalized)) {
    return null;
  }

  const amount = Number(normalized);
  return Number.isFinite(amount) && amount > 0 && amount <= MAX_LEDGER_AMOUNT ? amount : null;
}

function parseDate(value: CsvCell): string | null {
  const raw = textCell(value);
  const match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(raw);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function rowWarning(csvLine: number, message: string): string {
  return `第 ${csvLine} 行：${message}`;
}

export interface CsvImportResult {
  rows: LedgerRow[];
  warnings: string[];
  importedCount: number;
  skippedCount: number;
}

/**
 * Parse a UTF-8/Excel CSV into ledger rows. A malformed row is skipped and
 * explained through `warnings`; valid sibling rows are still returned.
 */
export function importLedgerCsv(
  csv: string,
  reservedIds: Iterable<string> = [],
  maxRows = MAX_LEDGER_ROWS,
): CsvImportResult {
  const warnings: string[] = [];
  if (!csv.trim().replace(/^\uFEFF/, '')) {
    return { rows: [], warnings: ['CSV 内容为空。'], importedCount: 0, skippedCount: 0 };
  }

  const result = papa.parse<PapaParseResult>(csv.replace(/^\uFEFF/, ''), {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: normalizeHeader,
  });

  for (const error of result.errors) {
    const line = typeof error.row === 'number' ? error.row + 2 : 1;
    warnings.push(rowWarning(line, `CSV 解析异常：${error.message}`));
  }

  const fields = new Set(result.meta.fields ?? []);
  const required: CsvField[] = ['date', 'type', 'amount'];
  const missing = required.filter((field) => !fields.has(field));
  if (missing.length > 0) {
    warnings.push(`缺少必需列：${missing.map((field) => FIELD_LABELS[field]).join('、')}。`);
    return {
      rows: [],
      warnings,
      importedCount: 0,
      skippedCount: result.data.length,
    };
  }

  const rows: LedgerRow[] = [];
  const ids = new Set(reservedIds);
  const rowLimit = Math.max(0, Math.min(MAX_LEDGER_ROWS, Math.trunc(maxRows) || 0));
  let rowLimitWarned = false;
  let skippedCount = 0;

  result.data.forEach((record, index) => {
    const csvLine = index + 2;
    if (rows.length >= rowLimit) {
      if (!rowLimitWarned) {
        warnings.push(`导入最多还能容纳 ${rowLimit} 条记录，其余行已跳过。`);
        rowLimitWarned = true;
      }
      skippedCount += 1;
      return;
    }
    const date = parseDate(record.date);
    const type = parseEntryType(record.type);
    const amount = parseAmount(record.amount);
    const category = textCell(record.category);
    const description = textCell(record.description);
    const account = textCell(record.account);
    const note = textCell(record.note);
    const problems: string[] = [];

    if (!date) problems.push('日期无效（请使用 YYYY-MM-DD）');
    if (!type) problems.push(`类型无效“${textCell(record.type) || '空'}”`);
    if (amount === null) problems.push(`金额无效“${textCell(record.amount) || '空'}”（必须大于 0）`);
    if (category.length > MAX_LEDGER_SHORT_TEXT_LENGTH) problems.push('分类文字过长');
    if (description.length > MAX_LEDGER_DESCRIPTION_LENGTH) problems.push('描述文字过长');
    if (account.length > MAX_LEDGER_SHORT_TEXT_LENGTH) problems.push('账户文字过长');
    if (note.length > MAX_LEDGER_NOTE_LENGTH) problems.push('备注文字过长');

    if (!date || !type || amount === null || problems.length > 0) {
      warnings.push(rowWarning(csvLine, `${problems.join('；')}，已跳过。`));
      skippedCount += 1;
      return;
    }

    const requestedId = textCell(record.id);
    const validRequestedId = requestedId.length <= MAX_LEDGER_ID_LENGTH ? requestedId : '';
    const uniqueId = validRequestedId && !ids.has(validRequestedId) ? validRequestedId : undefined;
    if (requestedId && !validRequestedId) {
      warnings.push(rowWarning(csvLine, 'ID 过长，已自动换成新 ID。'));
    } else if (validRequestedId && ids.has(validRequestedId)) {
      warnings.push(rowWarning(csvLine, `ID“${validRequestedId}”重复，已自动换成新 ID。`));
    }

    const row = createDefaultRow({
      id: uniqueId,
      date,
      type,
      amount,
      category,
      description,
      account,
      note,
    });

    // CSV blanks should stay blank instead of inheriting new-row UI defaults.
    row.category = category;
    row.account = account;
    ids.add(row.id);
    rows.push(row);
  });

  return {
    rows,
    warnings,
    importedCount: rows.length,
    skippedCount,
  };
}

const EXPORT_HEADERS = ['ID', '日期', '类型', '分类', '描述', '账户', '金额', '备注'] as const;

function excelSafeText(value: string): string {
  // Prevent formula execution when the exported file is opened in Excel.
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

/** Export with a UTF-8 BOM so Chinese headers/text open correctly in Excel. */
export function exportLedgerCsv(input: readonly LedgerRow[] | LedgerData): string {
  const rows: readonly LedgerRow[] = 'rows' in input ? input.rows : input;
  const body = rows.map((row) => ({
    ID: excelSafeText(row.id),
    日期: row.date,
    类型: row.type === 'income' ? '收入' : '支出',
    分类: excelSafeText(row.category),
    描述: excelSafeText(row.description),
    账户: excelSafeText(row.account),
    金额: row.amount,
    备注: excelSafeText(row.note),
  }));

  return `\uFEFF${papa.unparse(body, {
    columns: [...EXPORT_HEADERS],
    newline: '\r\n',
    header: true,
  })}`;
}

export const parseLedgerCsv = importLedgerCsv;
export const serializeLedgerCsv = exportLedgerCsv;
