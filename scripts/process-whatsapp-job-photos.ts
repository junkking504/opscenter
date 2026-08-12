import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import { buildFleetMapPayload } from "@/lib/fleet-map";
import { uploadJunkwareJobPhoto } from "@/lib/junkware-photo-uploader";
import { readMetrics, type AnyRecord } from "@/lib/opsData";
import { chicagoDateKey } from "@/lib/report-dates";
import { matchWhatsAppPhoto, normalizePhone, type FleetLocation } from "@/lib/whatsapp-job-photo-matching";
import {
  deliverWhatsAppPhotoSlackNotifications,
  recordWhatsAppPhotoSlackUpload,
  whatsAppPhotoSlackNotificationsEnabled,
} from "@/lib/whatsapp-job-photo-slack";
import {
  claimWhatsAppImage,
  finishWhatsAppImage,
  queuedWhatsAppImages,
  recentWhatsAppText,
  requeueWhatsAppImage,
  whatsappMediaFile,
  whatsappQueueCounts,
  type WhatsAppImageMessage,
} from "@/lib/whatsapp-job-photo-queue";

function clean(value: unknown): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function keychain(service: string, account?: string): string {
  try {
    return execFileSync("security", ["find-generic-password", "-w", ...(account ? ["-a", account] : []), "-s", service], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10_000,
    }).trim();
  } catch {
    return "";
  }
}

function accessToken(): string {
  return String(process.env.WHATSAPP_ACCESS_TOKEN || "").trim()
    || keychain("opscenter-whatsapp-access-token");
}

function loadSlackBotToken(): void {
  if (String(process.env.SLACK_BOT_TOKEN || "").trim()) return;
  const token = keychain("com.opscenter.slack-bot-token", "opscenter");
  if (token.startsWith("xoxb-")) process.env.SLACK_BOT_TOKEN = token;
}

export function senderTruckMap(raw = process.env.WHATSAPP_TRUCK_PHONE_MAP): Record<string, string> {
  if (!raw && process.env.WHATSAPP_TRUCK_PHONE_MAP_BASE64) {
    try { raw = Buffer.from(process.env.WHATSAPP_TRUCK_PHONE_MAP_BASE64, "base64").toString("utf8"); } catch { raw = ""; }
  }
  if (!raw) return {};
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("WHATSAPP_TRUCK_PHONE_MAP must be a JSON object.");
  return Object.fromEntries(Object.entries(parsed).flatMap(([phone, truck]) => {
    const normalized = normalizePhone(phone);
    const label = clean(truck);
    return normalized && label ? [[normalized, label]] : [];
  }));
}

function expectedMediaHash(buffer: Buffer, supplied: string): boolean {
  if (!supplied) return true;
  const hex = crypto.createHash("sha256").update(buffer).digest("hex");
  const base64 = Buffer.from(hex, "hex").toString("base64");
  return supplied === hex || supplied === base64;
}

function allowedMediaUrl(raw: string): URL {
  const url = new URL(raw);
  const hostname = url.hostname.toLowerCase();
  const allowed = url.protocol === "https:"
    && (hostname === "lookaside.fbsbx.com" || hostname.endsWith(".fbsbx.com") || hostname.endsWith(".fbcdn.net") || hostname.endsWith(".facebook.com"));
  if (!allowed) throw new Error("Meta returned an unexpected media host.");
  return url;
}

async function downloadWhatsAppImage(message: WhatsAppImageMessage): Promise<string> {
  const token = accessToken();
  const version = clean(process.env.WHATSAPP_GRAPH_API_VERSION);
  if (!token || !/^v\d+\.\d+$/.test(version)) throw new Error("WhatsApp Graph API credentials are unavailable.");
  const phoneNumberId = clean(process.env.WHATSAPP_PHONE_NUMBER_ID || message.phoneNumberId);
  if (!/^\d+$/.test(phoneNumberId) || phoneNumberId !== message.phoneNumberId) throw new Error("WhatsApp phone number ID mismatch.");
  const metadataUrl = new URL(`https://graph.facebook.com/${version}/${encodeURIComponent(message.mediaId)}`);
  metadataUrl.searchParams.set("phone_number_id", phoneNumberId);
  const metadataResponse = await fetch(metadataUrl, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!metadataResponse.ok) throw new Error(`Meta media lookup failed (${metadataResponse.status}).`);
  const metadata = await metadataResponse.json() as Record<string, unknown>;
  const mediaUrl = allowedMediaUrl(clean(metadata.url));
  const mimeType = clean(metadata.mime_type || message.mimeType).toLowerCase();
  if (!new Set(["image/jpeg", "image/png"]).has(mimeType)) throw new Error("Only JPEG and PNG WhatsApp photos are supported.");
  const declaredSize = Number(metadata.file_size || 0);
  if (declaredSize > 5 * 1024 * 1024) throw new Error("The WhatsApp photo exceeds the 5 MB JunkWare limit.");
  const mediaResponse = await fetch(mediaUrl, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (!mediaResponse.ok) throw new Error(`Meta media download failed (${mediaResponse.status}).`);
  const buffer = Buffer.from(await mediaResponse.arrayBuffer());
  if (!buffer.length || buffer.length > 5 * 1024 * 1024) throw new Error("The downloaded WhatsApp photo has an invalid size.");
  if (!expectedMediaHash(buffer, clean(metadata.sha256 || message.sha256))) throw new Error("The WhatsApp photo checksum did not match Meta metadata.");
  const target = whatsappMediaFile(message.messageId, mimeType);
  const temporary = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, buffer, { mode: 0o600 });
  fs.renameSync(temporary, target);
  return target;
}

function fleetLocations(date: string): FleetLocation[] {
  const payload = buildFleetMapPayload(date);
  return (payload?.trucks || []).map((truck) => ({
    truck: truck.truck,
    latitude: truck.latitude,
    longitude: truck.longitude,
    lastGpsUpdate: truck.lastGpsUpdate,
  }));
}

function numberOption(name: string): number | undefined {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

async function processOne(incomingFile: string, map: Record<string, string>): Promise<"completed" | "review" | "retried" | "failed" | "skipped"> {
  const claim = claimWhatsAppImage(incomingFile);
  if (!claim) return "skipped";
  let stage: "matching" | "downloading" | "uploading" = "matching";
  let matchedJob: Record<string, unknown> | null = null;
  try {
    const receivedAt = new Date(claim.message.receivedAt);
    if (Number.isNaN(receivedAt.getTime())) throw new Error("The WhatsApp message timestamp is invalid.");
    const date = chicagoDateKey(receivedAt);
    const metrics = readMetrics(date);
    const appointments = Array.isArray(metrics?.appointments) ? metrics.appointments as AnyRecord[] : [];
    const recentText = recentWhatsAppText(
      claim.message.senderPhone,
      receivedAt,
      numberOption("WHATSAPP_CONTEXT_MAX_AGE_MINUTES") ?? 10,
    );
    const match = matchWhatsAppPhoto({
      senderPhone: claim.message.senderPhone,
      caption: claim.message.caption,
      recentText,
      receivedAt,
      appointments,
      fleet: fleetLocations(date),
      senderTruckMap: map,
      options: {
        maxGpsAgeMinutes: numberOption("WHATSAPP_GPS_MAX_AGE_MINUTES"),
        maxJobDistanceMiles: numberOption("WHATSAPP_MAX_JOB_DISTANCE_MILES"),
        minimumDistanceMarginMiles: numberOption("WHATSAPP_MINIMUM_JOB_MARGIN_MILES"),
      },
    });
    if (match.status === "review") {
      finishWhatsAppImage(claim.file, "review", { review: match });
      return "review";
    }
    matchedJob = match;
    if (match.method === "jk_number" && whatsAppPhotoSlackNotificationsEnabled()) {
      recordWhatsAppPhotoSlackUpload({
        messageId: claim.message.messageId,
        jkNumber: match.jkNumber,
        category: match.category,
        receivedAt: claim.message.receivedAt,
        jobDate: date,
        status: "pending",
      });
    }
    stage = "downloading";
    const filePath = await downloadWhatsAppImage(claim.message);
    stage = "uploading";
    const verification = await uploadJunkwareJobPhoto({
      appointmentId: match.appointmentId,
      jkNumber: match.jkNumber,
      filePath,
      category: match.category,
    });
    if (match.method === "jk_number" && whatsAppPhotoSlackNotificationsEnabled()) {
      recordWhatsAppPhotoSlackUpload({
        messageId: claim.message.messageId,
        jkNumber: match.jkNumber,
        category: match.category,
        receivedAt: claim.message.receivedAt,
        jobDate: date,
        status: "completed",
        filePath,
      });
    }
    finishWhatsAppImage(claim.file, "completed", {
      match,
      upload: { verified: true, ...verification },
    });
    return "completed";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (stage === "uploading") {
      finishWhatsAppImage(claim.file, "review", {
        match: matchedJob,
        review: {
          reason: "upload_outcome_uncertain",
          detail: clean(message).slice(0, 500),
        },
      });
      return "review";
    }
    return requeueWhatsAppImage(claim.file, message) ? "retried" : "failed";
  }
}

async function main(): Promise<void> {
  const map = senderTruckMap();
  const results = { completed: 0, review: 0, retried: 0, failed: 0, skipped: 0 };
  for (const incomingFile of queuedWhatsAppImages(10)) {
    const result = await processOne(incomingFile, map);
    results[result] += 1;
  }
  loadSlackBotToken();
  const slack = await deliverWhatsAppPhotoSlackNotifications();
  const processedCount = Object.values(results).reduce((sum, count) => sum + count, 0);
  if (processedCount || slack.attempted) {
    process.stdout.write(`${JSON.stringify({ ok: true, processed: results, queue: whatsappQueueCounts(), slack })}\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`[whatsapp-photo-worker] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
