import { z } from 'zod';

import {
  MAX_LEDGER_AMOUNT,
  MAX_LEDGER_BYTES,
  MAX_LEDGER_DESCRIPTION_LENGTH,
  MAX_LEDGER_ID_LENGTH,
  MAX_LEDGER_LIST_ITEMS,
  MAX_LEDGER_NOTE_LENGTH,
  MAX_LEDGER_ROWS,
  MAX_LEDGER_SETTINGS_TITLE_LENGTH,
  MAX_LEDGER_SHORT_TEXT_LENGTH,
} from '../shared/ledger-limits.js';

export { MAX_LEDGER_BYTES, MAX_LEDGER_ROWS } from '../shared/ledger-limits.js';

function serializeLedgerValue(data: unknown): string {
  return `${JSON.stringify(data, null, 2)}\n`;
}

const shortText = z.string().trim().min(1).max(MAX_LEDGER_SHORT_TEXT_LENGTH);
const categoryList = z
  .array(shortText)
  .min(1)
  .max(MAX_LEDGER_LIST_ITEMS)
  .refine((values) => new Set(values).size === values.length, {
    message: '列表中不能包含重复项',
  });

function isCalendarDate(value: string): boolean {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

const ledgerRowSchema = z
  .object({
    id: z.string().trim().min(1).max(MAX_LEDGER_ID_LENGTH),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/u, '日期格式应为 YYYY-MM-DD')
      .refine(isCalendarDate, '日期无效'),
    type: z.enum(['income', 'expense']),
    category: z.string().trim().max(MAX_LEDGER_SHORT_TEXT_LENGTH),
    description: z.string().trim().max(MAX_LEDGER_DESCRIPTION_LENGTH),
    account: z.string().trim().max(MAX_LEDGER_SHORT_TEXT_LENGTH),
    amount: z.number().finite().nonnegative().max(MAX_LEDGER_AMOUNT),
    note: z.string().trim().max(MAX_LEDGER_NOTE_LENGTH),
  })
  .strict();

export const ledgerDataSchema = z
  .object({
    version: z.literal(1),
    settings: z
      .object({
        title: z.string().trim().min(1).max(MAX_LEDGER_SETTINGS_TITLE_LENGTH),
        currency: z.string().trim().regex(/^[A-Z]{3,8}$/u).max(8),
        expenseCategories: categoryList,
        incomeCategories: categoryList,
        accounts: categoryList,
      })
      .strict(),
    rows: z
      .array(ledgerRowSchema)
      .max(MAX_LEDGER_ROWS)
      .refine((rows) => new Set(rows.map((row) => row.id)).size === rows.length, {
        message: '记录 ID 不能重复',
      }),
    meta: z
      .object({
        // Client metadata is accepted only as bounded text and then discarded;
        // the API always stamps a trusted ISO timestamp and editor on write.
        updatedAt: z.string().max(64).nullable(),
        updatedBy: z.string().max(64).nullable(),
      })
      .strict(),
  })
  .strict()
  .refine(
    (data) => Buffer.byteLength(serializeLedgerValue(data), 'utf8') <= MAX_LEDGER_BYTES,
    {
      message: '账本数据超过大小限制',
    },
  );

export type LedgerData = z.infer<typeof ledgerDataSchema>;

export const ledgerPutSchema = z
  .object({
    data: ledgerDataSchema,
    expectedSha: z.string().regex(/^[a-f0-9]{40}$/u).nullable(),
    force: z.boolean().optional().default(false),
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.force && value.expectedSha === null) {
      context.addIssue({
        code: 'custom',
        path: ['expectedSha'],
        message: '非强制保存必须提供 expectedSha',
      });
    }
  });

export type LedgerPut = z.infer<typeof ledgerPutSchema>;

export function serializeLedger(data: LedgerData): string {
  return serializeLedgerValue(data);
}

export function ledgerJsonByteLength(data: LedgerData): number {
  return Buffer.byteLength(serializeLedger(data), 'utf8');
}

export function parseLedgerData(input: unknown): LedgerData {
  return ledgerDataSchema.parse(input);
}

export function parseLedgerPut(input: unknown): LedgerPut {
  const request = ledgerPutSchema.parse(input);
  return { ...request, data: parseLedgerData(request.data) };
}

export function stampLedger(data: LedgerData, editor: string, now = new Date()): LedgerData {
  return {
    ...data,
    meta: {
      updatedAt: now.toISOString(),
      updatedBy: editor,
    },
  };
}

/** Stamp trusted server metadata and re-check the final serialized payload size. */
export function stampAndValidateLedger(
  data: LedgerData,
  editor: string,
  now = new Date(),
): LedgerData {
  return parseLedgerData(stampLedger(data, editor, now));
}

export function formatValidationIssues(error: z.ZodError): Array<{ path: string; message: string }> {
  return error.issues.slice(0, 12).map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}
