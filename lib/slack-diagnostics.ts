import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
export const SLACK_METHODS = ['refresh', 'conversations.history', 'conversations.replies'] as const;
export const SLACK_REASONS = ['attempt','success','complete','partial','unavailable','rate_limited','cooldown','timeout','network_error','http_error','api_error','invalid_response','missing_cursor','cursor_cycle','invalid_date','not_configured','not_in_channel','channel_not_found','missing_scope','invalid_auth','account_inactive','is_archived'] as const;
export type SlackMethod = typeof SLACK_METHODS[number];
export type SlackReason = typeof SLACK_REASONS[number];
export type SlackReasonCounts = Partial<Record<`${SlackMethod}:${SlackReason}`, number>>;
type Counter = { count: number; durationMs: number; maxDurationMs: number };
export type SlackDiagnosticWindow = { startedAt: string; finishedAt: string; counters: Partial<Record<`${SlackMethod}:${SlackReason}`, Counter>> };
const INTERVAL = 300_000;
const RETENTION = 7 * 86400_000;

function validWindow(value: unknown): value is SlackDiagnosticWindow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as SlackDiagnosticWindow;
  if (Object.keys(row).sort().join(',') !== 'counters,finishedAt,startedAt' ||
      typeof row.startedAt !== 'string' || typeof row.finishedAt !== 'string' ||
      !Number.isFinite(Date.parse(row.startedAt)) || !Number.isFinite(Date.parse(row.finishedAt)) ||
      Date.parse(row.startedAt) > Date.parse(row.finishedAt) ||
      !row.counters || typeof row.counters !== 'object' || Array.isArray(row.counters)) return false;
  const allowed = new Set(SLACK_METHODS.flatMap(method => SLACK_REASONS.map(reason => `${method}:${reason}`)));
  return Object.entries(row.counters).every(([key, counter]) => allowed.has(key) &&
    counter && typeof counter === 'object' && !Array.isArray(counter) &&
    Object.keys(counter).sort().join(',') === 'count,durationMs,maxDurationMs' &&
    Number.isSafeInteger(counter.count) && counter.count >= 0 &&
    Number.isSafeInteger(counter.durationMs) && counter.durationMs >= 0 &&
    Number.isSafeInteger(counter.maxDurationMs) && counter.maxDurationMs >= 0 &&
    counter.maxDurationMs <= counter.durationMs);
}

export function persistSlackWindow(window: SlackDiagnosticWindow, directory = path.join(process.env.OPSCENTER_DATA_DIR || path.join(process.cwd(), 'data'), 'slack', 'digest-diagnostics')): boolean {
  if (!validWindow(window)) throw new Error('Invalid diagnostic window');
  fs.mkdirSync(directory, {recursive:true,mode:0o700});
  if (!fs.lstatSync(directory).isDirectory()) throw new Error('Invalid diagnostic directory');
  const lock = path.join(directory, 'summary.lock');
  let lockFd: number;
  try { lockFd=fs.openSync(lock,'wx',0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    // Fail closed: unlinking a stale path can race a replacement writer's lock.
    // An operator must inspect a crash residue before recovery; never steal it.
    throw new Error('Diagnostic history lock unavailable');
  }
  const lockIdentity=fs.fstatSync(lockFd);
  let temporary: string | undefined;
  try {
    fs.writeFileSync(lockFd,String(process.pid));fs.fsyncSync(lockFd);
    const target=path.join(directory,'summary.json');
    let previous: {schema:number; windows:SlackDiagnosticWindow[]}={schema:1,windows:[]};
    try {
      const info=fs.lstatSync(target);
      if(!info.isFile() || info.isSymbolicLink() || info.size>16*1024*1024)throw new Error('Invalid diagnostic history');
      previous=JSON.parse(fs.readFileSync(target,'utf8'));
      if(!previous || Object.keys(previous).sort().join(',')!=='schema,windows' || previous.schema!==1 || !Array.isArray(previous.windows) || previous.windows.length>2016 || !previous.windows.every(validWindow))throw new Error('Invalid diagnostic history');
    } catch(error) { if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error; }
    const now=Date.parse(window.finishedAt);
    const last=previous.windows.at(-1);
    if(last && now-Date.parse(last.finishedAt)<INTERVAL)return false;
    const windows=previous.windows.filter(w=>Number.isFinite(Date.parse(w.finishedAt)) && Date.parse(w.finishedAt)>=now-RETENTION).slice(-2015);
    windows.push(window);
    temporary=path.join(directory,`summary.${process.pid}.${randomUUID()}.tmp`);
    const output=fs.openSync(temporary,'wx',0o600);
    try { fs.writeFileSync(output,JSON.stringify({schema:1,windows})+'\n');fs.fsyncSync(output); } finally { fs.closeSync(output); }
    fs.renameSync(temporary,target);
    temporary=undefined;
    const directoryFd=fs.openSync(directory,'r');
    try{fs.fsyncSync(directoryFd);}finally{fs.closeSync(directoryFd);}
    return true;
  } finally {
    if (temporary) { try { fs.unlinkSync(temporary); } catch(error) { if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error; } }
    fs.closeSync(lockFd);
    const current=fs.lstatSync(lock);
    if(current.ino===lockIdentity.ino && current.dev===lockIdentity.dev)fs.unlinkSync(lock);
  }
}

export function createSlackDiagnostics(options: {now?:()=>number; persist?:(window:SlackDiagnosticWindow)=>boolean} = {}) {
  const now=options.now || Date.now;
  let started=now(), attempted=started;
  let persistenceUnavailable=false;
  let counters:SlackDiagnosticWindow['counters']={};
  // Private transient credential key: never persisted/logged or returned to the UI.
  const cooldowns=new Map<string,number>();
  const overflowCooldowns=new Map<SlackMethod,number>();
  const key=(token:string,method:SlackMethod)=>`${createHash('sha256').update(token).digest('hex')}:${method}`;
  return {
    record(method:SlackMethod,reason:SlackReason,duration=0) {
      const k=`${method}:${reason}` as const;
      const row=counters[k] ||= {count:0,durationMs:0,maxDurationMs:0};
      const ms=Number.isFinite(duration)?Math.max(0,Math.round(duration)):0;
      row.count++;row.durationMs+=ms;row.maxDurationMs=Math.max(row.maxDurationMs,ms);
    },
    cooling(token:string,method:SlackMethod) {
      for(const [k,until] of cooldowns)if(until<=now())cooldowns.delete(k);
      return Math.max(cooldowns.get(key(token,method))||0,overflowCooldowns.get(method)||0)>now();
    },
    cool(token:string,method:SlackMethod,retryAfter:string|null) {
      const seconds=retryAfter && /^\d+(?:\.\d+)?$/.test(retryAfter.trim())?Number(retryAfter):NaN;
      // Honor a valid server duration; malformed/missing uses a bounded 60s fallback.
      const delay=Number.isFinite(seconds)&&seconds>0?Math.min(seconds*1000,Number.MAX_SAFE_INTEGER-now()):60_000;
      if(cooldowns.size>=64 && !cooldowns.has(key(token,method))) {
        // Keep existing cooldowns; configured production has one bot workspace.
        for(const [k,until]of cooldowns)if(until<=now())cooldowns.delete(k);
        if(cooldowns.size>=64){overflowCooldowns.set(method,Math.max(overflowCooldowns.get(method)||0,now()+delay));return;}
      }
      cooldowns.set(key(token,method),Math.max(cooldowns.get(key(token,method))||0,now()+delay));
    },
    flush() {
      if(!options.persist || now()-attempted<INTERVAL)return;
      attempted=now();
      try {
        if(options.persist({startedAt:new Date(started).toISOString(),finishedAt:new Date(now()).toISOString(),counters})) { counters={};started=now();persistenceUnavailable=false; }
      } catch { persistenceUnavailable=true;console.warn('[slack-diagnostics] aggregate persistence unavailable'); }
    },
    persistenceUnavailable:()=>persistenceUnavailable,
    now,
  };
}
export type SlackDiagnostics = ReturnType<typeof createSlackDiagnostics>;
export function slackDiagnosticDetail(reasons:SlackReasonCounts):string {
  const labels:Record<string,string>={rate_limited:'rate limited',cooldown:'waiting for rate-limit cooldown',timeout:'timed out',network_error:'network failure',http_error:'HTTP failure',api_error:'Slack API failure',invalid_response:'unreadable response',missing_cursor:'missing pagination cursor',cursor_cycle:'repeated pagination cursor',invalid_date:'invalid date',not_configured:'not configured',not_in_channel:'bot is not a channel member',channel_not_found:'channel unavailable',missing_scope:'required permission missing',invalid_auth:'authentication rejected',account_inactive:'bot account inactive',is_archived:'channel archived'};
  return Object.entries(reasons).filter(([key])=>labels[key.split(':')[1]]).map(([key,count])=>{const [method,reason]=key.split(':');return `${method==='conversations.history'?'Channel history':method==='conversations.replies'?'Thread replies':'Refresh'}: ${labels[reason]} (${count})`;}).join('; ');
}
