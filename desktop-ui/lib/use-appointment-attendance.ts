import {useEffect,useRef,useState} from 'react';
import type {AppointmentCostSummary} from '../../lib/appointment-cost-model';
import {createRouteLoader,type RouteLoadState} from './route-loader';

type AttendanceData={rows:Record<string,AppointmentCostSummary>;denied:boolean};
export function useAppointmentAttendance(date:string,refreshKey:string,enabled:boolean){
 const key=JSON.stringify([date,enabled]);
 const [result,setResult]=useState<{key:string;state:RouteLoadState<AttendanceData>}|null>(null);
 const loader=useRef<ReturnType<typeof createRouteLoader<AttendanceData>>|null>(null);
 useEffect(()=>{
  if(!enabled)return;
  const current=createRouteLoader<AttendanceData>(async signal=>{
   const response=await fetch(`/api/desktop/schedule/cost?${new URLSearchParams({date,scope:'attendance'})}`,{cache:'no-store',signal:AbortSignal.any([signal,AbortSignal.timeout(60000)])});
   // A revoked permission clears previously visible amounts as well.
   if(response.status===403||response.status===401)return {rows:{},denied:true};
   if(!response.ok)throw new Error('Attendance costs unavailable');
   const body=await response.json();
   if(body.date!==date||!body.rows||typeof body.rows!=='object')throw new Error('Invalid appointment costs');
   return {rows:body.rows,denied:false};
  },state=>setResult({key,state}));
  loader.current=current;
  void current.refresh();
  return()=>{current.dispose();loader.current=null;};
 },[date,key,enabled]);
 const lastRefresh=useRef(refreshKey);
 useEffect(()=>{
  if(lastRefresh.current===refreshKey)return;
  lastRefresh.current=refreshKey;
  void loader.current?.refresh();
 },[refreshKey]);
 const state=result?.key===key?result.state:null;
 return {rows:state?.data?.rows||{},loading:state?.loading??enabled,error:state?.error??false,denied:!enabled||Boolean(state?.data?.denied)};
}
