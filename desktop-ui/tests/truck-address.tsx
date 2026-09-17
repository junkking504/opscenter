import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {TruckPosition} from '../truck-position';
import type {ScheduleTruck} from '../lib/schedule-contract';
let calls=0;
const originalFetch=window.fetch;
window.fetch=async(input,options)=>{
  if(input!=='/api/fleet-location-address')return originalFetch(input,options);
  calls++;
  const {latitude}=JSON.parse(String(options?.body));
  if(latitude===31)return Response.json({address:null,retryAfterMs:60000});
  if(calls===1)return Response.json({address:null,retryAfterMs:1000});
  return Response.json({address:'100 Example Street, Example City, Louisiana'});
};
function Fixture(){
  const [truck,setTruck]=useState('Truck 9'),[latitude,setLatitude]=useState(30);
  return <main style={{fontFamily:'sans-serif',maxWidth:380,padding:16}}><h1>Address recovery</h1><strong>{truck}</strong><dl><TruckPosition truck={{truck,latitude,longitude:-90} as ScheduleTruck}/></dl><button onClick={()=>setLatitude(31)}>Move truck while lookup waits</button><button onClick={()=>setTruck('Truck 4')}>Select another truck</button></main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
