const prefix='ops-crew-closeout:';
const maxAge=24*60*60_000;
export const crewCloseoutKey=(deviceId:string,assignmentId:string)=>`${prefix}${deviceId}:${assignmentId}`;
export function clearCrewCloseoutDrafts(keep?:string) {
  try {for(const key of Object.keys(localStorage))if(key.startsWith(prefix) && (!keep || !key.startsWith(`${keep}:`)))localStorage.removeItem(key);} catch { /* Storage denial must not prevent disconnect. */ }
}
export function readCloseoutLocal<T>(key:string):T|null {
  try {const value=JSON.parse(localStorage.getItem(key) || 'null');if(!value || !Number.isFinite(value.at) || Date.now()-value.at>maxAge){localStorage.removeItem(key);return null;}return value.value as T;}
  catch {try {localStorage.removeItem(key);} catch {} return null;}
}
export function writeCloseoutLocal(key:string,value:unknown) {localStorage.setItem(key,JSON.stringify({at:Date.now(),value}));}
