type AppointmentSearchScope = 'all'|'upcoming'|'past';
type HistoryResult = {id:string;type:'job';title:string;subtitle:string;source:string;href:string;appointmentDate:string;searchText:string};

export type HistoryQuery = { field: 'AddressTB'|'AppointmentCodeTB'|'PhoneTB'|'EmailTB'|'LastNameTB'; value: string };
/** Only record identifiers enter the live source path; questions still go to OpsBot. */
export function historyQuery(query: string): HistoryQuery | null {
  const value = query.trim().replace(/\s+/g, ' ');
  if (value.length < 3 || value.length > 120) return null;
  if (/^jk\s*\d{4,12}$/i.test(value)) return { field: 'AppointmentCodeTB', value: value.replace(/\s/g, '').toUpperCase() };
  if (/^[+()\d .-]+$/.test(value) && /^1?\d{10}$/.test(value.replace(/\D/g, ''))) return { field: 'PhoneTB', value: value.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '') };
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return { field: 'EmailTB', value };
  if (/^\d+[a-z]?(?:[-/]\d+)?\s+[a-z]/i.test(value)) return { field: 'AddressTB', value };
  const explicit = value.match(/^(address|surname):\s*(.{3,})$/i);
  if (explicit) return { field: explicit[1].toLowerCase() === 'address' ? 'AddressTB' : 'LastNameTB', value: explicit[2] };
  return null;
}

export type HistoryRow = { appointmentId: string; jk: string; date: string; time: string; name: string; address: string; phone: string; type: string; status: string };
export type HistorySearch = { results: HistoryResult[]; hasMore: boolean; checkedAt: string };
export function historyDate(value: string): string {
  const m = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const date = m ? `${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}` : '';
  if (!date || !Number.isFinite(Date.parse(date)) || new Date(date+'T12:00:00Z').toISOString().slice(0,10)!==date) throw new Error('Invalid source date');
  return date;
}
export function historyResult(row: HistoryRow): HistoryResult {
  if (!/^\d{1,12}$/.test(row.appointmentId) || !/^JK\d{4,12}$/.test(row.jk) || !row.name || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) throw new Error('Invalid source appointment');
  const href = '/jobs?' + new URLSearchParams({date:row.date, appointment:row.appointmentId, q:row.jk, sourceLookup:'1'});
  return {id:`job:${row.date}:${row.appointmentId}`, type:'job', title:`${row.name} · ${row.jk}`, subtitle:[row.date,row.time,row.type,row.status,row.address].filter(Boolean).join(' · '), source:'JunkWare history', href, appointmentDate:row.date, searchText:[row.name,row.jk,row.address,row.phone].join(' ')};
}
export function historyDateBounds(scope: AppointmentSearchScope, today: string) {
  const display = (date:string) => { const [y,m,d]=date.split('-');return `${Number(m)}/${Number(d)}/${y}`; };
  return { start:scope==='upcoming'?display(today):'', end:scope==='past'?display(new Date(Date.parse(today+'T12:00:00Z')-86400000).toISOString().slice(0,10)):'' };
}
type SearchRow = {id:string;type:string;title:string;subtitle:string;source:string;href:string};
/** Prefer current source identity even when a saved appointment has moved dates. */
export function mergeHistoryResults<T extends SearchRow>(saved:T[], live:T[]):T[] {
  const identity=(row:T)=>row.type==='job' ? new URL(row.href,'https://opscenter.invalid').searchParams.get('appointment') || row.id : row.id;
  const seen=new Set<string>();
  return [...live,...saved].filter(row=>{const key=identity(row);if(seen.has(key))return false;seen.add(key);return true;});
}
