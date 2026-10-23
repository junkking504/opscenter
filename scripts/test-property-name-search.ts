import assert from 'node:assert/strict';
import {propertyNameSearch} from '../lib/property-name-search';
import {serviceStreetCandidates,serviceAddressForGeocoding} from '../lib/appointment-partner';
import {geocodioAddressQuery} from '../lib/geocodio-service-address';
import {osmMapAddressQuery} from '../lib/osm-service-address';
import {cachedAddressVerification,verifyDesktopAddress} from '../lib/desktop-address-verification';
import {readAddressMapFallback} from '../lib/address-map-fallback';

async function main(){
  globalThis.fetch=async()=>{throw Error('Property recovery must not request a provider');};
  const source='Example Lakes Apartment 310 Blvd, Baton Rouge La, 70809 Baton Rouge, LA 70809';
  const candidate=propertyNameSearch(source)!;
  assert.equal(candidate.query,'Example Lakes Apartment, Baton Rouge, LA 70809');
  assert.equal(candidate.unresolvedIdentifier,'310');
  assert.equal(candidate.visitEligible,false);assert.equal(candidate.approximate,true);
  assert.ok(!('location' in candidate));
  assert.equal(serviceAddressForGeocoding(source),source,'Never strip property name to 310 Blvd');
  assert.deepEqual(serviceStreetCandidates(source),[]);
  assert.equal(geocodioAddressQuery(source),null);assert.equal(osmMapAddressQuery(source),null);
  assert.equal((await verifyDesktopAddress(source)).location,null);
  assert.equal(cachedAddressVerification(source)?.location,null);
  assert.equal(readAddressMapFallback(source),null,'Old cached or reviewed pins cannot supply a guessed complex');
  assert.equal(propertyNameSearch(source.replace('Baton Rouge, LA 70809','Gonzales, LA 70737')),null);
  assert.equal(propertyNameSearch(source+' Call Alice 555-0100'),null);
  assert.equal(propertyNameSearch(source.replace('310','310 Building B')),null);
  assert.equal(propertyNameSearch('Example Lakes Apartments 310 Blvd, Lafayette LA 70503')?.query,'Example Lakes Apartments, Lafayette, LA 70503');
  for(const normal of ['7200 Cypress Lakes Apartment Blvd, Baton Rouge, LA 70809','Example Lakes Apartments 7200 Main Blvd, Baton Rouge, LA 70809','123 A Street, Covington, LA 70433','Example Lakes Apartments 310 North Blvd, Baton Rouge LA 70801']){
    assert.equal(propertyNameSearch(normal),null);assert.equal(serviceStreetCandidates(normal).length,1);
  }
  console.log('Property-name search PASS: preserved source/locality, no network, no coordinates, no unit inference.');
}
void main();
