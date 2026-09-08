import React from 'react';
import {createRoot} from 'react-dom/client';
import LiveSearch from '../live-search';
import '../app/globals.css';
import '../live-responsive.css';
import '../workspace-density.css';
const rows=Array.from({length:12},(_,i)=>({id:'job:'+i,type:'job',title:'Synthetic Customer · JK1000'+String(i).padStart(3,'0'),subtitle:'2026-09-09 · 9:00–10:00 AM · Job · Confirmed · Truck 2',source:'JunkWare appointment',href:'/jobs?date=2026-09-09&appointment='+String(1000+i)+'&q=JK1000'+String(i).padStart(3,'0')}));
window.fetch=async input=>{
 const url=new URL(String(input),location.origin),query=url.searchParams.get('q'),scope=url.searchParams.get('scope'),limit=Number(url.searchParams.get('limit')||10);
 if(query==='slow'){await new Promise(resolve=>setTimeout(resolve,700));return Response.json({results:[{...rows[0],title:'Stale Response'}]});}
 if(query==='fail')return Response.json({error:'Source search is unavailable. Try again.'},{status:503});
 const found=scope==='past'?[]:rows;
 return Response.json({results:found.slice(0,limit),appointmentTotal:found.length,hasMore:found.length>limit,today:'2026-09-08',coverage:{dateCount:2,from:scope==='past'?'2026-08-31':'2026-09-08',to:scope==='past'?'2026-08-31':'2026-09-09'}});
};
createRoot(document.getElementById('root')!).render(<main style={{margin:'40px 30px',width:700}}><LiveSearch date="2026-09-01" navigate={()=>{}} disabled={false} finance={true}/></main>);
