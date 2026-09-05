import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { downloadWhatsAppImage } from "@/lib/whatsapp-photo-media";
import { whatsappMediaFile, type WhatsAppImageMessage } from "@/lib/whatsapp-job-photo-queue";
async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "photo-media-"));
  const keys = ["WHATSAPP_JOB_PHOTO_STATE_DIR", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_ACCESS_TOKEN_BASE64", "WHATSAPP_GRAPH_API_VERSION"];
  const saved = Object.fromEntries(keys.map(k => [k, process.env[k]]));const originalFetch = globalThis.fetch;
  process.env.WHATSAPP_JOB_PHOTO_STATE_DIR = root;process.env.WHATSAPP_PHONE_NUMBER_ID = "123";
  process.env.WHATSAPP_ACCESS_TOKEN = "test-only";delete process.env.WHATSAPP_ACCESS_TOKEN_BASE64;process.env.WHATSAPP_GRAPH_API_VERSION = "v24.0";
  const bytes = Buffer.from([255,216,255,224,0,16,74,70,73,70,0,255,217]);
  const hash = crypto.createHash("sha256").update(bytes).digest("base64");
  const message: WhatsAppImageMessage = {version:1,messageId:"fixture",senderPhone:"5045550101",phoneNumberId:"123",receivedAt:new Date().toISOString(),enqueuedAt:new Date().toISOString(),mediaId:"456",mimeType:"image/jpeg",sha256:hash,caption:""};
  let calls = 0;
  const metadata = {url:"https://lookaside.fbsbx.com/photo",mime_type:"image/jpeg",sha256:hash,file_size:bytes.length};
  const mockMediaResponses = (meta: unknown, body = bytes) => {calls=0;globalThis.fetch=async()=>{calls++;return calls===1 ? new Response(JSON.stringify(meta),{status:200}) : new Response(body,{status:200});};};
  try {
    mockMediaResponses(metadata);
    const file = await downloadWhatsAppImage(message);
    assert.equal(calls,2);assert.deepEqual(fs.readFileSync(file),bytes,"unmatched photo originals can be retained independently of job selection");
    globalThis.fetch = async()=>{throw new Error("Provider media unavailable");};
    assert.equal(await downloadWhatsAppImage(message),file,"retry uses checksum-verified cache when provider is unavailable");
    await assert.rejects(downloadWhatsAppImage({...message,phoneNumberId:"999"}),/mismatch/);
    fs.writeFileSync(file,Buffer.from("corrupt"));
    await assert.rejects(downloadWhatsAppImage(message),/Provider media unavailable/,"corrupt cache is never reused");
    mockMediaResponses(metadata);await downloadWhatsAppImage(message);assert.equal(calls,2,"corrupt cache is replaced by verified source bytes");
    const fresh = {...message,messageId:"different"};
    mockMediaResponses({...metadata,sha256:"invalid"});await assert.rejects(downloadWhatsAppImage(fresh),/checksum/);
    assert.equal(fs.existsSync(whatsappMediaFile(fresh.messageId,fresh.mimeType)),false);
    mockMediaResponses(metadata);await assert.rejects(downloadWhatsAppImage({...fresh,sha256:"wrong-inbound-hash"}),/checksum/);
    mockMediaResponses({...metadata,file_size:6*1024*1024});await assert.rejects(downloadWhatsAppImage(fresh),/5 MB/);assert.equal(calls,1);
    mockMediaResponses({...metadata,url:"https://example.com/photo"});await assert.rejects(downloadWhatsAppImage(fresh),/unexpected media host/);assert.equal(calls,1);
    const invalid = Buffer.from("not an image");mockMediaResponses({...metadata,sha256:crypto.createHash("sha256").update(invalid).digest("base64")},invalid);
    await assert.rejects(downloadWhatsAppImage({...fresh,sha256:""}),/contents/);
    console.log("PASS: original photo caching, retry without provider, checksum and inbox isolation, corrupt cache, size/type/host guards");
  } finally {globalThis.fetch=originalFetch;for(const k of keys){if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];}fs.rmSync(root,{recursive:true,force:true});}
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
