import assert from 'node:assert/strict';
import fs from 'node:fs';
import postcss from 'postcss';
const folders=['desktop-ui','desktop-ui/app'];
const files=folders.flatMap(folder=>fs.readdirSync(folder).filter(name=>name.endsWith('.css')).map(name=>`${folder}/${name}`));
const tokenFile='desktop-ui/design-tokens.css';
// Third-party CSS and the shared brand identity live outside this desktop audit.
// No application literals are exempt; additions need an exact file/value reason.
const rawHexAllowlist: Record<string, Record<string,string>> = {};
const tokens=postcss.parse(fs.readFileSync(tokenFile,'utf8'));
const definitions=new Map<string,string>();tokens.walkDecls(d=>{definitions.set(d.prop,d.value);});
const scale=new Set([6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,30,32,36,42]);
for(const size of scale)assert.equal(definitions.get(`--oc-type-${size}`),`${size}px`);
for(const role of ['surface-canvas','surface-raised','surface-muted','border-default','text-primary','text-muted','brand',...['ok','warn','critical','info'].flatMap(status=>['ink','tint','accent'].map(part=>`status-${status}-${part}`))])assert.ok(definitions.has(`--oc-${role}`),`Missing semantic token ${role}`);
function validate(file:string,css:string){
 postcss.parse(css).walkDecls(d=>{
  for(const hex of d.value.match(/#[\da-f]{3,8}\b/gi)||[])assert.ok(file===tokenFile||rawHexAllowlist[file]?.[hex],`${file}: raw color ${hex}`);
  for(const [,name] of d.value.matchAll(/var\((--oc-[\w-]+)/g))assert.ok(definitions.has(name),`${file}: undefined ${name}`);
  if(d.prop==='font-size')assert.ok(/^(var\(--oc-type-\d+\)|var\(--map-locator-font, var\(--oc-type-10\)\)|clamp\(var\(--oc-type-20\), 2\.5vw, var\(--oc-type-30\)\)|clamp\(var\(--oc-type-30\), 2\.6vw, var\(--oc-type-42\)\)|inherit|\.92em|0)$/.test(d.value),`${file}: use type tokens for ${d.value}`);
  if(d.prop==='font')assert.ok(d.value==='inherit'||/^(?:(?:\d+|normal|bold|italic|oblique|small-caps)\s+)*var\(--oc-type-\d+\)(?:\s|\/)/.test(d.value),`${file}: shorthand size must use a token`);
  if(d.prop.startsWith('--oc-type-'))assert.ok(file===tokenFile&&scale.has(Number(d.prop.slice(10))),`${file}: off-scale definition ${d.prop}`);
 });
}
let important=0;
for(const file of files){const css=fs.readFileSync(file,'utf8');validate(file,css);postcss.parse(css).walkDecls('font-size',d=>{if(d.important)important++;});}
assert.ok(important<=16,`Desktop font-size importance budget exceeded: ${important}`);
assert.ok(fs.readFileSync('desktop-ui/app/globals.css','utf8').startsWith('@import "../design-tokens.css";'),'Tokens must load first in the desktop CSS entry.');
assert.throws(()=>validate('new.css','.new{color:#abcdef}'),/raw color/);
assert.throws(()=>validate('new.css','.new{font-size:8.5px}'),/type tokens/);
assert.throws(()=>validate('new.css','.new{font-size:99rem}'),/type tokens/);
assert.throws(()=>validate('new.css','.new{font-size:var(--oc-type-99)}'),/undefined/);
assert.throws(()=>validate('new.css','.new{font:700 8.5px\/12px sans-serif}'),/shorthand/);
assert.throws(()=>validate('new.css','.new{font:700 1.03125rem/1.4 sans-serif}'),/shorthand/);
// Verify each original against its FINAL representative, never a transitive cluster.
const audit=JSON.parse(fs.readFileSync('scripts/fixtures/css-phase-one.json','utf8')) as {colors:{from:string;to:string;token:string}[]};
function lab(hex:string){const [r,g,b]=hex.match(/../g)!.map(c=>parseInt(c,16)/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4);const f=(v:number)=>v>.008856?Math.cbrt(v):7.787*v+16/116;const x=f((r*.4124+g*.3576+b*.1805)/.95047),y=f(r*.2126+g*.7152+b*.0722),z=f((r*.0193+g*.1192+b*.9505)/1.08883);return [116*y-16,500*(x-y),200*(y-z)];}
for(const color of audit.colors){assert.equal(definitions.get(color.token),`#${color.to}`);const a=lab(color.from),b=lab(color.to);assert.ok(Math.hypot(...a.map((v,i)=>v-b[i]))<2,`${color.from} exceeds Delta E limit`);}
console.log(`Desktop tokens passed: ${files.length} files, ${new Set(audit.colors.map(c=>c.to)).size} opaque anchors, ${scale.size} type sizes, ${important} font-size importance flags.`);
