import assert from "node:assert/strict";
import {
  missingPaymentTypeLabel,
  shouldFlagMissingPaymentType,
  shouldFlagMissingPhotos,
} from "../lib/job-audit-rules";

const closedEstimate = { appointmentType: "Estimate", status: "Completed Duration: 90 min(s)" };

assert.equal(shouldFlagMissingPaymentType({ ...closedEstimate, paymentAmount: "$3,632.00", paymentType: "" }), false);
assert.equal(shouldFlagMissingPaymentType({ appointmentType: "Job", status: "Completed", paymentAmount: "$3,632.00", paymentType: "" }), true);
assert.equal(shouldFlagMissingPaymentType({ appointmentType: "Job", status: "Confirmed", paymentAmount: "$3,632.00", paymentType: "" }), false);
assert.equal(shouldFlagMissingPhotos({ ...closedEstimate, photoAuditAvailable: true, photoCount: 0 }), true);
assert.equal(shouldFlagMissingPhotos({ ...closedEstimate, photoAuditAvailable: false, photoCount: 0 }), false);
assert.equal(shouldFlagMissingPhotos({ ...closedEstimate, photoAuditAvailable: true, photoCount: 2 }), false);
assert.equal(missingPaymentTypeLabel("Estimate", true), "Payment Not Required");
assert.equal(missingPaymentTypeLabel("Estimate"), "Not Required For Estimate");

console.log("Job audit rule checks passed.");
