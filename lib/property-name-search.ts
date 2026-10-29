/** A search candidate, never location evidence or a replacement service address. */
export function propertyNameSearch(address:string) {
  // Bound recovery to a named apartment property followed by a number and a
  // suffix with no road name. Do not reinterpret ordinary business/street text.
  const match=address.trim().match(/^([A-Z][A-Z .’'-]{1,70}\s+Apartments?)\s+(\d{1,5}[A-Z]?)\s+(?:Blvd|Boulevard|Dr|Drive|Rd|Road|St|Street)\.?,\s*([A-Z][A-Z .’'-]{1,45}?)\s*,?\s+(LA|Louisiana)\s*,?\s+(\d{5})(.*)$/i);
  if(!match)return null;
  const [,name,identifier,city,,zip,tail]=match;
  const normalize=(value:string)=>value.toUpperCase().replace(/[^A-Z0-9]/g,'');
  // JunkWare may append its structured locality a second time. Other trailing
  // text (including notes, another property or a conflicting locality) is unsafe.
  if(tail.trim() && ![`${city} LA ${zip}`,`${city} ${zip}`].some(value=>normalize(value)===normalize(tail)))return null;
  const query=`${name.trim()}, ${city.trim()}, LA ${zip}`;
  return {name:name.trim(),unresolvedIdentifier:identifier,query,
    href:`https://maps.apple.com/search?query=${encodeURIComponent(query)}`,
    approximate:true as const,visitEligible:false as const};
}
