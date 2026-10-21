import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import type {CrewPhone} from './crew-phone';
import {CrewPhoneError} from './crew-phone';
import {listCrewPhones,crewPhoneNotificationOwner} from './crew-phone-store';
import {requireCrewDay} from './crew-phone-day';
import {getKernelPool} from './platform/persistence/pool';
import {pushSubscription} from './web-push-policy';
import {chicagoDateKey} from './chicago-date';
import {crewAssignedDay} from './crew-assigned-day';
import {sameTruck,JUNKWARE_DISPATCH_TRUCKS} from './junkware-trucks';

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
export function activeNotificationPhone(phoneId:string,truck?:string) {
 const phone=listCrewPhones().find(p=>p.deviceId===phoneId && p.state==='active' && p.access==='live' && !p.test);
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
export async function saveWaypointMessage(input:{id:string;truck:string;body:string},actor:string,pool:Pool=getKernelPool()) {
 if(!/^[a-f0-9-]{36}$/i.test(input.id) || !JUNKWARE_DISPATCH_TRUCKS.includes(input.truck) || typeof input.body!=='string' || !input.body.trim() || input.body.length>1000)throw new CrewPhoneError('Choose a truck and enter a message up to 1,000 characters.');
 const client=await pool.connect();try{await client.query('BEGIN');
 const row=(await client.query('INSERT INTO opscenter_kernel.waypoint_messages(id,truck,service_date,actor,body) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET id=EXCLUDED.id RETURNING *',[input.id,input.truck,chicagoDateKey(),actor,input.body.trim()])).rows[0];
 if(row.actor!==actor || row.truck!==input.truck || row.body!==input.body.trim() || String(row.service_date).slice(0,10)!==chicagoDateKey() && new Date(row.service_date).toISOString().slice(0,10)!==chicagoDateKey())throw new CrewPhoneError('This message reference belongs to another message.',409);
 await client.query("SELECT pg_notify('waypoint_push','changed')");await client.query('COMMIT');return {id:row.id,saved:true};
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
export async function manageWaypointPush(phone:CrewPhone,input:Record<string,unknown>,pool:Pool=getKernelPool(),auth={owner:crewPhoneNotificationOwner,ready:waypointPushReady,active:activeNotificationPhone}) {
 const owner=auth.owner(phone);
 if(input.action==='unsubscribe') {
  if(typeof input.deviceId!=='string' || !/^[a-f0-9-]{36}$/i.test(input.deviceId))throw new CrewPhoneError('Invalid notification device.');
  await pool.query('UPDATE opscenter_kernel.waypoint_push_devices SET enabled=false WHERE id=$1 AND owner_id=$2',[input.deviceId,owner]);return {enabled:false};
 }
 if(input.action!=='subscribe' || !auth.ready() || !auth.active(phone.deviceId))throw new CrewPhoneError('Notifications are not available for this phone yet.',503);
 const subscription=pushSubscription(input.subscription),hash=createHash('sha256').update(subscription.endpoint).digest('hex');
 const client=await pool.connect();try{await client.query('BEGIN');
 await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`waypoint-push:${owner}`]);
 const existing=(await client.query('SELECT id FROM opscenter_kernel.waypoint_push_devices WHERE endpoint_hash=$1',[hash])).rows[0];
 if(!existing && Number((await client.query('SELECT count(*) FROM opscenter_kernel.waypoint_push_devices WHERE owner_id=$1 AND enabled=true',[owner])).rows[0].count)>=10)throw new CrewPhoneError('This phone has too many notification subscriptions. Disable an old one first.',409);
 const saved=await client.query(`INSERT INTO opscenter_kernel.waypoint_push_devices(id,owner_id,phone_id,endpoint_hash,subscription_json) VALUES($1,$2,$3,$4,$5::jsonb)
 ON CONFLICT(endpoint_hash) DO UPDATE SET phone_id=EXCLUDED.phone_id,subscription_json=EXCLUDED.subscription_json,enabled=true,updated_at=now() WHERE waypoint_push_devices.owner_id=EXCLUDED.owner_id RETURNING id`,[randomUUID(),owner,phone.deviceId,hash,JSON.stringify(subscription)]);
 if(!saved.rows.length)throw new CrewPhoneError('This notification belongs to another phone.',409);
 await client.query("SELECT pg_notify('waypoint_push','changed')");await client.query('COMMIT');return {deviceId:saved.rows[0].id,enabled:true};
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
/** Latest verified truck projection only; source outages never become removals. */
export async function recordWaypointChanges(pool:Pool=getKernelPool(),sources={active:activeNotificationPhone,snapshot:crewAssignedDay,messages:waypointMessages}) {
 const devices=(await pool.query('SELECT id,phone_id FROM opscenter_kernel.waypoint_push_devices WHERE enabled=true')).rows;
 for(const device of devices){
  const phone=sources.active(device.phone_id);if(!phone)continue;
  const snapshot=sources.snapshot(phone,chicagoDateKey());
  const messages=await sources.messages(phone.truck,pool),scope=`${chicagoDateKey()}:${phone.truck}`,revisions=[{kind:'messages',revision:waypointRevision([],messages)},...(snapshot.state==='unavailable'?[]:[{kind:'schedule',revision:waypointRevision(snapshot.jobs || [],[])}])];
  for(const {kind,revision} of revisions){
  const client=await pool.connect();try{await client.query('BEGIN');
   // Enrollment/disable must serialize with baseline and delivery creation.
   const current=(await client.query('SELECT enabled,phone_id FROM opscenter_kernel.waypoint_push_devices WHERE id=$1 FOR UPDATE',[device.id])).rows[0];
   if(!current?.enabled || current.phone_id!==device.phone_id){await client.query('ROLLBACK');continue;}
   const prior=(await client.query('SELECT scope,revision FROM opscenter_kernel.waypoint_push_baselines WHERE device_id=$1 AND kind=$2 FOR UPDATE',[device.id,kind])).rows[0];
   if(prior?.scope===scope && prior.revision!==revision)await client.query("INSERT INTO opscenter_kernel.waypoint_push_deliveries(id,device_id,phone_id,truck,service_date,status) VALUES($1,$2,$3,$4,$5,'pending')",[randomUUID(),device.id,phone.deviceId,phone.truck,chicagoDateKey()]);
   await client.query('INSERT INTO opscenter_kernel.waypoint_push_baselines(device_id,kind,scope,revision) VALUES($1,$2,$3,$4) ON CONFLICT(device_id,kind) DO UPDATE SET scope=EXCLUDED.scope,revision=EXCLUDED.revision,updated_at=now()',[device.id,kind,scope,revision]);
   await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
 }
}
