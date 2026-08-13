import fs from "fs";
import path from "path";

import type { AnyRecord } from "@/lib/opsData";

export type AppointmentVisitConfirmation = {
  date: string;
  appointment_id: string;
  jk_number: string;
  truck_number: string;
  first_arrival: string | null;
  final_departure: string | null;
  gps_gap_start: string | null;
  gps_gap_end: string | null;
  gps_gap_minutes: number | null;
  confirmed_at: string;
  confirmation_source: string;
  note: string;
};

function normalizeTruck(value: unknown): string {
  const match = String(value || "").match(/truck\s*#?\s*(\d+)/i);
  return match ? `Truck ${Number(match[1])}` : String(value || "").trim();
}

function sameAppointment(row: AnyRecord, confirmation: AppointmentVisitConfirmation): boolean {
  const appointmentId = String(row?.appointment_id || row?.appt_id || "").trim();
  const jkNumber = String(row?.jk_number || row?.job_id || "").trim().toLowerCase();
  return appointmentId === confirmation.appointment_id || jkNumber === confirmation.jk_number.toLowerCase();
}

function confirmedVisitRow(base: AnyRecord, confirmation: AppointmentVisitConfirmation): AnyRecord {
  const arrival = confirmation.first_arrival || null;
  const departure = confirmation.final_departure || null;
  const coverageGap = confirmation.gps_gap_start && confirmation.gps_gap_end
    ? [{
        start: confirmation.gps_gap_start,
        end: confirmation.gps_gap_end,
        minutes: confirmation.gps_gap_minutes,
      }]
    : [];

  return {
    ...base,
    date: confirmation.date,
    appointment_id: confirmation.appointment_id,
    jk_number: confirmation.jk_number,
    truck_number: normalizeTruck(confirmation.truck_number),
    arrival_at: arrival,
    departure_at: departure,
    first_arrival: arrival,
    final_departure: departure,
    duration_minutes: 0,
    onsite_minutes: 0,
    visit_count: 1,
    visit_intervals: arrival
      ? [{ arrival, departure, onsite_minutes: 0, operational_confirmation: true }]
      : [],
    match_status: "operationally_confirmed",
    match_confidence: "confirmed",
    match_reason: "operational_confirmation_with_gps_gap",
    assignment_mismatch_flag: true,
    gps_coverage_quality: "incomplete",
    pass_by_only: false,
    gps_coverage_gaps: coverageGap,
    operational_confirmation: true,
    operational_confirmation_source: confirmation.confirmation_source,
    operationally_confirmed_at: confirmation.confirmed_at,
    operational_confirmation_note: confirmation.note,
  };
}

export function applyAppointmentVisitConfirmations(
  visits: AnyRecord[],
  confirmations: AppointmentVisitConfirmation[],
): AnyRecord[] {
  const result = visits.map((row) => ({ ...row }));

  for (const confirmation of confirmations) {
    const truck = normalizeTruck(confirmation.truck_number);
    let index = result.findIndex((row) =>
      sameAppointment(row, confirmation) && normalizeTruck(row?.truck_number) === truck
    );
    if (index < 0) {
      index = result.findIndex((row) => sameAppointment(row, confirmation) && !normalizeTruck(row?.truck_number));
    }
    if (index < 0) {
      result.push(confirmedVisitRow({}, confirmation));
    } else {
      result[index] = confirmedVisitRow(result[index], confirmation);
    }
  }

  return result;
}

export function readAppointmentVisitConfirmations(date: string): AppointmentVisitConfirmation[] {
  const file = path.join(process.cwd(), "config", "appointment-visit-confirmations.json");
  try {
    const payload = JSON.parse(fs.readFileSync(file, "utf8"));
    return (Array.isArray(payload?.confirmations) ? payload.confirmations : [])
      .filter((row: AppointmentVisitConfirmation) => row?.date === date);
  } catch {
    return [];
  }
}

export function withAppointmentVisitConfirmations(visits: AnyRecord[], date: string): AnyRecord[] {
  return applyAppointmentVisitConfirmations(visits, readAppointmentVisitConfirmations(date));
}
