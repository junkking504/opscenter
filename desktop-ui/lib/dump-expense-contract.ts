export type DumpExpenseRecord = {
  id: string; date: string; truck: string; location: string;
  enteredAt: string | null; departedAt: string | null; replaceUntil: string | null;
  amount: number | null; assumedAmount: number | null;
  status: 'assumed' | 'actual' | 'minimum_missing';
  window: 'onsite' | 'open' | 'closed' | null;
  actualExpenseId: string | null; transactionAt: string;
};
export type DumpExpenseSummary = {
  date: string; policyAvailable: boolean; geofencesAvailable: boolean; observedAt: string | null;
  records: DumpExpenseRecord[]; actualTotal: number; assumedTotal: number;
  total: number | null; missingMinimumCount: number;
};
