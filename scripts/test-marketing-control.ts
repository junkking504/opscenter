import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function digest(file: string): string {
  return fs.existsSync(file) ? crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex") : "missing";
}

async function main() {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "opscenter-marketing-control-"));
  const assignmentFile = path.join(fixture, "operator", "podium_review_assignments.json");
  const snapshotFile = path.join(fixture, "podium-google-reviews", "current.json");
  process.env.OPSBOT_DATA_DIR = fixture;
  process.env.PODIUM_REVIEW_ASSIGNMENT_STORE = assignmentFile;
  process.env.OPSCENTER_RUNTIME = "MISSION_CONTROL";

  const metrics = {
    appointments: [{
      appt_id: "4055001",
      job_id: "JK4067001",
      job_status: "Completed",
      appointment_type: "Job",
      customer_name: "Google Customer",
      customer_phone: "504-555-0123",
      market: "New Orleans",
      truck: "Truck 1",
      driver_normalized_name: "Driver One",
      navigator_normalized_name: "Navigator Two",
    }, {
      appt_id: "4055002",
      job_id: "JK4067002",
      job_status: "Completed",
      appointment_type: "Job",
      customer_name: "Different Person",
      customer_phone: "504-555-0199",
      market: "New Orleans",
      truck: "Truck 2",
      driver_normalized_name: "Driver Three",
    }],
  };
  writeJson(path.join(fixture, "processed", "daily_metrics_2026-08-31.json"), metrics);

  const snapshot = {
    version: 1,
    source: "podium_api",
    fetchedAt: "2026-09-01T13:22:07.918Z",
    locations: [{
      uid: "loc-1",
      name: "Junk King New Orleans",
      address: "",
      averageRating: 5,
      reviewCount: 2,
      reviews: [{
        uid: "review-11111111",
        authorName: "Google Customer",
        body: "Excellent service",
        url: "",
        rating: 5,
        createdAt: "2026-08-31T15:00:00.000Z",
        updatedAt: "2026-08-31T15:01:00.000Z",
        needsResponse: true,
        responseCount: 0,
        attribution: { status: "unmatched" },
      }, {
        uid: "review-22222222",
        authorName: "Different Person",
        body: "Great crew",
        url: "",
        rating: 5,
        createdAt: "2026-08-31T16:00:00.000Z",
        updatedAt: "2026-08-31T16:01:00.000Z",
        needsResponse: false,
        responseCount: 0,
        attribution: { status: "unmatched" },
      }],
    }],
  };
  writeJson(snapshotFile, snapshot);

  try {
    const control = await import("@/lib/marketing-control");
    const assignments = await import("@/lib/podium-review-assignments");

    const initial = control.readMarketingControlSnapshot("2026-09-01");
    assert.equal(initial.mode, "live_control");
    assert.equal(initial.podium.snapshotAvailable, true);
    assert.equal(initial.podium.pendingAttribution, 2);
    const googleReview = initial.podium.reviews.find((review) => review.reviewUid === "review-11111111");
    assert.equal(googleReview?.suggestions[0]?.jkNumber, "JK4067001");
    assert.equal(googleReview?.suggestions[0]?.customerName, "Google Customer");

    const confirmInput = control.preparePodiumReviewAttributionInput(
      "review-11111111",
      "JK4067001",
      "confirm_suggestion",
    );
    assert.equal(confirmInput.expectedCandidateJkNumber, "JK4067001");
    assert.deepEqual(confirmInput.expectedCandidateCrew, ["Driver One", "Navigator Two"]);
    const receipt = await control.executePodiumReviewAttribution(confirmInput, "Approving marketing manager");
    assert.equal(receipt.mode, "live_control");
    assert.equal((await control.verifyPodiumReviewAttribution(receipt, confirmInput)).outcome, "verified");
    const saved = assignments.podiumReviewAssignmentForReview("review-11111111");
    assert.equal(saved?.attribution.jkNumber, "JK4067001");
    assert.deepEqual(saved?.attribution.crew, ["Driver One", "Navigator Two"]);
    assert.equal(/504|customer_phone/i.test(fs.readFileSync(assignmentFile, "utf8")), false);
    assert.equal(control.readMarketingControlSnapshot("2026-09-01").podium.pendingAttribution, 1);

    assert.throws(() => control.preparePodiumReviewAttributionInput(
      "review-22222222",
      "JK4067001",
      "confirm_suggestion",
    ), /Choose re-assign/);

    const staleInput = control.preparePodiumReviewAttributionInput("review-22222222", "JK4067002", "confirm_suggestion");
    writeJson(snapshotFile, { ...snapshot, fetchedAt: "2026-09-01T13:25:00.000Z" });
    await assert.rejects(control.executePodiumReviewAttribution(staleInput, "Approving marketing manager"), /snapshot changed/);
    writeJson(snapshotFile, snapshot);

    const previewInput = control.preparePodiumReviewAttributionInput("review-22222222", "JK4067002", "reassign");
    const storeHash = digest(assignmentFile);
    process.env.OPSCENTER_RUNTIME = "MAC_MINI_PREVIEW";
    const previewReceipt = await control.executePodiumReviewAttribution(previewInput, "Preview marketing manager");
    assert.equal(previewReceipt.mode, "preview_simulation");
    assert.equal((await control.verifyPodiumReviewAttribution(previewReceipt, previewInput)).outcome, "verified");
    assert.equal(digest(assignmentFile), storeHash);
    assert.equal(assignments.podiumReviewAssignmentForReview("review-22222222"), null);

    console.log("Marketing snapshot, candidate evidence, governed attribution, stale-state rejection, read-back, and preview isolation passed.");
  } finally {
    delete process.env.OPSBOT_DATA_DIR;
    delete process.env.PODIUM_REVIEW_ASSIGNMENT_STORE;
    delete process.env.OPSCENTER_RUNTIME;
    fs.rmSync(fixture, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
