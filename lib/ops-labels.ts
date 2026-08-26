export function operationalCategoryLabel(value: string): string {
  if (value === "Jobs") return "Schedule";
  if (value === "Crew") return "Krewe";
  return value;
}
