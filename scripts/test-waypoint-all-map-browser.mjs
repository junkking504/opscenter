import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {build} from 'esbuild';
import {chromium,expect} from '@playwright/test';
const repo=process.cwd();
const source=`
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import './app/globals.css';import Map from './app/crew-jobs/appointment-map';
import {managerMapAppointments} from './lib/waypoint-map';
const row=(id,truck,status,location)=>({recordId:id,customerName:id,address:'Sample address',truck,status,location});
const rows=[row('Scheduled truck 4','Truck 4','Confirmed',{latitude:29.955,longitude:-90.075}),row('Completed truck 6','Truck 6','Completed',{latitude:29.964,longitude:-90.067}),row('Cancelled shared location','','Cancelled',{latitude:29.964,longitude:-90.067}),{...row('Unassigned approximate','','Confirmed',null),mapFallback:{location:{latitude:29.95,longitude:-90.06}}},row('Missing address','Truck 2','Confirmed',null)];
const appointments=managerMapAppointments(rows);
function App(){const [selected,setSelected]=useState('');return <main style={{maxWidth:680,margin:'auto',padding:16,background:'#f6f7f1',color:'#25312c'}}><h1>Waypoint · sample appointments</h1><Map appointments={appointments} onSelect={setSelected}/><p role='status'>Selected: {selected || 'none'}</p></main>;}
createRoot(document.getElementById('root')).render(<App/>);`;
const result=await build({stdin:{contents:source,resolveDir:repo,loader:'tsx'},bundle:true,write:false,loader:{'.png':'dataurl'},outdir:'out',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'}});
const html=`<!doctype html><title>Waypoint all-appointments preview</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>${result.outputFiles.find(f=>f.path.endsWith('.css')).text}</style><div id="root"></div><script>${result.outputFiles.find(f=>f.path.endsWith('.js')).text}</script>`;
const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(html);});
await new Promise(resolve=>server.listen(process.argv.includes('--serve')?3199:0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
if(process.argv.includes('--serve')){console.log(origin);await new Promise(()=>{});}
const browser=await chromium.launch({headless:true});
try{
 for(const width of [320,390,1440]){
  const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://tile.openstreetmap.org/**',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#e5eadf"/></svg>'}));
  await page.goto(origin);
  await expect(page.getByText('4 mapped · 1 without a map location')).toBeVisible();
  await expect(page.locator('.leaflet-marker-icon')).toHaveCount(3);
  await page.locator('.leaflet-marker-icon[title*="Scheduled truck 4"]').click();
  await expect(page.getByRole('status').filter({hasText:'Selected:'})).toHaveText('Selected: Scheduled truck 4');
  const shared=page.locator('.leaflet-marker-icon[title*="Completed truck 6"]');
  await expect(shared).toHaveText('2');await shared.click();
  await page.getByRole('button',{name:/T6✓ · Completed truck 6/}).click();
  await expect(page.getByRole('status').filter({hasText:'Selected:'})).toHaveText('Selected: Completed truck 6');
  await page.getByRole('button',{name:/U× · Cancelled shared location/}).click();
  await expect(page.getByRole('status').filter({hasText:'Selected:'})).toHaveText('Selected: Cancelled shared location');
  await page.locator('.leaflet-popup-close-button').click();
  const approximate=page.locator('.leaflet-marker-icon[title*="Unassigned approximate"]');
  await expect(approximate).toHaveAttribute('title',/Approximate location/);await approximate.click();
  await expect(page.getByRole('status').filter({hasText:'Selected:'})).toHaveText('Selected: Unassigned approximate');
  await page.getByText('Appointments without a map location (1)',{exact:true}).click();
  await page.getByRole('button',{name:/Missing address/}).click();
  await expect(page.getByRole('status').filter({hasText:'Selected:'})).toHaveText('Selected: Missing address');
  const expand=page.getByRole('button',{name:'Full map',exact:true});await expand.click();
  await expect(page.getByRole('button',{name:'Compact map'})).toHaveAttribute('aria-expanded','true');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.deepEqual(errors,[]);
  if(width===390&&process.env.WAYPOINT_TEST_ARTIFACTS){fs.mkdirSync(process.env.WAYPOINT_TEST_ARTIFACTS,{recursive:true});await page.screenshot({path:path.join(process.env.WAYPOINT_TEST_ARTIFACTS,'waypoint-all-appointments-390.png'),fullPage:true});}
  console.log('PASS all-appointments map '+width+'px: all trucks/statuses, co-location selection, approximate and missing locations, expansion, no overflow; map tiles mocked.');
  await page.close();
 }
}finally{await browser.close();server.close();}
