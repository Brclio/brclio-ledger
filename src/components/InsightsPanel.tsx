import { ArrowDownLeft, ArrowUpRight, CalendarRange, PieChart } from 'lucide-react';
import { useMemo } from 'react';

import {
  getExpenseCategoryRanking,
  getRecentMonthlySummary,
  summarizeLedger,
} from '../lib';
import type { LedgerRow } from '../types';

interface InsightsPanelProps {
  rows: LedgerRow[];
  currency: string;
}

function money(value: number, currency: string, compact = false) {
  try {
    return new Intl.NumberFormat('zh-CN', {
      style: 'currency',
      currency,
      notation: compact ? 'compact' : 'standard',
      maximumFractionDigits: compact ? 1 : 2,
    }).format(value);
  } catch {
    return new Intl.NumberFormat('zh-CN', {
      notation: compact ? 'compact' : 'standard',
      maximumFractionDigits: 2,
    }).format(value);
  }
}

export function InsightsPanel({ rows, currency }: InsightsPanelProps) {
  const months = useMemo(() => getRecentMonthlySummary(rows, new Date(), 6), [rows]);
  const ranking = useMemo(() => getExpenseCategoryRanking(rows, 7), [rows]);
  const currentMonth = months.at(-1)!;
  const all = useMemo(() => summarizeLedger(rows), [rows]);
  const maxMonthly = Math.max(1, ...months.flatMap((month) => [month.income, month.expense]));
  const expenseShare = currentMonth.income > 0
    ? Math.min(100, (currentMonth.expense / currentMonth.income) * 100)
    : currentMonth.expense > 0
      ? 100
      : 0;
  const ringDash = `${Math.max(0, Math.min(100, expenseShare))} ${100 - Math.max(0, Math.min(100, expenseShare))}`;

  return (
    <section className="insights-layout">
      <div className="insight-heading">
        <div>
          <span className="section-kicker">MONTHLY VIEW · 近六个月</span>
          <h2>让数字说人话。</h2>
          <p>图表只读取当前浏览器工作副本，未推送的修改也会立即计入。</p>
        </div>
        <span aria-hidden="true" className="insight-heading__number">
          06
        </span>
      </div>

      <div className="insights-primary">
        <article className="monthly-chart-panel">
          <div className="panel-heading">
            <div>
              <span className="panel-heading__eyebrow">CASH FLOW</span>
              <h3>月度收支</h3>
            </div>
            <div className="chart-legend" aria-label="图例">
              <span><i className="legend-dot legend-dot--income" />收入</span>
              <span><i className="legend-dot legend-dot--expense" />支出</span>
            </div>
          </div>

          <div className="monthly-chart" role="group" aria-label="最近六个月收入与支出柱状图">
            <div className="monthly-chart__baseline" />
            {months.map((month) => (
              <div className="month-column" key={month.month}>
                <div className="month-column__bars">
                  <span
                    aria-label={`${month.label}收入 ${money(month.income, currency)}`}
                    className="month-bar month-bar--income"
                    role="img"
                    style={{ height: `${Math.max(month.income > 0 ? 5 : 0, (month.income / maxMonthly) * 100)}%` }}
                    tabIndex={month.income > 0 ? 0 : -1}
                  >
                    <span className="month-bar__tooltip">{money(month.income, currency, true)}</span>
                  </span>
                  <span
                    aria-label={`${month.label}支出 ${money(month.expense, currency)}`}
                    className="month-bar month-bar--expense"
                    role="img"
                    style={{ height: `${Math.max(month.expense > 0 ? 5 : 0, (month.expense / maxMonthly) * 100)}%` }}
                    tabIndex={month.expense > 0 ? 0 : -1}
                  >
                    <span className="month-bar__tooltip">{money(month.expense, currency, true)}</span>
                  </span>
                </div>
                <span className="month-column__label">{Number(month.month.slice(5))}月</span>
              </div>
            ))}
          </div>
        </article>

        <aside className="month-focus">
          <span className="month-focus__handwrite">This month ✦</span>
          <div className="month-ring" aria-label={`本月支出占收入 ${expenseShare.toFixed(0)}%`}>
            <svg aria-hidden="true" viewBox="0 0 42 42">
              <circle className="month-ring__track" cx="21" cy="21" fill="none" r="15.915" strokeWidth="3" />
              <circle
                className="month-ring__value"
                cx="21"
                cy="21"
                fill="none"
                pathLength="100"
                r="15.915"
                strokeDasharray={ringDash}
                strokeDashoffset="25"
                strokeWidth="3"
              />
            </svg>
            <div>
              <strong>{expenseShare.toFixed(0)}%</strong>
              <span>支出 / 收入</span>
            </div>
          </div>
          <dl className="month-focus__stats">
            <div>
              <dt><ArrowDownLeft aria-hidden="true" size={14} />本月收入</dt>
              <dd>{money(currentMonth.income, currency)}</dd>
            </div>
            <div>
              <dt><ArrowUpRight aria-hidden="true" size={14} />本月支出</dt>
              <dd>{money(currentMonth.expense, currency)}</dd>
            </div>
            <div>
              <dt><CalendarRange aria-hidden="true" size={14} />本月笔数</dt>
              <dd>{currentMonth.count} 笔</dd>
            </div>
          </dl>
        </aside>
      </div>

      <div className="insights-secondary">
        <article className="ranking-panel">
          <div className="panel-heading">
            <div>
              <span className="panel-heading__eyebrow">WHERE IT WENT</span>
              <h3>支出分类排行</h3>
            </div>
            <PieChart aria-hidden="true" size={20} />
          </div>
          {ranking.length === 0 ? (
            <div className="insight-empty">还没有支出记录，先去记一笔吧。</div>
          ) : (
            <div className="ranking-list">
              {ranking.map((item, index) => (
                <div className="ranking-row" key={item.category}>
                  <span className="ranking-row__index">{String(index + 1).padStart(2, '0')}</span>
                  <div className="ranking-row__main">
                    <div className="ranking-row__label">
                      <strong>{item.category}</strong>
                      <span>{item.count} 笔 · {item.percentage.toFixed(1)}%</span>
                    </div>
                    <div className="ranking-row__track">
                      <span style={{ width: `${Math.max(2, item.percentage)}%` }} />
                    </div>
                  </div>
                  <strong className="ranking-row__amount">{money(item.amount, currency)}</strong>
                </div>
              ))}
            </div>
          )}
        </article>

        <aside className="ledger-note">
          <span className="ledger-note__tag">Ledger note</span>
          <p className="ledger-note__big">{all.balance >= 0 ? '钱还在你这边。' : '该给支出踩一下刹车。'}</p>
          <p>
            累计收入 {money(all.income, currency)}，累计支出 {money(all.expense, currency)}。
            {all.count === 0 ? '记下第一笔后，这里会给出更有用的趋势。' : '每次保存都会在 GitHub 留下可追溯版本。'}
          </p>
          <span aria-hidden="true" className="ledger-note__scribble">↳ keep it honest</span>
        </aside>
      </div>
    </section>
  );
}
