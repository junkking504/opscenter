/** Explicit local operator test, never invoked by startup, web requests or builds. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readPushoverApproval, reservePushover, postPushover } from '../lib/pushover-transport';

async function main(){
 const args=process.argv.slice(2),file=process.env.OPSCENTER_PUSHOVER_CONFIG;
 if(process.env.OPSCENTER_RUNTIME!=='MISSION_CONTROL'||!file||args.length!==3||args[0]!=='--apply'||args[1]!=='--approval-reference')throw Error('explicit_setup_test_required');
 const {approval:a,hash}=readPushoverApproval(file,Date.now());
 if(args[2]!==a.approvalReference)throw Error('approval_reference_mismatch');
 const receipt=file+'.setup-test.json';
 // Exclusive marker makes this one-shot even after a timeout or process crash.
 const fd=fs.openSync(receipt,'wx',0o600);
 try{fs.writeFileSync(fd,JSON.stringify({status:'reserved',at:new Date().toISOString(),approvalReference:a.approvalReference}));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 const directory=fs.openSync(path.dirname(receipt),'r');
 try{fs.fsyncSync(directory);}finally{fs.closeSync(directory);}
 const deadline=Math.min(Date.now()+8000,Date.parse(a.expiresAt));
 const authorized=async()=>{
  try{return Date.now()<deadline&&readPushoverApproval(file,Date.now()).hash===hash;}catch{return false;}
 };
 let status='uncertain';
 try{
  reservePushover(file,a);
  const validation=await postPushover('/1/users/validate.json',new URLSearchParams({token:a.token,user:a.user,device:a.device}),authorized,deadline);
  if(validation.status!==200||validation.body.status!==1||validation.body.group===1||!Array.isArray(validation.body.devices)||validation.body.devices.length!==1||validation.body.devices[0]!==a.device){status='rejected_before_message';throw Error();}
  const response=await postPushover('/1/messages.json',new URLSearchParams({token:a.token,user:a.user,device:a.device,
   title:'OpsCenter — Setup test',message:'OpsCenter is connected to Pushover. This is your setup sound test.',priority:'0',ttl:'300',
   url:'https://ops.junk-king.app/desktop',url_title:'Open in OpsCenter'}),authorized,deadline);
  status=response.status===200&&response.body.status===1?'accepted':'rejected';
 }finally{
  const result={status,at:new Date().toISOString(),approvalReference:a.approvalReference,
   recipientHash:createHash('sha256').update(a.user+':'+a.device).digest('hex')};
  // An interrupted write still leaves the exclusive marker, preventing replay.
  fs.writeFileSync(receipt,JSON.stringify(result),{mode:0o600});
  console.log(JSON.stringify({setupTest:status,handsetReceipt:'requires user confirmation'}));
 }
 if(status!=='accepted')process.exitCode=1;
}
main().catch(()=>{console.error('Setup test stopped; inspect its private receipt. No automatic retry.');process.exitCode=1;});
