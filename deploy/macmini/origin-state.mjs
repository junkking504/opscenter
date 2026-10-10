import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';

export const DEPLOY_ROOT = '/Users/missioncontrol/opscenter-v2';
export const SLOT_PORTS = {a: 3201, b: 3202};
export const SHA = /^[a-f0-9]{40}$/;
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function privateDirectory(directory, create = false) {
  if (create) fs.mkdirSync(directory, {mode: 0o700});
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid()
      || (stat.mode & 0o077) !== 0 || fs.realpathSync(directory) !== path.resolve(directory)) {
    throw new Error('Deployment state directory ownership or mode is invalid');
  }
}
export function readPrivate(file) {
  privateDirectory(path.dirname(file));
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.uid !== process.getuid() || stat.nlink !== 1
        || (stat.mode & 0o077) !== 0 || stat.size > 4 * 1024 * 1024) throw new Error('Invalid state file');
    return JSON.parse(fs.readFileSync(fd, 'utf8'));
  } finally { fs.closeSync(fd); }
}
export function atomicPrivate(file, value) {
  privateDirectory(path.dirname(file));
  if (fs.existsSync(file)) readPrivate(file);
  const temporary = `${file}.new-${process.pid}-${crypto.randomUUID()}`;
  const fd = fs.openSync(temporary, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value) + '\n'); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  fs.renameSync(temporary, file);
  const dir = fs.openSync(path.dirname(file), fs.constants.O_RDONLY);
  try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
}
export function releasePath(root, sha) {
  if (!SHA.test(sha)) throw new Error('Invalid release SHA');
  const release = path.join(root, 'releases', sha);
  if (fs.realpathSync(release) !== release || !fs.lstatSync(release).isDirectory()) throw new Error('Invalid pinned release');
  const marker = path.join(release, '.opscenter-release');
  if (!fs.lstatSync(marker).isFile() || fs.lstatSync(marker).isSymbolicLink()) throw new Error('Invalid release marker');
  const body = fs.readFileSync(marker, 'utf8');
  if (body.length > 4096 || body.split('\n').filter(row => row.startsWith('commit=')).join('') !== `commit=${sha}`) throw new Error('Release marker mismatch');
  return release;
}
export function validateSlot(value, {root = DEPLOY_ROOT, ports = SLOT_PORTS} = {}) {
  if (value?.version !== 1 || !Object.hasOwn(ports, value.id) || value.port !== ports[value.id]
      || !SHA.test(value.sha) || value.release !== path.join(root, 'releases', value.sha)
      || !/^[a-zA-Z0-9_]+$/.test(value.database || '') || !/^\d{4}_[a-z0-9_]+\.sql$/.test(value.migration || '')) throw new Error('Invalid slot manifest');
  releasePath(root, value.sha);
  if (!value.assets || typeof value.assets !== 'object' || Array.isArray(value.assets)
      || Object.entries(value.assets).some(([name, size]) => staticPath(name) !== name || !Number.isSafeInteger(size) || size < 0)) throw new Error('Invalid immutable asset inventory');
  return value;
}
export function readSlot(stateDir, id, options) {
  if (!['a', 'b'].includes(id)) throw new Error('Unknown slot');
  return validateSlot(readPrivate(path.join(stateDir, `slot-${id}.json`)), options);
}
export function validateGeneration(value, stateDir, options) {
  if (value?.version !== 1 || !Number.isSafeInteger(value.generation) || value.generation < 1
      || !['a','b'].includes(value.slot) || !SHA.test(value.sha)) throw new Error('Invalid active generation');
  const slot = readSlot(stateDir, value.slot, options);
  if (slot.sha !== value.sha) throw new Error('Generation differs from pinned slot');
  return {...value, target: slot};
}
export function request(port, pathname, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const req = http.get({hostname:'127.0.0.1', port, path:pathname, agent:false}, res => {
      const chunks = []; let length = 0;
      res.on('data', chunk => { length += chunk.length; if (length > 1024 * 1024) req.destroy(new Error('Readiness response too large')); else chunks.push(chunk); });
      res.on('error', reject);
      res.on('end', () => resolve({status:res.statusCode, body:Buffer.concat(chunks).toString('utf8')}));
    });
    const timer = setTimeout(() => req.destroy(new Error('Readiness deadline exceeded')), timeoutMs);
    req.on('close', () => clearTimeout(timer)); req.on('error', reject);
  });
}
export function validHealth(health, slot, strict = true) {
  return health?.runtime === 'MISSION_CONTROL' && health.release?.sha === slot.sha
    && typeof health.release.instance === 'string' && health.release.instance.length > 0
    && health.release.stopping === false && Number.isSafeInteger(health.release.pending) && health.release.pending >= 0
    && health.platformKernel?.runtime === 'MISSION_CONTROL' && health.platformKernel.enabled === true
    && health.platformKernel.healthy === true && health.platformKernel.status === 'healthy'
    && health.platformKernel.databaseName === slot.database && health.platformKernel.migrationVersion === slot.migration
    && health.assignmentStoreWritable === true && health.operatorStateWritable === true
    && (!strict || health.ok === true);
}
export async function probeSlot(slot, {strict = true, timeoutMs = 5000, assets = true} = {}) {
  const result = await request(slot.port, strict ? '/api/health' : '/api/health?readiness=primary', timeoutMs);
  const health = JSON.parse(result.body);
  if (result.status !== 200 || !validHealth(health, slot, strict)) throw new Error('Pinned slot readiness rejected');
  if (assets) {
    const login = await request(slot.port, '/login', timeoutMs);
    if (login.status !== 200) throw new Error('Pinned slot login rejected');
    const manifest = JSON.parse(fs.readFileSync(path.join(slot.release, 'public/desktop-assets/.vite/manifest.json'), 'utf8'));
    const entry = Object.values(manifest).find(row => row?.isEntry && typeof row.file === 'string');
    if (!entry || !/^assets\/[A-Za-z0-9._-]+\.js$/.test(entry.file)) throw new Error('Desktop entry manifest invalid');
    if ((await request(slot.port, `/desktop-assets/${entry.file}`, timeoutMs)).status !== 200) throw new Error('Desktop entry unavailable');
  }
  return health;
}
export async function waitReady(slot, {deadlineMs = 120000, spacingMs = 5000, minimumMs = 10000, probe = probeSlot} = {}) {
  const start = Date.now(); let first = 0, consecutive = 0;
  while (Date.now() - start < deadlineMs) {
    try {
      let timer;
      const health = await Promise.race([probe(slot),new Promise((_,reject)=>{
        timer=setTimeout(()=>reject(new Error('Candidate readiness deadline')),Math.max(1,deadlineMs-(Date.now()-start)));
      })]).finally(()=>clearTimeout(timer));
      if (!consecutive) first = Date.now();
      consecutive++;
      if (consecutive >= 3 && Date.now() - first >= minimumMs) return health;
    } catch { consecutive = 0; }
    await sleep(Math.min(spacingMs, Math.max(0, deadlineMs - (Date.now() - start))));
  }
  throw new Error('Candidate failed the bounded consecutive-readiness gate');
}

// Only immutable static GET candidates. No normalization that hides traversal.
export function staticPath(raw) {
  const pathname = raw.split('?')[0];
  if (!/^\/(?:_next\/static|desktop-assets\/assets)\/[A-Za-z0-9_./-]+$/.test(pathname)) return null;
  if (pathname.slice(1).split('/').some(part => !part || part === '.' || part === '..')) return null;
  const name = path.posix.basename(pathname);
  if (!/\.(?:js|css|woff2?|png|jpe?g|webp|gif|svg|ico)$/.test(name)
      || !/(?:[a-f0-9]{8,}|-[A-Za-z0-9_-]{8,})/.test(name)) return null;
  return pathname;
}
export function inventoryAssets(release) {
  const assets = {};
  for (const [folder, prefix] of [['.next/static','/_next/static'], ['public/desktop-assets/assets','/desktop-assets/assets']]) {
    const base = path.join(release, folder);
    const walk = (directory, url) => {
      if (fs.realpathSync(directory) !== directory) throw new Error('Asset directory is aliased');
      for (const entry of fs.readdirSync(directory, {withFileTypes:true})) {
        if (entry.isSymbolicLink()) throw new Error('Asset symlink rejected');
        const file = path.join(directory, entry.name), name = `${url}/${entry.name}`;
        if (entry.isDirectory()) walk(file, name);
        else if (entry.isFile() && staticPath(name)) assets[name] = fs.statSync(file).size;
      }
    };
    walk(base, prefix);
  }
  if (!Object.keys(assets).length) throw new Error('Immutable asset inventory empty');
  return assets;
}
export function staticFile(slot, raw) {
  const pathname = staticPath(raw); if (!pathname) return null;
  if (!Object.hasOwn(slot.assets, pathname)) return null;
  const base = pathname.startsWith('/_next/static/') ? path.join(slot.release, '.next/static') : path.join(slot.release, 'public/desktop-assets/assets');
  const relative = pathname.startsWith('/_next/static/') ? pathname.slice('/_next/static/'.length) : pathname.slice('/desktop-assets/assets/'.length);
  const file = path.join(base, relative);
  try {
    if (fs.realpathSync(base) !== base || fs.realpathSync(file) !== file || !file.startsWith(base + '/')) return null;
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== slot.assets[pathname]) return null;
    return {file, size:stat.size};
  } catch { return null; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, directory, id] = process.argv.slice(2);
  if(command==='mode'){
    privateDirectory(directory);
    const file=path.join(directory,'enabled.json'),bootstrap=path.join(directory,'bootstrap.json');
    const enabled=fs.existsSync(file)?readPrivate(file):null;
    if(enabled&&(enabled.version!==1||typeof enabled.enabled!=='boolean'))throw new Error('Deployment mode invalid');
    if(enabled?.enabled===true)console.log('slots');
    else if(fs.existsSync(bootstrap)&&readPrivate(bootstrap).phase!=='rolled-back')console.log('bootstrap-incomplete');
    else console.log('legacy');
    process.exit(0);
  }
  if (command !== 'slot') throw new Error('Usage: origin-state.mjs slot <private-state-directory> <a|b>');
  const slot = readSlot(directory, id);
  console.log(slot.release); console.log(slot.port);
}
