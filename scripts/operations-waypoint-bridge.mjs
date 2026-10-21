// Narrow local bridge extension. No credentials, body logging, model calls or retries.
export const codeText = code => `Waypoint access code: ${code}\nExpires in 10 minutes. Do not share this code.`;
export function isWaypointCodeEcho(message) {
  if (!message?.key?.fromMe) return false;
  let body=message.message;
  for(let depth=0;body && depth<8;depth++) {
    const text=body.conversation || body.extendedTextMessage?.text;
    if(typeof text==='string' && /^Waypoint access code: \d{6}\nExpires in 10 minutes\. Do not share this code\.$/.test(text))return true;
    body=body.ephemeralMessage?.message || body.viewOnceMessage?.message || body.viewOnceMessageV2?.message || body.documentWithCaptionMessage?.message;
  }
  return false;
}
const accountOf = socket => typeof socket?.user?.id==='string' ? socket.user.id.split(':')[0].split('@')[0] : '';
export function installWaypointCodeRoutes(app, current, track) {
  app.get('/waypoint-code/health',(_request,response)=>{
    const {socket,connected}=current();
    response.json({status:connected?'connected':'disconnected',account:accountOf(socket)});
  });
  app.post('/waypoint-code/send',async(request,response)=>{
    const {account,to,code}=request.body || {};
    if(!/^1[2-9]\d{9}$/.test(account || '') || !/^1[2-9]\d{9}@s\.whatsapp\.net$/.test(to || '') || !/^\d{6}$/.test(code || '') || Object.keys(request.body).some(k=>!['account','to','code'].includes(k)))return response.status(400).json({rejected:true});
    // Capture and verify the same socket used for this send, with no await between.
    const {socket,connected}=current();
    if(!connected || !socket || accountOf(socket)!==account)return response.status(409).json({rejected:true});
    let timer;
    try {
      const result=await Promise.race([socket.sendMessage(to,{text:codeText(code)}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Unconfirmed')),20000);})]);
      if(typeof result?.key?.id!=='string' || !result.key.id)throw new Error('Missing acceptance');
      track(result); // IDs only; do not remember the body in the bridge message store.
      return response.json({success:true,messageId:result.key.id});
    }catch{return response.status(500).json({uncertain:true});}
    finally{clearTimeout(timer);}
  });
}
