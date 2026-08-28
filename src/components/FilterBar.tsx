import { Eraser, Search } from 'lucide-react';

import type { EntryType } from '../types';
import type { LedgerFilters } from '../lib';

interface FilterBarProps {
  value: LedgerFilters;
  months: string[];
  categories: string[];
  resultCount: number;
  totalCount: number;
  onChange: (next: LedgerFilters) => void;
}

function monthLabel(month: string) {
  const [year, number] = month.split('-');
  return `${year} 年 ${Number(number)} 月`;
}

export function FilterBar({
  value,
  months,
  categories,
  resultCount,
  totalCount,
  onChange,
}: FilterBarProps) {
  const hasFilters = Boolean(
    value.search ||
      (value.type && value.type !== 'all') ||
      (value.month && value.month !== 'all') ||
      (value.category && value.category !== 'all'),
  );

  const patch = (next: Partial<LedgerFilters>) => onChange({ ...value, ...next });

  return (
    <section aria-label="筛选账目" className="filter-panel">
      <div className="search-field">
        <Search aria-hidden="true" size={16} />
        <input
          aria-label="搜索账目"
          onChange={(event) => patch({ search: event.currentTarget.value })}
          placeholder="搜索摘要、分类、账户或金额…"
          type="search"
          value={value.search ?? ''}
        />
        <kbd>⌘ K</kbd>
      </div>

      <div className="filter-controls">
        <label className="filter-field">
          <span>收支</span>
          <select
            onChange={(event) => patch({ type: event.currentTarget.value as EntryType | 'all' })}
            value={value.type || 'all'}
          >
            <option value="all">全部</option>
            <option value="expense">仅支出</option>
            <option value="income">仅收入</option>
          </select>
        </label>
        <label className="filter-field">
          <span>月份</span>
          <select onChange={(event) => patch({ month: event.currentTarget.value })} value={value.month || 'all'}>
            <option value="all">全部月份</option>
            {months.map((month) => (
              <option key={month} value={month}>
                {monthLabel(month)}
              </option>
            ))}
          </select>
        </label>
        <label className="filter-field">
          <span>分类</span>
          <select
            onChange={(event) => patch({ category: event.currentTarget.value })}
            value={value.category || 'all'}
          >
            <option value="all">全部分类</option>
            {categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </label>
        <button
          className="clear-filter"
          disabled={!hasFilters}
          onClick={() => onChange({ search: '', type: 'all', month: 'all', category: 'all' })}
          type="button"
        >
          <Eraser aria-hidden="true" size={15} />
          清除
        </button>
      </div>

      <p className="filter-result">
        显示 <strong>{resultCount}</strong> / {totalCount} 条
      </p>
    </section>
  );
}
