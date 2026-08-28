import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';

export type ToastTone = 'success' | 'error' | 'info';

export interface ToastItem {
  id: number;
  message: string;
  detail?: string;
  tone: ToastTone;
}

interface ToastsProps {
  items: ToastItem[];
  onDismiss: (id: number) => void;
}

const ICONS = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
};

export function Toasts({ items, onDismiss }: ToastsProps) {
  return (
    <div aria-atomic="false" aria-live="polite" className="toast-stack">
      {items.map((item) => {
        const Icon = ICONS[item.tone];
        return (
          <div className={`toast toast--${item.tone}`} key={item.id} role="status">
            <Icon aria-hidden="true" size={18} />
            <div><strong>{item.message}</strong>{item.detail && <span>{item.detail}</span>}</div>
            <button aria-label="关闭提示" onClick={() => onDismiss(item.id)} type="button">
              <X aria-hidden="true" size={15} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
