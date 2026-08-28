import { MAX_LEDGER_AMOUNT } from '../../shared/ledger-limits.js';

export function parseGridAmount(rawValue: string): number | null {
  const trimmed = rawValue.trim();
  if (!trimmed || /^\(.*\)$/u.test(trimmed)) return null;
  const currencyStripped = trimmed
    .replace(/^(?:CNY|RMB)\s*/iu, '')
    .replace(/^[￥¥$€£]\s*/u, '');
  const grouped = currencyStripped.replace(/，/gu, ',');
  const plainAmount = /^\+?(?:\d+(?:\.\d*)?|\.\d+)$/u;
  const groupedAmount = /^\+?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/u;
  if (!plainAmount.test(grouped) && !groupedAmount.test(grouped)) return null;
  const parsed = Number(grouped.replace(/,/gu, ''));
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= MAX_LEDGER_AMOUNT ? parsed : null;
}

export function normalizePastedDate(value: string): string | null {
  const trimmed = value.trim();
  const slashDate = /^(\d{4})[/.年-](\d{1,2})[/.月-](\d{1,2})日?$/u.exec(trimmed);
  if (!slashDate) return null;

  const [, year, month, day] = slashDate;
  const normalized = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return date.getUTCFullYear() === Number(year) &&
    date.getUTCMonth() === Number(month) - 1 &&
    date.getUTCDate() === Number(day)
    ? normalized
    : null;
}
