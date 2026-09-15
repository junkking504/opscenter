import React, {useEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';
import L from 'leaflet';
import ScheduleMap from '../schedule-map';
import {TruckTelemetry} from '../truck-telemetry';
import type {ScheduleTruck} from '../lib/schedule-contract';
import '../app/globals.css';
import '../live-schedule.css';

let map: L.Map;
L.Map.addInitHook(function(this:L.Map){map=this;});
const initial:ScheduleTruck = {truck:'Truck 6',latitude:30.42,longitude:-91.14,lastGpsUpdate:new Date().toISOString(),speed:43,ignition:'ON',operationalStatus:'Driving',driver:'',navigator:'',serviceStatus:'',freshnessLabel:'Live GPS'};
function Fixture() {
  const [truck,setTruck]=useState(initial),[selected,setSelected]=useState<string|null>(null),[reset,setReset]=useState(0),[metrics,setMetrics]=useState('Loading');
  useEffect(()=>{const timer=setInterval(()=>{
    if(map) setMetrics(`Zoom ${map.getZoom()} · Truck centered: ${map.latLngToContainerPoint([truck.latitude!,truck.longitude!]).distanceTo(map.getSize().divideBy(2))<=1?'PASS':'NO'}`);
  },100);return()=>clearInterval(timer);},[truck]);
  return <main className="ops-live" style={{padding:20}}><h1>Synthetic GPS movement and speed</h1>
    <div style={{position:'relative',height:400,width:700,maxWidth:'95vw'}}><ScheduleMap appointments={[]} trucks={[truck]} selected={null} selectedTruck={selected} scope="ALL" resetKey={reset} date="2026-09-15" truckMapView="overview" onSelect={()=>{}} onSelectTruck={name=>{setSelected(name);setReset(n=>n+1);}}/></div>
    <button onClick={()=>{setSelected('Truck 6');setReset(n=>n+1);}}>Select Truck 6</button>{' '}
    <button onClick={()=>setTruck(t=>({...t,latitude:t.latitude!+.003,longitude:t.longitude!+.003,speed:59,lastGpsUpdate:new Date().toISOString()}))}>Receive next GPS report</button>{' '}
    <button onClick={()=>setTruck(t=>({...t,speed:0,ignition:'OFF',lastGpsUpdate:new Date().toISOString()}))}>Receive stopped report</button>{' '}
    <button onClick={()=>setTruck(t=>({...t,lastGpsUpdate:new Date(Date.now()-240_000).toISOString()}))}>Age report past live window</button>{' '}
    <button onClick={()=>setTruck(t=>({...t,speed:null,lastGpsUpdate:new Date().toISOString()}))}>Missing speed</button>
    <dl><TruckTelemetry truck={truck}/></dl><p>{metrics}</p>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
