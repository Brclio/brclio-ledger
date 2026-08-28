export type EntryType = 'income' | 'expense';

export interface LedgerRow {
  id: string;
  date: string;
  type: EntryType;
  category: string;
  description: string;
  account: string;
  amount: number;
  note: string;
}

export interface LedgerSettings {
  title: string;
  currency: string;
  expenseCategories: string[];
  incomeCategories: string[];
  accounts: string[];
}

export interface LedgerMeta {
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface LedgerData {
  version: 1;
  settings: LedgerSettings;
  rows: LedgerRow[];
  meta: LedgerMeta;
}

export interface RemoteLedger {
  data: LedgerData;
  sha: string | null;
  commitUrl?: string | null;
}

export interface AuthState {
  authenticated: boolean;
  editor: string | null;
  expiresAt: string | null;
  configured: boolean;
}

export interface HistoryItem {
  sha: string;
  message: string;
  author: string;
  date: string;
  url: string;
}
