import { ExternalLink, GitCommitHorizontal, RefreshCw } from 'lucide-react';

import type { HistoryItem } from '../types';

interface HistoryPanelProps {
  items: HistoryItem[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}

function relativeTime(value: string) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return '时间未知';
  const minutes = Math.round((time - Date.now()) / 60_000);
  const formatter = new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' });
  if (Math.abs(minutes) < 60) return formatter.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, 'hour');
  return formatter.format(Math.round(hours / 24), 'day');
}

export function HistoryPanel({ items, loading, error, onRefresh }: HistoryPanelProps) {
  return (
    <section className="history-layout">
      <aside className="history-intro">
        <span className="section-kicker">GITHUB HISTORY</span>
        <span aria-hidden="true" className="history-intro__ghost">git</span>
        <h2>每次保存，<br />都有据可查。</h2>
        <p>这里展示数据文件最近的 GitHub 提交。浏览器缓存不是提交；只有点击“保存到 GitHub”才会留下版本。</p>
        <button className="secondary-action" disabled={loading} onClick={onRefresh} type="button">
          <RefreshCw aria-hidden="true" className={loading ? 'spin-once' : ''} size={16} />
          {loading ? '读取中…' : '刷新历史'}
        </button>
      </aside>

      <div className="commit-timeline" aria-live="polite">
        {error && <div className="inline-error">{error}</div>}
        {!error && loading && items.length === 0 && (
          <div className="history-skeleton" aria-label="正在读取保存历史">
            <span /><span /><span />
          </div>
        )}
        {!loading && !error && items.length === 0 && (
          <div className="history-empty">这个数据文件还没有保存历史。</div>
        )}
        {items.map((item, index) => (
          <article className="commit-item" key={item.sha}>
            <div className="commit-item__rail">
              <span className="commit-item__dot"><GitCommitHorizontal aria-hidden="true" size={15} /></span>
              {index < items.length - 1 && <span aria-hidden="true" className="commit-item__line" />}
            </div>
            <div className="commit-item__content">
              <div className="commit-item__topline">
                <code>{item.sha.slice(0, 7)}</code>
                <time dateTime={item.date} title={new Date(item.date).toLocaleString('zh-CN')}>
                  {relativeTime(item.date)}
                </time>
              </div>
              <h3>{item.message}</h3>
              <p>由 {item.author || 'GitHub 用户'} 保存</p>
              <a href={item.url} rel="noreferrer" target="_blank">
                在 GitHub 查看 <ExternalLink aria-hidden="true" size={13} />
              </a>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
