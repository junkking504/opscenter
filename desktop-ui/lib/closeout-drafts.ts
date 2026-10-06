const prefix='ops-crew-closeout:';
const maxAge=24*60*60_000;
export const crewCloseoutKey=(deviceId:string,assignmentId:string)=>`${prefix}${deviceId}:${assignmentId}`;
export function clearCrewCloseoutDrafts(keep?:string) {
  try {for(const key of Object.keys(localStorage))if(key.startsWith(prefix) && (!keep || !key.startsWith(`${keep}:`)))localStorage.removeItem(key);} catch { /* Storage denial must not prevent disconnect. */ }
}
export function clearCrewCloseoutAssignment(deviceId:string,assignmentId:string) {
  const key=crewCloseoutKey(deviceId,assignmentId);
  try {for(const name of Object.keys(localStorage))if(name===key || name.startsWith(`${key}:`))localStorage.removeItem(name);} catch { /* A later refresh can retry the reset. */ }
}
export function readCloseoutLocal<T>(key:string):T|null {
  try {const value=JSON.parse(localStorage.getItem(key) || 'null');if(!value || !Number.isFinite(value.at) || (!key.endsWith(':receipt') && Date.now()-value.at>maxAge))return null;return value.value as T;}
  catch {return null;}
}
export function writeCloseoutLocal(key:string,value:unknown) {localStorage.setItem(key,JSON.stringify({at:Date.now(),value}));}

/** Copies only known aliases and never removes an older draft or photo scope. */
export function migrateCloseoutDraft(key:string,aliases:string[]) {
  if(localStorage.getItem(`${key}:draft`)!==null)return;
  const candidates=aliases.map(alias=>localStorage.getItem(`${alias}:draft`)).filter((raw):raw is string=>raw!==null);
  const newest=candidates.sort((a,b)=>{
    const at=(raw:string)=>{try{return Number(JSON.parse(raw).at)||0;}catch{return 0;}};
    return at(b)-at(a);
  })[0];
  if(newest!==undefined)localStorage.setItem(`${key}:draft`,newest);
}
/** Preserve the exact bytes before replacing incompatible/expired draft fields. */
export function preserveCloseoutDraft(key:string) {
  const raw=localStorage.getItem(`${key}:draft`);
  if(raw===null)return;
  if(Object.keys(localStorage).some(name=>name.startsWith(`${key}:preserved:`) && localStorage.getItem(name)===raw))return;
  localStorage.setItem(`${key}:preserved:${Date.now()}:${crypto.randomUUID()}`,raw);
}
export function preservedCloseoutDrafts(key:string) {
  return Object.keys(localStorage).filter(name=>name.startsWith(`${key}:preserved:`)).map(name=>({key:name,raw:localStorage.getItem(name)}));
}
export const appointmentDraftScope=(job:{date:string;appointmentId:string;draftScope?:string})=>job.draftScope || `appointment:${job.date}:${job.appointmentId}:original`;
