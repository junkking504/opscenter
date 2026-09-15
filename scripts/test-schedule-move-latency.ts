import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import { assignmentSessionState } from './junkware-assignment-session';

async function main() {
  const original = { cookies: [{name:'ASP.NET_SessionId',value:'collector'}, {name:'.ASPXAUTH',value:'synthetic-auth'}], origins: [] };
  const isolated = assignmentSessionState(original);
  assert.deepEqual(isolated.cookies, [original.cookies[1]], 'Keep authentication while removing the shared server session');
  assert.equal(original.cookies.length, 2, 'Do not mutate collector state');

  const output = await build({stdin:{contents:`
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {MoveConfirmation} from './desktop-ui/schedule-controls';
    const job={recordId:'fixture',jkNumber:'JK1234',customerName:'Synthetic appointment',truck:'Truck 1',appointmentTime:'9:00 AM–10:00 AM',appointmentStartMinutes:540,appointmentEndMinutes:600,version:'a'.repeat(64)};
    function App(){const [done,setDone]=React.useState(false);return done?<p>Board refreshed</p>:<MoveConfirmation move={{job,truck:'Truck 2',start:540,conflicts:[]}} date="2026-09-15" cancel={()=>{}} saved={()=>setDone(true)} onBusyChange={()=>{}}/>;}
    createRoot(document.getElementById('root')).render(<App/>);
  `,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,outdir:'fixture',jsx:'automatic',alias:{react:process.cwd()+'/desktop-ui/node_modules/react','react-dom':process.cwd()+'/desktop-ui/node_modules/react-dom'}});
  const js=output.outputFiles.find(file=>file.path.endsWith('.js'))!.text;
  const css=output.outputFiles.find(file=>file.path.endsWith('.css'))!.text;
  const server=createServer((req,res)=>{
    res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':'text/html');
    res.end(req.url==='/app.js'?js:`<html><head><style>${css}</style></head><body><div id="root"></div><script src="/app.js"></script></body></html>`);
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true});
  try {
    for(const mode of ['verified','recovered','unresolved','manual-check']) {
      const page=await browser.newPage(); let posts=0,reads=0;
      await page.route('**/api/desktop/schedule/operations*',async route=>{
        const post=route.request().method()==='POST'; if(post)posts++;else reads++;
        const status=post ? mode==='verified'?'verified':'uncertain' : mode==='unresolved'?'uncertain':'verified';
        await route.fulfill({json:{receipt:{requestId:'synthetic-request',status,message:status==='verified'?'Source verified':'Source verification pending'}}});
      });
      await page.goto(`http://127.0.0.1:${(server.address() as {port:number}).port}`);
      await page.getByRole('button',{name:'Confirm Move',exact:true}).click();
      if(mode==='manual-check') await page.getByRole('button',{name:'Check Saved Result'}).click();
      if(mode==='unresolved') {
        await expect.poll(()=>reads,{timeout:10000}).toBeGreaterThan(0);
        await expect(page.getByText('Board refreshed')).toHaveCount(0);
        await expect(page.getByRole('button',{name:'Confirm Move',exact:true})).toHaveCount(0);
      } else {
        await expect(page.getByText('Board refreshed')).toBeVisible({timeout:10000});
        await expect(page.getByRole('dialog')).toHaveCount(0);
      }
      assert.equal(posts,1,`${mode}: confirmation and polling must never resubmit`);
      await page.close();
    }
    console.log('Move latency regressions passed: isolated source session; immediate, polled, and manual verification refresh the board; uncertain moves stay protected; one POST only.');
  } finally { await browser.close(); await new Promise<void>(resolve=>server.close(()=>resolve())); }
}
void main();
