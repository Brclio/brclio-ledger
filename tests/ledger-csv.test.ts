import { describe, expect, it } from 'vitest';

import { exportLedgerCsv, importLedgerCsv } from '../src/lib/csv.js';
import { createDefaultRow } from '../src/lib/ledger.js';

describe('ledger CSV import', () => {
  it('supports Excel BOM, Chinese aliases, commas, quotes and embedded newlines', () => {
    const csv = [
      '\uFEFF记账日期,收支,类别,摘要,账号,数额,说明',
      '2026/8/1,收入,工资,"八月,工资",银行卡,"12,345.67","Alice 说""收到"""',
      '2026-08-02,支出,餐饮,外卖,微信,42,"两行备注第一行',
      '第二行"',
    ].join('\r\n');

    const result = importLedgerCsv(csv);

    expect(result.warnings).toEqual([]);
    expect(result.importedCount).toBe(2);
    expect(result.rows[0]).toMatchObject({
      date: '2026-08-01',
      type: 'income',
      description: '八月,工资',
      amount: 12_345.67,
      note: 'Alice 说"收到"',
    });
    expect(result.rows[1].note).toBe('两行备注第一行\r\n第二行');
  });

  it('keeps valid rows and returns actionable warnings for invalid rows', () => {
    const result = importLedgerCsv([
      '日期,类型,金额,描述',
      '2026-08-01,支出,20,有效',
      '2026-08-02,借款,50,类型错',
      '2026-08-03,收入,12abc,金额错',
      '2026-02-30,收入,100,日期错',
      '2026-08-04,支出,0,零金额',
    ].join('\n'));

    expect(result.rows).toHaveLength(1);
    expect(result.skippedCount).toBe(4);
    expect(result.warnings).toHaveLength(4);
    expect(result.warnings.join('\n')).toContain('第 3 行：类型无效');
    expect(result.warnings.join('\n')).toContain('金额无效');
    expect(result.warnings.join('\n')).toContain('日期无效');
  });

  it('reports missing required headers without throwing', () => {
    const result = importLedgerCsv('日期,描述\n2026-08-01,早餐');
    expect(result.rows).toEqual([]);
    expect(result.skippedCount).toBe(1);
    expect(result.warnings.at(-1)).toContain('类型、金额');
  });

  it('reassigns IDs that already exist in the current ledger', () => {
    const result = importLedgerCsv(
      ['ID,日期,类型,金额,描述', 'existing,2026-08-01,支出,20,重复导入'].join('\n'),
      ['existing'],
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].id).not.toBe('existing');
    expect(result.warnings.join('\n')).toContain('已自动换成新 ID');
  });

  it('enforces remaining row capacity and server-compatible field limits', () => {
    const capped = importLedgerCsv([
      '日期,类型,金额,描述',
      '2026-08-01,支出,20,第一条',
      '2026-08-02,支出,30,第二条',
    ].join('\n'), [], 1);
    expect(capped.rows).toHaveLength(1);
    expect(capped.skippedCount).toBe(1);
    expect(capped.warnings.join('\n')).toContain('最多还能容纳 1 条记录');

    const tooLong = importLedgerCsv([
      '日期,类型,金额,描述',
      `2026-08-01,支出,20,${'x'.repeat(241)}`,
      '2026-08-02,收入,1000000000001,金额过大',
    ].join('\n'));
    expect(tooLong.rows).toHaveLength(0);
    expect(tooLong.skippedCount).toBe(2);
  });
});

describe('ledger CSV export', () => {
  it('writes an Excel BOM and survives a quote/comma/newline round trip', () => {
    const source = createDefaultRow({
      id: 'csv-row',
      date: '2026-08-28',
      type: 'expense',
      category: '餐饮',
      description: '咖啡, 与"朋友"',
      account: '支付宝',
      amount: 38.5,
      note: '第一行\n第二行',
    });

    const csv = exportLedgerCsv([source]);
    const imported = importLedgerCsv(csv);

    expect(csv.startsWith('\uFEFFID,日期,类型')).toBe(true);
    expect(csv).toContain('\r\n');
    expect(imported.warnings).toEqual([]);
    expect(imported.rows[0]).toEqual(source);
  });

  it('neutralizes spreadsheet formulas in user-authored text', () => {
    const csv = exportLedgerCsv([
      createDefaultRow({ description: '=HYPERLINK("bad")', amount: 1 }),
    ]);
    expect(csv).toContain("'=HYPERLINK");
  });
});
