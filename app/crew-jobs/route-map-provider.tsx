'use client';
import {useEffect,useState} from 'react';
import type {WaypointMapAppointment} from '@/lib/waypoint-map';
import RouteMap from './route-map';
import RouteAppleMap from './route-apple-map';

type Provider={provider:'apple';token:string}|{provider:'openstreetmap'}|null;
let cached:Promise<Provider>|undefined;
/** One bounded read per page. Anything but an explicit Apple answer keeps OpenStreetMap. */
function readProvider():Promise<Provider>{
 cached??=fetch('/api/crew-jobs/maps',{cache:'no-store'}).then(async response=>{
  if(!response.ok)return {provider:'openstreetmap' as const};
  const body=await response.json();
  return body?.provider==='apple' && typeof body.token==='string' && body.token?{provider:'apple' as const,token:body.token as string}:{provider:'openstreetmap' as const};
 }).catch(()=>({provider:'openstreetmap' as const}));
 return cached;
}

export default function RouteMapProvider(props:{appointments:WaypointMapAppointment[];onSelect:(id:string)=>void;expanded:boolean}) {
 const [provider,setProvider]=useState<Provider>(null),[failed,setFailed]=useState(false);
 useEffect(()=>{let active=true;void readProvider().then(value=>{if(active)setProvider(value);});return()=>{active=false;};},[]);
 // The original map renders while the provider is unknown, so nothing waits on Apple.
 if(provider?.provider==='apple' && !failed)return <RouteAppleMap token={provider.token} {...props} onFailure={()=>setFailed(true)}/>;
 return <RouteMap {...props}/>;
}
