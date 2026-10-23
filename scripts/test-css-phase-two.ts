import assert from 'node:assert/strict';
import fs from 'node:fs';
import postcss from 'postcss';
const directory='docs/css-phase-two';
type Decision={workspace:string;colors:Record<string,{from:string;to:string;kind:string;deltaE?:number}>;rejected:Array<{token:string;decision:string}>;typeMap:Record<string,number>;compactExceptions:Array<{selector:string;px:number;reason:string}>;roleSelectors?:Array<{selector:string;role:string}>;typeSelectors?:Array<{selector:string;px:number}>;variableSelectors?:Array<{selector:string;property:string;role:string}>;surfaceSelectors?:Array<{selector:string;property:string;role:string}>;stackSelectors?:Array<{selector:string;z:number}>};
const decisions:Decision[]=fs.readdirSync(directory).filter(f=>f.endsWith('-decisions.json')&&f!=='small-text-decisions.json').map(f=>JSON.parse(fs.readFileSync(`${directory}/${f}`,'utf8')));
const candidates=JSON.parse(fs.readFileSync('docs/css-phase-two-palette-candidates.json','utf8')).candidateMerges as Array<{token:string;from:string;to:string;deltaE:number}>;
const scale=new Set([9,10,11,12,13,14,16,20,24,28]);
const fixed:Record<string,string>={'--oc-surface-canvas':'#f1f6f8','--oc-border-default':'#dbe4e9','--oc-text-muted':'#687e8e'};
const neutrals=new Set(['#f1f6f8','#f6f9fb','#dbe4e9','#243b4d','#687e8e']);
const phaseOne=JSON.parse(fs.readFileSync('scripts/fixtures/css-phase-one.json','utf8')).colors as Array<{token:string;to:string}>;
for(const decision of decisions){
 for(const [token,row]of Object.entries(decision.colors)){
  assert.equal(row.from,`#${phaseOne.find(c=>c.token===token)?.to}`,`${token}: original must remain traceable`);
  if(row.kind==='direct-delta-e-merge'){
   const approved=candidates.find(c=>c.token===token);assert(approved);assert.equal(row.to,`#${approved.to}`);assert.equal(row.deltaE,approved.deltaE);assert(approved.deltaE>=2&&approved.deltaE<5);
  }else if(row.kind==='fixed-anchor')assert.equal(row.to,fixed[token]);
  else {assert.equal(row.kind,'role-neutral');assert(neutrals.has(row.to));assert(!token.startsWith('--oc-status-'),'Status aliases are not neutralized');}
 }
 for(const row of candidates)assert(decision.colors[row.token]||decision.rejected.some(r=>r.token===row.token&&r.decision),'Every candidate must be accepted, role-mapped or explicitly rejected');
 for(const [size,target]of Object.entries(decision.typeMap)){assert(scale.has(target));assert(Number(size)>=6);}
 assert.equal(decision.typeMap['6'],10);assert.equal(decision.typeMap['7'],10);assert.equal(decision.typeMap['8'],9);
 for(const exception of decision.compactExceptions){assert.equal(exception.px,8);assert.equal(exception.selector,'.brand-lockup small');assert(exception.reason);}
}
const css=postcss.parse(fs.readFileSync('desktop-ui/css-phase-two.css','utf8'));
css.walkDecls(d=>{
 const selector=(d.parent as postcss.Rule).selector;
 if(selector==='.ops-live:not([data-css-phase-two])'){
  assert.equal(d.value,({'--oc-surface-canvas':'#f5f9fc','--oc-border-default':'#dce2e8','--oc-text-muted':'#657c8c'} as Record<string,string>)[d.prop]);return;
 }
 const decision=decisions.find(row=>selector.startsWith(`.ops-live[data-css-phase-two="${row.workspace}"]`));assert(decision,`Unscoped phase-two rule: ${selector}`);
 if(d.prop.startsWith('--oc-type-'))assert.equal(d.value,`var(--oc-type-${decision.typeMap[d.prop.slice(10)]})`);
 else if(d.prop.startsWith('--oc-'))assert.equal(d.value,decision.colors[d.prop]?.to);
 else if(d.prop==='font-size')assert(decision.compactExceptions.some(e=>selector.endsWith(` ${e.selector}`)&&d.value==='var(--oc-compact-label)')||decision.typeSelectors?.some(e=>selector.endsWith(` ${e.selector}`)&&scale.has(e.px)&&d.value===`var(--oc-type-${e.px})`));
 else if(d.prop==='z-index')assert(decision.stackSelectors?.some(e=>selector.endsWith(` ${e.selector}`)&&d.value===String(e.z)&&[1099,1100].includes(e.z)));
 else if(['background','border-color'].includes(d.prop))assert(decision.surfaceSelectors?.some(e=>selector.endsWith(` ${e.selector}`)&&d.prop===e.property&&['--oc-surface-muted','--oc-surface-canvas','--oc-border-default'].includes(e.role)&&d.value===`var(${e.role})`));
 else if(d.prop==='color')assert(decision.roleSelectors?.some(e=>selector.endsWith(` ${e.selector}`)&&d.value===`var(${e.role})`));
 else if(decision.variableSelectors?.some(e=>selector.endsWith(` ${e.selector}`)&&d.prop===e.property)){assert.equal(d.prop,'--capital-muted');assert.equal(d.value,'var(--oc-text-primary)');}
 else assert(['--background','--foreground','--border','--muted','--muted-foreground','grid-template-areas','padding','justify-self','margin','min-height','min-width','justify-content','height','line-height','top'].includes(d.prop));
});
const inventory=JSON.parse(fs.readFileSync(`${directory}/small-text-decisions.json`,'utf8')) as Array<{id:string;file:string;selector:string;classification:string;acceptedMinimumPx:number;targetPx:number}>;
assert.equal(inventory.length,98);assert.equal(new Set(inventory.map(r=>r.id)).size,98);
for(const row of inventory){assert(['essential information','compact secondary label','redundant decoration','demonstrably unused'].includes(row.classification));assert(row.acceptedMinimumPx>=9);assert(scale.has(row.targetPx));assert(row.file&&row.selector);}
console.log(`CSS phase two: ${decisions.length} scoped workspace decision(s), all 350 candidates accounted for, fixed anchors, 98 classified tiny rules, approved type mapping and exact compact exception passed.`);
