export type DrivingScoreAlertRule = {
  key: "highSpeed" | "rapidAcceleration" | "harshBraking" | "postedSpeed" | "phoneUse" | "tailgating";
  label: string;
  perEvent: number;
  dailyCap: number;
};

// Daily caps keep a noisy sensor or a cluster of routine events from overwhelming
// the score, while still allowing repeated or high-risk behavior to be visible.
export const DRIVING_SCORE_ALERT_RULES: DrivingScoreAlertRule[] = [
  { key: "highSpeed", label: "High Speed over 70 mph", perEvent: 3, dailyCap: 9 },
  { key: "rapidAcceleration", label: "Rapid Acceleration", perEvent: 0.5, dailyCap: 3 },
  { key: "harshBraking", label: "Harsh Braking", perEvent: 1, dailyCap: 6 },
  { key: "postedSpeed", label: "Posted Speed", perEvent: 2, dailyCap: 10 },
  { key: "phoneUse", label: "Phone Use", perEvent: 8, dailyCap: 24 },
  { key: "tailgating", label: "Tailgating", perEvent: 3, dailyCap: 9 },
];

export type DrivingScoreCompensationBand = "reward" | "maintain" | "docked";

export function drivingScoreCompensationBand(score: number): DrivingScoreCompensationBand {
  if (score > 80) return "reward";
  if (score >= 60) return "maintain";
  return "docked";
}

export function drivingScoreCompensationLabel(score: number): string {
  switch (drivingScoreCompensationBand(score)) {
    case "reward":
      return "Reward earned";
    case "maintain":
      return "Bonus maintained";
    default:
      return "Bonus docked";
  }
}

export const DRIVING_SCORE_COMPENSATION_COPY = "Over 80: reward earned · 60–80: bonus maintained · Below 60: bonus docked.";
