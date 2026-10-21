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
  volumes: string[];
  prices: string[];
  work: string;
  truck: string;
  notes: string[];
  observedAt: string | null;
};

export type CustomerSummary = { id: string; name: string; phone: string; email: string; address: string; appointments: number; latestDate: string };
export type CustomerDirectory = { customers: CustomerSummary[]; total: number; offset: number; coverage: CustomerHistory['coverage'] };
export type CustomerAccount = { customer: CustomerSummary; phones: string[]; emails: string[]; addresses: string[]; records: CustomerHistoryRecord[]; total: number; offset: number; coverage: CustomerHistory['coverage'] };

export type CustomerHistory = {
  records: CustomerHistoryRecord[];
  total: number;
  coverage: { from: string; through: string; unreadable: number };
};
