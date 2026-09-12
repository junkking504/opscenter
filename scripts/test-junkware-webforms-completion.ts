import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from '@playwright/test';
import { clickWithWebFormsCompletion, selectWithWebFormsPostback, selectWithWebFormsCompletion } from './junkware-webforms';

async function main() {
  let posts = 0;
  const html = (mode: string, selected = 'a') => `<!doctype html><html><body>
    <form method="post" ${mode==='multipart'?'enctype="multipart/form-data"':''}><input name="__EVENTTARGET"><input name="__EVENTARGUMENT">
    <select id="Type" name="ctl00$Content$Type" onchange="${['full','multipart'].includes(mode)?"this.form.elements.namedItem('__EVENTTARGET').value=this.name;this.form.submit()":"setTimeout(()=>__doPostBack(this.name),0)"}"><option value="a" ${selected === 'a' ? 'selected' : ''}>A</option><option value="b" ${selected === 'b' ? 'selected' : ''}>B</option></select>
    <input id="FullSave" name="ctl00$Content$Save" type="submit" value="Save">
    <a id="ctl00_Content_Update" href="javascript:__doPostBack('ctl00$Content$Update','')">Update</a>
    <button id="Validation" type="button" onclick="alert('Choose a truck')">Validate</button>
    <div id="spinner" hidden></div><output id="result">${selected}</output></form>
    <script>
      let inFlight = false;
      window.Sys = {WebForms:{PageRequestManager:{getInstance:()=>({get_isInAsyncPostBack:()=>inFlight})}}};
      window.__doPostBack = target => {
        fetch(location.href, {method:'POST',body:new URLSearchParams({__EVENTTARGET:'unrelated','ctl00$Content$Type':document.getElementById('Type').value})});
        // The spinner is initially hidden and the button still enabled.
        setTimeout(async () => {
          inFlight = true;
          await fetch(location.href, {method:'POST',body:new URLSearchParams({__EVENTTARGET:target})});
          setTimeout(()=>{ document.querySelector('#result').textContent='applied'; inFlight=false; },150);
        },200);
      };
    </script></body></html>`;
  const server = createServer(async (request, response) => {
    const mode = new URL(request.url || '/', 'http://localhost').searchParams.get('mode') || 'partial';
    let body = '';
    for await (const chunk of request) body += chunk;
    const fields = new URLSearchParams(body);
    if(mode==='multipart') {for (const part of body.split(/--[^\r\n]+\r\n/)) {const name=part.match(/name="([^"]+)"/)?.[1];const value=part.split('\r\n\r\n')[1]?.split('\r\n')[0];if(name&&value!==undefined)fields.set(name,value);}}
    if (request.method === 'POST') {
      posts++;
      if (fields.get('__EVENTTARGET') === 'unrelated') { response.end('unrelated'); return; }
      await new Promise(resolve => setTimeout(resolve, 200));
      if (mode === 'failure') { response.writeHead(500); response.end('failed'); return; }
    }
    response.setHeader('Content-Type', 'text/html');
    response.end(html(mode, fields.get('ctl00$Content$Type') || 'a'));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as {port:number}).port;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/appointment.aspx`);
    const start = Date.now();
    await clickWithWebFormsCompletion(page, '#ctl00_Content_Update', 'navigator update');
    assert.equal(await page.locator('#result').textContent(), 'applied');
    assert.ok(Date.now() - start >= 500, 'Must await matching POST and applied DOM, not hidden spinner or unrelated POST');
    assert.equal(posts, 2);
    await page.goto(`http://127.0.0.1:${port}/appointment.aspx`);
    await selectWithWebFormsCompletion(page, '#Type', 'b', 'charge selection');
    assert.equal(await page.locator('#result').textContent(), 'applied');
    assert.equal(await page.locator('#Type').inputValue(), 'b');
    await page.goto(`http://127.0.0.1:${port}/appointment.aspx?mode=full`);
    await selectWithWebFormsPostback(page, '#Type', 'b', 'appointment type');
    assert.equal(await page.locator('#result').textContent(), 'b');
    await clickWithWebFormsCompletion(page, '#FullSave', 'full save');
    assert.equal(await page.locator('#result').textContent(), 'b');
    for (const mode of ['full','multipart']) {
      await page.goto(`http://127.0.0.1:${port}/appointment.aspx?mode=${mode}`);
      await selectWithWebFormsCompletion(page, '#Type', 'b', 'native selection');
      assert.equal(await page.locator('#result').textContent(),'b');
      await clickWithWebFormsCompletion(page,'#FullSave','native save');
    }
    await assert.rejects(clickWithWebFormsCompletion(page, '#Validation', 'save'), /Choose a truck/);
    await page.goto(`http://127.0.0.1:${port}/appointment.aspx?mode=failure`);
    await assert.rejects(clickWithWebFormsCompletion(page, '#ctl00_Content_Update', 'save'), /did not finish/);
    await page.close();
    console.log('WebForms browser tests passed: delayed partial postback, underscore ID/dollar event target, unrelated response ignored, DOM completion, full navigation, dropdown postback, validation dialog, HTTP failure. Local fixture only.');
  } finally {
    await browser.close();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}
void main();
