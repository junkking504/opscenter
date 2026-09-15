export type FuelMatchStatus = 'matched' | 'amount_difference' | 'ambiguous' | 'awaiting_wex' | 'wex_only';
export type FuelReconciliationRow = {
  id: string; truck: string; date: string; location: string;
  status: FuelMatchStatus; reason: string;
  reportedId: string | null; wexId: string | null;
  reportedAmount: number | null; wexFuelAmount: number | null; wexNetAmount: number | null;
  difference: number | null;
};
export type FuelReconciliation = {
  date: string; wexImportedAt: string | null; wexAvailable: boolean;
  rows: FuelReconciliationRow[]; matchedCount: number; differenceCount: number;
  reportedTotal: number | null; wexFuelTotal: number | null;
};
