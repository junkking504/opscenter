import { readCrewPhoneDirectory } from "@/lib/crew-phone-directory";
import { normalizePhone } from "@/lib/whatsapp-job-photo-matching";

const clean = (value: unknown): string => String(value || "").replace(/\s+/g, " ").trim();

/** Use the private company-phone directory as the baseline attribution source.
 * Explicit environment entries remain supported as narrow overrides. */
export function whatsappSenderTruckMap(raw = process.env.WHATSAPP_TRUCK_PHONE_MAP): Record<string, string> {
  const directory = Object.fromEntries(readCrewPhoneDirectory().company.flatMap(({ number, truck }) => {
    const normalized = normalizePhone(number);
    return normalized && clean(truck) ? [[normalized, clean(truck)]] : [];
  }));
  if (!raw && process.env.WHATSAPP_TRUCK_PHONE_MAP_BASE64) {
    try { raw = Buffer.from(process.env.WHATSAPP_TRUCK_PHONE_MAP_BASE64, "base64").toString("utf8"); } catch { raw = ""; }
  }
  if (!raw) return directory;
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("WHATSAPP_TRUCK_PHONE_MAP must be a JSON object.");
  const overrides = Object.fromEntries(Object.entries(parsed).flatMap(([phone, truck]) => {
    const normalized = normalizePhone(phone);
    const label = clean(truck);
    return normalized && label ? [[normalized, label]] : [];
  }));
  return { ...directory, ...overrides };
}
