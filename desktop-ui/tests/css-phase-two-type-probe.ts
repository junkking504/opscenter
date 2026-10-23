import inventory from '../../docs/css-phase-two/small-text-decisions.json';
// Test-only selector specimens complement real workspace/dialog captures. They
// establish the winning computed type rule, not proof a selector is unused.
const trigger=document.createElement('button');trigger.textContent='Inspect all 98 type specimens';trigger.id='inspect-type-specimens';trigger.style.cssText='position:fixed;left:-10000px;top:0';document.body.append(trigger);
trigger.onclick=async()=>{
 await document.fonts.ready;
 const host=document.createElement('section');host.style.cssText='position:absolute;left:-20000px;top:0;width:400px;visibility:hidden;pointer-events:none';
 document.querySelector('.ops-content')!.append(host);
 const results=inventory.map(row=>({id:row.id,selector:row.selector,classification:row.classification,minimum:row.acceptedMinimumPx,computed:row.selector.split(',').map(selector=>{
  const box=document.createElement('div');box.style.cssText='position:relative;width:400px;min-height:40px';host.append(box);let parent:HTMLElement=box;
  for(const part of selector.trim().split(/\s*>\s*|\s+/)){
   if(part==='.ops-live')continue;
   const tag=part.match(/^[a-z][a-z\d-]*/i)?.[0]||'div';const element=document.createElement(tag);
   for(const match of part.matchAll(/\.([\w-]+)/g))element.classList.add(match[1]);
   for(const match of part.matchAll(/\[([\w-]+)(?:=["']?([^"'\]]+)["']?)?\]/g))element.setAttribute(match[1],match[2]||'');
   parent.append(element);parent=element;
  }
  parent.textContent='Synthetic operational label';const style=getComputedStyle(parent);return {fontPx:parseFloat(style.fontSize),display:style.display,visibility:style.visibility};
 })}));host.remove();
 let output=document.querySelector('#type-specimen-result');if(!output){output=document.createElement('pre');output.id='type-specimen-result';output.setAttribute('hidden','');document.body.append(output);}
 output.textContent=JSON.stringify({workspace:document.querySelector('.workspace-heading h1')?.textContent,phase:document.querySelector('.ops-app')?.getAttribute('data-css-phase-two'),viewport:{width:innerWidth,height:innerHeight},results});
 output.dispatchEvent(new CustomEvent('type-audit-complete',{bubbles:true}));
};
