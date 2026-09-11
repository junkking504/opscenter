/** Processor approval is independent of QBO posting and bank settlement. */
export type MerchantTransaction = {
  date: string; transactionId: string; amount: number; cardLastFour: string;
  customer: string; jkNumber: string; status: string; transactionType: string;
  fee: number | null; observedAt: string;
};
export type MerchantEvidence = {
  state: 'approved' | 'review' | 'ambiguous' | 'not_found' | 'unavailable';
  transaction: MerchantTransaction | null; fresh: boolean;
};
export type MerchantReport = {
  available: boolean; fresh: boolean; complete: boolean; collectedAt: string | null;
  approvedTotal: number | null; approvedCount: number; issue: string | null;
  unmatched: Array<{ transaction: MerchantTransaction; qboTransactionId: string | null; reason: string }>;
};
