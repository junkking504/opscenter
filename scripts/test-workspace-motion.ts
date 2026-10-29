import assert from 'node:assert/strict';
import { playWorkspaceMotion, workspaceMotionDirection } from '../desktop-ui/use-workspace-motion';

const groups = [
  {workspace:'Dashboard',pages:[['now'],['control']]},
  {workspace:'Command',pages:[['board'],['calendar'],['customers']]},
  {workspace:'Settings',pages:[['overview']]},
];
const route = (workspace:string,page='overview') => ({workspace,page});
assert.equal(workspaceMotionDirection(route('Dashboard'),route('Command'),groups),1);
assert.equal(workspaceMotionDirection(route('Settings'),route('Command'),groups),-1);
assert.equal(workspaceMotionDirection(route('Command','board'),route('Command','customers'),groups),1);
assert.equal(workspaceMotionDirection(route('Command','customers'),route('Command','board'),groups),-1);
assert.equal(workspaceMotionDirection(route('Command','legacy'),route('Command','board'),groups),1);

function fixture(reduced=false) {
  let finished!:()=>void;
  let cancelled=0;
  const listeners=new Map<string,()=>void>();
  const changes=new Map<string,()=>void>();
  let frames:Keyframe[]|undefined,options:KeyframeAnimationOptions|undefined;
  const frame={style:{overflowX:''}};
  const preference={matches:reduced,addEventListener:(type:string,callback:()=>void)=>changes.set(type,callback),removeEventListener:(type:string)=>changes.delete(type)};
  const element={parentElement:frame,addEventListener:(type:string,callback:()=>void)=>listeners.set(type,callback),removeEventListener:(type:string)=>listeners.delete(type),animate:(keyframes:Keyframe[],settings:KeyframeAnimationOptions)=>{
    frames=keyframes;options=settings;
    return {finished:new Promise<void>(resolve=>{finished=resolve;}),cancel:()=>{cancelled++;}};
  }};
  const start=(direction:-1|1=1)=>playWorkspaceMotion(element as unknown as HTMLElement,direction,preference as unknown as MediaQueryList);
  return {start,frame,preference,changes,listeners,finish:()=>finished(),frames:()=>frames,options:()=>options,cancelled:()=>cancelled};
}

async function main(){
const enter=fixture();const stop=enter.start();
assert.deepEqual(enter.frames(),[{transform:'translateX(18px)',opacity:0.94},{transform:'translateX(0)',opacity:1}]);
assert.equal(enter.options()?.duration,240);
assert.equal(enter.options()?.delay,undefined,'navigation has no artificial delay');
assert.equal(enter.frame.style.overflowX,'clip','motion cannot introduce horizontal page scrolling');
enter.finish();await Promise.resolve();
assert.equal(enter.frame.style.overflowX,'');assert.equal(enter.listeners.size,0);assert.equal(enter.changes.size,0);
stop?.();assert.equal(enter.cancelled(),1,'cleanup is idempotent');

const reverse=fixture();reverse.start(-1);
assert.equal(reverse.frames()?.[0].transform,'translateX(-18px)');
reverse.listeners.get('pointerdown')?.();
assert.equal(reverse.cancelled(),1,'new interaction settles animation before hit targets can move');
assert.equal(reverse.frame.style.overflowX,'');

const reduced=fixture(true);assert.equal(reduced.start(),undefined);assert.equal(reduced.frames(),undefined);
const changed=fixture();changed.start();changed.preference.matches=true;changed.changes.get('change')?.();
assert.equal(changed.cancelled(),1,'changing Reduce Motion cancels an in-flight animation');
assert.equal(changed.frame.style.overflowX,'');
const interrupted=fixture();const cleanup=interrupted.start();cleanup?.();
assert.equal(interrupted.cancelled(),1,'superseded route/unmount cancels previous motion');
console.log('Workspace motion PASS: direction, non-blank frames, no delay, interaction/route interruption, clipping cleanup and reduced motion. Mock animation API, not browser rendering.');

}
void main().catch(error=>{console.error(error);process.exitCode=1;});
