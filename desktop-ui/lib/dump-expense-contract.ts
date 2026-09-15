export type DumpExpenseRecord = {
  id: string; date: string; truck: string; location: string;
  enteredAt: string | null; departedAt: string | null; replaceUntil: string | null;
  amount: number | null; assumedAmount: number | null;
  status: 'assumed' | 'actual' | 'minimum_missing';
  window: 'onsite' | 'open' | 'closed' | null;
  actualExpenseId: string | null; transactionAt: string;
  unloadEventId?: string; sourceExpenseIds?: string[]; reconciliationNote?: string;
  departureBounds?: {after: string; by: string} | null;
};
export type DumpExpenseSummary = {
  date: string; policyAvailable: boolean; geofencesAvailable: boolean; observedAt: string | null;
  records: DumpExpenseRecord[]; actualTotal: number | null; assumedTotal: number;
  total: number | null; missingMinimumCount: number; needsReviewCount?: number;
};
