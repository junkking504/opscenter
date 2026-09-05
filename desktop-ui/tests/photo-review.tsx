import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import LivePhotoReview from '../live-photo-review';
import '../app/globals.css';
import type {PhotoReviewRecord, PhotoReviewSnapshot} from '../lib/photo-review-contract';

// Isolated browser fixture. All requests are answered locally with synthetic
// records. No production data, credentials, providers or mutations are used.
let fail=false, partial=false, advanced=false;
window.fetch=async (input,options) => {
  if(options?.method && options.method!=='GET')throw new Error('Fixture forbids writes.');
  const url=new URL(String(input),window.location.origin);
  if(url.pathname!=='/api/desktop/photos')throw new Error('Unexpected fixture request.');
  if(fail)return Response.json({error:'Simulated queue offline.'},{status:503});
  const rows:PhotoReviewRecord[]=Array.from({length:advanced?27:28},(_,i)=>({
    id:i.toString(16).padStart(4,'0').padEnd(64,'0'),state:i===0?'failed':'review',receivedAt:`2026-09-${String(i%4+1).padStart(2,'0')}T15:00:00Z`,outcomeAt:null,jobDate:`2026-09-${String(i%4+1).padStart(2,'0')}`,sender:i===0?'Sender ending 2222':'Sender ending 1111',senderKey:i===0?'sender-two':'sender-one',jk:i===0?'JK7654321':'JK1234567',caption:i===0?'Synthetic after photo':'Synthetic before photo',category:'Before',reason:i===0?'network_media_failure':'sender_not_mapped_to_truck',reasonLabel:i===0?'Media retrieval failed':'Sender mapping needed',nextStep:'Verify the original message and intended appointment before recovery.',attempts:0,previewAvailable:false,sourceHref:null
  }));
  const params=url.searchParams;
  const filtered=rows.filter(row=>(!params.get('state')||params.get('state')==='all'||params.get('state')===row.state)&&(!params.get('reason')||params.get('reason')===row.reason)&&(!params.get('sender')||params.get('sender')===row.senderKey)&&(!params.get('q')||`${row.jk} ${row.caption} ${row.sender}`.toLowerCase().includes(params.get('q')!.toLowerCase())));
  const pages=Math.max(1,Math.ceil(filtered.length/25)),page=Math.min(Number(params.get('page')||1),pages);
  const body:PhotoReviewSnapshot={observedAt:new Date().toISOString(),complete:!partial,unreadable:partial?1:0,unavailableStates:[],counts:{review:rows.length-1,failed:1,incoming:0,processing:0},total:rows.length,filtered:filtered.length,page,pages,records:filtered.slice((page-1)*25,page*25),reasons:[{reason:'sender_not_mapped_to_truck',label:'Sender mapping needed',count:rows.length-1},{reason:'network_media_failure',label:'Media retrieval failed',count:1}],senders:[{key:'sender-one',label:'Sender ending 1111',count:rows.length-1},{key:'sender-two',label:'Sender ending 2222',count:1}]};
  return Response.json(body);
};
function Fixture(){
  const [status,setStatus]=useState('Normal source');
  return <main style={{maxWidth:1200,margin:'24px auto',padding:16}}><h1>Photo review regression fixture</h1><p>Synthetic records only. No uploads or business writes.</p><div style={{display:'flex',gap:16,margin:'16px 0'}}><button onClick={()=>{fail=true;setStatus('Reads will fail');}}>Fail reads</button><button onClick={()=>{fail=false;setStatus('Reads restored');}}>Restore reads</button><button onClick={()=>{partial=true;setStatus('Partial source');}}>Make source incomplete</button><button onClick={()=>{advanced=true;setStatus('Source advanced');}}>Advance queue</button><span>{status}</span></div><LivePhotoReview /></main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
