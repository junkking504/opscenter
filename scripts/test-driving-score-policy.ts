import assert from "node:assert/strict";
import {
  DRIVING_SCORE_ALERT_RULES,
  drivingScoreCompensationBand,
  drivingScoreCompensationLabel,
} from "@/lib/driving-score-policy";

assert.equal(drivingScoreCompensationBand(80.1), "reward");
assert.equal(drivingScoreCompensationLabel(80.1), "Reward earned");
assert.equal(drivingScoreCompensationBand(80), "maintain");
assert.equal(drivingScoreCompensationBand(60), "maintain");
assert.equal(drivingScoreCompensationBand(59.9), "docked");

assert.deepEqual(
  DRIVING_SCORE_ALERT_RULES.map(({ key, perEvent, dailyCap }) => [key, perEvent, dailyCap]),
  [
    ["highSpeed", 3, 9],
    ["rapidAcceleration", 0.5, 3],
    ["harshBraking", 1, 6],
    ["postedSpeed", 2, 10],
    ["phoneUse", 8, 24],
    ["tailgating", 3, 9],
  ],
);

console.log("Driving-score policy verification passed.");
