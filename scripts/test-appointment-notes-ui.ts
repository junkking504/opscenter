import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {chromium} from 'playwright';

async function main() {
 const notes = [
  'Remove sofa and recliner.\nLeave the baby crib inside. (8/7/2026 9:43:18 AM , Example Agent)',
  'Appointment moved from 09/01/2026, 08:00 AM - 09:00 AM to 09/11/2026, 08:00 AM - 10:00 AM (8/31/2026 8:26:46 AM , Example Dispatcher)',
  'Call Summary: Customer confirmed the time. Action Details: Call before arrival. (9/10/2026 4:34:49 PM , Example Caller)',
  'Keep literal <b>text</b> and an unfamiliar date (yesterday, Agent).',
  'Very long source text: '+ 'unbroken'.repeat(70),
 ];
 const output=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import Notes from './desktop-ui/appointment-notes';createRoot(document.getElementById('root')).render(<><Notes notes={${JSON.stringify(notes)}}/><Notes notes={[]}/></>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,outdir:'fixture',jsx:'automatic',alias:{react:process.cwd()+'/desktop-ui/node_modules/react','react-dom':process.cwd()+'/desktop-ui/node_modules/react-dom'}});
 const js=output.outputFiles.find(file=>file.path.endsWith('.js'))!.text,css=output.outputFiles.find(file=>file.path.endsWith('.css'))!.text;
 const server=createServer((req,res)=>{if(req.url==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(js);return;}res.setHeader('Content-Type','text/html');res.end(`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{font-family:Arial;margin:12px}${css}</style></head><body><div id="root"></div><script src="/app.js"></script></body></html>`);});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true});
 try {for(const width of [320,390,620]) {
  const page=await browser.newPage({viewport:{width,height:950}});
  await page.goto(`http://127.0.0.1:${(server.address() as {port:number}).port}`);
  const section=page.getByRole('region',{name:'Appointment notes',exact:true}).first();
  await section.locator('article').first().waitFor();
  assert.equal(await section.locator(':scope > ol > li').count(),4);
  assert.equal(await section.locator('article p').first().innerText(),'Remove sofa and recliner.\nLeave the baby crib inside.');
  assert.match(await section.locator('article header').first().innerText(),/8\/7\/2026 9:43:18 AM\s+Example Agent/);
  assert.equal(await section.locator('details').getAttribute('open'),null);
  assert.equal(await section.getByText('Call Summary: Customer confirmed the time. Action Details: Call before arrival.',{exact:true}).isVisible(),true);
  assert.equal(await section.getByText(notes[3],{exact:true}).isVisible(),true);
  await section.locator('summary').click();
  assert.equal(await section.locator('details article p').isVisible(),true);
  assert.match(await section.locator('details').innerText(),/Appointment moved from 09\/01\/2026/);
  assert.equal(await page.getByText('No notes recorded.',{exact:true}).isVisible(),true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'No horizontal overflow');
  await page.screenshot({path:`/tmp/appointment-notes-${width}.png`,fullPage:true});await page.close();
 }console.log('Appointment notes passed: separate entries, full text, date/author, expandable move history, unknown formats, empty state and 320–620px layout.');}
 finally {await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()));}
}
void main();
