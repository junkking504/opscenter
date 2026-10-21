import assert from 'node:assert/strict';
import {installWaypointCodeRoutes,isWaypointCodeEcho,codeText} from './operations-waypoint-bridge.mjs';
const handlers=new Map();let calls=0,mode='ok';
const socket={user:{id:'15045550199:1@s.whatsapp.net'},sendMessage:async(to,body)=>{calls++;assert.equal(to,'15045550100@s.whatsapp.net');assert.deepEqual(body,{text:codeText('012345')});if(mode==='throw')throw Error('synthetic');return {key:{id:'synthetic'}};}};
const app={get:(p,f)=>handlers.set(p,f),post:(p,f)=>handlers.set(p,f)};
installWaypointCodeRoutes(app,()=>({socket,connected:true}),()=>{});
function response(){return {code:200,body:null,status(code){this.code=code;return this;},json(body){this.body=body;return this;}};}
const body={account:'15045550199',to:'15045550100@s.whatsapp.net',code:'012345'};
let res=response();await handlers.get('/waypoint-code/send')({body:{...body,account:'15045550198'}},res);assert.equal(res.code,409);assert.equal(calls,0);
res=response();await handlers.get('/waypoint-code/send')({body:{...body,to:'group@g.us'}},res);assert.equal(res.code,400);assert.equal(calls,0);
res=response();await handlers.get('/waypoint-code/send')({body},res);assert.equal(res.body.messageId,'synthetic');assert.equal(calls,1);
mode='throw';res=response();await handlers.get('/waypoint-code/send')({body},res);assert.equal(res.code,500);assert.equal(calls,2);
for(const message of [{conversation:codeText('012345')},{ephemeralMessage:{message:{extendedTextMessage:{text:codeText('012345')}}}}])assert.equal(isWaypointCodeEcho({key:{fromMe:true},message}),true);
assert.equal(isWaypointCodeEcho({key:{fromMe:false},message:{conversation:codeText('012345')}}),false);
assert.equal(isWaypointCodeEcho({key:{fromMe:true},message:{conversation:'Normal owner message'}}),false);
console.log('PASS bridge: connected sender pinning, direct-only recipient, leading-zero code, acceptance, uncertain errors, code-echo suppression including restart history. No live messaging.');
