import {
  CloudUpload,
  Download,
  KeyRound,
  LockKeyhole,
  RefreshCw,
  Upload,
  Wifi,
  WifiOff,
} from 'lucide-react';

import type { AuthState } from '../types';

interface AppHeaderProps {
  title: string;
  auth: AuthState;
  dirty: boolean;
  saving: boolean;
  loadingRemote: boolean;
  online: boolean;
  cacheLabel: string;
  workingCopyEstablished: boolean;
  onSave: () => void;
  onForceRefresh: () => void;
  onUnlock: () => void;
  onLock: () => void;
  onExport: () => void;
  onImport: () => void;
}

function StatusDot({
  dirty,
  saving,
  workingCopyEstablished,
}: Pick<AppHeaderProps, 'dirty' | 'saving' | 'workingCopyEstablished'>) {
  const label = !workingCopyEstablished
    ? '等待账本'
    : saving ? '正在推送' : dirty ? '有本地更改' : '已同步';
  return (
    <span className={`sync-state sync-state--${!workingCopyEstablished ? 'waiting' : saving ? 'saving' : dirty ? 'dirty' : 'clean'}`}>
      <span aria-hidden="true" className="sync-state__dot" />
      {label}
    </span>
  );
}

export function AppHeader({
  title,
  auth,
  dirty,
  saving,
  loadingRemote,
  online,
  cacheLabel,
  workingCopyEstablished,
  onSave,
  onForceRefresh,
  onUnlock,
  onLock,
  onExport,
  onImport,
}: AppHeaderProps) {
  return (
    <header className="app-header">
      <div className="brand-lockup">
        <span aria-hidden="true" className="brand-mark">
          B
        </span>
        <div className="brand-copy">
          <span className="brand-copy__eyebrow">BRCLIO · LEDGER</span>
          <h1 title={title}>{title}</h1>
        </div>
      </div>

      <div className="header-status" aria-label="账本状态">
        <StatusDot dirty={dirty} saving={saving} workingCopyEstablished={workingCopyEstablished} />
        <span className="cache-state" title="浏览器刷新会继续使用这份本地工作副本">
          {online ? <Wifi aria-hidden="true" size={13} /> : <WifiOff aria-hidden="true" size={13} />}
          {cacheLabel}
        </span>
      </div>

      <div className="header-actions" aria-label="账本操作">
        <button
          className="icon-action"
          disabled={saving || loadingRemote || !workingCopyEstablished}
          onClick={onImport}
          title="导入 CSV"
          type="button"
        >
          <Upload aria-hidden="true" size={17} />
          <span className="icon-action__label">导入</span>
        </button>
        <button
          className="icon-action"
          disabled={!workingCopyEstablished}
          onClick={onExport}
          title="导出 CSV"
          type="button"
        >
          <Download aria-hidden="true" size={17} />
          <span className="icon-action__label">导出</span>
        </button>
        <button
          className="icon-action icon-action--refresh"
          disabled={saving || loadingRemote}
          onClick={onForceRefresh}
          title="清除旧工作副本并读取 GitHub 最新数据"
          type="button"
        >
          <RefreshCw aria-hidden="true" className={loadingRemote ? 'spin-once' : ''} size={17} />
          <span className="icon-action__label">强制刷新</span>
        </button>
        {auth.authenticated ? (
          <button
            className="editor-chip"
            disabled={saving || loadingRemote}
            onClick={onLock}
            title="退出编辑模式"
            type="button"
          >
            <LockKeyhole aria-hidden="true" size={14} />
            <span>{auth.editor}</span>
          </button>
        ) : (
          <button
            className="unlock-action"
            disabled={loadingRemote || !workingCopyEstablished}
            onClick={onUnlock}
            type="button"
          >
            <KeyRound aria-hidden="true" size={16} />
            解锁编辑
          </button>
        )}
        <button
          className="save-action"
          disabled={saving || loadingRemote || !online || !dirty || !workingCopyEstablished}
          onClick={onSave}
          title={!online ? '离线时会继续保存在浏览器，联网后再推送' : '保存到 GitHub（⌘/Ctrl + S）'}
          type="button"
        >
          <CloudUpload aria-hidden="true" size={17} />
          {saving ? '推送中…' : !workingCopyEstablished ? '等待数据' : dirty ? '保存到 GitHub' : '已保存'}
        </button>
      </div>
    </header>
  );
}
