import { buildFleetMapPayload } from "@/lib/fleet-map";
import { crewRows, readMetrics, type AnyRecord } from "@/lib/opsData";
import { crewMemberHref, fleetTruckHref, jobScheduleHref } from "@/lib/related-record-links";
import fs from 'node:fs';
import path from 'node:path';
import {readJobRows,junkwareScheduleUpdatedAt} from './desktop-schedule-source';
import {chicagoDateKey} from './report-dates';

export type GlobalSearchResultType = "job" | "crew" | "truck";

export type GlobalSearchResult = {
  id: string;
  type: GlobalSearchResultType;
  title: string;
  subtitle: string;
  source: string;
  href: string;
  searchText: string;
  appointmentDate?: string;
};

export type AppointmentSearchScope = 'all'|'upcoming'|'past';
const RESULTS_PER_TYPE = 5;

function text(value: unknown): string {
  const normalized = String(value ?? "").trim();
  return normalized && normalized !== "—" ? normalized : "";
}

function first(row: AnyRecord, keys: string[]): string {
  for (const key of keys) {
    const value = text(row?.[key]);
    if (value) return value;
  }
  return "";
}

function normalized(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function resultScore(result: GlobalSearchResult, query: string): number {
  const title = normalized(result.title);
  const haystack = normalized(result.searchText);
  const normalizedQuery = normalized(query);
  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  const truckNumberQuery = normalizedQuery.match(/^truck\s+(\d+)$/);
  if (truckNumberQuery && !haystack.includes(`truck ${truckNumberQuery[1]}`)) return -1;
  if (!tokens.length || !tokens.every((token) => haystack.includes(token))) return -1;
  if (title === normalizedQuery) return 100;
  if (title.startsWith(normalizedQuery)) return 80;
  if (title.includes(normalizedQuery)) return 60;
  return 20 + tokens.reduce((sum, token) => sum + (title.includes(token) ? 4 : 0), 0);
}

export function searchGlobalIndex(
  index: GlobalSearchResult[],
  query: string,
  perType = RESULTS_PER_TYPE,
): GlobalSearchResult[] {
  if (normalized(query).length < 2) return [];
  const counts: Record<GlobalSearchResultType, number> = { job: 0, crew: 0, truck: 0 };
  return index
    .map((result, order) => ({ result, order, score: resultScore(result, query) }))
    .filter((entry) => entry.score >= 0)
    .sort((left, right) => right.score - left.score || left.order - right.order)
    .flatMap(({ result }) => {
      if (counts[result.type] >= perType) return [];
      counts[result.type] += 1;
      return [result];
    });
}

export function jobResult(row: AnyRecord, date: string): GlobalSearchResult | null {
  const appointmentId = first(row, ["appointmentId", "appt_id", "appointment_id"]);
  const jkNumber = first(row, ["jkNumber", "job_id", "jk_number", "job_number"]);
  const customer = first(row, ["customerName", "customer_name", "customer", "name"]);
  if (!appointmentId && !jkNumber && !customer) return null;
  const phone = first(row, ["customer_phone", "phone"]);
  const address = first(row, ["service_address", "address"]);
  const time = first(row, ["appointmentTime", "appointment_time", "time"]);
  const status = first(row, ["job_status", "appointment_status", "status"]);
  const truck = first(row, ["truck", "assigned_truck", "truck_number"]);
  const driver = first(row, ["driver_normalized_name", "driver_name", "driver"]);
  const navigator = first(row, ["navigator_normalized_name", "navigator_name", "navigator"]);
  const title = customer && jkNumber ? `${customer} · ${jkNumber}` : customer || jkNumber || `Appointment ${appointmentId}`;
  const category=first(row,['appointmentType','appointment_type']);
  const detail = [date, time || 'Time Unavailable', category, status || 'Status Unavailable', truck || 'Unassigned'].filter(Boolean).join(" · ");
  const routeQuery = jkNumber || customer || appointmentId;
  return {
    id: `job:${date}:${appointmentId || jkNumber || customer}`,
    type: "job",
    appointmentDate: date,
    title,
    subtitle: detail,
    source: "JunkWare appointment",
    href: jobScheduleHref(date, routeQuery, appointmentId),
    searchText: [title, date, phone, phone.replace(/\D/g,''), address, status, truck, driver, navigator, appointmentId].join(" "),
  };
}

function crewResult(row: AnyRecord, date: string): GlobalSearchResult | null {
  const name = first(row, ["name", "employee_name", "employee", "crew_member"]);
  if (!name) return null;
  const truck = first(row, ["truck", "assigned_truck", "trucks"]);
  const shift = first(row, ["shift_status", "roster_status", "pay_status"]);
  return {
    id: `crew:${normalized(name)}`,
    type: "crew",
    title: name,
    subtitle: [shift, truck].filter(Boolean).join(" · ") || "Today’s Krewe",
    source: "OpsCenter Krewe snapshot",
    href: crewMemberHref(date, name),
    searchText: [name, truck, shift].join(" "),
  };
}

export function orderSearchDates(dates:string[],today:string) {
  const valid=[...new Set(dates)].filter(date=>/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(date))&&new Date(date+'T12:00:00Z').toISOString().slice(0,10)===date);
  return [...valid.filter(date=>date>=today).sort(),...valid.filter(date=>date<today).sort().reverse()];
}
export function availableScheduleSearchDates(dataDir=process.env.OPSBOT_DATA_DIR||path.join(process.env.HOME||'','.openclaw','workspace','opsbot','data')) {
  const directory=path.join(dataDir,'history','junkware'),dates=new Set<string>();
  const scan=(dir:string)=>{try{for(const file of fs.readdirSync(dir)){
    const match=file.match(/^junkware_(?:(?:live|completed)_(\d{4}-\d{2}-\d{2})_summary\.csv|schedule_(?:fast|requested)_(\d{4}-\d{2}-\d{2})\.json|(\d{4}-\d{2}-\d{2})_raw\.json)$/);
    if(match)dates.add(match[1]||match[2]||match[3]);
  }}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}};
  scan(directory);for(const market of ['352','477','399','484'])scan(path.join(directory,'schedule-watchers',market));
  return [...dates];
}
let appointmentsCache:{at:number;today:string;dates:string[];rows:GlobalSearchResult[]}|null=null;
function appointmentIndex(today:string){
  if(appointmentsCache?.today===today&&Date.now()-appointmentsCache.at<15000)return appointmentsCache;
  const candidates=orderSearchDates(availableScheduleSearchDates(),today),dates:string[]=[];
  // Use Schedule's normalized JunkWare records; metrics do not establish coverage.
  const rows=candidates.flatMap(date=>{const jobs=readJobRows(date);if(jobs.length||junkwareScheduleUpdatedAt(date))dates.push(date);return jobs.flatMap(row=>jobResult(row,date)||[]);});
  return appointmentsCache={at:Date.now(),today,dates,rows};
}
export function buildGlobalSearchIndex(date: string): GlobalSearchResult[] {
  const currentMetrics = readMetrics(date);
  const jobs = appointmentIndex(chicagoDateKey()).rows;

  const crew = crewRows(currentMetrics).flatMap((row) => crewResult(row, date) || []);
  const fleet = buildFleetMapPayload(date);
  const trucks = (fleet?.trucks || []).map((truck) => ({
    id: `truck:${truck.truck}`,
    type: "truck" as const,
    title: truck.truck,
    subtitle: [truck.freshnessLabel, truck.driver, truck.navigator].filter((value) => text(value)).join(" · "),
    source: "Linxup fleet",
    href: fleetTruckHref(date, truck.truck),
    searchText: [truck.truck, truck.driver, truck.navigator, truck.yearMakeModel].join(" "),
  }));

  return [...trucks, ...crew, ...jobs];
}

export function scopeSearchResults(index:GlobalSearchResult[],scope:AppointmentSearchScope,today:string){
  return index.filter(result=>result.type!=='job'||scope==='all'||Boolean(result.appointmentDate&&(scope==='upcoming'?result.appointmentDate>=today:result.appointmentDate<today)));
}
export function buildGlobalSearchResults(query: string, date: string,scope:AppointmentSearchScope='all'): GlobalSearchResult[] {
  return searchGlobalIndex(scopeSearchResults(buildGlobalSearchIndex(date),scope,chicagoDateKey()), query);
}
export function buildGlobalSearchResponse(query:string,date:string,scope:AppointmentSearchScope='all',limit=10){
  const today=chicagoDateKey(),ranked=searchGlobalIndex(scopeSearchResults(buildGlobalSearchIndex(date),scope,today),query,Infinity);
  const jobs=ranked.filter(row=>row.type==='job'),others=ranked.filter(row=>row.type!=='job');
  const visible=new Set([...jobs.slice(0,limit),...others.filter((row,index)=>others.slice(0,index).filter(other=>other.type===row.type).length<5)].map(row=>row.id));
  const dates=appointmentIndex(today).dates.filter(date=>scope==='all'||(scope==='upcoming'?date>=today:date<today)).sort();
  return {results:ranked.filter(row=>visible.has(row.id)),appointmentTotal:jobs.length,hasMore:jobs.length>limit,today,coverage:{dateCount:dates.length,from:dates[0]||null,to:dates.at(-1)||null}};
}
