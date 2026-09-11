import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import ScheduleMap from '../schedule-map';
import '../app/globals.css';
import '../live-schedule.css';
import '../schedule-selection.css';
import type {ScheduleAppointment,ScheduleTruck} from '../lib/schedule-contract';
function Fixture() {
 const [dense,setDense]=useState(false),[selected,setSelected]=useState<string|null>(null),[truck,setTruck]=useState<string|null>(null),[reset,setReset]=useState(0);
 const appointments=Array.from({length:dense?16:1},(_,i)=>({recordId:`job-${i}`,appointmentId:String(i),jkNumber:`JKTEST${i}`,customerName:`Example ${i}`,address:'100 Example St New Orleans LA 70119',appointmentTime:'9 AM–10 AM',status:'Confirmed',truck:'Truck 3',location:{latitude:29.965+i*.00002,longitude:-90.094},truckOnSite:i===0} as ScheduleAppointment));
 const trucks=Array.from({length:dense?8:1},(_,i)=>({truck:`Truck ${i+1}`,latitude:29.965,longitude:-90.094,lastGpsUpdate:new Date().toISOString(),ignition:'OFF',operationalStatus:'Parked'} as ScheduleTruck));
 return <main className="ops-live" style={{padding:20}}><h1>Locator layout · synthetic only</h1><button onClick={()=>{setDense(!dense);setSelected(null);setTruck(null);setReset(reset+1);}}>{dense?'Show pair':'Show crowded yard'}</button><div className="fixture-map" style={{width:600,maxWidth:'95vw',height:420,position:'relative'}}><ScheduleMap appointments={appointments} trucks={trucks} selected={selected} selectedTruck={truck} scope="ALL" resetKey={reset} date="2026-09-11" onSelect={id=>{setSelected(id);setTruck(null);}} onSelectTruck={id=>{setTruck(id);setSelected(null);}}/></div><p id="selected-locator">Selected: {selected||truck||'none'}</p></main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
