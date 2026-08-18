import assert from "node:assert/strict";
import { appointmentTerritoryTone, isWithinLafayetteServiceRadius } from "@/lib/territory-presentation";

assert.equal(appointmentTerritoryTone("New Orleans", "100 Bourbon St, New Orleans, LA"), "is-new-orleans");
assert.equal(appointmentTerritoryTone("New Orleans", "100 Westbank Expy, Gretna, LA"), "is-westbank");
assert.equal(appointmentTerritoryTone("New Orleans", "100 Veterans Blvd, Metairie, LA"), "is-jefferson");
assert.equal(appointmentTerritoryTone("North Shore", "Mandeville, LA"), "is-northshore");
assert.equal(appointmentTerritoryTone("Baton Rouge", "Baton Rouge, LA"), "is-baton-rouge");
assert.equal(appointmentTerritoryTone("Unknown"), "is-unknown-territory");
assert.equal(isWithinLafayetteServiceRadius(30.2241, -92.0198), true);
assert.equal(isWithinLafayetteServiceRadius(29.9511, -90.0715), false);
