import assert from 'node:assert/strict';
import { build } from 'esbuild';

async function main() {
  const state = { receipt: {requestId:'synthetic',action:'move',status:'uncertain',actor:'fixture'}, callbacks: [] as Array<()=>Promise<void>>, reads:0 };
  const globals = globalThis as typeof globalThis & { moveResponseFixture?: typeof state };
  globals.moveResponseFixture=state;
  const stubs = `
    const state=globalThis.moveResponseFixture;
    export const isDesktopWriteOriginAllowed=()=>true;
    export const cookies=async()=>({get:()=>({value:'synthetic'})});
    export const after=callback=>state.callbacks.push(callback);
    export const AUTH_SESSION_COOKIE='fixture';
    export const verifyAuthSessionCookie=async()=>({email:'fixture',role:'admin'});
    export const authorizeOpsRequest=()=>({allowed:true});
    export const readDesktopSchedule=()=>({appointments:[]});
    export const parseScheduleOperation=value=>value;
    export const executeScheduleOperation=async()=>state.receipt;
    export const readScheduleReceipt=async()=>state.receipt;
    export const automaticallyCheckMove=async()=>{state.reads++;throw new Error('Slow or unavailable source');};
    export const reconcileCloseoutReceipt=async()=>state.receipt;
    export const reconcileMoveReceipt=async()=>{state.reads++;return state.receipt;};
    export const reconcileRescheduleReceipt=async()=>state.receipt;
    export const reconcileStaleRescheduleForAppointment=async()=>null;
    export const assertRecoveredScheduleMatches=()=>{};
    export class PendingScheduleOperationError extends Error {}
    export const readJunkwareTruckAssignment=async()=>{};
    export const rescheduleAppointment=async()=>{};
    export const withJunkwareAppointmentSyncLock=(_id,run)=>run();
    export const junkwareJobCloseout=async()=>({});
    export const POST=async()=>Response.json({});
  `;
  try {
    const result=await build({entryPoints:['app/api/desktop/schedule/operations/route.ts'],bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'synthetic-dependencies',setup(builder){
      builder.onResolve({filter:/.*/},args=>args.kind==='entry-point'?undefined:{path:args.path,namespace:'fixture'});
      builder.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:stubs,loader:'js'}));
    }}]});
    const route=await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
    for(const method of ['POST','GET']) {
      state.callbacks=[];state.reads=0;
      const request=new Request('http://localhost/api/desktop/schedule/operations?requestId=synthetic',method==='POST'?{method,body:JSON.stringify({action:'move',recordId:'fixture',values:{}})}:{});
      const response=await route[method](request);
      assert.equal((await response.json()).receipt.status,'uncertain');
      assert.equal(state.reads,0,`${method} must return the durable receipt before source recovery`);
      assert.equal(state.callbacks.length,1);
      await state.callbacks[0]();
      assert.equal(state.reads,1,'Deferred recovery runs once and contains source errors');
    }
    state.callbacks=[];state.reads=0;
    await route.GET(new Request('http://localhost/api/desktop/schedule/operations?requestId=synthetic&reconcile=1'));
    assert.equal(state.reads,1,'Explicit Check Saved Result still performs the requested source read');
    assert.equal(state.callbacks.length,0);
    console.log('Move HTTP response tests passed: POST and polling return before automatic source recovery; source errors are contained; explicit reconciliation still waits.');
  } finally { delete globals.moveResponseFixture; }
}
void main();
