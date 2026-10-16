import {createHash} from 'node:crypto';
import sharp from 'sharp';
import type {Page} from '@playwright/test';
import {parseSignature,type SignatureDrawing,type SignatureEvidence} from '../lib/amazon-closeout';
import {clickWithWebFormsCompletion} from './junkware-webforms';

export async function signatureImage(drawing:SignatureDrawing) {
  const {strokes}=parseSignature(drawing);
  const lines=strokes.map(stroke=>`<polyline points="${stroke.map(point=>point.join(',')).join(' ')}"/>`).join('');
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="200"><rect width="600" height="200" fill="white"/><g fill="none" stroke="#111111" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${lines}</g></svg>`)).png().toBuffer();
}
export async function signatureHash(bytes:Buffer) {
  const {data,info}=await sharp(bytes,{limitInputPixels:2_000_000}).flatten({background:'#fff'}).removeAlpha().raw().toBuffer({resolveWithObject:true});
  let ink=0;
  for(let i=0;i<data.length;i+=info.channels)if(data[i]<220 && data[i+1]<220 && data[i+2]<220)ink++;
  if(ink<12)throw new Error('The saved signature is blank. Please capture the customer signature.');
  return createHash('sha256').update(`${info.width}:${info.height}:`).update(data).digest('hex');
}
export async function readSignature(page:Page):Promise<SignatureEvidence> {
  const appointmentId=new URL(page.url()).searchParams.get('id') || '';
  const image=page.locator('#ctl00_Content_SignatureImage');
  if(!await image.count())return null;
  const src=await image.getAttribute('src') || '';
  if(!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(src) || src.length>3_000_000)throw new Error('JunkWare signature evidence is unavailable. Reload the appointment.');
  return {appointmentId,sha256:await signatureHash(Buffer.from(src.split(',')[1],'base64'))};
}
/** Uses JunkWare's dedicated signature save before staging financial fields.
 * A lost response is never replayed; the closeout receipt stays uncertain. */
export async function saveSignature(page:Page,drawing:SignatureDrawing) {
  const image=await signatureImage(drawing),expected=await signatureHash(image),url=page.url();
  const existing=await readSignature(page);
  if(existing?.sha256===expected)return existing;
  if(existing)throw new Error('A signature is already saved. Reload the appointment before changing it.');
  await page.locator('#ctl00_Content_SignatureHF').evaluate((node,value)=>{(node as HTMLInputElement).value=value;},`data:image/png;base64,${image.toString('base64')}`);
  // The native submit is normally hidden behind the capture toolbar.
  await page.locator('#ctl00_Content_SaveSignatureBtn').evaluate(node=>{(node as HTMLElement).style.display='block';for(let p=node.parentElement;p;p=p.parentElement){p.style.display='block';p.classList.remove('collapse');}});
  await clickWithWebFormsCompletion(page,'#ctl00_Content_SaveSignatureBtn','the customer signature save');
  await page.goto(url,{waitUntil:'domcontentloaded'});
  const saved=await readSignature(page);
  if(saved?.sha256!==expected)throw new Error('JunkWare did not retain the captured signature. Check Saved Result before another closeout.');
  return saved;
}
