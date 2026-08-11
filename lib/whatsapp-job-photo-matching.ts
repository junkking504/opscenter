import type { AnyRecord } from "@/lib/opsData";

export type WhatsAppPhotoCategory = "before" | "after" | "donation";

export type WhatsAppPhotoMatch = {
  status: "matched";
  method: "jk_number" | "nearest_truck_gps";
  appointmentId: string;
  jkNumber: string;
  truck: string | null;
  distanceMiles: number | null;
  category: WhatsAppPhotoCategory;
};

export type WhatsAppPhotoReview = {
  status: "review";
  reason:
    | "jk_not_on_active_schedule"
    | "sender_not_mapped_to_truck"
    | "truck_gps_unavailable"
    | "truck_gps_stale"
    | "job_coordinates_unavailable"
    | "truck_not_near_active_job"
    | "nearest_job_ambiguous";
  detail: string;
  category: WhatsAppPhotoCategory;
};

export type WhatsAppPhotoMatchResult = WhatsAppPhotoMatch | WhatsAppPhotoReview;

export type WhatsAppMatchOptions = {
  maxGpsAgeMinutes?: number;
  maxJobDistanceMiles?: number;
  minimumDistanceMarginMiles?: number;
};

export type FleetLocation = {
  truck: string;
  latitude: number | null;
  longitude: number | null;
  lastGpsUpdate: string | null;
};

type Coordinates = { latitude: number; longitude: number };

const DEFAULT_MAX_GPS_AGE_MINUTES = 30;
const DEFAULT_MAX_JOB_DISTANCE_MILES = 0.5;
const DEFAULT_MINIMUM_DISTANCE_MARGIN_MILES = 0.15;

function clean(value: unknown): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function normalizePhone(value: unknown): string {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

export function normalizeTruck(value: unknown): string {
  const raw = clean(value);
  if (!raw) return "";
  const match = raw.match(/(\d+)/);
  return match ? `Truck# ${Number(match[1])}` : raw;
}

export function normalizeJkNumber(value: unknown): string {
  const raw = clean(value).toUpperCase();
  const match = raw.match(/(?:^|\b)JK\s*[-#:]*\s*(\d{4,12})(?:\b|$)/i);
  if (match) return `JK${match[1]}`;
  if (/^\d{7,12}$/.test(raw)) return `JK${raw}`;
  return "";
}

export function extractJkNumber(message: string): string {
  const match = String(message || "").match(/(?:^|\b)JK\s*[-#:]*\s*(\d{4,12})(?:\b|$)/i);
  if (match) return `JK${match[1]}`;
  const standalone = String(message || "").match(/(?:^|\s)(\d{7,12})(?=\s|$)/);
  return standalone ? `JK${standalone[1]}` : "";
}

export function inferPhotoCategory(message: string): WhatsAppPhotoCategory {
  const normalized = String(message || "").toLowerCase();
  if (/\b(?:donation|receipt)\b/.test(normalized)) return "donation";
  if (/\bbefore\b/.test(normalized)) return "before";
  return "after";
}

function coordinates(latitude: unknown, longitude: unknown): Coordinates | null {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat === 0 || lng === 0) return null;
  return { latitude: lat, longitude: lng };
}

function radians(value: number): number {
  return value * Math.PI / 180;
}

export function distanceMiles(from: Coordinates, to: Coordinates): number {
  const latitudeDelta = radians(to.latitude - from.latitude);
  const longitudeDelta = radians(to.longitude - from.longitude);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(from.latitude)) * Math.cos(radians(to.latitude)) * Math.sin(longitudeDelta / 2) ** 2;
  return 3_958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function appointmentJkNumber(appointment: AnyRecord): string {
  for (const value of [appointment.jk_number, appointment.job_id, appointment.job_number, appointment.jkNumber]) {
    const normalized = normalizeJkNumber(value);
    if (normalized) return normalized;
  }
  return "";
}

function appointmentId(appointment: AnyRecord): string {
  return clean(appointment.appt_id || appointment.appointment_id || appointment.appointmentId);
}

function activeAppointment(appointment: AnyRecord): boolean {
  const status = clean(appointment.job_status || appointment.status || appointment.final_status).toLowerCase();
  return !/(?:cancelled|canceled)/.test(status) && Boolean(appointmentId(appointment) && appointmentJkNumber(appointment));
}

function appointmentCoordinates(appointment: AnyRecord): Coordinates | null {
  return coordinates(
    appointment.lat ?? appointment.latitude,
    appointment.lng ?? appointment.longitude,
  );
}

export function matchWhatsAppPhoto(input: {
  senderPhone: string;
  caption: string;
  recentText?: string;
  receivedAt: Date;
  appointments: AnyRecord[];
  fleet: FleetLocation[];
  senderTruckMap: Record<string, string>;
  options?: WhatsAppMatchOptions;
}): WhatsAppPhotoMatchResult {
  const combinedText = [input.caption, input.recentText].map(clean).filter(Boolean).join(" ");
  const category = inferPhotoCategory(combinedText);
  const appointments = input.appointments.filter(activeAppointment);
  const explicitJk = extractJkNumber(combinedText);
  if (explicitJk) {
    const matched = appointments.find((appointment) => appointmentJkNumber(appointment) === explicitJk);
    if (!matched) {
      return {
        status: "review",
        reason: "jk_not_on_active_schedule",
        detail: `${explicitJk} was not found on the active schedule for the message date.`,
        category,
      };
    }
    return {
      status: "matched",
      method: "jk_number",
      appointmentId: appointmentId(matched),
      jkNumber: appointmentJkNumber(matched),
      truck: normalizeTruck(matched.truck || matched.assigned_truck) || null,
      distanceMiles: null,
      category,
    };
  }

  const sender = normalizePhone(input.senderPhone);
  const mappedTruck = normalizeTruck(
    input.senderTruckMap[sender]
      || input.senderTruckMap[`1${sender}`]
      || input.senderTruckMap[input.senderPhone],
  );
  if (!mappedTruck) {
    return {
      status: "review",
      reason: "sender_not_mapped_to_truck",
      detail: "The sender phone is not mapped to a Junk King truck.",
      category,
    };
  }

  const fleetTruck = input.fleet.find((truck) => normalizeTruck(truck.truck) === mappedTruck);
  const truckCoordinates = fleetTruck ? coordinates(fleetTruck.latitude, fleetTruck.longitude) : null;
  if (!fleetTruck || !truckCoordinates || !fleetTruck.lastGpsUpdate) {
    return {
      status: "review",
      reason: "truck_gps_unavailable",
      detail: `${mappedTruck} does not have a usable GPS position.`,
      category,
    };
  }

  const gpsTime = new Date(fleetTruck.lastGpsUpdate).getTime();
  const messageTime = input.receivedAt.getTime();
  const maxGpsAgeMinutes = input.options?.maxGpsAgeMinutes ?? DEFAULT_MAX_GPS_AGE_MINUTES;
  if (!Number.isFinite(gpsTime) || Math.abs(messageTime - gpsTime) > maxGpsAgeMinutes * 60_000) {
    return {
      status: "review",
      reason: "truck_gps_stale",
      detail: `${mappedTruck} GPS is not fresh enough to select a customer job safely.`,
      category,
    };
  }

  const candidates = appointments.flatMap((appointment) => {
    const location = appointmentCoordinates(appointment);
    if (!location) return [];
    return [{
      appointment,
      miles: distanceMiles(truckCoordinates, location),
    }];
  }).sort((a, b) => a.miles - b.miles);

  if (!candidates.length) {
    return {
      status: "review",
      reason: "job_coordinates_unavailable",
      detail: "No active appointment has verified coordinates for proximity matching.",
      category,
    };
  }

  const nearest = candidates[0];
  const maxJobDistanceMiles = input.options?.maxJobDistanceMiles ?? DEFAULT_MAX_JOB_DISTANCE_MILES;
  if (nearest.miles > maxJobDistanceMiles) {
    return {
      status: "review",
      reason: "truck_not_near_active_job",
      detail: `${mappedTruck} is ${nearest.miles.toFixed(2)} miles from the nearest active appointment.`,
      category,
    };
  }

  const second = candidates[1];
  const minimumDistanceMarginMiles = input.options?.minimumDistanceMarginMiles ?? DEFAULT_MINIMUM_DISTANCE_MARGIN_MILES;
  if (second && second.miles - nearest.miles < minimumDistanceMarginMiles) {
    return {
      status: "review",
      reason: "nearest_job_ambiguous",
      detail: `The two nearest active appointments are only ${(second.miles - nearest.miles).toFixed(2)} miles apart.`,
      category,
    };
  }

  return {
    status: "matched",
    method: "nearest_truck_gps",
    appointmentId: appointmentId(nearest.appointment),
    jkNumber: appointmentJkNumber(nearest.appointment),
    truck: mappedTruck,
    distanceMiles: nearest.miles,
    category,
  };
}
