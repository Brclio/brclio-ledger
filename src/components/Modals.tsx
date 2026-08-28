import { AlertTriangle, CloudDownload, CloudUpload, Eye, EyeOff, KeyRound, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';

import type { RemoteLedger } from '../types';

interface ModalShellProps {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  tone?: 'default' | 'warning';
}

function ModalShell({ title, description, children, onClose, tone = 'default' }: ModalShellProps) {
  const titleId = useId();
  const descriptionId = useId();
  const contentRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const background = Array.from(
      document.querySelectorAll<HTMLElement>('.app-shell > :not(.modal-overlay)'),
    ).map((element) => ({
      element,
      inert: element.inert,
      ariaHidden: element.getAttribute('aria-hidden'),
    }));
    background.forEach(({ element }) => {
      element.inert = true;
      element.setAttribute('aria-hidden', 'true');
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const content = contentRef.current;
      if (!content) return;
      const focusable = Array.from(
        content.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]):not([tabindex="-1"]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => !element.hidden && element.getClientRects().length > 0);
      if (focusable.length === 0) {
        event.preventDefault();
        content.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !content.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !content.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    document.body.classList.add('modal-open');
    const focusFrame = window.requestAnimationFrame(() => {
      const content = contentRef.current;
      if (content && !content.contains(document.activeElement)) {
        content.querySelector<HTMLElement>('button:not([disabled]), input:not([disabled])')?.focus();
      }
    });
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', onKeyDown);
      document.body.classList.remove('modal-open');
      background.forEach(({ element, inert, ariaHidden }) => {
        element.inert = inert;
        if (ariaHidden === null) element.removeAttribute('aria-hidden');
        else element.setAttribute('aria-hidden', ariaHidden);
      });
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, []);

  return (
    <div
      aria-describedby={description ? descriptionId : undefined}
      aria-labelledby={titleId}
      aria-modal="true"
      className="modal-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="dialog"
    >
      <div className={`modal-content modal-content--${tone}`} ref={contentRef} tabIndex={-1}>
        <button aria-label="关闭" className="modal-close" onClick={onClose} type="button">
          <X aria-hidden="true" size={18} />
        </button>
        <div className="modal-heading">
          {tone === 'warning' && <AlertTriangle aria-hidden="true" className="modal-heading__warning" size={24} />}
          <h2 id={titleId}>{title}</h2>
          {description && <p id={descriptionId}>{description}</p>}
        </div>
        {children}
      </div>
    </div>
  );
}

interface AuthModalProps {
  configured: boolean;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (password: string) => void;
}

export function AuthModal({ configured, loading, error, onClose, onSubmit }: AuthModalProps) {
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (password && !loading && configured) onSubmit(password);
  };

  return (
    <ModalShell
      description="密码在 Vercel 服务端验证，验证通过后才开放表格编辑。"
      onClose={onClose}
      title="解锁这本账"
    >
      <form className="auth-form" onSubmit={submit}>
        <input
          aria-hidden="true"
          autoComplete="username"
          className="visually-hidden"
          name="username"
          readOnly
          tabIndex={-1}
          type="text"
          value="ledger-editor"
        />
        <label>
          <span>编辑密码</span>
          <div className="password-field">
            <KeyRound aria-hidden="true" size={17} />
            <input
              autoComplete="current-password"
              disabled={!configured || loading}
              name="password"
              onChange={(event) => setPassword(event.currentTarget.value)}
              placeholder="输入任一有效编辑密码"
              ref={inputRef}
              type={show ? 'text' : 'password'}
              value={password}
            />
            <button aria-label={show ? '隐藏密码' : '显示密码'} onClick={() => setShow((value) => !value)} type="button">
              {show ? <EyeOff aria-hidden="true" size={16} /> : <Eye aria-hidden="true" size={16} />}
            </button>
          </div>
        </label>
        {!configured && <p className="form-error">尚未在 Vercel 配置编辑密码，请先设置环境变量。</p>}
        {error && <p aria-live="polite" className="form-error">{error}</p>}
        <div className="modal-actions">
          <button className="button-secondary" onClick={onClose} type="button">取消</button>
          <button className="button-primary" disabled={!password || loading || !configured} type="submit">
            {loading ? '正在验证…' : '验证并解锁'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

interface ConfirmModalProps {
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmModal({
  title,
  description,
  confirmLabel,
  danger = false,
  onCancel,
  onConfirm,
}: ConfirmModalProps) {
  return (
    <ModalShell description={description} onClose={onCancel} title={title} tone={danger ? 'warning' : 'default'}>
      <div className="modal-actions">
        <button className="button-secondary" onClick={onCancel} type="button">取消</button>
        <button className={danger ? 'button-danger' : 'button-primary'} onClick={onConfirm} type="button">
          {confirmLabel}
        </button>
      </div>
    </ModalShell>
  );
}

interface ConflictModalProps {
  remote: RemoteLedger;
  saving: boolean;
  onClose: () => void;
  onLoadRemote: () => void;
  onOverwrite: () => void;
  onExportDraft: () => void;
}

export function ConflictModal({
  remote,
  saving,
  onClose,
  onLoadRemote,
  onOverwrite,
  onExportDraft,
}: ConflictModalProps) {
  const remoteTime = remote.data.meta.updatedAt
    ? new Date(remote.data.meta.updatedAt).toLocaleString('zh-CN', { hour12: false })
    : '时间未知';

  return (
    <ModalShell
      description="GitHub 上的账本在你读取后又被保存过。为了避免静默覆盖，需要你选择保留哪一份。"
      onClose={onClose}
      title="发现远端新版本"
      tone="warning"
    >
      <div className="conflict-compare">
        <div>
          <span>REMOTE</span>
          <strong>{remote.data.rows.length} 条记录</strong>
          <p>{remoteTime} · {remote.data.meta.updatedBy ?? '未知编辑者'}</p>
        </div>
        <div>
          <span>LOCAL DRAFT</span>
          <strong>当前浏览器草稿</strong>
          <button onClick={onExportDraft} type="button">先导出 CSV 备份</button>
        </div>
      </div>
      <div className="conflict-actions">
        <button className="button-secondary button-with-icon" disabled={saving} onClick={onLoadRemote} type="button">
          <CloudDownload aria-hidden="true" size={16} />读取远端
        </button>
        <button className="button-danger button-with-icon" disabled={saving} onClick={onOverwrite} type="button">
          <CloudUpload aria-hidden="true" size={16} />{saving ? '覆盖中…' : '用本地覆盖远端'}
        </button>
      </div>
    </ModalShell>
  );
}
