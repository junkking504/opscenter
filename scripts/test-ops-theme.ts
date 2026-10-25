import assert from 'node:assert/strict';
import vm from 'node:vm';
import { OPS_THEME_BOOTSTRAP } from '../lib/ops-theme';

function browser({ saved = null, dark = false, blocked = false, hostname = 'ops.junk-king.app', pathname = '/desktop' }: {saved?: string|null;dark?: boolean;blocked?: boolean;hostname?: string;pathname?: string} = {}) {
  const attrs = new Map<string,string>(); const stored = new Map<string,string>(); if(saved)stored.set('opscenter.theme.v1',saved);
  const listeners = new Map<string,(event: {key:string|null;newValue:string|null})=>void>(); let mediaListener = () => {};
  const media = { matches: dark, addEventListener: (_:string, callback:()=>void) => { mediaListener = callback; } };
  const window = { matchMedia: () => media, dispatchEvent: () => {}, addEventListener: (name:string,callback:()=>void) => listeners.set(name,callback), OpsTheme: undefined as undefined|{get:()=>string;set:(value:string)=>boolean} };
  vm.runInNewContext(OPS_THEME_BOOTSTRAP,{window,document:{querySelectorAll:()=>[],addEventListener:()=>{},documentElement:{style:{},setAttribute:(k:string,v:string)=>attrs.set(k,v)}},location:{hostname,pathname},localStorage:{getItem:(key:string)=>{if(blocked)throw Error('denied');return stored.get(key)||null;},setItem:(key:string,value:string)=>{if(blocked)throw Error('denied');stored.set(key,value);}},Event:class{}});
  return {attrs,stored,window,system:(value:boolean)=>{media.matches=value;mediaListener();},storage:(newValue:string|null,key:string|null='opscenter.theme.v1')=>listeners.get('storage')?.({key,newValue})};
}
const fresh=browser({dark:true});assert.equal(fresh.attrs.get('data-ops-theme'),'dark');assert.equal(fresh.window.OpsTheme?.get(),'system');fresh.system(false);assert.equal(fresh.attrs.get('data-ops-theme'),'light');
assert.equal(fresh.window.OpsTheme?.set('dark'),true);assert.equal(fresh.stored.get('opscenter.theme.v1'),'dark');fresh.system(false);assert.equal(fresh.attrs.get('data-ops-theme'),'dark');
assert.equal(fresh.window.OpsTheme?.set('invalid'),false);assert.equal(fresh.window.OpsTheme?.get(),'dark');
fresh.storage('light');assert.equal(fresh.attrs.get('data-ops-theme'),'light');fresh.storage(null);assert.equal(fresh.window.OpsTheme?.get(),'system');
assert.equal(browser({saved:'light',dark:true}).attrs.get('data-ops-theme'),'light');assert.equal(browser({saved:'invalid',dark:true}).window.OpsTheme?.get(),'system');
const denied=browser({blocked:true,dark:true});assert.equal(denied.attrs.get('data-ops-theme'),'dark');assert.equal(denied.window.OpsTheme?.set('light'),false);assert.equal(denied.attrs.get('data-ops-theme'),'light');
for(const pathname of ['/crew-jobs','/crew-jobs/100','/crew-login','/set-password','/my-pay','/truck-inspection'])assert.equal(browser({pathname,dark:true}).window.OpsTheme,undefined);
for(const hostname of ['waypoint.junk-king.app','kingpin.junk-king.app','jobs.junk-king.app','convoy.junk-king.app','crew.junk-king.app'])assert.equal(browser({hostname,pathname:'/login',dark:true}).window.OpsTheme,undefined);
assert.ok(browser({pathname:'/crew-phones'}).window.OpsTheme);assert.ok(browser({pathname:'/crew-dispatch'}).window.OpsTheme);
console.log('Theme persistence, explicit/system precedence, storage failure, cross-tab events and separate-app exclusions passed.');
