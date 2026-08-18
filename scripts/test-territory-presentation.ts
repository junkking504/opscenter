import assert from "node:assert/strict";
import {
  appointmentTerritoryTone,
  isNolaEastLocation,
  isWestbankLocation,
  isWithinLafayetteServiceRadius,
} from "@/lib/territory-presentation";

assert.equal(isWestbankLocation("101 Westbank Expressway, Gretna, LA 70053"), true);
assert.equal(isWestbankLocation("Algiers, New Orleans, LA 70131"), true);
assert.equal(isWestbankLocation("Metairie, LA 70002"), false);
assert.equal(isNolaEastLocation("New Orleans, LA 70126"), true);
assert.equal(isNolaEastLocation("Chalmette, LA 70043"), true);
assert.equal(isNolaEastLocation("Metairie, LA 70002"), false);
assert.equal(isWithinLafayetteServiceRadius(30.2241, -92.0198), true);
assert.equal(isWithinLafayetteServiceRadius(30.58, -92.0198), true);
assert.equal(isWithinLafayetteServiceRadius(30.70, -92.0198), false);
assert.equal(isWithinLafayetteServiceRadius(null, -92.0198), false);
assert.equal(appointmentTerritoryTone("Jefferson Parish", "Harvey, LA 70058"), "is-westbank");
assert.equal(appointmentTerritoryTone("New Orleans", "Algiers, LA 70131"), "is-westbank");
assert.equal(appointmentTerritoryTone("New Orleans", "New Orleans, LA 70126"), "is-nola-east");
assert.equal(appointmentTerritoryTone("Baton Rouge", "Denham Springs, LA 70726"), "is-baton-rouge");
assert.equal(appointmentTerritoryTone("Northshore", "Covington, LA 70433"), "is-northshore");
assert.equal(appointmentTerritoryTone("Lafayette", "Lafayette, LA 70501"), "is-lafayette");

console.log("Territory presentation tests passed.");
