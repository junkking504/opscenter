'use client';
import {useCallback,useEffect} from 'react';
export type LeaveGuard = () => boolean;
export function useManagerLeaveGuard({busy,pending,dirty,onBlocked,onGuard}:{busy:boolean;pending:boolean;dirty:boolean;onBlocked:(message:string)=>void;onGuard?:(guard:LeaveGuard|null)=>void}) {
 const leave=useCallback(()=>{
  if(busy||pending){onBlocked('Check the saved result and finish this operation before leaving.');return false;}
  return !dirty || window.confirm('Leave without saving these edits?');
 },[busy,pending,dirty,onBlocked]);
 useEffect(()=>{onGuard?.(leave);return()=>onGuard?.(null);},[leave,onGuard]);
 useEffect(()=>{if(!busy&&!pending&&!dirty)return;const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[busy,pending,dirty]);
 return leave;
}
