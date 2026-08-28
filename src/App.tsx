import { AlertCircle, CloudOff, HardDrive, Keyboard, RotateCcw } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from 'react';

import { AppHeader } from './components/AppHeader';
import { FilterBar } from './components/FilterBar';
import { HistoryPanel } from './components/HistoryPanel';
import { InsightsPanel } from './components/InsightsPanel';
import { LedgerGrid, type LedgerGridRowUpdate } from './components/LedgerGrid';
import { AuthModal, ConfirmModal, ConflictModal } from './components/Modals';
import { SettingsPanel } from './components/SettingsPanel';
import { SummaryStrip } from './components/SummaryStrip';
import { TabNav, type AppTab } from './components/TabNav';
import { Toasts, type ToastItem, type ToastTone } from './components/Toasts';
import {
  ApiError,
  authenticate,
  clearLedgerCache,
  createDefaultLedger,
  createDefaultRow,
  exportLedgerCsv,
  fetchHistory,
  fetchLedger,
  filterLedgerRows,
  getAuthState,
  importLedgerCsv,
  loadLedgerCache,
  logout,
  saveLedger,
  saveLedgerCache,
  summarizeLedger,
  type LedgerFilters,
} from './lib';
import type {
  AuthState,
  HistoryItem,
  LedgerData,
  LedgerRow,
  LedgerSettings,
  RemoteLedger,
} from './types';
import {
  LEDGER_METADATA_RESERVE_BYTES,
  MAX_LEDGER_BYTES,
  MAX_LEDGER_ROWS,
} from '../shared/ledger-limits';

const INITIAL_AUTH: AuthState = {
  authenticated: false,
  editor: null,
  expiresAt: null,
  configured: true,
};

const LEDGER_PAGE_SIZE = 150;
const CLIENT_LEDGER_BYTE_LIMIT = MAX_LEDGER_BYTES - LEDGER_METADATA_RESERVE_BYTES;

type ConfirmState =
  | { kind: 'force-refresh'; title: string; description: string; confirmLabel: string }
  | { kind: 'delete'; title: string; description: string; confirmLabel: string };

function timestampLabel(value: string | null) {
  if (!value) return '尚未缓存';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '本地缓存';
  return `缓存于 ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
}

function downloadText(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function fileDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

function ledgerByteLength(data: LedgerData) {
  return new TextEncoder().encode(`${JSON.stringify(data, null, 2)}\n`).byteLength;
}

export default function App() {
  const [data, setData] = useState<LedgerData>(() => createDefaultLedger());
  const [remoteSha, setRemoteSha] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [cacheUpdatedAt, setCacheUpdatedAt] = useState<string | null>(null);
  const [cacheWriteFailed, setCacheWriteFailed] = useState(false);
  const [workingCopyEstablished, setWorkingCopyEstablished] = useState(false);
  const [ready, setReady] = useState(false);
  const [auth, setAuth] = useState<AuthState>(INITIAL_AUTH);
  const [activeTab, setActiveTab] = useState<AppTab>('ledger');
  const [filters, setFilters] = useState<LedgerFilters>({
    search: '',
    type: 'all',
    month: 'all',
    category: 'all',
  });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [ledgerPage, setLedgerPage] = useState(0);
  const [saving, setSaving] = useState(false);
  const [loadingRemote, setLoadingRemote] = useState(false);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [saveAfterAuth, setSaveAfterAuth] = useState(false);
  const [importAfterAuth, setImportAfterAuth] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [conflict, setConflict] = useState<RemoteLedger | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const initializedRef = useRef(false);
  const toastIdRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const stateRef = useRef({ data, remoteSha, dirty, lastSyncedAt });
  const revisionRef = useRef(0);
  const operationRef = useRef<'save' | 'refresh' | null>(null);
  const cacheWarningShownRef = useRef(false);
  const authRequestVersionRef = useRef(0);

  useEffect(() => {
    stateRef.current = { data, remoteSha, dirty, lastSyncedAt };
  }, [data, dirty, lastSyncedAt, remoteSha]);

  const pushToast = useCallback((message: string, tone: ToastTone = 'info', detail?: string) => {
    const id = ++toastIdRef.current;
    setToasts((items) => [...items.slice(-3), { id, message, tone, detail }]);
    window.setTimeout(() => {
      setToasts((items) => items.filter((item) => item.id !== id));
    }, tone === 'error' ? 6500 : 4200);
  }, []);

  const writeRemoteSnapshot = useCallback((remote: RemoteLedger) => {
    const syncedAt = new Date().toISOString();
    revisionRef.current += 1;
    stateRef.current = {
      data: remote.data,
      remoteSha: remote.sha,
      dirty: false,
      lastSyncedAt: syncedAt,
    };
    setData(remote.data);
    setRemoteSha(remote.sha);
    setDirty(false);
    setLastSyncedAt(syncedAt);
    setSelectedIds(new Set());
    setWorkingCopyEstablished(true);
    clearLedgerCache();
    const cached = saveLedgerCache({
      data: remote.data,
      remoteSha: remote.sha,
      dirty: false,
      lastSyncedAt: syncedAt,
    });
    setCacheWriteFailed(!cached.persisted);
    if (cached.persisted) setCacheUpdatedAt(cached.cachedAt);
  }, []);

  const refreshRemote = useCallback(async (announce = true) => {
    if (operationRef.current) {
      if (announce) pushToast('另一个同步操作正在进行', 'info');
      return null;
    }
    operationRef.current = 'refresh';
    setLoadingRemote(true);
    setRemoteError(null);
    try {
      const remote = await fetchLedger();
      writeRemoteSnapshot(remote);
      if (announce) pushToast('已读取 GitHub 最新版本', 'success', '旧浏览器工作副本已被替换。');
      return remote;
    } catch (error) {
      const message = error instanceof Error ? error.message : '无法读取 GitHub 数据。';
      setRemoteError(message);
      if (announce) pushToast('强制刷新失败', 'error', message);
      return null;
    } finally {
      if (operationRef.current === 'refresh') operationRef.current = null;
      setLoadingRemote(false);
      setReady(true);
    }
  }, [pushToast, writeRemoteSnapshot]);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const cached = loadLedgerCache();
    if (cached) {
      stateRef.current = {
        data: cached.data,
        remoteSha: cached.remoteSha,
        dirty: cached.dirty,
        lastSyncedAt: cached.lastSyncedAt,
      };
      setData(cached.data);
      setRemoteSha(cached.remoteSha);
      setDirty(cached.dirty);
      setLastSyncedAt(cached.lastSyncedAt);
      setCacheUpdatedAt(cached.cachedAt);
      setWorkingCopyEstablished(true);
      setReady(true);
    } else {
      void refreshRemote(false);
    }

    const authRequestVersion = ++authRequestVersionRef.current;
    void getAuthState()
      .then((nextAuth) => {
        if (authRequestVersionRef.current === authRequestVersion) setAuth(nextAuth);
      })
      .catch(() => {
        if (authRequestVersionRef.current === authRequestVersion) setAuth(INITIAL_AUTH);
      });
  }, [refreshRemote]);

  useEffect(() => {
    if (!ready || !workingCopyEstablished) return;
    const timer = window.setTimeout(() => {
      const cached = saveLedgerCache({ data, remoteSha, dirty, lastSyncedAt });
      setCacheWriteFailed(!cached.persisted);
      if (cached.persisted) {
        cacheWarningShownRef.current = false;
        setCacheUpdatedAt(cached.cachedAt);
      } else if (!cacheWarningShownRef.current) {
        cacheWarningShownRef.current = true;
        pushToast(
          '浏览器缓存写入失败',
          'error',
          '刷新页面可能丢失本地草稿，请先导出 CSV，并检查浏览器隐私或存储设置。',
        );
      }
    }, 180);
    return () => window.clearTimeout(timer);
  }, [data, dirty, lastSyncedAt, pushToast, ready, remoteSha, workingCopyEstablished]);

  useEffect(() => {
    if (!ready || !workingCopyEstablished) return;
    const persistLatestSnapshot = () => {
      saveLedgerCache(stateRef.current);
    };
    const persistWhenHidden = () => {
      if (document.visibilityState === 'hidden') persistLatestSnapshot();
    };
    window.addEventListener('pagehide', persistLatestSnapshot);
    document.addEventListener('visibilitychange', persistWhenHidden);
    return () => {
      window.removeEventListener('pagehide', persistLatestSnapshot);
      document.removeEventListener('visibilitychange', persistWhenHidden);
    };
  }, [ready, workingCopyEstablished]);

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  useEffect(() => {
    if (!auth.authenticated || !auth.expiresAt) return;
    const expiresAt = Date.parse(auth.expiresAt);
    if (!Number.isFinite(expiresAt)) return;
    const expireSession = () => {
      setAuth((current) => ({ ...INITIAL_AUTH, configured: current.configured }));
      pushToast('编辑会话已过期', 'info', '本地草稿仍保留；再次保存前请重新解锁。');
    };
    let timer = 0;
    const scheduleExpiry = () => {
      const remaining = expiresAt - Date.now();
      if (remaining <= 0) {
        expireSession();
        return;
      }
      timer = window.setTimeout(scheduleExpiry, Math.min(remaining, 2_147_000_000));
    };
    scheduleExpiry();
    return () => window.clearTimeout(timer);
  }, [auth.authenticated, auth.expiresAt, pushToast]);

  const mutateData = useCallback((producer: (current: LedgerData) => LedgerData) => {
    if (!auth.authenticated) {
      setAuthError(null);
      setAuthModalOpen(true);
      return false;
    }
    if (!workingCopyEstablished) {
      pushToast('尚未取得可编辑的账本', 'error', '请先重试读取 GitHub 数据。');
      return false;
    }
    if (operationRef.current) {
      pushToast('同步期间已暂时锁定编辑', 'info', '操作完成后即可继续修改。');
      return false;
    }
    const nextData = producer(stateRef.current.data);
    if (nextData.rows.length > MAX_LEDGER_ROWS) {
      pushToast(`账本最多保存 ${MAX_LEDGER_ROWS.toLocaleString('zh-CN')} 条记录`, 'error');
      return false;
    }
    const nextByteLength = ledgerByteLength(nextData);
    if (
      nextByteLength > CLIENT_LEDGER_BYTE_LIMIT &&
      nextByteLength >= ledgerByteLength(stateRef.current.data)
    ) {
      pushToast(
        '账本已达到浏览器工作副本大小上限',
        'error',
        '已为 GitHub 保存元数据预留空间，请先导出或整理旧记录后再继续。',
      );
      return false;
    }
    revisionRef.current += 1;
    stateRef.current = { ...stateRef.current, data: nextData, dirty: true };
    setWorkingCopyEstablished(true);
    setData(nextData);
    setDirty(true);
    return true;
  }, [auth.authenticated, pushToast, workingCopyEstablished]);

  const updateRows = useCallback((updates: LedgerGridRowUpdate[]) => {
    if (updates.length === 0) return;
    const patchById = new Map(updates.map(({ id, patch }) => [id, patch]));
    mutateData((current) => ({
      ...current,
      rows: current.rows.map((row) =>
        patchById.has(row.id)
          ? {
              ...row,
              ...patchById.get(row.id),
            }
          : row,
      ),
    }));
  }, [mutateData]);

  const updateRow = useCallback((id: string, patch: Partial<Omit<LedgerRow, 'id'>>) => {
    updateRows([{ id, patch }]);
  }, [updateRows]);

  const addRow = useCallback(() => {
    const currentRowCount = stateRef.current.data.rows.length;
    if (currentRowCount >= MAX_LEDGER_ROWS) {
      pushToast(`已达到 ${MAX_LEDGER_ROWS.toLocaleString('zh-CN')} 条记录上限`, 'error');
      return;
    }
    const added = mutateData((current) => ({
      ...current,
      rows: [
        ...current.rows,
        createDefaultRow({
          category: current.settings.expenseCategories[0] ?? '',
          account: current.settings.accounts[0] ?? '',
        }),
      ],
    }));
    if (added) {
      setFilters({ search: '', type: 'all', month: 'all', category: 'all' });
      setLedgerPage(Math.floor(currentRowCount / LEDGER_PAGE_SIZE));
    }
  }, [mutateData, pushToast]);

  const duplicateSelected = useCallback(() => {
    if (selectedIds.size === 0) return;
    const available = MAX_LEDGER_ROWS - stateRef.current.data.rows.length;
    if (available <= 0) {
      pushToast(`已达到 ${MAX_LEDGER_ROWS.toLocaleString('zh-CN')} 条记录上限`, 'error');
      return;
    }
    let copiedCount = 0;
    const duplicated = mutateData((current) => {
      const copies = current.rows
        .filter((row) => selectedIds.has(row.id))
        .slice(0, available)
        .map((row) => createDefaultRow({
          ...row,
          id: undefined,
          description: row.description ? `${row.description}（副本）` : '',
        }));
      copiedCount = copies.length;
      return { ...current, rows: [...current.rows, ...copies] };
    });
    if (!duplicated || copiedCount === 0) return;
    setFilters({ search: '', type: 'all', month: 'all', category: 'all' });
    setLedgerPage(Math.floor((stateRef.current.data.rows.length - 1) / LEDGER_PAGE_SIZE));
    setSelectedIds(new Set());
    pushToast(
      `已复制 ${copiedCount} 条记录`,
      'success',
      copiedCount < selectedIds.size ? '其余记录因达到上限而未复制。' : undefined,
    );
  }, [mutateData, pushToast, selectedIds]);

  const requestDelete = useCallback(() => {
    if (!auth.authenticated || selectedIds.size === 0) return;
    setConfirm({
      kind: 'delete',
      title: `删除 ${selectedIds.size} 条记录？`,
      description: '删除会先写入浏览器工作副本。点击保存前，GitHub 上的数据不会改变。',
      confirmLabel: '删除所选',
    });
  }, [auth.authenticated, selectedIds.size]);

  const deleteSelected = useCallback(() => {
    const count = selectedIds.size;
    const deleted = mutateData((current) => ({
      ...current,
      rows: current.rows.filter((row) => !selectedIds.has(row.id)),
    }));
    if (!deleted) return;
    setSelectedIds(new Set());
    setConfirm(null);
    pushToast(`已从工作副本删除 ${count} 条记录`, 'info');
  }, [mutateData, pushToast, selectedIds]);

  const updateSettings = useCallback((patch: Partial<LedgerSettings>) => {
    mutateData((current) => ({
      ...current,
      settings: { ...current.settings, ...patch },
    }));
  }, [mutateData]);

  const doNetworkSave = useCallback(async (
    force = false,
    expectedSha = stateRef.current.remoteSha,
  ) => {
    if (operationRef.current) {
      pushToast('另一个同步操作正在进行', 'info');
      return false;
    }
    if (!navigator.onLine) {
      pushToast('当前处于离线状态', 'error', '修改已留在浏览器，联网后再保存到 GitHub。');
      return false;
    }
    const snapshot = stateRef.current.data;
    if (!snapshot.settings.title.trim()) {
      pushToast('账本名称不能为空', 'error');
      setActiveTab('settings');
      return false;
    }

    const revisionAtStart = revisionRef.current;
    operationRef.current = 'save';
    setSaving(true);
    try {
      const remote = await saveLedger(snapshot, expectedSha, { force });
      const hasNewerLocalChanges = revisionRef.current !== revisionAtStart;
      if (!hasNewerLocalChanges) {
        writeRemoteSnapshot(remote);
      } else {
        const syncedAt = new Date().toISOString();
        const current = stateRef.current;
        const currentWithServerMeta = {
          ...current.data,
          meta: remote.data.meta,
        };
        stateRef.current = {
          data: currentWithServerMeta,
          remoteSha: remote.sha,
          dirty: true,
          lastSyncedAt: syncedAt,
        };
        setData(currentWithServerMeta);
        setRemoteSha(remote.sha);
        setDirty(true);
        setLastSyncedAt(syncedAt);
        const cached = saveLedgerCache(stateRef.current);
        setCacheWriteFailed(!cached.persisted);
        if (cached.persisted) setCacheUpdatedAt(cached.cachedAt);
      }
      setConflict(null);
      pushToast(
        hasNewerLocalChanges ? '已保存先前版本' : '已保存到 GitHub',
        'success',
        hasNewerLocalChanges
          ? '同步期间产生的新修改仍保留在本地，请再次保存。'
          : remote.commitUrl ? '新的数据版本已经提交。' : undefined,
      );
      if (activeTab === 'history') {
        void fetchHistory(20).then(setHistory).catch(() => undefined);
      }
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        authRequestVersionRef.current += 1;
        setAuth({ ...INITIAL_AUTH, configured: auth.configured });
        setSaveAfterAuth(true);
        setAuthError('验证已过期，请重新输入密码后继续保存。');
        setAuthModalOpen(true);
      } else if (error instanceof ApiError && error.status === 409 && error.remote) {
        setConflict(error.remote);
      } else {
        pushToast('保存失败', 'error', error instanceof Error ? error.message : '请稍后重试。');
      }
      return false;
    } finally {
      if (operationRef.current === 'save') operationRef.current = null;
      setSaving(false);
    }
  }, [activeTab, auth.configured, pushToast, writeRemoteSnapshot]);

  const requestSave = useCallback(() => {
    if (operationRef.current || saving || loadingRemote) return;
    if (!dirty) {
      pushToast('当前没有待保存的修改', 'info');
      return;
    }
    if (!auth.authenticated) {
      setSaveAfterAuth(true);
      setAuthError(null);
      setAuthModalOpen(true);
      return;
    }
    void doNetworkSave();
  }, [auth.authenticated, dirty, doNetworkSave, loadingRemote, pushToast, saving]);

  const submitPassword = useCallback(async (password: string) => {
    const authRequestVersion = ++authRequestVersionRef.current;
    setAuthLoading(true);
    setAuthError(null);
    try {
      const nextAuth = await authenticate(password);
      if (authRequestVersionRef.current !== authRequestVersion) return;
      setAuth(nextAuth);
      setAuthModalOpen(false);
      pushToast(`已解锁编辑 · ${nextAuth.editor}`, 'success');
      if (saveAfterAuth) {
        setSaveAfterAuth(false);
        window.setTimeout(() => void doNetworkSave(), 0);
      }
      if (importAfterAuth) {
        setImportAfterAuth(false);
        window.setTimeout(() => fileInputRef.current?.click(), 0);
      }
    } catch (error) {
      if (authRequestVersionRef.current === authRequestVersion) {
        setAuthError(error instanceof Error ? error.message : '密码验证失败。');
      }
    } finally {
      if (authRequestVersionRef.current === authRequestVersion) setAuthLoading(false);
    }
  }, [doNetworkSave, importAfterAuth, pushToast, saveAfterAuth]);

  const lockEditing = useCallback(async () => {
    const authRequestVersion = ++authRequestVersionRef.current;
    try {
      const next = await logout();
      if (authRequestVersionRef.current !== authRequestVersion) return;
      setAuth(next);
      pushToast('已退出编辑模式', 'info', '浏览器工作副本仍然保留。');
    } catch (error) {
      if (authRequestVersionRef.current === authRequestVersion) {
        pushToast('退出失败', 'error', error instanceof Error ? error.message : undefined);
      }
    }
  }, [pushToast]);

  const requestForceRefresh = useCallback(() => {
    if (operationRef.current) return;
    if (dirty) {
      setConfirm({
        kind: 'force-refresh',
        title: '用 GitHub 最新数据替换本地草稿？',
        description: '当前浏览器里有未推送修改。强制刷新成功后，这些修改将从缓存中清除；如需保留，请先导出 CSV。',
        confirmLabel: '清除缓存并刷新',
      });
      return;
    }
    void refreshRemote();
  }, [dirty, refreshRemote]);

  const exportCsv = useCallback(() => {
    downloadText(
      exportLedgerCsv(stateRef.current.data),
      `brclio-ledger-${fileDate()}.csv`,
      'text/csv;charset=utf-8',
    );
    pushToast('CSV 已导出', 'success');
  }, [pushToast]);

  const requestImport = useCallback(() => {
    if (operationRef.current) {
      pushToast('同步完成后再导入 CSV', 'info');
      return;
    }
    if (!auth.authenticated) {
      setImportAfterAuth(true);
      setAuthError('导入会修改当前工作副本，请先验证编辑密码。');
      setAuthModalOpen(true);
      return;
    }
    fileInputRef.current?.click();
  }, [auth.authenticated, pushToast]);

  const importCsv = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    try {
      const csv = await file.text();
      if (operationRef.current) {
        pushToast('同步完成后再导入 CSV', 'info');
        return;
      }
      const existingCount = stateRef.current.data.rows.length;
      const available = MAX_LEDGER_ROWS - existingCount;
      if (available <= 0) {
        pushToast(`已达到 ${MAX_LEDGER_ROWS.toLocaleString('zh-CN')} 条记录上限`, 'error');
        return;
      }
      const result = importLedgerCsv(
        csv,
        stateRef.current.data.rows.map((row) => row.id),
        available,
      );
      if (result.rows.length === 0) {
        pushToast('没有导入任何记录', 'error', result.warnings[0] ?? '请检查 CSV 列名与内容。');
        return;
      }
      const imported = mutateData((current) => ({ ...current, rows: [...current.rows, ...result.rows] }));
      if (!imported) return;
      setFilters({ search: '', type: 'all', month: 'all', category: 'all' });
      setLedgerPage(Math.floor(existingCount / LEDGER_PAGE_SIZE));
      const detail = result.skippedCount > 0
        ? `另有 ${result.skippedCount} 行因格式或容量限制被跳过。`
        : result.warnings.length > 0
          ? `已自动处理 ${result.warnings.length} 个重复或过长 ID。`
        : '数据已加入浏览器工作副本，尚未推送。';
      pushToast(`已导入 ${result.importedCount} 条记录`, 'success', detail);
      setActiveTab('ledger');
    } catch (error) {
      pushToast('CSV 导入失败', 'error', error instanceof Error ? error.message : undefined);
    }
  }, [mutateData, pushToast]);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      setHistory(await fetchHistory(20));
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : '无法读取 GitHub 保存历史。');
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'history' && history.length === 0 && !historyLoading && !historyError) {
      void loadHistory();
    }
  }, [activeTab, history.length, historyError, historyLoading, loadHistory]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      const command = event.metaKey || event.ctrlKey;
      if (command && event.key.toLowerCase() === 's') {
        event.preventDefault();
        requestSave();
      }
      if (command && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setActiveTab('ledger');
        window.setTimeout(() => document.querySelector<HTMLInputElement>('[aria-label="搜索账目"]')?.focus(), 0);
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [requestSave]);

  const filteredRows = useMemo(() => filterLedgerRows(data.rows, filters), [data.rows, filters]);
  const summary = useMemo(() => summarizeLedger(data.rows), [data.rows]);
  const months = useMemo(
    () => [...new Set(data.rows.map((row) => row.date.slice(0, 7)))].filter(Boolean).sort().reverse(),
    [data.rows],
  );
  const categories = useMemo(
    () => [...new Set(data.rows.map((row) => row.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN')),
    [data.rows],
  );
  const ledgerPageCount = Math.max(1, Math.ceil(filteredRows.length / LEDGER_PAGE_SIZE));
  useEffect(() => {
    setLedgerPage((current) => Math.min(current, ledgerPageCount - 1));
  }, [ledgerPageCount]);
  const pagedRows = useMemo(
    () => filteredRows.slice(
      ledgerPage * LEDGER_PAGE_SIZE,
      (ledgerPage + 1) * LEDGER_PAGE_SIZE,
    ),
    [filteredRows, ledgerPage],
  );
  const visibleIds = useMemo(() => new Set(pagedRows.map((row) => row.id)), [pagedRows]);
  useEffect(() => {
    setSelectedIds((current) => {
      const next = new Set([...current].filter((id) => visibleIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [visibleIds]);
  const canEdit = workingCopyEstablished && auth.authenticated && !saving && !loadingRemote;

  if (!ready) {
    return (
      <main className="boot-screen">
        <span aria-hidden="true" className="boot-mark">B</span>
        <p>正在读取账本工作副本…</p>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <AppHeader
        auth={auth}
        cacheLabel={cacheWriteFailed ? '缓存写入失败' : timestampLabel(cacheUpdatedAt)}
        dirty={dirty}
        loadingRemote={loadingRemote}
        online={online}
        onExport={exportCsv}
        onForceRefresh={requestForceRefresh}
        onImport={requestImport}
        onLock={() => void lockEditing()}
        onSave={requestSave}
        onUnlock={() => { setAuthError(null); setAuthModalOpen(true); }}
        saving={saving}
        title={data.settings.title || 'Brclio Ledger'}
        workingCopyEstablished={workingCopyEstablished}
      />
      <TabNav active={activeTab} onChange={setActiveTab} />

      {remoteError && (
        <div className="remote-error-banner" role="alert">
          <AlertCircle aria-hidden="true" size={17} />
          <span>
            <strong>未能读取远端数据。</strong>{' '}
            {workingCopyEstablished ? '当前仍可查看浏览器工作副本：' : '尚未建立可编辑的工作副本：'}
            {remoteError}
          </span>
          <button disabled={loadingRemote} onClick={() => void refreshRemote()} type="button">
            <RotateCcw aria-hidden="true" size={14} />重试
          </button>
        </div>
      )}
      {!online && (
        <div className="offline-banner" role="status">
          <CloudOff aria-hidden="true" size={16} />
          {cacheWriteFailed
            ? '离线且浏览器缓存不可用：请先导出 CSV，避免草稿丢失。'
            : '离线模式：修改会继续保存在浏览器，恢复联网后再推送 GitHub。'}
        </div>
      )}

      <main className="app-main">
        {activeTab === 'ledger' && (
          <div className="ledger-view">
            <SummaryStrip currency={data.settings.currency} summary={summary} />
            <FilterBar
              categories={categories}
              months={months}
              onChange={(next) => {
                setFilters(next);
                setLedgerPage(0);
              }}
              resultCount={filteredRows.length}
              totalCount={data.rows.length}
              value={filters}
            />
            <LedgerGrid
              data={data}
              editable={canEdit}
              onAddRow={addRow}
              onDeleteSelected={requestDelete}
              onDuplicateSelected={duplicateSelected}
              onPasteOverflow={(info) => {
                if (info.skippedCells > 0) pushToast('部分单元格未能粘贴', 'info', `已应用 ${info.appliedCells} 个，跳过 ${info.skippedCells} 个。`);
              }}
              onSelectionChange={setSelectedIds}
              onUpdateRow={updateRow}
              onUpdateRows={updateRows}
              onPageChange={setLedgerPage}
              page={ledgerPage}
              pageCount={ledgerPageCount}
              rowNumberOffset={ledgerPage * LEDGER_PAGE_SIZE}
              rows={pagedRows}
              selectedIds={selectedIds}
              totalRows={filteredRows.length}
            />
          </div>
        )}

        {activeTab === 'insights' && <InsightsPanel currency={data.settings.currency} rows={data.rows} />}

        {activeTab === 'history' && (
          <HistoryPanel
            error={historyError}
            items={history}
            loading={historyLoading}
            onRefresh={() => void loadHistory()}
          />
        )}

        {activeTab === 'settings' && (
          <SettingsPanel
            auth={auth}
            cacheUpdatedAt={cacheUpdatedAt}
            editable={canEdit}
            lastSyncedAt={lastSyncedAt}
            onChange={updateSettings}
            onUnlock={() => { setAuthError(null); setAuthModalOpen(true); }}
            remoteSha={remoteSha}
            rowCount={data.rows.length}
            settings={data.settings}
          />
        )}
      </main>

      <footer className="app-statusbar">
        <span>
          <HardDrive aria-hidden="true" size={12} />
          {cacheWriteFailed ? '缓存不可用，请先导出 CSV' : '浏览器刷新保留工作副本'}
        </span>
        <span className="app-statusbar__center">{dirty ? '本地有未推送修改' : remoteSha ? `远端 ${remoteSha.slice(0, 7)}` : '等待首次同步'}</span>
        <span><Keyboard aria-hidden="true" size={12} /><kbd>⌘S</kbd> 保存 · <kbd>⌘K</kbd> 搜索</span>
      </footer>

      <input
        accept=".csv,text/csv"
        className="visually-hidden"
        onChange={(event) => void importCsv(event)}
        ref={fileInputRef}
        tabIndex={-1}
        type="file"
      />

      {authModalOpen && (
        <AuthModal
          configured={auth.configured}
          error={authError}
          loading={authLoading}
          onClose={() => {
            if (!authLoading) {
              setAuthModalOpen(false);
              setSaveAfterAuth(false);
              setImportAfterAuth(false);
            }
          }}
          onSubmit={(password) => void submitPassword(password)}
        />
      )}

      {confirm && (
        <ConfirmModal
          confirmLabel={confirm.confirmLabel}
          danger
          description={confirm.description}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            if (confirm.kind === 'delete') deleteSelected();
            else {
              setConfirm(null);
              void refreshRemote();
            }
          }}
          title={confirm.title}
        />
      )}

      {conflict && (
        <ConflictModal
          onClose={() => setConflict(null)}
          onExportDraft={exportCsv}
          onLoadRemote={() => {
            writeRemoteSnapshot(conflict);
            setConflict(null);
            pushToast('已改用 GitHub 最新版本', 'success');
          }}
          onOverwrite={() => void doNetworkSave(true, conflict.sha)}
          remote={conflict}
          saving={saving}
        />
      )}

      <Toasts items={toasts} onDismiss={(id) => setToasts((items) => items.filter((item) => item.id !== id))} />
    </div>
  );
}
