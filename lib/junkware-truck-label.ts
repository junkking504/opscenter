export function normalizeJunkwareTruckLabel(value: string): string {
  const match = String(value || "").match(/truck\s*#?\s*(\d+)/i);
  return match ? `Truck ${match[1]}` : "";
}

export function resolveJunkwareAssignedTruck(input: {
  selectedOption: string;
  assignedLabel: string;
}): string {
  return normalizeJunkwareTruckLabel(input.selectedOption)
    || normalizeJunkwareTruckLabel(input.assignedLabel);
}
