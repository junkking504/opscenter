import React from 'react';
import {createRoot} from 'react-dom/client';
import LiveSearch from '../live-search';
import '../app/globals.css';
import '../live-responsive.css';
import '../workspace-density.css';
const rows=Array.from({length:12},(_,i)=>({id:'job:'+i,type:'job',title:'Synthetic Customer · JK1000'+String(i).padStart(3,'0'),subtitle:'2026-09-09 · 9:00–10:00 AM · Job · Confirmed · Truck 2',source:'JunkWare appointment',href:'/jobs?date=2026-09-09&appointment='+String(1000+i)+'&q=JK1000'+String(i).padStart(3,'0')}));
window.fetch=async (input,init)=>{
 const url=new URL(String(input),location.origin),query=url.searchParams.get('q'),scope=url.searchParams.get('scope'),limit=Number(url.searchParams.get('limit')||10);
 if(url.pathname==='/api/desktop/knowledge/answer')return Response.json({answer:null});
 if(url.pathname==='/api/desktop/ask-opsbot/local'){
   const question=JSON.parse(String(init?.body||'{}')).question;
   if(question==='html local')return new Response('<!DOCTYPE html><title>Gateway failure</title>',{status:502,headers:{'Content-Type':'text/html'}});
   return Response.json({matched:false});
 }
 if(url.pathname==='/api/desktop/ask-opsbot'){
   if(init?.method==='POST')return new Response('<!DOCTYPE html><title>Gateway failure</title>',{status:502,headers:{'Content-Type':'text/html'}});
   return Response.json({available:true,reason:null,remaining:50,limit:50});
 }
 if(query==='html search')return new Response('<!DOCTYPE html><title>Gateway failure</title>',{status:502,headers:{'Content-Type':'text/html'}});
 if(query==='expired')return new Response('<html>Sign in</html>',{status:401});
 if(query==='empty'||query?.startsWith('html '))return Response.json({results:[],appointmentTotal:0,coverage:{dateCount:2,from:'2026-09-08',to:'2026-09-09'}});
 if(query==='slow'){await new Promise(resolve=>setTimeout(resolve,700));return Response.json({results:[{...rows[0],title:'Stale Response'}]});}
 if(query==='fail')return Response.json({error:'Source search is unavailable. Try again.'},{status:503});
 const found=scope==='past'?[]:rows;
 return Response.json({results:found.slice(0,limit),appointmentTotal:found.length,hasMore:found.length>limit,today:'2026-09-08',coverage:{dateCount:2,from:scope==='past'?'2026-08-31':'2026-09-08',to:scope==='past'?'2026-08-31':'2026-09-09'}});
};
createRoot(document.getElementById('root')!).render(<main className="ops-live" style={{margin:'12px',width:'min(1000px, calc(100vw - 24px))'}}>
 <header className="topbar"><LiveSearch date="2026-09-01" navigate={()=>{}} disabled={false} finance={true}/></header>
 <section aria-label="Synthetic Schedule Board" style={{position:'relative',zIndex:6,height:650,background:'#dce6de'}}>Synthetic Schedule Board</section>
</main>);
