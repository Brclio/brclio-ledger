import { ArrowDownLeft, ArrowUpRight, Landmark, Rows3 } from 'lucide-react';

import type { LedgerSummary } from '../lib';

interface SummaryStripProps {
  summary: LedgerSummary;
  currency: string;
}

function formatMoney(value: number, currency: string) {
  try {
    return new Intl.NumberFormat('zh-CN', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value);
  }
}

export function SummaryStrip({ summary, currency }: SummaryStripProps) {
  const items = [
    {
      label: '总收入',
      value: formatMoney(summary.income, currency),
      note: `${summary.incomeCount} 笔入账`,
      icon: ArrowDownLeft,
      tone: 'income',
    },
    {
      label: '总支出',
      value: formatMoney(summary.expense, currency),
      note: `${summary.expenseCount} 笔支出`,
      icon: ArrowUpRight,
      tone: 'expense',
    },
    {
      label: '当前结余',
      value: formatMoney(summary.balance, currency),
      note: summary.balance >= 0 ? '收支仍有余量' : '支出已经超出收入',
      icon: Landmark,
      tone: summary.balance >= 0 ? 'balance' : 'warning',
    },
    {
      label: '记录笔数',
      value: String(summary.count).padStart(2, '0'),
      note: '浏览器工作副本',
      icon: Rows3,
      tone: 'count',
    },
  ];

  return (
    <section aria-label="账本汇总" className="summary-strip">
      <span aria-hidden="true" className="summary-strip__ghost">
        BALANCE
      </span>
      {items.map(({ label, value, note, icon: Icon, tone }, index) => (
        <article className={`summary-item summary-item--${tone}`} key={label}>
          <div className="summary-item__topline">
            <span className="summary-item__index">0{index + 1}</span>
            <Icon aria-hidden="true" size={17} />
          </div>
          <p className="summary-item__label">{label}</p>
          <p className="summary-item__value">{value}</p>
          <p className="summary-item__note">{note}</p>
        </article>
      ))}
    </section>
  );
}
