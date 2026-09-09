import { METERED_USAGE_BLOCKED } from "./metered-usage-policy";

export type TruckLoadPhotoAnalysis = {
  loadFraction: number;
  loadLabel: string;
  contents: string;
  confidence: number;
  visibleEnough: boolean;
  notes: string;
  model: string;
};

// Photo storage and manual load reports remain available. A credential must
// never silently activate paid vision analysis. Re-enable only after a scoped
// user approval and an enforced spending budget are implemented.
export async function analyzeTruckLoadPhoto(_filePath: string): Promise<TruckLoadPhotoAnalysis> {
  throw new Error(METERED_USAGE_BLOCKED);
}
