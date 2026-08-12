const DEFAULT_TRUCK_CHANNEL_IDS: Record<number, string> = {
  1: "C0BPU3XUANN",
  2: "C0BPQGBD4N9",
  3: "C0BPQGARS1K",
  4: "C0BQNEV0GFJ",
  6: "C0BPXQJACS0",
  7: "C0BPXQK9ESG",
  8: "C0BPMSJ7V43",
  9: "C0BPCP2B6BH",
};

export function normalizeSlackTruckNumber(value: unknown): number | null {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  const match = normalized.match(/^(?:truck\s*#?\s*|t\s*#?\s*)?(\d{1,2})$/i);
  if (!match) return null;
  const truckNumber = Number(match[1]);
  return DEFAULT_TRUCK_CHANNEL_IDS[truckNumber] ? truckNumber : null;
}

export function truckSlackChannelId(truck: unknown, fallbackChannelId: string): string {
  const truckNumber = normalizeSlackTruckNumber(truck);
  if (!truckNumber) return String(fallbackChannelId || "").trim();
  return String(
    process.env[`SLACK_TRUCK_${truckNumber}_CHANNEL_ID`]
      || DEFAULT_TRUCK_CHANNEL_IDS[truckNumber],
  ).trim();
}
