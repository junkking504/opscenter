import fs from "fs";
import path from "path";

type AnyRecord = Record<string, any>;

export type JunkwareReschedule = {
  appointmentId: string;
  jkNumber: string;
  customerName: string;
  territory: string;
  appointmentUrl: string;
  fromDate: string;
  fromTime: string;
  toDate: string;
  toTime: string;
  changedAt: string;
  changedBy: string;
};

export type JunkwareCancellation = {
  appointmentId: string;
  jkNumber: string;
  customerName: string;
  territory: string;
  appointmentUrl: string;
  appointmentTime: string;
  cancelledBy: string;
  reason: string;
};

export type JunkwareDayActivity = {
  rescheduled: JunkwareReschedule[];
  cancelled: JunkwareCancellation[];
};

const JUNK_ITEM_PATTERNS: Array<[string, RegExp]> = [
  ["Mattress", /\b(?:mattress|box\s*spring)s?\b/i],
  ["Bed / bed frame", /\b(?:bed\s*frame|headboard|footboard|bed)s?\b/i],
  ["Couch / sofa", /\b(?:couch|sofa|sectional|loveseat)s?\b/i],
  ["Furniture", /\b(?:furniture|lawn\s*furniture)\b/i],
  ["Chair / recliner", /\b(?:chair|recliner)s?\b/i],
  ["Table", /\b(?:table|dining\s*table|coffee\s*table|end\s*table)s?\b/i],
  ["TV", /\b(?:tv|television)s?\b/i],
  ["Washer", /\b(?:washing\s*machine|washer)s?\b/i],
  ["Dryer", /\bdryers?\b/i],
  ["Refrigerator / freezer", /\b(?:refrigerator|fridge|freezer)s?\b/i],
  ["Stove / oven", /\b(?:stove|oven|range)s?\b/i],
  ["Dishwasher", /\bdishwashers?\b/i],
  ["Microwave", /\bmicrowaves?\b/i],
  ["Appliance", /\bappliances?\b/i],
  ["Trampoline", /\btrampolines?\b/i],
  ["Hot tub", /\bhot\s*tubs?\b/i],
  ["Exercise equipment", /\b(?:treadmill|elliptical|exercise\s*(?:bike|equipment)|weight\s*bench)s?\b/i],
  ["Grill / BBQ pit", /\b(?:grills?|bbq\s*pit)\b/i],
  ["Lawn equipment", /\b(?:lawn\s*mower|push\s*mower|mower|weed\s*eater)s?\b/i],
  ["Bike", /\b(?:bike|bicycle)s?\b/i],
  ["Yard debris / branches", /\b(?:yard\s*debris|branches|brush|tree\s*limbs?|leaves)\b/i],
  ["Fence / lumber", /\b(?:fence\s*boards?|lumber|wood\s*boards?|plywood|pallets?)\b/i],
  ["Construction debris", /\b(?:construction\s*debris|drywall|sheetrock|tile|shingles?|concrete)\b/i],
  ["Carpet / flooring", /\b(?:carpet|flooring|rugs?)\b/i],
  ["Cabinet", /\bcabinets?\b/i],
  ["Dresser", /\bdressers?\b/i],
  ["Desk", /\bdesks?\b/i],
  ["Bookshelf", /\b(?:bookshelf|bookcase)s?\b/i],
  ["Entertainment center", /\bentertainment\s*centers?\b/i],
  ["Piano", /\bpianos?\b/i],
  ["Pool table", /\bpool\s*tables?\b/i],
  ["Garbage bags", /\b(?:garbage|trash)\s*bags?\b/i],
  ["Bins / containers", /\b(?:storage\s*)?(?:bins?|containers?|totes?)\b/i],
  ["Tires", /\btires?\b/i],
  ["Scrap metal", /\b(?:scrap\s*metal|metal\s*scrap)\b/i],
  ["Toilet / bathroom fixture", /\b(?:toilet|commode|bathroom\s*fixture)s?\b/i],
  ["Aquarium / tank", /\b(?:aquarium|fish\s*tank)s?\b/i],
  ["Boxes / loose junk", /\b(?:boxes?\s+of\s+junk|loose\s+junk)\b/i],
  ["Cleanout", /\b(?:house|garage|storage|estate|apartment)\s*clean[ -]?outs?\b/i],
];

function clean(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(clean).filter(Boolean);
  const raw = clean(value);
  if (!raw) return [];
  if (raw.startsWith("[") && raw.endsWith("]")) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map(clean).filter(Boolean);
    } catch {
      // Fall through to treating the source as a single note.
    }
  }
  return [raw];
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.toLowerCase();
    if (!value || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function usefulAppointmentNote(value: string): string {
  const note = clean(value);
  if (!note || /^new item$/i.test(note) || /^promo code:\s*,/i.test(note)) return "";
  if (/^(?:credit card|cash|check|billed),/i.test(note)) return "";
  if (/^Sent ['“].+['”] notification\./i.test(note)) return "";
  if (/^Additional Lead Note Label:/i.test(note)) {
    const items = note.match(/What will be picking up\?:\s*(.+?)(?:,\s*Service Type:|$)/i)?.[1];
    return items ? `Online request: ${clean(items)}` : "";
  }
  return note;
}

export function appointmentNotes(row: AnyRecord): string[] {
  return unique([
    ...stringList(row?.appointment_notes),
    ...stringList(row?.franchise_notes),
    ...stringList(row?.call_center_notes),
    ...stringList(row?.customer_notes),
    ...stringList(row?.additional_notes),
  ].map(usefulAppointmentNote).filter(Boolean));
}

export function junkItemKeywords(row: AnyRecord): string[] {
  const source = [
    clean(row?.job_description),
    ...appointmentNotes(row),
  ].join(" ");
  return JUNK_ITEM_PATTERNS
    .filter(([, pattern]) => pattern.test(source))
    .map(([label]) => label);
}

function isoDate(value: string): string {
  const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return value;
  return `${match[3]}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`;
}

export function parseRescheduleNote(note: string): Omit<JunkwareReschedule,
  "appointmentId" | "jkNumber" | "customerName" | "territory" | "appointmentUrl"
> | null {
  const normalized = clean(note);
  const match = normalized.match(
    /^Appointment moved from\s+(\d{1,2}\/\d{1,2}\/\d{4}),\s*(.+?)\s+to\s+(\d{1,2}\/\d{1,2}\/\d{4}),\s*(.+?)(?:\s+\((\d{1,2}\/\d{1,2}\/\d{4}\s+.+?)\s*,\s*([^)]+)\))?$/i,
  );
  if (!match) return null;
  return {
    fromDate: isoDate(match[1]),
    fromTime: clean(match[2]),
    toDate: isoDate(match[3]),
    toTime: clean(match[4]),
    changedAt: clean(match[5]),
    changedBy: clean(match[6]),
  };
}

function rawFiles(junkwareDir: string): string[] {
  if (!fs.existsSync(junkwareDir)) return [];
  return fs.readdirSync(junkwareDir)
    .filter((name) => /^junkware_\d{4}-\d{2}-\d{2}_raw\.json$/.test(name))
    .map((name) => path.join(junkwareDir, name));
}

function readJson(file: string): AnyRecord | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function rowIdentity(row: AnyRecord) {
  const appointmentId = clean(row?.appt_id || row?.appointment_id);
  const jkNumber = clean(row?.job_id || row?.jk_number);
  const appointmentUrl = clean(row?.source_page) || (appointmentId
    ? `https://junkware.junk-king.com/franchise/appointment.aspx?id=${appointmentId}`
    : "");
  return {
    appointmentId,
    jkNumber,
    customerName: clean(row?.customer_name),
    territory: clean(row?.normalized_territory || row?.territory || row?.market),
    appointmentUrl,
  };
}

function cancellationCustomerName(row: AnyRecord): string {
  const raw = clean(row?.customer_name);
  const reason = clean(row?.cancellation_reason);
  if (!raw || raw !== reason) return raw;
  const match = raw.match(/^(.+?)\s+(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}\b/);
  return clean(match?.[1]);
}

export function readJunkwareDayActivity(dataDir: string, date: string): JunkwareDayActivity {
  const junkwareDir = path.join(dataDir, "history", "junkware");
  const rescheduled = new Map<string, JunkwareReschedule>();

  for (const file of rawFiles(junkwareDir)) {
    const payload = readJson(file);
    if (!payload) continue;
    const rows = [
      ...(Array.isArray(payload.appointments) ? payload.appointments : []),
      ...(Array.isArray(payload.completed) ? payload.completed : []),
      ...(Array.isArray(payload.cancelled) ? payload.cancelled : []),
    ];
    for (const row of rows) {
      for (const note of appointmentNotes(row)) {
        const parsed = parseRescheduleNote(note);
        if (!parsed || (parsed.fromDate !== date && parsed.toDate !== date)) continue;
        const identity = rowIdentity(row);
        const key = `${identity.appointmentId || identity.jkNumber}|${parsed.fromDate}|${parsed.fromTime}|${parsed.toDate}|${parsed.toTime}`;
        rescheduled.set(key, { ...identity, ...parsed });
      }
    }
  }

  const payload = readJson(path.join(junkwareDir, `junkware_${date}_raw.json`));
  const cancelled: JunkwareCancellation[] = (Array.isArray(payload?.cancelled) ? payload.cancelled : [])
    .map((row: AnyRecord) => ({
      ...rowIdentity(row),
      customerName: cancellationCustomerName(row),
      appointmentTime: clean(row?.appointment_time),
      cancelledBy: clean(row?.cancelled_by),
      reason: clean(row?.cancellation_reason || row?.customer_name),
    }))
    .sort((a, b) => a.appointmentTime.localeCompare(b.appointmentTime));

  return {
    rescheduled: Array.from(rescheduled.values()).sort((a, b) =>
      `${a.toDate} ${a.toTime}`.localeCompare(`${b.toDate} ${b.toTime}`),
    ),
    cancelled,
  };
}
