import {useEffect,useState} from 'react';
import type {AppointmentCostSummary} from '../../lib/appointment-cost-model';

type AttendanceState={key:string;rows:Record<string,AppointmentCostSummary>;loading:boolean;denied:boolean};
export function useAppointmentAttendance(date:string,refreshKey:string,enabled:boolean):Omit<AttendanceState,'key'>{
 const key=JSON.stringify([date,refreshKey,enabled]);
 const [state,setState]=useState<AttendanceState|null>(null);
 useEffect(()=>{
  if(!enabled)return;
  const controller=new AbortController();
  fetch(`/api/desktop/schedule/cost?${new URLSearchParams({date,scope:'attendance'})}`,{cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(60000)])})
   .then(async response=>{
    if(response.status===403){if(!controller.signal.aborted)setState({key,rows:{},loading:false,denied:true});return;}
    if(!response.ok)throw new Error('Attendance costs unavailable');
    const body=await response.json();
    if(body.date!==date)throw new Error('Mismatched appointment day');
    if(!controller.signal.aborted)setState({key,rows:body.rows,loading:false,denied:false});
   }).catch(()=>{if(!controller.signal.aborted)setState({key,rows:{},loading:false,denied:false});});
  return()=>controller.abort();
 },[date,key,enabled]);
 return state?.key===key?state:{rows:{},loading:enabled,denied:!enabled};
}
