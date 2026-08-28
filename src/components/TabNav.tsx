import { ChartNoAxesCombined, History, Settings2, Table2 } from 'lucide-react';

export type AppTab = 'ledger' | 'insights' | 'history' | 'settings';

interface TabNavProps {
  active: AppTab;
  onChange: (tab: AppTab) => void;
}

const TABS: Array<{ id: AppTab; label: string; icon: typeof Table2 }> = [
  { id: 'ledger', label: '记账表', icon: Table2 },
  { id: 'insights', label: '月度洞察', icon: ChartNoAxesCombined },
  { id: 'history', label: '保存历史', icon: History },
  { id: 'settings', label: '账本设置', icon: Settings2 },
];

export function TabNav({ active, onChange }: TabNavProps) {
  return (
    <nav aria-label="账本页面" className="tab-bar">
      {TABS.map(({ id, label, icon: Icon }) => (
        <button
          aria-current={active === id ? 'page' : undefined}
          className={`tab ${active === id ? 'active' : ''}`}
          key={id}
          onClick={() => onChange(id)}
          type="button"
        >
          <Icon aria-hidden="true" size={16} />
          {label}
        </button>
      ))}
    </nav>
  );
}
