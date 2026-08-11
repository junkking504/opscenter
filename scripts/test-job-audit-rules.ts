import assert from "node:assert/strict";
import {
  missingPaymentTypeLabel,
  shouldFlagMissingPaymentType,
  shouldFlagMissingPhotos,
} from "../lib/job-audit-rules";
import { junkwareJobPhotos, junkwarePhotoMatchesAppointment } from "../lib/junkware-job-details";

const closedEstimate = { appointmentType: "Estimate", status: "Completed Duration: 90 min(s)" };

assert.equal(shouldFlagMissingPaymentType({ ...closedEstimate, paymentAmount: "$3,632.00", paymentType: "" }), false);
assert.equal(shouldFlagMissingPaymentType({ appointmentType: "Job", status: "Completed", paymentAmount: "$3,632.00", paymentType: "" }), true);
assert.equal(shouldFlagMissingPaymentType({ appointmentType: "Job", status: "Confirmed", paymentAmount: "$3,632.00", paymentType: "" }), false);
assert.equal(shouldFlagMissingPhotos({ ...closedEstimate, photoAuditAvailable: true, photoCount: 0 }), true);
assert.equal(shouldFlagMissingPhotos({ ...closedEstimate, photoAuditAvailable: false, photoCount: 0 }), false);
assert.equal(shouldFlagMissingPhotos({ ...closedEstimate, photoAuditAvailable: true, photoCount: 2 }), false);
assert.equal(missingPaymentTypeLabel("Estimate", true), "Payment Not Required");
assert.equal(missingPaymentTypeLabel("Estimate"), "Not Required For Estimate");

const estimatePhoto = junkwareJobPhotos({
  photos: [{
    url: "https://junkware.junk-king.com/system/aspnet/local/media/2026-07/new%20orleans-3995059-photo.jpg",
  }],
})[0];
assert.ok(estimatePhoto);
assert.equal(junkwarePhotoMatchesAppointment(estimatePhoto, "3995059"), true);
assert.equal(junkwarePhotoMatchesAppointment(estimatePhoto, "4011951"), false);
assert.equal(junkwarePhotoMatchesAppointment(estimatePhoto, "../../3995059"), false);

console.log("Job audit rule checks passed.");
