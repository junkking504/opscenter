/** Five section answers from the supplied Junk King daily inspection forms. */
export const INSPECTION_SECTIONS = [
  { id: "walk-around", label: "Walk-around", checks: ["Look under and around the truck for fluid leaks.", "Check for loose wires, hoses, chains, tarp parts and equipment.", "Check the body, doors, latches and exterior for damage or loose items.", "Make sure the area around the truck is clear before moving."] },
  { id: "wheels-tires", label: "Wheels & tires", checks: ["Inspect every tire for wear, cuts, bulges, damage or a low appearance.", "Check pressure if a tire looks low or concerning. Use the approved pressure for this truck.", "Check for loose, missing or damaged lug nuts.", "Inspect wheels and rims for cracks, bends and damage."] },
  { id: "dashboard", label: "Dashboard check", checks: ["Start the truck and check warning lights, including the check engine light.", "Check fuel and DEF, where fitted. Record the fuel level below.", "Review gauges, alerts and dashboard messages.", "Listen for unusual alarms, sounds or changes in operation."] },
  { id: "operation", label: "Truck & dump body", checks: ["Check normal brake and steering response before leaving the yard.", "Test headlights, brake lights, turn signals, hazards and reverse lights.", "Test the horn, backup alarm, wipers and washer fluid.", "Safely test the dump bed, hoist and winch where fitted; stop for leaks, binding or unusual noise.", "Check rear doors, latches and the tarp system."] },
  { id: "cleanliness", label: "Cleanliness", checks: ["Remove trash and personal items; organize tools and supplies.", "Sweep or wipe down the cab as needed.", "Spray off the truck if overly dirty and note any washdown needed.", "Give the truck a full wash when time allows."] },
] as const;
export type InspectionSectionId = (typeof INSPECTION_SECTIONS)[number]["id"];
export const INSPECTION_STATUSES = {
  clear: "No problems",
  reported: "Safe to operate — problem reported",
  stop: "Do not operate",
} as const;
export type InspectionStatus = keyof typeof INSPECTION_STATUSES;
export type InspectionAnswer = { id: InspectionSectionId; status: "good" | "problem"; notes: string };
export type InspectionPhoto = { section: InspectionSectionId; data: string };
export type TruckInspectionInput = {
  requestId: string; inspector: string; odometer: string; fuel: string;
  startedAt: string; answers: InspectionAnswer[]; photos: InspectionPhoto[];
  status: InspectionStatus; notes: string; initials: string;
};
export type TruckInspectionReport = TruckInspectionInput & {
  version: 1; truck: string; deviceId: string; receivedAt: string; inspectionDate: string;
};
export type InspectionDevice = { deviceId: string; truck: string; label: string; expiresAt: string; createdAt: string };
export function inspectionDate(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
export class InspectionError extends Error {
  constructor(message: string, public statusCode = 400) { super(message); }
}
function text(value: unknown, label: string, max: number, required = false): string {
  if (typeof value !== "string" || value.length > max || (required && !value.trim())) throw new InspectionError(`Enter ${label}.`);
  return value.trim();
}
export function validateTruckInspection(raw: unknown, now = new Date()): TruckInspectionInput {
  if (!raw || typeof raw !== "object") throw new InspectionError("Enter an inspection.");
  const v = raw as Record<string, unknown>;
  if (typeof v.requestId !== "string" || !/^[a-f0-9-]{36}$/.test(v.requestId)) throw new InspectionError("Start a new inspection.");
  const inspector = text(v.inspector, "the inspector's name", 100, true);
  const odometer = text(v.odometer, "the mileage", 9, true);
  if (!/^\d{1,8}$/.test(odometer)) throw new InspectionError("Enter mileage as a whole number.");
  const fuel = text(v.fuel, "the fuel level", 20, true);
  if (!["Empty", "1/4", "1/2", "3/4", "Full"].includes(fuel)) throw new InspectionError("Choose the fuel level.");
  const startedAt = text(v.startedAt, "the start time", 30, true);
  const start = Date.parse(startedAt);
  if (!Number.isFinite(start) || start > now.getTime() + 300_000 || start < now.getTime() - 7 * 86400_000) throw new InspectionError("This draft is over seven days old or has an invalid start time. Start a new inspection.");
  if (!Array.isArray(v.answers) || v.answers.length !== 5) throw new InspectionError("Complete all five sections.");
  const answers: InspectionAnswer[] = INSPECTION_SECTIONS.map(section => {
    const matches = (v.answers as Record<string, unknown>[]).filter(a => a && a.id === section.id);
    if (matches.length !== 1 || !["good", "problem"].includes(String(matches[0].status))) throw new InspectionError(`Check ${section.label}.`);
    return { id: section.id, status: matches[0].status as "good" | "problem", notes: text(matches[0].notes, `a note for ${section.label}`, 1000, matches[0].status === "problem") };
  });
  if (!["clear", "reported", "stop"].includes(String(v.status))) throw new InspectionError("Choose the final operating status.");
  const problem = answers.some(a => a.status === "problem");
  if (problem && v.status === "clear") throw new InspectionError("A problem was marked. Choose a problem-reported or do-not-operate status.");
  if (!problem && v.status === "reported") throw new InspectionError("Mark the section with the reported problem.");
  const notes = text(v.notes, "notes explaining why the truck must not operate", 2000, v.status === "stop" && !problem);
  const initials = text(v.initials, "your initials to confirm the inspection", 12, true);
  if (!Array.isArray(v.photos) || v.photos.length > 3) throw new InspectionError("Attach up to three photos.");
  const photos: InspectionPhoto[] = v.photos.map(p => {
    if (!p || typeof p !== "object" || !INSPECTION_SECTIONS.some(s => s.id === p.section) || typeof p.data !== "string" || p.data.length > 1_000_000 || !/^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/=]+$/.test(p.data)) throw new InspectionError("Use a JPEG photo under 750 KB.");
    return { section: p.section, data: p.data };
  });
  return { requestId: v.requestId, inspector, odometer, fuel, startedAt, answers, status: v.status as InspectionStatus, notes, initials, photos };
}
