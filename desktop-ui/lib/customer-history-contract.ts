export type CustomerHistoryRecord = {
  id: string;
  jk: string;
  date: string;
  customer: string;
  address: string;
  type: string;
  status: string;
  relationship: 'estimate' | 'job' | 'contact';
  amounts: string[];
  notes: string[];
  observedAt: string | null;
};

export type CustomerHistory = {
  records: CustomerHistoryRecord[];
  total: number;
  coverage: { from: string; through: string; unreadable: number };
};
