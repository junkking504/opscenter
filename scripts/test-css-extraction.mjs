import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import postcss from 'postcss';
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function styleRules(source){const rules=[];postcss.parse(source).walkRules(rule=>{const contexts=[];for(let parent=rule.parent;parent.type!=='root';parent=parent.parent)contexts.unshift([parent.name,parent.params]);rules.push({selector:rule.selector,contexts,nodes:rule.nodes.map(node=>node.type==='decl'?[node.prop,node.value,Boolean(node.important)]:node.toString())});});return rules;}
const manifest=JSON.parse(fs.readFileSync('desktop-ui/css-extraction-manifest.json','utf8'));
const eager=styleRules(fs.readFileSync(manifest.source,'utf8'));
assert.equal(hash(eager),manifest.retainedRuleSequenceSha256,'Retained shell declarations/order changed; re-audit the extraction');
const reconstructed=Array(manifest.originalRuleCount),indices=new Set();let moved=0;
for(const packet of manifest.packets){
 const rules=styleRules(fs.readFileSync(packet.file,'utf8'));
 assert.equal(hash(rules),packet.ruleSequenceSha256,`${packet.file}: declaration or media order changed`);
 assert.equal(hash(rules.map(rule=>rule.selector)),packet.selectorSequenceSha256);
 assert.equal(rules.length,packet.sourceRuleIndices.length);
 rules.forEach((rule,index)=>{const position=packet.sourceRuleIndices[index];assert.ok(!indices.has(position));indices.add(position);assert.ok(rule.nodes.every(node=>!Array.isArray(node)||node[2]!==true),'Important declarations stay eager');assert.ok(!/:(?:is|where|not|has)\(/.test(rule.selector),'Mixed/functional selectors stay eager');assert.ok(rule.selector.split(',').every(selector=>new RegExp('\\.'+packet.family+'-[\\w-]+').test(selector)));reconstructed[position]=rule;moved++;});
}
let cursor=0;for(let index=0;index<reconstructed.length;index++)if(!indices.has(index))reconstructed[index]=eager[cursor++];
assert.equal(cursor,eager.length);
assert.equal(hash(reconstructed),manifest.originalRuleSequenceSha256,'Original declarations and source order must reconstruct exactly');
for(const family of ['krewe','fleet','marketing','finance'])assert.match(fs.readFileSync(`desktop-ui/live-${family}.tsx`,'utf8'),new RegExp(`^import './${family}-base.css';`));
assert.match(fs.readFileSync('desktop-ui/main.tsx','utf8'),/import\('\.\/reference-workspace-styles'\)\.then\(\(\) => createRoot\(root\)\.render/,'Reference mode waits for the same style packets');
console.log(`CSS extraction PASS: ${moved} unchanged normal rules reconstruct all ${manifest.originalRuleCount} original rules; shared/important rules retained, route/reference imports verified.`);
