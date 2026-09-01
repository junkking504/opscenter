import crypto from "node:crypto";
import path from "node:path";
import type { ActionVerification } from "@/lib/platform/contracts";
import { readCommunicationsControlSnapshot, type CommunicationsControlSnapshot } from "@/lib/communications-control";
import { readDispatchControlSnapshot, type DispatchControlSnapshot } from "@/lib/dispatch-control";
import { readFinanceControlSnapshot, type FinanceControlSnapshot } from "@/lib/finance-control";
import { readLinxupControlSnapshot, type LinxupControlSnapshot } from "@/lib/linxup-control";
import { readMarketingControlSnapshot, type MarketingControlSnapshot } from "@/lib/marketing-control";
import { getOperationalReadiness, type OperationalReadiness } from "@/lib/operational-readiness";
import { getKernelDatabaseHealth, type KernelDatabaseHealth } from "@/lib/platform/persistence/health";
import { getOpsRuntime } from "@/lib/runtime";
import { readSearchKingsSnapshot, type SearchKingsSnapshot } from "@/lib/searchkings";
import {
  readSystemsIntegrationReviewStore,
  saveSystemsIntegrationReview,
  systemsIntegrationReviewRecord,
  type SystemsIntegrationReviewRecord,
  type SystemsIntegrationReviewStore,
  type SystemsReviewDisposition,
} from "@/lib/systems-control-store";

export type SystemsControlMode = "live_control" | "preview_simulation";
export type SystemsIntegrationStatus = "healthy" | "degraded" | "attention" | "unavailable";

export type SystemsControlIntegration = {
  integrationId: string;
  label: string;
  authority: string;
  status: SystemsIntegrationStatus;
  observedAt: string;
  freshness: string;
  detail: string;
  suggestedDisposition: SystemsReviewDisposition;
  suggestedNextAction: string;
  observationKey: string;
  reviewCurrent: boolean;
  review: Pick<SystemsIntegrationReviewRecord, "recordId" | "disposition" | "owner" | "nextAction" | "note" | "sourceObservationKey" | "updatedAt" | "updatedBy"> | null;
};

export type SystemsControlSnapshot = {
  date: string;
  mode: SystemsControlMode;
  source: "OpsCenter health + readiness + integration source snapshots";
  sourceObservedAt: string;
  reviewStoreUpdatedAt: string;
  integrations: SystemsControlIntegration[];
  summary: {
    integrations: number;
    healthy: number;
    degraded: number;
    attention: number;
    unavailable: number;
    reviewed: number;
  };
  authorityNotice: string;
};

export type SystemsControlSources = {
  now: Date;
  kernel: KernelDatabaseHealth;
  readiness: OperationalReadiness;
  dispatch: DispatchControlSnapshot;
  linxup: LinxupControlSnapshot;
  finance: FinanceControlSnapshot;
  communications: CommunicationsControlSnapshot;
  marketing: MarketingControlSnapshot;
  searchKings: SearchKingsSnapshot | null;
};

export type SystemsIntegrationReviewInput = {
  date: string;
  integrationId: string;
  disposition: SystemsReviewDisposition;
  owner: string;
  nextAction: string;
  note: string;
  expectedReviewStoreUpdatedAt: string;
  expectedReviewUpdatedAt: string;
  expectedObservationKey: string;
};

export type SystemsIntegrationReviewReceipt = {
  mode: SystemsControlMode;
  recordId: string;
  integrationId: string;
  changed: boolean;
  verified: boolean;
  summary: string;
  evidence: Record<string, unknown>;
};

export type SystemsSnapshotReader = (date: string) => Promise<SystemsControlSnapshot>;

type LaneInput = Omit<SystemsControlIntegration, "observationKey" | "reviewCurrent" | "review"> & {
  evidence: Record<string, unknown>;
};

function clean(value: unknown): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function dataRoot(): string {
  return clean(process.env.OPSBOT_DATA_DIR) || path.join(process.cwd(), "data");
}

export function systemsControlMode(): SystemsControlMode {
  return getOpsRuntime() === "MISSION_CONTROL" ? "live_control" : "preview_simulation";
}

function ageSeconds(value: string, now: Date): number | null {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.floor((now.getTime() - parsed) / 1_000));
}

function freshnessLabel(value: string, maxAgeSeconds: number, now: Date): string {
  const age = ageSeconds(value, now);
  if (age === null) return "Observation unavailable";
  if (age < 60) return `${age}s old`;
  if (age < 3_600) return `${Math.floor(age / 60)}m old${age > maxAgeSeconds ? " · stale" : ""}`;
  return `${Math.floor(age / 3_600)}h old${age > maxAgeSeconds ? " · stale" : ""}`;
}

function freshStatus(value: string, maxAgeSeconds: number, now: Date): "fresh" | "stale" | "missing" {
  const age = ageSeconds(value, now);
  if (age === null) return "missing";
  return age <= maxAgeSeconds ? "fresh" : "stale";
}

function suggestedReview(
  status: SystemsIntegrationStatus,
  kind: "credential" | "source" | "general" = "general",
): Pick<LaneInput, "suggestedDisposition" | "suggestedNextAction"> {
  if (status === "healthy") {
    return { suggestedDisposition: "monitor", suggestedNextAction: "Continue monitoring the current verified source evidence." };
  }
  if (kind === "credential") {
    return { suggestedDisposition: "credential_follow_up", suggestedNextAction: "Verify the approved connection configuration without exposing or changing credentials." };
  }
  if (status === "unavailable" || kind === "source") {
    return { suggestedDisposition: "source_recovery", suggestedNextAction: "Verify the owning source or collector and publish a fresh observation before retrying." };
  }
  return { suggestedDisposition: "owner_follow_up", suggestedNextAction: "Assign an owner to verify the degraded lane and record the next bounded recovery step." };
}

function laneWithReview(input: LaneInput, store: SystemsIntegrationReviewStore): SystemsControlIntegration {
  const observationKey = crypto.createHash("sha256").update(JSON.stringify({
    integrationId: input.integrationId,
    status: input.status,
    observedAt: input.observedAt,
    evidence: input.evidence,
  })).digest("hex");
  const record = store.records.find((candidate) => candidate.integrationId === input.integrationId) || null;
  return {
    ...input,
    observationKey,
    reviewCurrent: Boolean(record && record.sourceObservationKey === observationKey),
    review: record ? {
      recordId: record.recordId,
      disposition: record.disposition,
      owner: record.owner,
      nextAction: record.nextAction,
      note: record.note,
      sourceObservationKey: record.sourceObservationKey,
      updatedAt: record.updatedAt,
      updatedBy: record.updatedBy,
    } : null,
  };
}

export function buildSystemsControlSnapshot(
  date: string,
  sources: SystemsControlSources,
  store: SystemsIntegrationReviewStore = readSystemsIntegrationReviewStore(),
): SystemsControlSnapshot {
  const { now, kernel, readiness, dispatch, linxup, finance, communications, marketing, searchKings } = sources;
  const junkwareFreshness = freshStatus(dispatch.sourceObservedAt, 180, now);
  const junkwareStatus: SystemsIntegrationStatus = junkwareFreshness === "missing"
    ? "unavailable"
    : junkwareFreshness === "stale" || Boolean(dispatch.warning) ? "attention" : "healthy";
  const linxupFreshness = freshStatus(linxup.sourceObservedAt, 180, now);
  const linxupStatus: SystemsIntegrationStatus = linxupFreshness === "missing"
    ? "unavailable"
    : linxupFreshness === "stale" ? "attention"
      : linxup.summary.fallback > 0 ? "degraded" : "healthy";
  const qboStatus: SystemsIntegrationStatus = !finance.paymentReconciliation.merchantCenterAvailable
    ? "unavailable"
    : !finance.paymentReconciliation.merchantCenterFresh ? "attention" : "healthy";
  const slackConfigured = communications.slack.enabled
    && communications.slack.credentialAvailable
    && communications.slack.commandChannelConfigured;
  const slackStatus: SystemsIntegrationStatus = slackConfigured
    ? communications.slack.stateUpdatedAt ? "healthy" : "degraded"
    : "unavailable";
  const photoCounts = readiness.photoQueue.counts;
  const photoStatus: SystemsIntegrationStatus = photoCounts.failed > 0 || photoCounts.review > 0
    ? "attention"
    : photoCounts.incoming > 0 || photoCounts.processing > 0 ? "degraded" : "healthy";
  const crewStatus: SystemsIntegrationStatus = readiness.crewPortalSync.status === "synchronized"
    ? "healthy"
    : readiness.crewPortalSync.status === "failed" ? "attention" : "unavailable";
  const podiumFreshness = freshStatus(marketing.podium.snapshotFetchedAt, 3_600, now);
  const podiumStatus: SystemsIntegrationStatus = podiumFreshness === "missing"
    ? "unavailable"
    : podiumFreshness === "stale" ? "attention"
      : marketing.podium.connected ? "healthy" : "degraded";
  const searchKingsFreshness = freshStatus(searchKings?.fetchedAt || "", 1_800, now);
  const searchKingsStatus: SystemsIntegrationStatus = searchKingsFreshness === "missing"
    ? "unavailable" : searchKingsFreshness === "stale" ? "attention" : "healthy";
  const authStatus: SystemsIntegrationStatus = readiness.auth.ok ? "healthy" : "unavailable";
  const kernelStatus: SystemsIntegrationStatus = kernel.healthy ? "healthy" : "unavailable";

  const laneInputs: LaneInput[] = [
    {
      integrationId: "platform_kernel",
      label: "Platform action kernel",
      authority: "OpsCenter PostgreSQL",
      status: kernelStatus,
      observedAt: "",
      freshness: "Current request probe",
      detail: kernel.healthy
        ? `${kernel.databaseName || "Kernel database"} · ${kernel.migrationVersion || "migration verified"}`
        : `Kernel ${kernel.status.replaceAll("-", " ")}; controlled action execution is unavailable.`,
      ...suggestedReview(kernelStatus, "source"),
      evidence: { enabled: kernel.enabled, healthy: kernel.healthy, status: kernel.status, databaseName: kernel.databaseName || "", migrationVersion: kernel.migrationVersion || "" },
    },
    {
      integrationId: "opscenter_auth",
      label: "OpsCenter operator authentication",
      authority: "OpsCenter signed sessions",
      status: authStatus,
      observedAt: "",
      freshness: "Current configuration probe",
      detail: readiness.auth.ok ? "Identity, password hash, and signed-session secret are configured." : "One or more operator-authentication requirements are unavailable.",
      ...suggestedReview(authStatus, "credential"),
      evidence: { ok: readiness.auth.ok, identityConfigured: readiness.auth.identityConfigured, passwordHashConfigured: readiness.auth.passwordHashConfigured, sessionSecretConfigured: readiness.auth.sessionSecretConfigured },
    },
    {
      integrationId: "junkware_schedule",
      label: "JunkWare verified schedule",
      authority: "JunkWare",
      status: junkwareStatus,
      observedAt: dispatch.sourceObservedAt,
      freshness: freshnessLabel(dispatch.sourceObservedAt, 180, now),
      detail: dispatch.warning || `${dispatch.appointments.length} active appointments available to governed Dispatch controls.`,
      ...suggestedReview(junkwareStatus, "source"),
      evidence: { observedAt: dispatch.sourceObservedAt, appointments: dispatch.appointments.length, warning: dispatch.warning || "" },
    },
    {
      integrationId: "linxup_delivery",
      label: "LinxUp telemetry delivery",
      authority: "LinxUp telemetry + verified vehicle map",
      status: linxupStatus,
      observedAt: linxup.sourceObservedAt,
      freshness: freshnessLabel(linxup.sourceObservedAt, 180, now),
      detail: linxupStatus === "healthy"
        ? `Collector evidence is fresh; ${linxup.summary.reviewNeeded} device-level exceptions remain separate.`
        : `${linxup.gpsDataStatus}; ${linxup.summary.fallback} fallback and ${linxup.summary.offline + linxup.summary.stale} stale/offline devices.`,
      ...suggestedReview(linxupStatus, "source"),
      evidence: { observedAt: linxup.sourceObservedAt, gpsDataStatus: linxup.gpsDataStatus, fallback: linxup.summary.fallback, stale: linxup.summary.stale, offline: linxup.summary.offline },
    },
    {
      integrationId: "qbo_reconciliation",
      label: "QBO payment reconciliation",
      authority: finance.paymentReconciliation.merchantSourceName || "QuickBooks Online",
      status: qboStatus,
      observedAt: finance.paymentReconciliation.merchantCenterCollectedAt || "",
      freshness: finance.paymentReconciliation.merchantCenterCollectedAt
        ? freshnessLabel(finance.paymentReconciliation.merchantCenterCollectedAt, 86_400, now) : "Collection unavailable",
      detail: `${finance.paymentReconciliation.status.replaceAll("_", " ")} · ${finance.paymentReconciliation.exceptionCount} source exceptions; exceptions are not integration failures.`,
      ...suggestedReview(qboStatus, "credential"),
      evidence: { status: finance.paymentReconciliation.status, available: finance.paymentReconciliation.merchantCenterAvailable, fresh: finance.paymentReconciliation.merchantCenterFresh, collectedAt: finance.paymentReconciliation.merchantCenterCollectedAt, exceptionCount: finance.paymentReconciliation.exceptionCount },
    },
    {
      integrationId: "slack_ops_command",
      label: "Slack Ops Command delivery",
      authority: "Slack #ops-command",
      status: slackStatus,
      observedAt: communications.slack.stateUpdatedAt,
      freshness: communications.slack.stateUpdatedAt ? freshnessLabel(communications.slack.stateUpdatedAt, 86_400, now) : "Delivery ledger waiting",
      detail: slackConfigured
        ? `${communications.slack.deliveredToday} delivered today · ${communications.slack.activeIncidents} active incidents.`
        : "The approved bot credential, alert enablement, or owned command channel is unavailable.",
      ...suggestedReview(slackStatus, "credential"),
      evidence: { enabled: communications.slack.enabled, credentialAvailable: communications.slack.credentialAvailable, commandChannelConfigured: communications.slack.commandChannelConfigured, stateUpdatedAt: communications.slack.stateUpdatedAt, deliveredToday: communications.slack.deliveredToday, activeIncidents: communications.slack.activeIncidents },
    },
    {
      integrationId: "whatsapp_job_photos",
      label: "WhatsApp job-photo queue",
      authority: "OpsBot durable WhatsApp queues",
      status: photoStatus,
      observedAt: communications.sourceObservedAt,
      freshness: "Durable queue read-back",
      detail: `${photoCounts.incoming} incoming · ${photoCounts.processing} processing · ${photoCounts.review} review · ${photoCounts.failed} failed.`,
      ...suggestedReview(photoStatus, "source"),
      evidence: { ...photoCounts },
    },
    {
      integrationId: "crew_portal_sync",
      label: "Crew Portal synchronization",
      authority: "Crew Portal sync ledger",
      status: crewStatus,
      observedAt: readiness.crewPortalSync.lastAttemptAt || readiness.crewPortalSync.lastSuccessAt || "",
      freshness: readiness.crewPortalSync.lastSuccessAt ? freshnessLabel(readiness.crewPortalSync.lastSuccessAt, 86_400, now) : "Success unavailable",
      detail: readiness.crewPortalSync.status === "synchronized" ? "The latest Crew Portal synchronization completed." : `Crew Portal sync is ${readiness.crewPortalSync.status}.`,
      ...suggestedReview(crewStatus, "source"),
      evidence: { status: readiness.crewPortalSync.status, lastAttemptAt: readiness.crewPortalSync.lastAttemptAt || "", lastSuccessAt: readiness.crewPortalSync.lastSuccessAt || "", hasError: Boolean(readiness.crewPortalSync.error) },
    },
    {
      integrationId: "podium_reviews",
      label: "Podium Reviews snapshot",
      authority: "Podium Reviews collector",
      status: podiumStatus,
      observedAt: marketing.podium.snapshotFetchedAt,
      freshness: freshnessLabel(marketing.podium.snapshotFetchedAt, 3_600, now),
      detail: marketing.podium.snapshotAvailable
        ? `${marketing.podium.locations} locations · ${marketing.podium.pendingAttribution} unattributed; direct runtime OAuth ${marketing.podium.connected ? "connected" : "not attached"}.`
        : "No verified Podium Reviews snapshot is available.",
      ...suggestedReview(podiumStatus, marketing.podium.snapshotAvailable ? "general" : "credential"),
      evidence: { snapshotAvailable: marketing.podium.snapshotAvailable, fetchedAt: marketing.podium.snapshotFetchedAt, connected: marketing.podium.connected, scopes: marketing.podium.scopes, locations: marketing.podium.locations },
    },
    {
      integrationId: "searchkings_reports",
      label: "SearchKings reporting",
      authority: searchKings?.source === "searchkings_reports_api" ? "SearchKings Reports API" : "SearchKings signed-in report",
      status: searchKingsStatus,
      observedAt: searchKings?.fetchedAt || "",
      freshness: freshnessLabel(searchKings?.fetchedAt || "", 1_800, now),
      detail: searchKings ? `${searchKings.accounts.length} accounts · ${searchKings.calls.calls.length} calls in the verified snapshot.` : "No verified SearchKings snapshot is available.",
      ...suggestedReview(searchKingsStatus, "source"),
      evidence: { available: Boolean(searchKings), source: searchKings?.source || "", fetchedAt: searchKings?.fetchedAt || "", accounts: searchKings?.accounts.length || 0, calls: searchKings?.calls.calls.length || 0 },
    },
  ];

  const integrations = laneInputs.map((lane) => laneWithReview(lane, store))
    .sort((left, right) => {
      const rank: Record<SystemsIntegrationStatus, number> = { unavailable: 0, attention: 1, degraded: 2, healthy: 3 };
      return rank[left.status] - rank[right.status] || left.label.localeCompare(right.label);
    });
  const observed = integrations.map((lane) => lane.observedAt).filter((value) => Number.isFinite(Date.parse(value))).sort().at(-1) || "";
  return {
    date,
    mode: systemsControlMode(),
    source: "OpsCenter health + readiness + integration source snapshots",
    sourceObservedAt: observed,
    reviewStoreUpdatedAt: store.updatedAt,
    integrations,
    summary: {
      integrations: integrations.length,
      healthy: integrations.filter((lane) => lane.status === "healthy").length,
      degraded: integrations.filter((lane) => lane.status === "degraded").length,
      attention: integrations.filter((lane) => lane.status === "attention").length,
      unavailable: integrations.filter((lane) => lane.status === "unavailable").length,
      reviewed: integrations.filter((lane) => lane.reviewCurrent).length,
    },
    authorityNotice: "Integration reviews record internal ownership and recovery intent only. They never restart a service or collector, change credentials, touch a tunnel or database, resend a message, or overwrite source evidence.",
  };
}

export async function readSystemsControlSnapshot(date: string): Promise<SystemsControlSnapshot> {
  const [kernel] = await Promise.all([getKernelDatabaseHealth()]);
  const sources: SystemsControlSources = {
    now: new Date(),
    kernel,
    readiness: getOperationalReadiness(dataRoot()),
    dispatch: readDispatchControlSnapshot(date),
    linxup: readLinxupControlSnapshot(date),
    finance: readFinanceControlSnapshot(date),
    communications: readCommunicationsControlSnapshot(date),
    marketing: readMarketingControlSnapshot(date),
    searchKings: readSearchKingsSnapshot(),
  };
  return buildSystemsControlSnapshot(date, sources);
}

async function currentIntegration(
  input: SystemsIntegrationReviewInput,
  snapshotReader: SystemsSnapshotReader,
): Promise<{ integration: SystemsControlIntegration; currentReview: SystemsIntegrationReviewRecord | null }> {
  const snapshot = await snapshotReader(input.date);
  if (snapshot.reviewStoreUpdatedAt !== input.expectedReviewStoreUpdatedAt) {
    throw new Error("VERSION_CONFLICT: Integration review state changed after this request was prepared.");
  }
  const integration = snapshot.integrations.find((candidate) => candidate.integrationId === input.integrationId);
  if (!integration) throw new Error("The integration is no longer available in the current systems snapshot.");
  if (integration.observationKey !== input.expectedObservationKey) {
    throw new Error("VERSION_CONFLICT: Integration evidence changed after this request was prepared.");
  }
  const currentReview = systemsIntegrationReviewRecord(input.integrationId);
  if (String(currentReview?.updatedAt || "") !== input.expectedReviewUpdatedAt) {
    throw new Error("VERSION_CONFLICT: The integration review changed after this request was prepared.");
  }
  return { integration, currentReview };
}

export async function executeSystemsIntegrationReview(
  input: SystemsIntegrationReviewInput,
  actorLabel = "Approved OpsCenter manager",
  snapshotReader: SystemsSnapshotReader = readSystemsControlSnapshot,
): Promise<SystemsIntegrationReviewReceipt> {
  const { integration, currentReview } = await currentIntegration(input, snapshotReader);
  const mode = systemsControlMode();
  const evidence = {
    date: input.date,
    integrationId: integration.integrationId,
    integrationLabel: integration.label,
    disposition: input.disposition,
    sourceStatus: integration.status,
    sourceObservedAt: integration.observedAt,
    sourceObservationKey: integration.observationKey,
  };
  if (mode === "preview_simulation") {
    return {
      mode,
      recordId: currentReview?.recordId || "preview-simulation",
      integrationId: integration.integrationId,
      changed: true,
      verified: true,
      summary: "Preview simulation verified; no integration review, service, collector, credential, tunnel, database, queue, or source state was changed.",
      evidence,
    };
  }
  const record = saveSystemsIntegrationReview({
    integrationId: integration.integrationId,
    integrationLabel: integration.label,
    disposition: input.disposition,
    owner: input.owner,
    nextAction: input.nextAction,
    note: input.note,
    sourceObservationKey: integration.observationKey,
    sourceStatus: integration.status,
    sourceObservedAt: integration.observedAt,
    updatedBy: actorLabel,
  }, {
    storeUpdatedAt: input.expectedReviewStoreUpdatedAt,
    recordUpdatedAt: input.expectedReviewUpdatedAt,
  });
  return {
    mode,
    recordId: record.recordId,
    integrationId: record.integrationId,
    changed: true,
    verified: true,
    summary: `${record.integrationLabel} recovery review verified in OpsCenter systems state.`,
    evidence: { ...evidence, recordId: record.recordId, updatedAt: record.updatedAt },
  };
}

export async function verifySystemsIntegrationReview(
  receipt: SystemsIntegrationReviewReceipt,
  input: SystemsIntegrationReviewInput,
): Promise<ActionVerification> {
  if (receipt.mode === "preview_simulation") {
    return { outcome: "verified", verifiedAt: new Date().toISOString(), summary: receipt.summary, evidence: receipt.evidence };
  }
  const review = systemsIntegrationReviewRecord(input.integrationId);
  if (
    !review
    || review.recordId !== receipt.recordId
    || review.disposition !== input.disposition
    || review.owner !== input.owner
    || review.nextAction !== input.nextAction
    || review.note !== input.note
    || review.sourceObservationKey !== input.expectedObservationKey
  ) {
    return { outcome: "mismatch", summary: "The systems review does not match the approved owner, disposition, next action, and source evidence." };
  }
  return {
    outcome: "verified",
    verifiedAt: review.updatedAt,
    summary: receipt.summary,
    evidence: { ...receipt.evidence, recordId: review.recordId, updatedAt: review.updatedAt },
  };
}
