import assert from 'node:assert/strict';
import { verifyAddressResult,verifyCensusAddress,ADDRESS_VERIFICATION_POLICY } from '../lib/desktop-address-verification';
import {addressQueries} from '../lib/desktop-address-verification';
import {appointmentServiceAddress,normalizeServiceAddress} from '../lib/service-address-format';
import {serviceStreetCandidates} from '../lib/appointment-partner';
const component=(type:string,value:string)=>({types:[type],long_name:value,short_name:value});
const result={address_components:[component('street_number','100'),component('route','Example Street'),component('locality','New Orleans'),component('postal_code','70125'),component('administrative_area_level_1','LA'),component('country','US')],geometry:{location:{lat:29.95,lng:-90.1},location_type:'ROOFTOP'}};
const payload={status:'OK',results:[result]};
assert.ok(verifyAddressResult('100 Example St, New Orleans, LA 70125',payload).location);
assert.ok(verifyAddressResult('Business Name 100 Example Street New Orleans, 70125',payload).location);
assert.equal(verifyAddressResult('101 Example Street, New Orleans, LA 70125',payload).location,null);
assert.equal(verifyAddressResult('100 Other Street, New Orleans, LA 70125',payload).location,null);
assert.equal(verifyAddressResult('100 Example Street, New Orleans, LA 70124',payload).location,null);
assert.equal(verifyAddressResult('100 Example Street, New Orleans, LA 70125',{status:'OK',results:[{...result,partial_match:true}]}).location,null);
assert.equal(verifyAddressResult('100 Example Street, New Orleans, LA 70125',{status:'OK',results:[result,result]}).location,null);
assert.equal(verifyAddressResult('100 Example Street, New Orleans, LA 70125',{status:'OK',results:[{...result,geometry:{...result.geometry,location_type:'APPROXIMATE'}}]}).location,null);
assert.equal(verifyAddressResult('100 Example Street, New Orleans, LA 70125',{status:'REQUEST_DENIED'}).reason,'Geocoding REQUEST_DENIED');
const cityResult={...result,address_components:[...result.address_components,component('locality','New Orleans')]};
assert.ok(verifyAddressResult('100 Example New Orleans, LA 70125',{status:'OK',results:[cityResult]}).location,'An omitted road type is safe with the exact following city');
assert.equal(verifyAddressResult('100 Example Other City, LA 70125',{status:'OK',results:[cityResult]}).location,null);
assert.equal(verifyAddressResult('100 Example Heights New Orleans, LA 70125',{status:'OK',results:[cityResult]}).location,null,'Do not accept a different street sharing a prefix');
assert.equal(verifyAddressResult('100 Example New Orleans, LA 70124',{status:'OK',results:[cityResult]}).location,null);
assert.equal(verifyAddressResult('100 Example New Orleans, LA 70125',{status:'OK',results:[{...cityResult,partial_match:true}]}).location,null);
const renamedRoute={...cityResult,address_components:cityResult.address_components.map(c=>c.types.includes('route')?component('route','South Norman C. Francis Parkway'):c)};
assert.ok(verifyAddressResult('100 South Norman Francis Parkway, New Orleans, LA 70125',{status:'OK',results:[renamedRoute]}).location);
assert.equal(verifyAddressResult('100 North Norman Francis Parkway, New Orleans, LA 70125',{status:'OK',results:[renamedRoute]}).location,null,'Direction remains significant');
console.log('Address verification: exact house/street/ZIP, aliases, business prefixes, partial matches, ambiguous results, and provider failure passed.');

const censusMatch={matchedAddress:'100 EXAMPLE ST, NEW ORLEANS, LA, 70125',addressComponents:{zip:'70125',state:'LA',city:'NEW ORLEANS'},coordinates:{x:-90.1,y:29.95}};
assert(verifyCensusAddress('100 Example St New Orleans LA 70125',{result:{addressMatches:[censusMatch]}}).location);
assert.equal(verifyCensusAddress('101 Example St New Orleans LA 70125',{result:{addressMatches:[censusMatch]}}).location,null);
assert.equal(verifyCensusAddress('100 Example St New Orleans LA 70124',{result:{addressMatches:[censusMatch]}}).location,null);
assert.equal(verifyCensusAddress('100 Example St New Orleans LA 70125',{result:{addressMatches:[censusMatch,censusMatch]}}).location,null);
const hospital={matchedAddress:'1014 W ST CLAIRE BLVD, GONZALES, LA, 70737',addressComponents:{zip:'70737',state:'LA',city:'GONZALES'},coordinates:{x:-90.931727047708,y:30.208176890499}};
const full='Our Lady Of The Lake St. Elizabeth 1014 W St Clare Blvd Suite 3110 Gonzales, LA 70737';
assert.ok(verifyCensusAddress(full,{result:{addressMatches:[hospital]}}).location,'Read business, house, suite, locality and ZIP together');
assert.equal(verifyCensusAddress(full.replace('1014','1015'),{result:{addressMatches:[hospital]}}).location,null);
assert.equal(verifyCensusAddress(full.replace('70737','70734'),{result:{addressMatches:[hospital]}}).location,null);
assert.equal(verifyCensusAddress(full.replace(' W St',' E St'),{result:{addressMatches:[hospital]}}).location,null);
assert.equal(verifyCensusAddress(full.replace('Gonzales','Other City'),{result:{addressMatches:[hospital]}}).location,null,'Alias must not cross localities');
assert.ok(verifyCensusAddress('Business 84 Location 2, 100 Example St Suite 3 New Orleans LA 70125',{result:{addressMatches:[censusMatch]}}).location,'Business/unit numbers must not replace the street number');
assert.equal(verifyCensusAddress('100 Example St New Orleans LA 70125 or 200 Other St New Orleans LA 70125',{result:{addressMatches:[censusMatch]}}).location,null,'Two street addresses require review');

// Synthetic address fixture: a unique provider match with a minor name typo.
const spellingMatch={...censusMatch,matchedAddress:'100 PENROSE ST, NEW ORLEANS, LA, 70125'};
const spellingPayload={result:{addressMatches:[spellingMatch]}};
for (const name of ['Pensrose','Penrsoe','Penrse']) {
  const verified=verifyCensusAddress(`100 ${name} Street New Orleans LA 70125`,spellingPayload);
  assert.ok(verified.location,`${name} is a single insertion, transposition or omission`);
  assert.equal(verified.matchedAddress,spellingMatch.matchedAddress);
}
assert.ok(verifyCensusAddress('Business 100 Pensrose Street Apt 2 New Orleans, LA 70125-1234',spellingPayload).location);
assert.ok(verifyCensusAddress('100 Pensrose Street, New Orleans, 70125',spellingPayload).location);
for (const input of [
  '101 Pensrose St New Orleans LA 70125',
  '100 Pensrose St New Orleans LA 70124',
  '100 Pensrose St Other City LA 70125',
  '100 Pensrose St New Orleans MS 70125',
  '100 Pensrose Rd New Orleans LA 70125',
  '100 N Pensrose St New Orleans LA 70125',
  '100 Pendose St New Orleans LA 70125',
  '100 Pensrrose St New Orleans LA 70125',
  '100 Penrose Heights St New Orleans LA 70125',
  '100 Pensrose St New Orleans LA 70125 or 200 Other St New Orleans LA 70125',
]) assert.equal(verifyCensusAddress(input,spellingPayload).location,null,input);
assert.equal(verifyCensusAddress('100 Pensrose St New Orleans LA 70125',{result:{addressMatches:[spellingMatch,spellingMatch]}}).location,null);
assert.equal(verifyCensusAddress('100 Pensrose St New Orleans LA 70125',{result:{addressMatches:[{...spellingMatch,coordinates:{x:0,y:0}}]}}).location,null);
const shortMatch={...censusMatch,matchedAddress:'100 OAK ST, NEW ORLEANS, LA, 70125'};
assert.equal(verifyCensusAddress('100 Oaks St New Orleans LA 70125',{result:{addressMatches:[shortMatch]}}).location,null,'Short street names are not typo-corrected');
console.log('Automatic spelling correction passed: exact locality/number/ZIP/type/direction guards, ambiguous matches and invalid points.');

// Synthetic short-name fixture: only duplicated letters extend the existing
// policy below six letters, and all full-address guards still apply.
const shortDuplicate={...censusMatch,matchedAddress:'100 MAPLE ST, NEW ORLEANS, LA, 70125'};
const shortDuplicatePayload={result:{addressMatches:[shortDuplicate]}};
assert.ok(verifyCensusAddress('100 Mapple St New Orleans LA 70125',shortDuplicatePayload).location);
assert.ok(verifyCensusAddress('100 Maple St New Orleans LA 70125',{result:{addressMatches:[{...shortDuplicate,matchedAddress:'100 MAPPLE ST, NEW ORLEANS, LA, 70125'}]}}).location);
for(const input of [
  '100 Maples St New Orleans LA 70125', '100 Mapel St New Orleans LA 70125',
  '101 Mapple St New Orleans LA 70125', '100 Mapple St New Orleans LA 70124',
  '100 Mapple St Other City LA 70125', '100 Mapple Rd New Orleans LA 70125',
  '100 N Mapple St New Orleans LA 70125', '100 Mapple St New Orleans MS 70125',
]) assert.equal(verifyCensusAddress(input,shortDuplicatePayload).location,null,input);
assert.equal(verifyCensusAddress('100 Mapple St New Orleans LA 70125',{result:{addressMatches:[shortDuplicate,{...shortDuplicate,coordinates:{x:-90.2,y:30}}]}}).location,null);
assert.equal(verifyCensusAddress('100 Elmm St New Orleans LA 70125',{result:{addressMatches:[{...shortDuplicate,matchedAddress:'100 ELM ST, NEW ORLEANS, LA, 70125'}]}}).location,null);
console.log('Repeated-letter correction passed with short-name, identity and ambiguity guards.');

const duplicateBase={...censusMatch,matchedAddress:'100 PEACHTREE CT, NEW ORLEANS, LA, 70125',
  addressComponents:{...censusMatch.addressComponents,streetName:'PEACHTREE',suffixType:'CT'},
  tigerLine:{tigerLineId:'test-road-segment',side:'R'}};
const spacedAlias={...duplicateBase,matchedAddress:'100 PEACH TREE CT, NEW ORLEANS, LA, 70125',addressComponents:{...duplicateBase.addressComponents,streetName:'PEACH TREE'}};
const aliasAddress='100 Peachtree Ct New Orleans LA 70125';
assert.ok(verifyCensusAddress(aliasAddress,{result:{addressMatches:[spacedAlias,duplicateBase]}}).location,'Spaced street aliases at the same physical address are one location');
assert.ok(verifyCensusAddress(aliasAddress,{result:{addressMatches:[duplicateBase,spacedAlias]}}).location,'Provider ordering does not affect verification');
for(const other of [
  {...spacedAlias,coordinates:{x:-90.10001,y:29.95}},
  {...spacedAlias,tigerLine:{...spacedAlias.tigerLine,side:'L'}},
  {...spacedAlias,tigerLine:{...spacedAlias.tigerLine,tigerLineId:'other-segment'}},
  {...spacedAlias,matchedAddress:'101 PEACH TREE CT, NEW ORLEANS, LA, 70125'},
  {...spacedAlias,addressComponents:{...spacedAlias.addressComponents,streetName:'OTHER'}},
  {...spacedAlias,addressComponents:{...spacedAlias.addressComponents,preDirection:'N'}},
  {...spacedAlias,addressComponents:{...spacedAlias.addressComponents,suffixType:'ST'}},
  {...spacedAlias,addressComponents:{...spacedAlias.addressComponents,zip:'70124'}},
  {...spacedAlias,tigerLine:undefined},
]) assert.equal(verifyCensusAddress(aliasAddress,{result:{addressMatches:[duplicateBase,other]}}).location,null,'Distinct or insufficiently identified candidates remain ambiguous');
console.log('Duplicate Census aliases passed: same point/road/side/address only; true ambiguity still rejected.');

async function verifyAutomaticCache() {
  const fs=await import('node:fs'),os=await import('node:os'),path=await import('node:path');
  const {createHash}=await import('node:crypto');
  const {verifyDesktopAddress}=await import('../lib/desktop-address-verification');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'address-correction-test-'));
  const previousDirectory=process.env.SERVICE_ADDRESS_CACHE_DIR,previousFetch=globalThis.fetch;
  const address='100 Sixth Street New Orleans LA 70125';
  const file=path.join(directory,createHash('sha256').update(address).digest('hex')+'.json');
  let calls=0;
  try {
    process.env.SERVICE_ADDRESS_CACHE_DIR=directory;
    fs.writeFileSync(file,JSON.stringify({schema:6,address,expires:Date.now()+300000,verified:{location:null,reason:'Address Needs Exact House, Street, And ZIP Match'}}));
    globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({result:{addressMatches:[{...censusMatch,matchedAddress:'100 6TH ST, NEW ORLEANS, LA, 70125'}]}}));};
    const first=await verifyDesktopAddress(address);
    assert.ok(first.location,'Old cached rejection is reconsidered automatically');
    assert.deepEqual(await verifyDesktopAddress(address),first);
    assert.equal(calls,1,'Accepted correction is reused without another provider request');
    const saved=JSON.parse(fs.readFileSync(file,'utf8'));
    assert.equal(saved.schema,ADDRESS_VERIFICATION_POLICY);
    assert.equal(saved.address,address,'Source spelling is retained');
    assert.deepEqual(saved.verified,first,'Matched spelling and point persist atomically');
  } finally {
    globalThis.fetch=previousFetch;
    if(previousDirectory===undefined)delete process.env.SERVICE_ADDRESS_CACHE_DIR;else process.env.SERVICE_ADDRESS_CACHE_DIR=previousDirectory;
    fs.rmSync(directory,{recursive:true,force:true});
  }
  console.log('Automatic retry, source preservation and correction caching passed.');
}
assert.equal(serviceStreetCandidates('100 LA-16 Denham Springs, LA 70726').length,1);
assert.equal(serviceStreetCandidates('100 LA-16 Denham Springs LA 70726 or 200 Example St Kenner LA 70065').length,2);
assert.equal(serviceStreetCandidates('100 S Example Pky Apt 156 New Orleans 70123').length,1);
assert.equal(addressQueries('100 Example Rd Bldg 1, Greenwell Springs, 70739')[0],'100 Example Rd Greenwell Springs, LA 70739');
assert.equal(addressQueries('100 S Example Pky, Apt 156, New Orleans, 70123')[0],'100 S Example Pkwy, New Orleans, LA 70123');
assert.equal(addressQueries('100 Example Dr, Kenner, La 70065 Kenner, LA 70065')[0],'100 Example Dr, Kenner, La 70065');
assert.equal(normalizeServiceAddress('LA-16'),normalizeServiceAddress('Louisiana Highway 16'));
const saint={...censusMatch,matchedAddress:'100 SAINT EXAMPLE ST, NEW ORLEANS, LA, 70125'};
assert.ok(verifyCensusAddress('100 St Example St New Orleans LA 70125',{result:{addressMatches:[saint]}}).location);
const parkway={...censusMatch,matchedAddress:'100 S EXAMPLE PKWY, NEW ORLEANS, LA, 70125'};
assert.ok(verifyCensusAddress('100 S Example Pky Apt 156 New Orleans LA 70125',{result:{addressMatches:[parkway]}}).location);
assert.equal(appointmentServiceAddress({address:'Business 100 Exmaple Rd, Apt 156, New Orleans, LA 70125',mapAddress:'100 Example Road, New Orleans, LA 70125'}),'100 Example Road, Apt 156, New Orleans, LA 70125');
assert.equal(appointmentServiceAddress({address:'100 Exmaple Rd Apt 156 New Orleans LA 70125'}),'100 Exmaple Rd Apt 156 New Orleans LA 70125','Unverified spelling stays intact');
console.log('Address formatting passed: building/unit preservation, parkway/highway/Saint aliases, repeated locality and corrected display.');
verifyAutomaticCache().catch(error=>{console.error(error);process.exitCode=1;});

// Synthetic numbered streets: matching spelling cannot change the premises.
for (const [written, numeric] of [['Sixth','6TH'],['First','1ST'],['Twelfth','12TH'],['Twentieth','20TH'],['Twenty-First','21ST'],['Ninety Ninth','99TH']]) {
  const match = {...censusMatch, matchedAddress:`100 ${numeric} ST, NEW ORLEANS, LA, 70125`};
  const fixture = {result:{addressMatches:[match]}};
  assert.ok(verifyCensusAddress(`100 ${written} Street New Orleans LA 70125`,fixture).location);
  assert.ok(verifyCensusAddress(`100 ${numeric} St New Orleans LA 70125`,{result:{addressMatches:[{...match,matchedAddress:`100 ${written} ST, NEW ORLEANS, LA, 70125`}]}}).location);
  assert.equal(serviceStreetCandidates(`Business 84 Location 2, 100 ${numeric} St Apt 3 New Orleans LA 70125`).length,1);
  for (const input of [`101 ${written} St New Orleans LA 70125`,`100 ${written} St New Orleans LA 70124`,`100 N ${written} St New Orleans LA 70125`,`100 ${written} Ave New Orleans LA 70125`,`100 ${written} Heights St New Orleans LA 70125`,`100 ${written} St New Orleans LA 70125 or 200 7th St New Orleans LA 70125`]) {
    assert.equal(verifyCensusAddress(input,fixture).location,null,input);
  }
  assert.equal(verifyCensusAddress('100 Seventh St New Orleans LA 70125',{result:{addressMatches:[{...match,matchedAddress:'100 6TH ST, NEW ORLEANS, LA, 70125'}]}}).location,null);
}
assert.equal(normalizeServiceAddress('Sixth Company 100 Example St Apt Sixth Sixth City'), 'SIXTH COMPANY 100 EXAMPLE ST APT SIXTH SIXTH CITY');
assert.equal(normalizeServiceAddress('100 First Colony St'), '100 FIRST COLONY ST');
console.log('Numbered streets passed: written/numeric ordinals, reverse matching, compound ordinals, business/unit preservation and conflicting-premises rejection.');
