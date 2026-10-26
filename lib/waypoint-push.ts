import {waypointPushProjection,waypointPushChange,type WaypointPushProjection} from './waypoint-push-change';
import {waypointUpdateCounts,waypointJobChanges} from './waypoint-update-context';
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import type {CrewPhone} from './crew-phone';
import {CrewPhoneError} from './crew-phone';
import {activeCrewPhoneById,isCrewPhoneRevoked} from './crew-phone-store';
import {requireCrewDay} from './crew-phone-day';
import {getKernelPool} from './platform/persistence/pool';
import {pushSubscription} from './web-push-policy';
import {chicagoDateKey} from './chicago-date';
import {crewAssignedDay} from './crew-assigned-day';
import {sameTruck,JUNKWARE_DISPATCH_TRUCKS} from './junkware-trucks';

// Actionable schedule changes coalesce briefly; routine enrichment stays silent.
// Office messages flush immediately. The first pending event fixes the deadline.
export const WAYPOINT_ROUTINE_BATCH_SECONDS=15;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export const WAYPOINT_PUSH_HOME='/Users/missioncontrol/Library/Application Support/OpsCenter/waypoint-push';
export function waypointPushEnabled(home=WAYPOINT_PUSH_HOME,now=Date.now()) {
 try {
  const dir=fs.lstatSync(home),file=path.join(home,'config.json'),stat=fs.lstatSync(file);
  if(!dir.isDirectory() || (dir.mode&0o077)!==0 || dir.uid!==process.getuid?.() || !stat.isFile() || stat.isSymbolicLink() || stat.size>2048 || (stat.mode&0o077)!==0 || stat.uid!==process.getuid?.())return false;
  const config=JSON.parse(fs.readFileSync(file,'utf8'));
  return config.schema===1 && config.enabled===true && (config.expiresAt===undefined || typeof config.expiresAt==='number' && Number.isFinite(config.expiresAt) && config.expiresAt>now);
 }catch{return false;}
}
export function waypointPushReady(home=WAYPOINT_PUSH_HOME,now=Date.now()) {
 if(!waypointPushEnabled(home,now))return false;
 try {const file=path.join(home,'ready.json'),stat=fs.lstatSync(file);if(!stat.isFile() || stat.isSymbolicLink() || stat.uid!==process.getuid?.() || (stat.mode&0o077)!==0 || stat.size>512)return false;
 const state=JSON.parse(fs.readFileSync(file,'utf8'));return typeof state.until==='number' && state.until>now && state.until<=now+10000;}catch{return false;}
}
/** Private browser capability survives daily enrollment and enrolling-manager changes. */
export function waypointNotificationOwner(key:unknown) {
 if(typeof key!=='string' || !/^[a-f0-9]{64}$/.test(key))throw new CrewPhoneError('Enable notifications again on this phone.');
 return createHash('sha256').update(key).digest('hex');
}
export async function waypointNotificationStatus(phone:CrewPhone,key:unknown,deviceId:unknown,pool:Pool=getKernelPool()) {
 if(!key || !deviceId)return {enabled:false};const owner=waypointNotificationOwner(key);
 if(typeof deviceId!=='string' || !uuid.test(deviceId))return {enabled:false};
 const row=(await pool.query('SELECT enabled,phone_id,subscription_json FROM opscenter_kernel.waypoint_push_devices WHERE id=$1 AND owner_id=$2',[deviceId,owner])).rows[0];
 return {enabled:Boolean(row?.enabled && row.phone_id===phone.deviceId && (!row.subscription_json.expirationTime || row.subscription_json.expirationTime>Date.now()) && activeNotificationPhone(phone.deviceId))};
}
export function activeNotificationPhone(phoneId:string,truck?:string) {
 const phone=activeCrewPhoneById(phoneId);
 if(!phone)return null;let day;try{day=requireCrewDay(phone);}catch{return null;}
 if(!day || day.date!==chicagoDateKey() || truck && !sameTruck(day.truck,truck))return null;
 return {...phone,truck:day.truck};
}
export function waypointRevision(jobs:Array<{appointmentId:string;status:string;appointmentTime:string;address:string;appointmentNotes:string[];junkItems:string[];routePosition?:number;customerName?:string;phone?:string;driver?:string;navigator?:string}>,messages:Array<{id:string}>) {
 return createHash('sha256').update(JSON.stringify({jobs:jobs.map(j=>({id:j.appointmentId,status:j.status,time:j.appointmentTime,address:j.address,notes:j.appointmentNotes,items:j.junkItems,position:j.routePosition,customer:j.customerName,phone:j.phone,driver:j.driver,navigator:j.navigator})),messages:messages.map(m=>m.id)})).digest('hex');
}
export async function waypointMessages(truck:string,pool:Pool=getKernelPool()) {
 return (await pool.query('SELECT id,body,created_at FROM opscenter_kernel.waypoint_messages WHERE truck=$1 AND service_date=$2 ORDER BY created_at DESC,id DESC LIMIT 30',[truck,chicagoDateKey()])).rows;
}
export async function saveWaypointMessage(input:{id:string;truck:string;body:string;date:string},actor:string,pool:Pool=getKernelPool()) {
 if(!uuid.test(input.id) || !JUNKWARE_DISPATCH_TRUCKS.includes(input.truck) || typeof input.body!=='string' || !input.body.trim() || input.body.length>1000)throw new CrewPhoneError('Choose a truck and enter a message up to 1,000 characters.');
 const client=await pool.connect();try{await client.query('BEGIN');
 const existing=(await client.query('SELECT *,service_date::text AS service_date FROM opscenter_kernel.waypoint_messages WHERE id=$1 FOR UPDATE',[input.id])).rows[0];
 if(existing){if(existing.actor!==actor || existing.truck!==input.truck || existing.body!==input.body.trim() || existing.service_date!==input.date)throw new CrewPhoneError('This message reference belongs to another message.',409);await client.query('COMMIT');return {id:existing.id,saved:true};}
 if(input.date!==chicagoDateKey())throw new CrewPhoneError('This unsaved message belongs to a previous day. Discard it and write a new message.',409);
 const row=(await client.query('INSERT INTO opscenter_kernel.waypoint_messages(id,truck,service_date,actor,body) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET id=EXCLUDED.id RETURNING *,service_date::text AS service_date',[input.id,input.truck,input.date,actor,input.body.trim()])).rows[0];
 if(row.actor!==actor || row.truck!==input.truck || row.body!==input.body.trim() || row.service_date!==input.date)throw new CrewPhoneError('This message reference belongs to another message.',409);
 await client.query("SELECT pg_notify('waypoint_push','changed')");await client.query('COMMIT');return {id:row.id,saved:true};
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
export async function manageWaypointPush(phone:CrewPhone,input:Record<string,unknown>,pool:Pool=getKernelPool(),auth={ready:waypointPushReady,active:activeNotificationPhone}) {
 const owner=waypointNotificationOwner(input.notificationKey);
 if(input.action==='unsubscribe') {
  if(typeof input.deviceId!=='string' || !uuid.test(input.deviceId))throw new CrewPhoneError('Invalid notification device.');
  await pool.query('UPDATE opscenter_kernel.waypoint_push_devices SET enabled=false WHERE id=$1 AND owner_id=$2',[input.deviceId,owner]);return {enabled:false};
 }
 if(!['subscribe','restore'].includes(String(input.action)) || !auth.ready() || !auth.active(phone.deviceId))throw new CrewPhoneError('Notifications are not available for this phone yet.',503);
 // Restore can only move an existing opt-in; it must never undo an explicit disable.
 if(input.action==='restore') {
  if(typeof input.deviceId!=='string' || !uuid.test(input.deviceId))throw new CrewPhoneError('Invalid notification device.');
  const client=await pool.connect();try{await client.query('BEGIN');
   await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`waypoint-phone:${phone.deviceId}`]);
   const saved=(await client.query('SELECT enabled,phone_id,subscription_json FROM opscenter_kernel.waypoint_push_devices WHERE id=$1 AND owner_id=$2 FOR UPDATE',[input.deviceId,owner])).rows[0];
   if(saved?.enabled && isCrewPhoneRevoked(saved.phone_id)){
    await client.query('UPDATE opscenter_kernel.waypoint_push_devices SET enabled=false WHERE id=$1',[input.deviceId]);
    await client.query('COMMIT');return {enabled:false};
   }
   if(!saved?.enabled || saved.subscription_json.endpoint!==input.endpoint || saved.subscription_json.expirationTime && saved.subscription_json.expirationTime<=Date.now()){
    await client.query('COMMIT');return {enabled:false};
   }
   if(saved.phone_id!==phone.deviceId){
    if(Number((await client.query('SELECT count(*) FROM opscenter_kernel.waypoint_push_devices WHERE phone_id=$1 AND enabled=true',[phone.deviceId])).rows[0].count)>=10)throw new CrewPhoneError('This phone has too many notification connections. Contact the office.',409);
    await client.query('UPDATE opscenter_kernel.waypoint_push_devices SET phone_id=$2,updated_at=now() WHERE id=$1',[input.deviceId,phone.deviceId]);
    await client.query("UPDATE opscenter_kernel.waypoint_push_deliveries SET status='skipped' WHERE device_id=$1 AND status='pending'",[input.deviceId]);
    await client.query('DELETE FROM opscenter_kernel.waypoint_push_baselines WHERE device_id=$1',[input.deviceId]);
    await client.query("SELECT pg_notify('waypoint_push','changed')");
   }
   await client.query('COMMIT');return {deviceId:input.deviceId,enabled:true};
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 }
 const subscription=pushSubscription(input.subscription),hash=createHash('sha256').update(subscription.endpoint).digest('hex');
 const client=await pool.connect();try{await client.query('BEGIN');
 await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`waypoint-phone:${phone.deviceId}`]);
 const existing=(await client.query('SELECT id,enabled,phone_id FROM opscenter_kernel.waypoint_push_devices WHERE endpoint_hash=$1',[hash])).rows[0];
 if((!existing?.enabled || existing.phone_id!==phone.deviceId) && Number((await client.query('SELECT count(*) FROM opscenter_kernel.waypoint_push_devices WHERE phone_id=$1 AND enabled=true',[phone.deviceId])).rows[0].count)>=10)throw new CrewPhoneError('This phone has too many notification connections. Contact the office.',409);
 const saved=await client.query(`INSERT INTO opscenter_kernel.waypoint_push_devices(id,owner_id,phone_id,endpoint_hash,subscription_json) VALUES($1,$2,$3,$4,$5::jsonb)
 ON CONFLICT(endpoint_hash) DO UPDATE SET phone_id=EXCLUDED.phone_id,subscription_json=EXCLUDED.subscription_json,enabled=true,updated_at=now() WHERE waypoint_push_devices.owner_id=EXCLUDED.owner_id RETURNING id`,[randomUUID(),owner,phone.deviceId,hash,JSON.stringify(subscription)]);
 if(!saved.rows.length)throw new CrewPhoneError('This notification belongs to another phone.',409);
 await client.query("UPDATE opscenter_kernel.waypoint_push_deliveries SET status='skipped' WHERE device_id=$1 AND status='pending'",[saved.rows[0].id]);
 await client.query('DELETE FROM opscenter_kernel.waypoint_push_baselines WHERE device_id=$1',[saved.rows[0].id]);
 await client.query("SELECT pg_notify('waypoint_push','changed')");await client.query('COMMIT');return {deviceId:saved.rows[0].id,enabled:true};
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
/** Latest verified truck projection only; source outages never become removals. */
export async function recordWaypointChanges(pool:Pool=getKernelPool(),sources={active:activeNotificationPhone,snapshot:crewAssignedDay,messages:waypointMessages}) {
 const devices=(await pool.query('SELECT id,phone_id FROM opscenter_kernel.waypoint_push_devices WHERE enabled=true')).rows;
 for(const device of devices){
  // Daily authentication expires independently of the browser's notification opt-in.
  // Delivery rechecks active access; keep consent so the next daily setup can restore it.
  const phone=sources.active(device.phone_id);if(!phone){
   if(isCrewPhoneRevoked(device.phone_id))await pool.query('UPDATE opscenter_kernel.waypoint_push_devices SET enabled=false WHERE id=$1 AND phone_id=$2',[device.id,device.phone_id]);
   continue;
  }
  let snapshot;try{snapshot=sources.snapshot(phone,chicagoDateKey());}catch{snapshot={state:'unavailable' as const,jobs:[]};}
  const messages=await sources.messages(phone.truck,pool),scope=`${chicagoDateKey()}:${phone.truck}`,revisions=[{kind:'messages' as const,revision:waypointRevision([],messages),projection:waypointPushProjection([],messages)},...(snapshot.state==='unavailable'?[]:[{kind:'schedule' as const,revision:waypointRevision(snapshot.jobs || [],[]),projection:waypointPushProjection(snapshot.jobs || [],[])}])];
  for(const {kind,revision,projection} of revisions){
  const client=await pool.connect();try{await client.query('BEGIN');
   // Enrollment/disable must serialize with baseline and delivery creation.
   const current=(await client.query('SELECT enabled,phone_id FROM opscenter_kernel.waypoint_push_devices WHERE id=$1 FOR UPDATE',[device.id])).rows[0];
   if(!current?.enabled || current.phone_id!==device.phone_id){await client.query('ROLLBACK');continue;}
   const prior=(await client.query('SELECT scope,revision,projection_json FROM opscenter_kernel.waypoint_push_baselines WHERE device_id=$1 AND kind=$2 FOR UPDATE',[device.id,kind])).rows[0];
   if(prior?.scope===scope && prior.revision!==revision){
    const change=waypointPushChange(prior.projection_json as WaypointPushProjection|null,projection,kind);
    if(change.changed)await client.query("INSERT INTO opscenter_kernel.waypoint_push_deliveries(id,device_id,phone_id,truck,service_date,status,context_json,not_before) VALUES($1,$2,$3,$4,$5,'pending',$6::jsonb,now()+($7 * interval '1 second'))",[randomUUID(),device.id,phone.deviceId,phone.truck,chicagoDateKey(),JSON.stringify({...change.counts,changes:change.changes}),change.urgent?0:WAYPOINT_ROUTINE_BATCH_SECONDS]);
   }
   await client.query('INSERT INTO opscenter_kernel.waypoint_push_baselines(device_id,kind,scope,revision,projection_json) VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT(device_id,kind) DO UPDATE SET scope=EXCLUDED.scope,revision=EXCLUDED.revision,projection_json=EXCLUDED.projection_json,updated_at=now()',[device.id,kind,scope,revision,JSON.stringify(projection)]);
   await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
 }
}

/** Retire only this feature's old, settled private records; protect pending work. */
export async function retainWaypointPush(pool:Pool=getKernelPool()) {
 await pool.query("UPDATE opscenter_kernel.waypoint_push_deliveries SET status='skipped' WHERE status='pending' AND created_at<now()-interval '5 minutes'");
 await pool.query("DELETE FROM opscenter_kernel.waypoint_messages WHERE service_date<(now() AT TIME ZONE 'America/Chicago')::date-14");
 await pool.query("DELETE FROM opscenter_kernel.waypoint_push_deliveries WHERE created_at<now()-interval '14 days' AND status NOT IN ('pending','sending')");
 const client=await pool.connect();try{await client.query('BEGIN');
 const retired=(await client.query("SELECT d.id FROM opscenter_kernel.waypoint_push_devices d WHERE enabled=false AND updated_at<now()-interval '14 days' AND NOT EXISTS(SELECT 1 FROM opscenter_kernel.waypoint_push_deliveries q WHERE q.device_id=d.id) FOR UPDATE OF d SKIP LOCKED")).rows.map(row=>row.id);
 if(retired.length){await client.query('DELETE FROM opscenter_kernel.waypoint_push_baselines WHERE device_id=ANY($1::uuid[])',[retired]);await client.query('DELETE FROM opscenter_kernel.waypoint_push_devices WHERE id=ANY($1::uuid[])',[retired]);}
 await client.query('COMMIT');
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}

/** Authentication and today's day are required by the caller. No endpoint/key or
 * customer data is returned; grouping is scoped to the current phone/truck/date. */
export async function waypointUpdates(phone:CrewPhone,pool:Pool=getKernelPool(),selected?:string|null) {
 const selectedId=selected&&uuid.test(selected)?selected:null;
 const rows=(await pool.query(`SELECT * FROM (
  SELECT DISTINCT ON (COALESCE(q.context_json->>'notificationId',q.id::text))
   COALESCE(q.context_json->>'notificationId',q.id::text) AS id,COALESCE(q.context_json->'notificationContext',q.context_json) AS context_json,q.created_at
  FROM opscenter_kernel.waypoint_push_deliveries q
  WHERE phone_id=$1 AND truck=$2 AND service_date=$3 AND status<>'skipped'
  ORDER BY COALESCE(q.context_json->>'notificationId',q.id::text),q.created_at DESC
 ) updates ORDER BY (id=$4) DESC NULLS LAST,created_at DESC,id DESC LIMIT 30`,[phone.deviceId,phone.truck,chicagoDateKey(),selectedId])).rows;
 return rows.map(row=>({id:row.id,counts:waypointUpdateCounts(row.context_json),changes:waypointJobChanges(row.context_json?.changes),created_at:row.created_at}));
}
