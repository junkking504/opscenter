const TRUCK_LABEL_PATTERN = /^(?:truck\s*#?\s*|t)(\d{1,2})$/i;

export function parseTruckNumberFromLabel(value: unknown): number | null {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  const match = normalized.match(TRUCK_LABEL_PATTERN);
  if (!match) return null;

  const truckNumber = Number(match[1]);
  return Number.isInteger(truckNumber) && truckNumber > 0 ? truckNumber : null;
}

export function truckCameraLabel(truckNumber: number): string {
  return `Truck ${truckNumber}`;
}
