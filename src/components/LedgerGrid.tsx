import {
  Copy,
  ChevronLeft,
  ChevronRight,
  Database,
  LockKeyhole,
  Plus,
  Trash2,
  UnlockKeyhole,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';

import type { EntryType, LedgerData, LedgerRow } from '../types';
import { normalizePastedDate, parseGridAmount } from '../lib/grid-input';
import {
  MAX_LEDGER_DESCRIPTION_LENGTH,
  MAX_LEDGER_NOTE_LENGTH,
  MAX_LEDGER_SHORT_TEXT_LENGTH,
} from '../../shared/ledger-limits';

const GRID_COLUMNS = [
  'date',
  'type',
  'category',
  'description',
  'account',
  'amount',
  'note',
] as const satisfies readonly (keyof Omit<LedgerRow, 'id'>)[];

type GridColumn = (typeof GRID_COLUMNS)[number];
type LedgerRowPatch = Partial<Omit<LedgerRow, 'id'>>;

export interface LedgerGridRowUpdate {
  id: string;
  patch: LedgerRowPatch;
}

export interface LedgerGridPasteOverflow {
  /** Number of clipboard rows that did not fit into the currently displayed rows. */
  skippedRows: number;
  /** Number of non-empty clipboard cells that could not be applied. */
  skippedCells: number;
  /** Number of clipboard cells successfully applied to ledger rows. */
  appliedCells: number;
}

export interface LedgerGridProps {
  data: LedgerData;
  /** Rows currently visible after the parent has applied filters and sorting. */
  rows: LedgerRow[];
  editable: boolean;
  selectedIds: Set<string>;
  onSelectionChange: (selectedIds: Set<string>) => void;
  onUpdateRow: (id: string, patch: LedgerRowPatch) => void;
  onUpdateRows: (updates: LedgerGridRowUpdate[]) => void;
  onAddRow: () => void;
  onDeleteSelected: () => void;
  onDuplicateSelected: () => void;
  /** Called when an Excel-style paste extends beyond the visible rows or columns. */
  onPasteOverflow?: (info: LedgerGridPasteOverflow) => void;
  page: number;
  pageCount: number;
  totalRows: number;
  rowNumberOffset: number;
  onPageChange: (page: number) => void;
}

interface GridCellLocation {
  rowIndex: number;
  columnIndex: number;
}

interface AmountInputProps {
  value: number;
  currency: string;
  rowIndex: number;
  columnIndex: number;
  ariaLabel: string;
  onChange: (amount: number) => void;
  onNavigate: (
    event: ReactKeyboardEvent<HTMLInputElement>,
    location: GridCellLocation,
  ) => void;
}

const classNames = (...names: Array<string | false | null | undefined>) =>
  names.filter(Boolean).join(' ');

function normalizePastedType(value: string): EntryType | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === '收入' || normalized === 'income' || normalized === 'in') {
    return 'income';
  }
  if (
    normalized === '支出' ||
    normalized === 'expense' ||
    normalized === 'out'
  ) {
    return 'expense';
  }
  return null;
}

function formatDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return value || '—';
  }

  return `${Number(match[2])}月${Number(match[3])}日`;
}

function makeCurrencyFormatter(currency: string): Intl.NumberFormat {
  try {
    return new Intl.NumberFormat('zh-CN', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  } catch {
    return new Intl.NumberFormat('zh-CN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
}

function AmountInput({
  value,
  currency,
  rowIndex,
  columnIndex,
  ariaLabel,
  onChange,
  onNavigate,
}: AmountInputProps) {
  const formatter = useMemo(() => makeCurrencyFormatter(currency), [currency]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    if (!editing) {
      setDraft(String(value));
    }
  }, [editing, value]);

  const handleFocus = (event: ReactFocusEvent<HTMLInputElement>) => {
    setEditing(true);
    setDraft(String(value));
    event.currentTarget.select();
  };

  const handleBlur = () => {
    const parsed = parseGridAmount(draft);
    if (parsed === null) {
      setDraft(String(value));
    } else if (parsed !== value) {
      onChange(parsed);
    }
    setEditing(false);
  };

  return (
    <input
      aria-label={ariaLabel}
      className="ledger-grid__input ledger-grid__input--amount"
      data-grid-column="amount"
      data-grid-column-index={columnIndex}
      data-grid-row-index={rowIndex}
      inputMode="decimal"
      onBlur={handleBlur}
      onChange={(event) => {
        const nextDraft = event.currentTarget.value;
        setDraft(nextDraft);
        const parsed = parseGridAmount(nextDraft);
        if (parsed !== null) {
          onChange(parsed);
        }
      }}
      onFocus={handleFocus}
      onKeyDown={(event) => onNavigate(event, { rowIndex, columnIndex })}
      spellCheck={false}
      type="text"
      value={editing ? draft : formatter.format(value)}
    />
  );
}

export function LedgerGrid({
  data,
  rows,
  editable,
  selectedIds,
  onSelectionChange,
  onUpdateRow,
  onUpdateRows,
  onAddRow,
  onDeleteSelected,
  onDuplicateSelected,
  onPasteOverflow,
  page,
  pageCount,
  totalRows,
  rowNumberOffset,
  onPageChange,
}: LedgerGridProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const shouldFocusAddedRowRef = useRef(false);
  const previousRowCountRef = useRef(totalRows);
  const [pasteStatus, setPasteStatus] = useState('');

  const visibleIds = useMemo(() => new Set(rows.map((row) => row.id)), [rows]);
  const visibleSelectedCount = useMemo(
    () => rows.reduce((total, row) => total + Number(selectedIds.has(row.id)), 0),
    [rows, selectedIds],
  );
  const allVisibleSelected = rows.length > 0 && visibleSelectedCount === rows.length;
  const someVisibleSelected = visibleSelectedCount > 0 && !allVisibleSelected;
  const hasSelection = visibleSelectedCount > 0;

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someVisibleSelected;
    }
  }, [someVisibleSelected]);

  useEffect(() => {
    const rowWasAdded = totalRows > previousRowCountRef.current;
    previousRowCountRef.current = totalRows;

    if (!shouldFocusAddedRowRef.current || !rowWasAdded) {
      return;
    }

    shouldFocusAddedRowRef.current = false;
    requestAnimationFrame(() => {
      const lastRowIndex = rows.length - 1;
      const input = viewportRef.current?.querySelector<HTMLElement>(
        `[data-grid-row-index="${lastRowIndex}"][data-grid-column-index="0"]`,
      );
      input?.focus();
    });
  }, [rows.length, totalRows]);

  const toggleAllVisible = useCallback(() => {
    const nextSelection = new Set(selectedIds);
    if (allVisibleSelected) {
      visibleIds.forEach((id) => nextSelection.delete(id));
    } else {
      visibleIds.forEach((id) => nextSelection.add(id));
    }
    onSelectionChange(nextSelection);
  }, [allVisibleSelected, onSelectionChange, selectedIds, visibleIds]);

  const toggleRow = useCallback(
    (id: string) => {
      const nextSelection = new Set(selectedIds);
      if (nextSelection.has(id)) {
        nextSelection.delete(id);
      } else {
        nextSelection.add(id);
      }
      onSelectionChange(nextSelection);
    },
    [onSelectionChange, selectedIds],
  );

  const handleAddRow = useCallback(() => {
    if (!editable) {
      return;
    }
    shouldFocusAddedRowRef.current = true;
    onAddRow();
  }, [editable, onAddRow]);

  const navigateWithinColumn = useCallback(
    (
      event: ReactKeyboardEvent<HTMLInputElement | HTMLSelectElement>,
      { rowIndex, columnIndex }: GridCellLocation,
    ) => {
      let targetRowIndex: number | null = null;
      const nativeArrowControl =
        event.currentTarget instanceof HTMLSelectElement ||
        (event.currentTarget instanceof HTMLInputElement && event.currentTarget.type === 'date');

      if (event.key === 'Enter') {
        targetRowIndex = rowIndex + (event.shiftKey ? -1 : 1);
      } else if (event.key === 'ArrowUp') {
        if (nativeArrowControl) return;
        targetRowIndex = rowIndex - 1;
      } else if (event.key === 'ArrowDown') {
        if (nativeArrowControl) return;
        targetRowIndex = rowIndex + 1;
      }

      if (targetRowIndex === null) {
        return;
      }

      event.preventDefault();
      const target = viewportRef.current?.querySelector<HTMLElement>(
        `[data-grid-row-index="${targetRowIndex}"][data-grid-column-index="${columnIndex}"]`,
      );
      if (!target) {
        return;
      }

      target.focus();
      if (target instanceof HTMLInputElement) {
        target.select();
      }
    },
    [],
  );

  const applyPastedValue = useCallback(
    (column: GridColumn, rawValue: string, patch: LedgerRowPatch): boolean => {
      switch (column) {
        case 'date':
          {
            const date = normalizePastedDate(rawValue);
            if (!date) return false;
            patch.date = date;
          }
          return true;
        case 'type': {
          const type = normalizePastedType(rawValue);
          if (!type) {
            return false;
          }
          patch.type = type;
          return true;
        }
        case 'amount': {
          const amount = parseGridAmount(rawValue);
          if (amount === null) {
            return false;
          }
          patch.amount = amount;
          return true;
        }
        case 'category':
          if (rawValue.trim().length > MAX_LEDGER_SHORT_TEXT_LENGTH) return false;
          patch.category = rawValue.trim();
          return true;
        case 'description':
          if (rawValue.trim().length > MAX_LEDGER_DESCRIPTION_LENGTH) return false;
          patch.description = rawValue.trim();
          return true;
        case 'account':
          if (rawValue.trim().length > MAX_LEDGER_SHORT_TEXT_LENGTH) return false;
          patch.account = rawValue.trim();
          return true;
        case 'note':
          if (rawValue.trim().length > MAX_LEDGER_NOTE_LENGTH) return false;
          patch.note = rawValue.trim();
          return true;
        default: {
          const exhaustiveCheck: never = column;
          return exhaustiveCheck;
        }
      }
    },
    [],
  );

  const handlePaste = useCallback(
    (event: ReactClipboardEvent<HTMLDivElement>) => {
      if (!editable || !(event.target instanceof Element)) {
        return;
      }

      const origin = event.target.closest<HTMLElement>(
        '[data-grid-row-index][data-grid-column-index]',
      );
      if (!origin) {
        return;
      }

      const clipboardText = event.clipboardData.getData('text/plain');
      if (!clipboardText.includes('\t') && !/[\r\n]/.test(clipboardText)) {
        return;
      }

      event.preventDefault();
      const startRowIndex = Number(origin.dataset.gridRowIndex);
      const startColumnIndex = Number(origin.dataset.gridColumnIndex);
      if (!Number.isInteger(startRowIndex) || !Number.isInteger(startColumnIndex)) {
        return;
      }

      // Commit an in-progress amount draft before applying the clipboard patch.
      // The cell is focused again after React has rendered the pasted values.
      origin.blur();

      const clipboardRows = clipboardText
        .replace(/\r\n?/g, '\n')
        .replace(/\n$/, '')
        .split('\n')
        .map((line) => line.split('\t'));
      const patches = new Map<string, LedgerRowPatch>();
      let appliedCells = 0;
      let skippedCells = 0;
      let skippedRows = 0;

      clipboardRows.forEach((clipboardRow, clipboardRowOffset) => {
        const targetRow = rows[startRowIndex + clipboardRowOffset];
        if (!targetRow) {
          skippedRows += 1;
          skippedCells += clipboardRow.filter((value) => value !== '').length;
          return;
        }

        const patch = patches.get(targetRow.id) ?? {};
        clipboardRow.forEach((rawValue, clipboardColumnOffset) => {
          const column = GRID_COLUMNS[startColumnIndex + clipboardColumnOffset];
          if (!column) {
            if (rawValue !== '') {
              skippedCells += 1;
            }
            return;
          }

          if (applyPastedValue(column, rawValue, patch)) {
            appliedCells += 1;
          } else if (rawValue !== '') {
            skippedCells += 1;
          }
        });
        if (Object.keys(patch).length > 0) {
          patches.set(targetRow.id, patch);
        }
      });

      onUpdateRows([...patches].map(([id, patch]) => ({ id, patch })));

      const overflowInfo = { skippedRows, skippedCells, appliedCells };
      if (skippedRows > 0 || skippedCells > 0) {
        setPasteStatus(
          `已粘贴 ${appliedCells} 个单元格，${skippedCells} 个单元格因超出范围或格式无效而跳过。`,
        );
        onPasteOverflow?.(overflowInfo);
      } else {
        setPasteStatus(`已粘贴 ${appliedCells} 个单元格。`);
      }

      requestAnimationFrame(() => origin.focus());
    },
    [applyPastedValue, editable, onPasteOverflow, onUpdateRows, rows],
  );

  const getCategoryOptions = useCallback(
    (row: LedgerRow) => {
      const configured =
        row.type === 'income'
          ? data.settings.incomeCategories
          : data.settings.expenseCategories;
      return configured.includes(row.category) || !row.category
        ? configured
        : [row.category, ...configured];
    },
    [data.settings.expenseCategories, data.settings.incomeCategories],
  );

  const getAccountOptions = useCallback(
    (row: LedgerRow) =>
      data.settings.accounts.includes(row.account) || !row.account
        ? data.settings.accounts
        : [row.account, ...data.settings.accounts],
    [data.settings.accounts],
  );

  const amountFormatter = useMemo(
    () => makeCurrencyFormatter(data.settings.currency),
    [data.settings.currency],
  );

  return (
    <section
      aria-label={`${data.settings.title} 明细表`}
      className={classNames('ledger-grid', !editable && 'ledger-grid--readonly')}
    >
      <div className="ledger-grid__toolbar">
        <div className="ledger-grid__toolbar-primary">
          <button
            className="ledger-grid__action ledger-grid__action--primary"
            disabled={!editable}
            onClick={handleAddRow}
            type="button"
          >
            <Plus aria-hidden="true" className="ledger-grid__action-icon" size={16} />
            新增记录
          </button>
          <button
            className="ledger-grid__action"
            disabled={!editable || !hasSelection}
            onClick={onDuplicateSelected}
            type="button"
          >
            <Copy aria-hidden="true" className="ledger-grid__action-icon" size={15} />
            复制所选
          </button>
          <button
            className="ledger-grid__action ledger-grid__action--danger"
            disabled={!editable || !hasSelection}
            onClick={onDeleteSelected}
            type="button"
          >
            <Trash2 aria-hidden="true" className="ledger-grid__action-icon" size={15} />
            删除所选
          </button>
        </div>

        <div className="ledger-grid__toolbar-meta">
          {visibleSelectedCount > 0 && (
            <span className="ledger-grid__selection-count">
              已选择 {visibleSelectedCount} 项
            </span>
          )}
          <span
            className={classNames(
              'ledger-grid__mode-badge',
              editable
                ? 'ledger-grid__mode-badge--editable'
                : 'ledger-grid__mode-badge--locked',
            )}
          >
            {editable ? (
              <UnlockKeyhole aria-hidden="true" size={13} />
            ) : (
              <LockKeyhole aria-hidden="true" size={13} />
            )}
            {editable ? '编辑模式' : '只读模式'}
          </span>
          <span className="ledger-grid__row-count">
            {pageCount > 1
              ? `${rowNumberOffset + 1}–${rowNumberOffset + rows.length} / ${totalRows} 条`
              : `${totalRows} 条记录`}
          </span>
          {pageCount > 1 && (
            <span className="ledger-grid__pager" aria-label={`第 ${page + 1} 页，共 ${pageCount} 页`}>
              <button
                aria-label="上一页"
                disabled={page <= 0}
                onClick={() => onPageChange(page - 1)}
                type="button"
              >
                <ChevronLeft aria-hidden="true" size={14} />
              </button>
              <span>{page + 1} / {pageCount}</span>
              <button
                aria-label="下一页"
                disabled={page >= pageCount - 1}
                onClick={() => onPageChange(page + 1)}
                type="button"
              >
                <ChevronRight aria-hidden="true" size={14} />
              </button>
            </span>
          )}
        </div>
      </div>

      <p
        aria-live="polite"
        className={classNames(
          'ledger-grid__paste-status',
          !pasteStatus && 'ledger-grid__paste-status--empty',
        )}
      >
        {pasteStatus ||
          (editable ? '可从 Excel 复制多个单元格后直接粘贴' : '解锁编辑后可粘贴 Excel 数据')}
      </p>

      <div
        className="ledger-grid__viewport"
        onPaste={handlePaste}
        ref={viewportRef}
        tabIndex={-1}
      >
        <table className="ledger-grid__table">
          <caption className="ledger-grid__caption">
            {data.settings.title}，当前显示 {rows.length} 条记录
          </caption>
          <thead className="ledger-grid__head">
            <tr className="ledger-grid__header-row">
              <th
                className="ledger-grid__header-cell ledger-grid__header-cell--index ledger-grid__header-cell--sticky"
                scope="col"
              >
                <label className="ledger-grid__select-all">
                  <input
                    aria-label="选择当前显示的全部记录"
                    checked={allVisibleSelected}
                    className="ledger-grid__checkbox"
                    disabled={rows.length === 0}
                    onChange={toggleAllVisible}
                    ref={selectAllRef}
                    type="checkbox"
                  />
                  <span aria-hidden="true" className="ledger-grid__index-label">
                    #
                  </span>
                </label>
              </th>
              <th className="ledger-grid__header-cell ledger-grid__header-cell--date" scope="col">
                日期
              </th>
              <th className="ledger-grid__header-cell ledger-grid__header-cell--type" scope="col">
                收支
              </th>
              <th className="ledger-grid__header-cell ledger-grid__header-cell--category" scope="col">
                分类
              </th>
              <th className="ledger-grid__header-cell ledger-grid__header-cell--description" scope="col">
                摘要
              </th>
              <th className="ledger-grid__header-cell ledger-grid__header-cell--account" scope="col">
                账户
              </th>
              <th className="ledger-grid__header-cell ledger-grid__header-cell--amount" scope="col">
                金额
              </th>
              <th className="ledger-grid__header-cell ledger-grid__header-cell--note" scope="col">
                备注
              </th>
            </tr>
          </thead>

          <tbody className="ledger-grid__body">
            {rows.map((row, rowIndex) => {
              const isSelected = selectedIds.has(row.id);
              const displayRowNumber = rowNumberOffset + rowIndex + 1;
              const rowLabel = row.description || row.category || row.date || `第 ${displayRowNumber} 行`;
              const cellData = (columnIndex: number, column: GridColumn) => ({
                'data-grid-column': column,
                'data-grid-column-index': columnIndex,
                'data-grid-row-index': rowIndex,
              });

              return (
                <tr
                  className={classNames(
                    'ledger-grid__row',
                    isSelected && 'ledger-grid__row--selected',
                    `ledger-grid__row--${row.type}`,
                  )}
                  data-row-id={row.id}
                  key={row.id}
                >
                  <th
                    className="ledger-grid__cell ledger-grid__cell--index ledger-grid__cell--sticky"
                    scope="row"
                  >
                    <label className="ledger-grid__row-selector">
                      <input
                        aria-label={`选择${rowLabel}`}
                        checked={isSelected}
                        className="ledger-grid__checkbox"
                        onChange={() => toggleRow(row.id)}
                        type="checkbox"
                      />
                      <span aria-hidden="true" className="ledger-grid__row-number">
                        {displayRowNumber}
                      </span>
                    </label>
                  </th>

                  <td className="ledger-grid__cell ledger-grid__cell--date">
                    {editable ? (
                      <input
                        {...cellData(0, 'date')}
                        aria-label={`第 ${displayRowNumber} 行日期`}
                        className="ledger-grid__input ledger-grid__input--date"
                        onChange={(event) => {
                          const nextDate = normalizePastedDate(event.currentTarget.value);
                          if (nextDate) onUpdateRow(row.id, { date: nextDate });
                        }}
                        onKeyDown={(event) =>
                          navigateWithinColumn(event, { rowIndex, columnIndex: 0 })
                        }
                        type="date"
                        value={row.date}
                      />
                    ) : (
                      <span className="ledger-grid__readonly-value ledger-grid__readonly-value--date">
                        {formatDate(row.date)}
                      </span>
                    )}
                  </td>

                  <td className="ledger-grid__cell ledger-grid__cell--type">
                    {editable ? (
                      <select
                        {...cellData(1, 'type')}
                        aria-label={`第 ${displayRowNumber} 行收支类型`}
                        className="ledger-grid__select ledger-grid__select--type"
                        onChange={(event) => {
                          const nextType = event.currentTarget.value as EntryType;
                          const nextCategories =
                            nextType === 'income'
                              ? data.settings.incomeCategories
                              : data.settings.expenseCategories;
                          const patch: LedgerRowPatch = { type: nextType };
                          if (!nextCategories.includes(row.category)) {
                            patch.category = nextCategories[0] ?? '';
                          }
                          onUpdateRow(row.id, patch);
                        }}
                        onKeyDown={(event) =>
                          navigateWithinColumn(event, { rowIndex, columnIndex: 1 })
                        }
                        value={row.type}
                      >
                        <option value="expense">支出</option>
                        <option value="income">收入</option>
                      </select>
                    ) : (
                      <span
                        className={`ledger-grid__type-badge ledger-grid__type-badge--${row.type}`}
                      >
                        {row.type === 'income' ? '收入' : '支出'}
                      </span>
                    )}
                  </td>

                  <td className="ledger-grid__cell ledger-grid__cell--category">
                    {editable ? (
                      <select
                        {...cellData(2, 'category')}
                        aria-label={`第 ${displayRowNumber} 行分类`}
                        className="ledger-grid__select ledger-grid__select--category"
                        onChange={(event) =>
                          onUpdateRow(row.id, { category: event.currentTarget.value })
                        }
                        onKeyDown={(event) =>
                          navigateWithinColumn(event, { rowIndex, columnIndex: 2 })
                        }
                        value={row.category}
                      >
                        {!row.category && <option value="">未分类</option>}
                        {getCategoryOptions(row).map((category) => (
                          <option key={category} value={category}>
                            {category}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="ledger-grid__category-badge">
                        {row.category || '未分类'}
                      </span>
                    )}
                  </td>

                  <td className="ledger-grid__cell ledger-grid__cell--description">
                    {editable ? (
                      <input
                        {...cellData(3, 'description')}
                        aria-label={`第 ${displayRowNumber} 行摘要`}
                        className="ledger-grid__input ledger-grid__input--description"
                        maxLength={MAX_LEDGER_DESCRIPTION_LENGTH}
                        onChange={(event) =>
                          onUpdateRow(row.id, { description: event.currentTarget.value })
                        }
                        onKeyDown={(event) =>
                          navigateWithinColumn(event, { rowIndex, columnIndex: 3 })
                        }
                        placeholder="这笔账是什么？"
                        type="text"
                        value={row.description}
                      />
                    ) : (
                      <span className="ledger-grid__readonly-value ledger-grid__readonly-value--description">
                        {row.description || '—'}
                      </span>
                    )}
                  </td>

                  <td className="ledger-grid__cell ledger-grid__cell--account">
                    {editable ? (
                      <select
                        {...cellData(4, 'account')}
                        aria-label={`第 ${displayRowNumber} 行账户`}
                        className="ledger-grid__select ledger-grid__select--account"
                        onChange={(event) =>
                          onUpdateRow(row.id, { account: event.currentTarget.value })
                        }
                        onKeyDown={(event) =>
                          navigateWithinColumn(event, { rowIndex, columnIndex: 4 })
                        }
                        value={row.account}
                      >
                        {!row.account && <option value="">未指定</option>}
                        {getAccountOptions(row).map((account) => (
                          <option key={account} value={account}>
                            {account}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="ledger-grid__readonly-value ledger-grid__readonly-value--account">
                        {row.account || '—'}
                      </span>
                    )}
                  </td>

                  <td
                    className={`ledger-grid__cell ledger-grid__cell--amount ledger-grid__cell--${row.type}`}
                  >
                    {editable ? (
                      <AmountInput
                        ariaLabel={`第 ${displayRowNumber} 行金额`}
                        columnIndex={5}
                        currency={data.settings.currency}
                        onChange={(amount) => onUpdateRow(row.id, { amount })}
                        onNavigate={navigateWithinColumn}
                        rowIndex={rowIndex}
                        value={row.amount}
                      />
                    ) : (
                      <span className="ledger-grid__readonly-value ledger-grid__readonly-value--amount">
                        {row.type === 'income' ? '+' : '−'}
                        {amountFormatter.format(Math.abs(row.amount))}
                      </span>
                    )}
                  </td>

                  <td className="ledger-grid__cell ledger-grid__cell--note">
                    {editable ? (
                      <input
                        {...cellData(6, 'note')}
                        aria-label={`第 ${displayRowNumber} 行备注`}
                        className="ledger-grid__input ledger-grid__input--note"
                        maxLength={MAX_LEDGER_NOTE_LENGTH}
                        onChange={(event) =>
                          onUpdateRow(row.id, { note: event.currentTarget.value })
                        }
                        onKeyDown={(event) =>
                          navigateWithinColumn(event, { rowIndex, columnIndex: 6 })
                        }
                        placeholder="可选备注"
                        type="text"
                        value={row.note}
                      />
                    ) : (
                      <span className="ledger-grid__readonly-value ledger-grid__readonly-value--note">
                        {row.note || '—'}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}

            {rows.length === 0 && (
              <tr className="ledger-grid__empty-row">
                <td className="ledger-grid__empty-cell" colSpan={8}>
                  <div className="ledger-grid__empty-state" role="status">
                    <span className="ledger-grid__empty-icon" aria-hidden="true">
                      <Database size={22} />
                    </span>
                    <span className="ledger-grid__empty-title">
                      {data.rows.length === 0 ? '账本还是空的' : '没有符合条件的记录'}
                    </span>
                    <span className="ledger-grid__empty-description">
                      {data.rows.length === 0
                        ? editable
                          ? '新增第一笔记录，让账目开始流动。'
                          : '解锁编辑后即可新增第一笔记录。'
                        : '试试调整搜索词或筛选条件。'}
                    </span>
                    {editable && data.rows.length === 0 && (
                      <button
                        className="ledger-grid__empty-action"
                        onClick={handleAddRow}
                        type="button"
                      >
                        <Plus aria-hidden="true" size={15} />
                        新增第一笔
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default LedgerGrid;
