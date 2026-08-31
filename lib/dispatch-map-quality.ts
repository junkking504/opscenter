export type DispatchMapQualityJob = {
  latitude: number | null;
  longitude: number | null;
  address: string;
};

const SERVICE_AREA_BOUNDS = {
  minimumLatitude: 29,
  maximumLatitude: 31.3,
  minimumLongitude: -93,
  maximumLongitude: -89.4,
} as const;

export function hasVerifiedDispatchLocation(job: DispatchMapQualityJob): boolean {
  const { latitude, longitude } = job;
  return typeof latitude === "number"
    && typeof longitude === "number"
    && Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && latitude >= SERVICE_AREA_BOUNDS.minimumLatitude
    && latitude <= SERVICE_AREA_BOUNDS.maximumLatitude
    && longitude >= SERVICE_AREA_BOUNDS.minimumLongitude
    && longitude <= SERVICE_AREA_BOUNDS.maximumLongitude;
}

export function dispatchMapVerificationReason(job: DispatchMapQualityJob): string {
  const address = String(job.address || "").trim();
  if (!address || address === "—" || address.toLowerCase() === "unavailable") {
    return "Service address is missing";
  }
  return "Address is not confirmed in the map cache";
}

export function dispatchMapCoverage(jobs: DispatchMapQualityJob[]) {
  const mapped = jobs.filter(hasVerifiedDispatchLocation).length;
  const total = jobs.length;
  const needsVerification = total - mapped;
  const percent = total > 0 ? Math.round((mapped / total) * 100) : 100;
  return { mapped, total, needsVerification, percent };
}
