import { Check, Cloud, Database, GitBranch, HardDrive, KeyRound, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { AuthState, LedgerSettings } from '../types';
import {
  MAX_LEDGER_LIST_ITEMS,
  MAX_LEDGER_SETTINGS_TITLE_LENGTH,
  MAX_LEDGER_SHORT_TEXT_LENGTH,
} from '../../shared/ledger-limits';

interface SettingsPanelProps {
  settings: LedgerSettings;
  auth: AuthState;
  editable: boolean;
  remoteSha: string | null;
  cacheUpdatedAt: string | null;
  lastSyncedAt: string | null;
  rowCount: number;
  onChange: (patch: Partial<LedgerSettings>) => void;
  onUnlock: () => void;
}

interface ListEditorProps {
  label: string;
  description: string;
  value: string[];
  disabled: boolean;
  onChange: (value: string[]) => void;
}

function normalizeList(value: string) {
  const seen = new Set<string>();
  return value
    .split(/[，,\n]/)
    .map((item) => item.trim())
    .filter((item) => {
      if (!item || seen.has(item)) return false;
      seen.add(item);
      return true;
    });
}

function ListEditor({ label, description, value, disabled, onChange }: ListEditorProps) {
  const [draft, setDraft] = useState(value.join('，'));

  useEffect(() => setDraft(value.join('，')), [value]);

  return (
    <label className="settings-field settings-field--wide">
      <span>{label}</span>
      <small>{description}</small>
      <textarea
        disabled={disabled}
        onBlur={() => {
          const next = normalizeList(draft);
          if (next.length > 0) onChange(next);
          else setDraft(value.join('，'));
        }}
        onChange={(event) => {
          const nextDraft = event.currentTarget.value;
          const segments = nextDraft.split(/[，,\n]/).map((item) => item.trim()).filter(Boolean);
          if (
            segments.length === 0 ||
            segments.length > MAX_LEDGER_LIST_ITEMS ||
            segments.some((item) => item.length > MAX_LEDGER_SHORT_TEXT_LENGTH)
          ) {
            return;
          }
          setDraft(nextDraft);
          const next = normalizeList(nextDraft);
          if (next.length > 0 && next.join('，') !== value.join('，')) onChange(next);
        }}
        maxLength={MAX_LEDGER_LIST_ITEMS * (MAX_LEDGER_SHORT_TEXT_LENGTH + 1)}
        rows={3}
        value={draft}
      />
    </label>
  );
}

function timeLabel(value: string | null) {
  if (!value) return '尚未发生';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '未知' : date.toLocaleString('zh-CN', { hour12: false });
}

export function SettingsPanel({
  settings,
  auth,
  editable,
  remoteSha,
  cacheUpdatedAt,
  lastSyncedAt,
  rowCount,
  onChange,
  onUnlock,
}: SettingsPanelProps) {
  return (
    <section className="settings-layout">
      <div className="settings-main">
        <div className="settings-heading">
          <div>
            <span className="section-kicker">LEDGER SETTINGS</span>
            <h2>把表格调成你的习惯。</h2>
          </div>
          {!editable && (
            <button className="unlock-inline" onClick={onUnlock} type="button">
              <KeyRound aria-hidden="true" size={15} />
              解锁后修改
            </button>
          )}
        </div>

        <form className="settings-form" onSubmit={(event) => event.preventDefault()}>
          <label className="settings-field">
            <span>账本名称</span>
            <small>会显示在顶部与表格无障碍标题中</small>
            <input
              disabled={!editable}
              maxLength={MAX_LEDGER_SETTINGS_TITLE_LENGTH}
              onChange={(event) => onChange({ title: event.currentTarget.value })}
              type="text"
              value={settings.title}
            />
          </label>
          <label className="settings-field">
            <span>默认币种</span>
            <small>影响金额格式，不会自动换算历史数据</small>
            <select
              disabled={!editable}
              onChange={(event) => onChange({ currency: event.currentTarget.value })}
              value={settings.currency}
            >
              <option value="CNY">CNY · 人民币</option>
              <option value="HKD">HKD · 港币</option>
              <option value="USD">USD · 美元</option>
              <option value="EUR">EUR · 欧元</option>
              <option value="JPY">JPY · 日元</option>
              <option value="SGD">SGD · 新加坡元</option>
            </select>
          </label>
          <ListEditor
            description="用中文逗号、英文逗号或换行分隔"
            disabled={!editable}
            label="支出分类"
            onChange={(expenseCategories) => onChange({ expenseCategories })}
            value={settings.expenseCategories}
          />
          <ListEditor
            description="收入行会使用这组下拉选项"
            disabled={!editable}
            label="收入分类"
            onChange={(incomeCategories) => onChange({ incomeCategories })}
            value={settings.incomeCategories}
          />
          <ListEditor
            description="例如微信、支付宝、银行卡、现金"
            disabled={!editable}
            label="账户列表"
            onChange={(accounts) => onChange({ accounts })}
            value={settings.accounts}
          />
        </form>

        <div className="storage-flow" aria-label="数据保存流程">
          <div className="storage-step storage-step--browser">
            <span className="storage-step__num">01</span>
            <HardDrive aria-hidden="true" size={20} />
            <div><strong>浏览器工作副本</strong><span>每次修改自动缓存</span></div>
          </div>
          <span aria-hidden="true" className="storage-flow__arrow">→</span>
          <div className="storage-step storage-step--api">
            <span className="storage-step__num">02</span>
            <ShieldCheck aria-hidden="true" size={20} />
            <div><strong>Vercel 安全校验</strong><span>密码与令牌只在服务端</span></div>
          </div>
          <span aria-hidden="true" className="storage-flow__arrow">→</span>
          <div className="storage-step storage-step--github">
            <span className="storage-step__num">03</span>
            <GitBranch aria-hidden="true" size={20} />
            <div><strong>GitHub 版本记录</strong><span>点击保存才形成提交</span></div>
          </div>
        </div>
      </div>

      <aside className="settings-status">
        <span className="settings-status__eyebrow">SYSTEM STATUS</span>
        <h3>当前工作副本</h3>
        <dl className="status-list">
          <div><dt><Database aria-hidden="true" size={14} />记录数量</dt><dd>{rowCount} 条</dd></div>
          <div><dt><HardDrive aria-hidden="true" size={14} />本地缓存</dt><dd>{timeLabel(cacheUpdatedAt)}</dd></div>
          <div><dt><Cloud aria-hidden="true" size={14} />最近同步</dt><dd>{timeLabel(lastSyncedAt)}</dd></div>
          <div><dt><GitBranch aria-hidden="true" size={14} />远端版本</dt><dd><code>{remoteSha?.slice(0, 8) ?? '未读取'}</code></dd></div>
          <div>
            <dt><KeyRound aria-hidden="true" size={14} />编辑权限</dt>
            <dd className={auth.authenticated ? 'status-ok' : ''}>
              {auth.authenticated ? <><Check aria-hidden="true" size={13} />{auth.editor}</> : '只读'}
            </dd>
          </div>
        </dl>
        <div className="security-note">
          <ShieldCheck aria-hidden="true" size={18} />
          <p><strong>密码不会进入 GitHub。</strong> 多个编辑密码与 GitHub Token 均通过 Vercel 环境变量提供。</p>
        </div>
        <div className="design-credit">
          <span>DESIGN CREDIT</span>
          <p>
            Visual system adapted from{' '}
            <a href="https://github.com/esthersjw/esther-design-system" rel="noreferrer" target="_blank">
              ESTHER不二 · esther-design-system
            </a>
            ，依 CC BY-NC-SA 4.0 使用。
          </p>
        </div>
      </aside>
    </section>
  );
}
