import fs from "fs";
import path from "path";
import { crewRows, readMetrics, type AnyRecord } from "@/lib/opsData";

const RECENT_LOOKBACK_DAYS = 21;
const ACTIVE_LOOKBACK_DAYS = 14;
const ASSUMED_CALL_IN_HOURS = 8;
const JOBS_PER_CREW_DAY = 4;
const PEOPLE_PER_CREW = 2;

export type CrewCallInCandidate = {
  name: string;
  rank: number;
  suggestedRole: "Driver" | "Crew";
  weeklyHours: number;
  projectedWeeklyHours: number;
  recentHours: number;
  recentShifts: number;
  recentJobs: number;
  recentRph: number;
  recentDriverShifts: number;
  driverScore: number | null;
  overtimeRisk: boolean;
  reason: string;
};

export type CrewCallInTerritoryDemand = {
  territory: string;
  appointments: number;
  crews: number;
};

export type CrewCallInPlan = {
  baseDate: string;
  targetDate: string;
  scheduleAvailable: boolean;
  scheduleUpdatedAt: string | null;
  appointmentCount: number;
  requiredCrews: number;
  requiredHeadcount: number;
  alreadyAssignedHeadcount: number;
  callInCount: number;
  assumedShiftHours: number;
  territoryDemand: CrewCallInTerritoryDemand[];
  recommendations: CrewCallInCandidate[];
  alternates: CrewCallInCandidate[];
  note: string;
};

type ScheduleAppointment = {
  territory: string;
  startMinutes: number | null;
  endMinutes: number | null;
  driver: string;
  navigator: string;
  additionalCrew: string[];
};

type CandidateAccumulator = {
  name: string;
  lastWorked: string;
  recentHours: number;
  recentRevenue: number;
  recentJobs: number;
  recentShifts: number;
  weeklyHours: number;
  driverShifts: number;
  driverScores: number[];
  salary: boolean;
};

function addDays(date: string, amount: number): string {
  const parsed = new Date(`${date}T12:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + amount);
  return parsed.toISOString().slice(0, 10);
}

function mondayFor(date: string): string {
  const parsed = new Date(`${date}T12:00:00Z`);
  const daysSinceMonday = (parsed.getUTCDay() + 6) % 7;
  parsed.setUTCDate(parsed.getUTCDate() - daysSinceMonday);
  return parsed.toISOString().slice(0, 10);
}

function datesBetween(start: string, end: string): string[] {
  const dates: string[] = [];
  for (let date = start; date <= end; date = addDays(date, 1)) dates.push(date);
  return dates;
}

function numberFrom(row: AnyRecord, keys: string[]): number {
  for (const key of keys) {
    const value = Number(row?.[key]);
    if (Number.isFinite(value)) return Math.max(0, value);
  }
  return 0;
}

function displayName(row: AnyRecord): string {
  const raw = String(row?.name || row?.employee_name || row?.employee || "").trim();
  const parts = raw.split(",").map((part) => part.trim()).filter(Boolean);
  return parts.length === 2 ? `${parts[1]} ${parts[0]}` : raw;
}

function personKey(value: unknown): string {
  const raw = displayName({ name: value })
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const parts = raw.split(" ").filter(Boolean);
  if (parts.length >= 3 && parts[1].length === 1) parts.splice(1, 1);
  return parts.join(" ");
}

function parseTimeMinutes(value: unknown): number | null {
  const match = String(value || "").match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const meridiem = match[3].toUpperCase();
  if (meridiem === "PM" && hour !== 12) hour += 12;
  if (meridiem === "AM" && hour === 12) hour = 0;
  return hour * 60 + minute;
}

function normalizeTerritory(value: unknown): string {
  const cleaned = String(value || "Unassigned")
    .replace(/^Junk King\s+/i, "")
    .trim();
  return cleaned || "Unassigned";
}

function schedulePaths(date: string): string[] {
  const roots = [
    path.join(process.cwd(), "data"),
    process.env.OPSBOT_DATA_DIR || "",
    path.join(process.env.HOME || "", ".openclaw", "workspace", "opsbot", "data"),
  ].filter(Boolean);
  return Array.from(new Set(roots)).map((root) =>
    path.join(root, "history", "junkware", `junkware_${date}_raw.json`),
  );
}

function readSchedule(date: string): { rows: ScheduleAppointment[]; updatedAt: string | null } | null {
  for (const file of schedulePaths(date)) {
    try {
      if (!fs.existsSync(file)) continue;
      const payload = JSON.parse(fs.readFileSync(file, "utf8")) as AnyRecord;
      const sourceRows = [
        ...(Array.isArray(payload.appointments) ? payload.appointments : []),
        ...(Array.isArray(payload.completed) ? payload.completed : []),
      ];
      const rows = sourceRows
        .filter((row: AnyRecord) => {
          const status = String(row?.job_status || row?.status || "").toLowerCase();
          return !status.includes("cancel");
        })
        .map((row: AnyRecord) => {
          const window = String(
            row?.appointment_time || row?.scheduled_time || row?.time_window || "",
          );
          const times = window.match(/\d{1,2}:\d{2}\s*(?:AM|PM)/gi) || [];
          return {
            territory: normalizeTerritory(
              row?.normalized_territory || row?.territory || row?.source_territory || row?.market,
            ),
            startMinutes: parseTimeMinutes(times[0]),
            endMinutes: parseTimeMinutes(times[1]),
            driver: displayName({
              name: row?.driver_normalized_name || row?.driver_name || row?.driver,
            }),
            navigator: displayName({
              name: row?.navigator_normalized_name || row?.navigator_name || row?.navigator,
            }),
            additionalCrew: Array.isArray(row?.additional_crew)
              ? row.additional_crew.map((name: unknown) => displayName({ name })).filter(Boolean)
              : [],
          } satisfies ScheduleAppointment;
        });
      return { rows, updatedAt: String(payload.scraped_at || "").trim() || null };
    } catch {
      // Try the next configured data location.
    }
  }
  return null;
}

function maxConcurrent(rows: ScheduleAppointment[]): number {
  const timed = rows.filter((row) => row.startMinutes != null);
  if (!timed.length) return rows.length ? 1 : 0;
  let maximum = 1;
  for (const row of timed) {
    const start = row.startMinutes as number;
    const active = timed.filter((candidate) => {
      const candidateStart = candidate.startMinutes as number;
      const candidateEnd = candidate.endMinutes ?? candidateStart + 60;
      return candidateStart <= start && candidateEnd > start;
    }).length;
    maximum = Math.max(maximum, active);
  }
  return maximum;
}

function buildTerritoryDemand(rows: ScheduleAppointment[]): CrewCallInTerritoryDemand[] {
  const grouped = new Map<string, ScheduleAppointment[]>();
  for (const row of rows) {
    if (!grouped.has(row.territory)) grouped.set(row.territory, []);
    grouped.get(row.territory)!.push(row);
  }
  return Array.from(grouped.entries())
    .map(([territory, appointments]) => ({
      territory,
      appointments: appointments.length,
      crews: Math.max(
        maxConcurrent(appointments),
        Math.ceil(appointments.length / JOBS_PER_CREW_DAY),
      ),
    }))
    .sort((a, b) => b.crews - a.crews || b.appointments - a.appointments || a.territory.localeCompare(b.territory));
}

function percentile(values: number[], value: number): number {
  if (!values.length) return 0;
  const belowOrEqual = values.filter((candidate) => candidate <= value).length;
  return belowOrEqual / values.length;
}

function collectCandidates(baseDate: string): CandidateAccumulator[] {
  const recentStart = addDays(baseDate, -(RECENT_LOOKBACK_DAYS - 1));
  const activeCutoff = addDays(baseDate, -(ACTIVE_LOOKBACK_DAYS - 1));
  const weekStart = mondayFor(baseDate);
  const byEmployee = new Map<string, CandidateAccumulator>();

  for (const date of datesBetween(recentStart, baseDate)) {
    const metrics = readMetrics(date);
    if (!metrics) continue;
    for (const row of crewRows(metrics)) {
      const name = displayName(row);
      const key = personKey(name);
      if (!key || key === "unknown") continue;
      const hours = numberFrom(row, ["hours_worked", "hours", "labor_hours", "worked_hours"]);
      const jobs = numberFrom(row, ["jobs_completed", "completed_jobs", "credited_jobs", "jobs"]);
      const revenue = numberFrom(row, [
        "individual_revenue",
        "revenue_generated",
        "credited_revenue",
        "employee_revenue",
        "revenue",
      ]);
      const hasShift = hours > 0 || jobs > 0 || revenue > 0 || Boolean(row?.clock_in || row?.time_in);
      if (!hasShift) continue;

      const existing = byEmployee.get(key) || {
        name,
        lastWorked: date,
        recentHours: 0,
        recentRevenue: 0,
        recentJobs: 0,
        recentShifts: 0,
        weeklyHours: 0,
        driverShifts: 0,
        driverScores: [],
        salary: false,
      };
      existing.name = name;
      existing.lastWorked = date;
      existing.recentHours += hours;
      existing.recentRevenue += revenue;
      existing.recentJobs += jobs;
      existing.recentShifts += 1;
      if (date >= weekStart) existing.weeklyHours += hours;
      const driverTrucks = Array.isArray(row?.driver_trucks) ? row.driver_trucks : [];
      const drove = driverTrucks.length > 0 || Boolean(row?.driver_assignment_windows?.length);
      if (drove) existing.driverShifts += 1;
      const driverScore = Number(row?.driver_score ?? row?.opscenter_driving_score);
      if (drove && Number.isFinite(driverScore) && driverScore > 0) {
        existing.driverScores.push(driverScore);
      }
      existing.salary ||= Boolean(row?.is_salary);
      byEmployee.set(key, existing);
    }
  }

  return Array.from(byEmployee.values()).filter(
    (candidate) => candidate.lastWorked >= activeCutoff && !candidate.salary,
  );
}

function candidateReason(candidate: Omit<CrewCallInCandidate, "rank" | "reason">): string {
  const performance = candidate.recentHours >= 8
    ? `$${Math.round(candidate.recentRph)} recent RPH across ${candidate.recentShifts} shifts`
    : `${candidate.recentShifts} recent shift${candidate.recentShifts === 1 ? "" : "s"}; limited performance sample`;
  const hours = `${candidate.weeklyHours.toFixed(1)} hrs this week; ${candidate.projectedWeeklyHours.toFixed(1)} projected`;
  const driver = candidate.suggestedRole === "Driver"
    ? `driver on ${candidate.recentDriverShifts} recent shift${candidate.recentDriverShifts === 1 ? "" : "s"}`
    : "krewe role balances hours and production";
  return `${hours} · ${performance} · ${driver}`;
}

function rankCandidates(
  accumulators: CandidateAccumulator[],
  assignedPeople: Set<string>,
  neededDrivers: number,
  callInCount: number,
): { recommendations: CrewCallInCandidate[]; alternates: CrewCallInCandidate[] } {
  const eligible = accumulators.filter((candidate) => !assignedPeople.has(personKey(candidate.name)));
  const rphValues = eligible
    .filter((candidate) => candidate.recentHours >= 8)
    .map((candidate) => candidate.recentRevenue / candidate.recentHours)
    .sort((a, b) => a - b);
  const medianRph = rphValues.length
    ? rphValues[Math.floor((rphValues.length - 1) / 2)]
    : 0;
  const performanceFloor = Math.max(75, medianRph * 0.7);

  const scored = eligible.map((candidate) => {
    const recentRph = candidate.recentHours > 0 ? candidate.recentRevenue / candidate.recentHours : 0;
    const projectedWeeklyHours = candidate.weeklyHours + ASSUMED_CALL_IN_HOURS;
    const rphScore = candidate.recentHours >= 8 ? percentile(rphValues, recentRph) : 0.25;
    const hoursScore = Math.max(0, Math.min(1, (40 - candidate.weeklyHours) / 40));
    const activityScore = Math.min(1, candidate.recentShifts / 8);
    const overtimePenalty = Math.max(0, projectedWeeklyHours - 40) * 0.045;
    const dataPenalty = candidate.recentHours < 8 ? 0.12 : 0;
    const driverScore = candidate.driverScores.length
      ? candidate.driverScores.reduce((sum, value) => sum + value, 0) / candidate.driverScores.length
      : null;
    const score = rphScore * 0.65 + hoursScore * 0.25 + activityScore * 0.1 - overtimePenalty - dataPenalty;
    const performanceQualified = candidate.recentHours < 8 || recentRph >= performanceFloor;
    return { candidate, recentRph, projectedWeeklyHours, driverScore, score, performanceQualified };
  });

  const byScore = (a: typeof scored[number], b: typeof scored[number]) =>
    b.score - a.score || a.candidate.weeklyHours - b.candidate.weeklyHours || a.candidate.name.localeCompare(b.candidate.name);
  const driverPool = scored
    .filter(({ candidate }) => candidate.driverShifts > 0)
    .sort((a, b) => {
      const overtimeDifference = Number(a.projectedWeeklyHours > 40) - Number(b.projectedWeeklyHours > 40);
      if (overtimeDifference !== 0) return overtimeDifference;
      const performanceDifference = Number(b.performanceQualified) - Number(a.performanceQualified);
      if (performanceDifference !== 0) return performanceDifference;
      const aDriver = a.driverScore == null ? 0.5 : a.driverScore / 100;
      const bDriver = b.driverScore == null ? 0.5 : b.driverScore / 100;
      return (b.score + bDriver * 0.15) - (a.score + aDriver * 0.15) || byScore(a, b);
    });
  const overallPool = scored.sort(byScore);
  const selected = new Map<string, { item: typeof scored[number]; role: "Driver" | "Crew" }>();

  for (const item of driverPool.slice(0, Math.min(neededDrivers, callInCount))) {
    selected.set(personKey(item.candidate.name), { item, role: "Driver" });
  }
  const preferredPool = overallPool.filter((item) => item.projectedWeeklyHours <= 40 && item.performanceQualified);
  const lowerPerformancePool = overallPool
    .filter((item) => item.projectedWeeklyHours <= 40 && !item.performanceQualified)
    .sort((a, b) => b.recentRph - a.recentRph || byScore(a, b));
  const overtimePool = overallPool.filter((item) => item.projectedWeeklyHours > 40 && item.performanceQualified);
  const fallbackPool = overallPool
    .filter((item) => item.projectedWeeklyHours > 40 && !item.performanceQualified)
    .sort((a, b) => b.recentRph - a.recentRph || byScore(a, b));
  const orderedPool = [...preferredPool, ...lowerPerformancePool, ...overtimePool, ...fallbackPool];
  for (const item of orderedPool) {
    if (selected.size >= callInCount) break;
    const key = personKey(item.candidate.name);
    if (!selected.has(key)) selected.set(key, { item, role: "Crew" });
  }

  const toView = (
    entry: { item: typeof scored[number]; role: "Driver" | "Crew" },
    rank: number,
  ): CrewCallInCandidate => {
    const { candidate, recentRph, projectedWeeklyHours, driverScore } = entry.item;
    const partial = {
      name: candidate.name,
      suggestedRole: entry.role,
      weeklyHours: candidate.weeklyHours,
      projectedWeeklyHours,
      recentHours: candidate.recentHours,
      recentShifts: candidate.recentShifts,
      recentJobs: candidate.recentJobs,
      recentRph,
      recentDriverShifts: candidate.driverShifts,
      driverScore,
      overtimeRisk: projectedWeeklyHours > 40,
    };
    return { ...partial, rank, reason: candidateReason(partial) };
  };

  const recommendations = Array.from(selected.values()).map((entry, index) => toView(entry, index + 1));
  const selectedKeys = new Set(recommendations.map((candidate) => personKey(candidate.name)));
  const alternates = orderedPool
    .filter((item) => !selectedKeys.has(personKey(item.candidate.name)))
    .slice(0, 3)
    .map((item, index) => toView({ item, role: item.candidate.driverShifts > 0 ? "Driver" : "Crew" }, index + 1));
  return { recommendations, alternates };
}

export function buildCrewCallInPlan(baseDate: string): CrewCallInPlan {
  const targetDate = addDays(baseDate, 1);
  const schedule = readSchedule(targetDate);
  if (!schedule) {
    return {
      baseDate,
      targetDate,
      scheduleAvailable: false,
      scheduleUpdatedAt: null,
      appointmentCount: 0,
      requiredCrews: 0,
      requiredHeadcount: 0,
      alreadyAssignedHeadcount: 0,
      callInCount: 0,
      assumedShiftHours: ASSUMED_CALL_IN_HOURS,
      territoryDemand: [],
      recommendations: [],
      alternates: [],
      note: "Tomorrow’s JunkWare schedule has not been published yet.",
    };
  }

  const territoryDemand = buildTerritoryDemand(schedule.rows);
  const requiredCrews = territoryDemand.reduce((sum, territory) => sum + territory.crews, 0);
  const requiredHeadcount = requiredCrews * PEOPLE_PER_CREW;
  const assignedPeople = new Set<string>();
  const assignedDrivers = new Set<string>();
  for (const appointment of schedule.rows) {
    for (const name of [appointment.driver, appointment.navigator, ...appointment.additionalCrew]) {
      const key = personKey(name);
      if (key) assignedPeople.add(key);
    }
    const driverKey = personKey(appointment.driver);
    if (driverKey) assignedDrivers.add(driverKey);
  }
  const callInCount = Math.max(0, requiredHeadcount - assignedPeople.size);
  const neededDrivers = Math.max(0, requiredCrews - assignedDrivers.size);
  const { recommendations, alternates } = rankCandidates(
    collectCandidates(baseDate),
    assignedPeople,
    neededDrivers,
    callInCount,
  );
  const uncovered = Math.max(0, callInCount - recommendations.length);
  const note = schedule.rows.length === 0
    ? "No active appointments are on tomorrow’s schedule, so no call-ins are suggested."
    : uncovered > 0
      ? `${uncovered} additional person${uncovered === 1 ? "" : "s"} may be needed; there is not enough recent krewe history to make a confident suggestion.`
      : "Recommendations balance recent RPH, current-week hours, recent activity, and driver coverage. Confirm availability before scheduling.";

  return {
    baseDate,
    targetDate,
    scheduleAvailable: true,
    scheduleUpdatedAt: schedule.updatedAt,
    appointmentCount: schedule.rows.length,
    requiredCrews,
    requiredHeadcount,
    alreadyAssignedHeadcount: assignedPeople.size,
    callInCount,
    assumedShiftHours: ASSUMED_CALL_IN_HOURS,
    territoryDemand,
    recommendations,
    alternates,
    note,
  };
}
