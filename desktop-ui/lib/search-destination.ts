export type SearchDestination = {type:string;title:string;href:string};
const normalized=(text:string)=>text.trim().replace(/\s+/g,' ').toLowerCase();
/** Only an unambiguous identity may launch on Enter. Never take results[0]. */
export function exactSearchDestination(query:string,rows:SearchDestination[]):SearchDestination|null {
 const text=normalized(query),jk=text.match(/^jk\s*(\d{4,12})$/i);
 let candidates:SearchDestination[];
 if(jk)candidates=rows.filter(row=>row.type==='job'&&new RegExp(`\\bJK${jk[1]}\\b`,'i').test(row.title));
 else {
  const customers=rows.filter(row=>row.type==='customer'&&normalized(row.title)===text);
  candidates=customers.length?customers:rows.filter(row=>normalized(row.title)===text);
 }
 const unique=[...new Map(candidates.map(row=>[row.href,row])).values()];
 return unique.length===1?unique[0]:null;
}
export function isSearchQuestion(query:string){return /\?|^(?:who|what|when|where|why|how|which|show|tell|explain|help|compare|summarize|based on|looks like|anything)\b/i.test(query.trim());}
