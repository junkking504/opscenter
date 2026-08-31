import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import { buildFleetMapPayload } from "@/lib/fleet-map";
import { findJunkwareAppointmentIdByJkNumber, uploadJunkwareJobPhoto } from "@/lib/junkware-photo-uploader";
import { uploadJunkwareTruckRecord } from "@/lib/junkware-truck-record-uploader";
import { readMetrics, type AnyRecord } from "@/lib/opsData";
import { chicagoDateKey } from "@/lib/report-dates";
import { matchWhatsAppPhoto, normalizePhone, type FleetLocation } from "@/lib/whatsapp-job-photo-matching";
import {
  queueVerifiedWhatsAppJobPhotoBatchConfirmations,
  recordVerifiedWhatsAppJobPhoto,
} from "@/lib/whatsapp-job-photo-confirmations";
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
import {
  claimCrewExpenseTransaction,
  claimCrewExpenseReply,
  crewExpenseQueueCounts,
  finishCrewExpenseTransaction,
  finishCrewExpenseReply,
  queuedCrewExpenseTransactions,
  queuedCrewExpenseReplies,
  requeueCrewExpenseTransaction,
  requeueCrewExpenseReply,
  updateCrewExpenseTransaction,
} from "@/lib/whatsapp-crew-expenses";
import { sendCrewExpenseSlackNotification } from "@/lib/whatsapp-crew-expense-slack";
import { analyzeTruckLoadPhoto } from "@/lib/truck-load-photo-analysis";
import {
  recordTruckLoadPhotoAnalysis,
  recordTruckLoadPhotoFailure,
  truckLoadPhotoRequest,
} from "@/lib/whatsapp-truck-loads";

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
  const encoded = String(process.env.WHATSAPP_ACCESS_TOKEN_BASE64 || "").trim();
  const environment = encoded
    ? (() => { try { return Buffer.from(encoded, "base64").toString("utf8").trim(); } catch { return ""; } })()
    : String(process.env.WHATSAPP_ACCESS_TOKEN || "").trim();
  return environment || keychain("opscenter-whatsapp-access-token");
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

async function deliverCrewExpenseReplies(): Promise<{ sent: number; retried: number; failed: number }> {
  const results = { sent: 0, retried: 0, failed: 0 };
  const token = accessToken();
  const version = clean(process.env.WHATSAPP_GRAPH_API_VERSION);
  const configuredPhoneNumberId = clean(process.env.WHATSAPP_PHONE_NUMBER_ID);
  if (!token || !/^v\d+\.\d+$/.test(version) || !/^\d+$/.test(configuredPhoneNumberId)) return results;
  for (const incomingFile of queuedCrewExpenseReplies(20)) {
    const claim = claimCrewExpenseReply(incomingFile);
    if (!claim) continue;
    try {
      const phoneNumberId = configuredPhoneNumberId;
      if (claim.reply.phoneNumberId && claim.reply.phoneNumberId !== phoneNumberId) {
        throw new Error("WhatsApp reply phone number ID mismatch.");
      }
      const recipient = claim.reply.recipient.length === 10 ? `1${claim.reply.recipient}` : claim.reply.recipient;
      const response = await fetch(`https://graph.facebook.com/${version}/${encodeURIComponent(phoneNumberId)}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: recipient, type: "text", text: { preview_url: false, body: claim.reply.text } }),
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      });
      const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (!response.ok || payload.error) throw new Error(`WhatsApp reply failed (${response.status}).`);
      finishCrewExpenseReply(claim.file, "sent", { metaMessageId: clean((payload.messages as Array<Record<string, unknown>> | undefined)?.[0]?.id) });
      results.sent += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (requeueCrewExpenseReply(claim.file, message)) results.retried += 1;
      else results.failed += 1;
    }
  }
  return results;
}

async function processCrewExpenseTransactions(): Promise<{ completed: number; retried: number; failed: number }> {
  const results = { completed: 0, retried: 0, failed: 0 };
  for (const incomingFile of queuedCrewExpenseTransactions(10)) {
    const claim = claimCrewExpenseTransaction(incomingFile);
    if (!claim) continue;
    try {
      let transaction = claim.transaction;
      if (transaction.stage === "pending_junkware") {
        const verification = await uploadJunkwareTruckRecord(transaction.record);
        transaction = updateCrewExpenseTransaction(claim.file, {
          stage: "junkware_verified",
          junkware: { ...verification, verifiedAt: new Date().toISOString() },
        });
      }
      if (transaction.stage === "junkware_verified") {
        const delivery = await sendCrewExpenseSlackNotification(transaction.record);
        transaction = updateCrewExpenseTransaction(claim.file, {
          stage: "slack_sent",
          slack: { ...delivery, sentAt: new Date().toISOString() },
        });
      }
      if (transaction.stage !== "slack_sent") throw new Error("The crew expense transaction did not reach its final stage.");
      finishCrewExpenseTransaction(claim.file);
      results.completed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (requeueCrewExpenseTransaction(claim.file, message)) results.retried += 1;
      else results.failed += 1;
    }
  }
  return results;
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
  let stage: "matching" | "downloading" | "analyzing" | "uploading" = "matching";
  let matchedJob: Record<string, unknown> | null = null;
  let loadPhotoTruck = "";
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
    const loadPhoto = truckLoadPhotoRequest(claim.message, recentText);
    if (loadPhoto) {
      loadPhotoTruck = loadPhoto.truck;
      stage = "downloading";
      const filePath = await downloadWhatsAppImage(claim.message);
      stage = "analyzing";
      const analysis = await analyzeTruckLoadPhoto(filePath);
      recordTruckLoadPhotoAnalysis(claim.message, loadPhoto.truck, analysis);
      finishWhatsAppImage(claim.file, "completed", {
        truckLoadPhoto: {
          truck: loadPhoto.truck,
          estimate: analysis,
          confirmed: false,
        },
      });
      return "completed";
    }
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
    const appointmentId = match.appointmentId || await findJunkwareAppointmentIdByJkNumber(match.jkNumber);
    if (!appointmentId) {
      finishWhatsAppImage(claim.file, "review", {
        review: {
          reason: "jk_not_found_in_junkware",
          detail: `${match.jkNumber} did not resolve to the exact JunkWare appointment.`,
          category: match.category,
        },
      });
      return "review";
    }
    matchedJob = { ...match, appointmentId };
    if (match.method === "jk_number" && whatsAppPhotoSlackNotificationsEnabled()) {
      recordWhatsAppPhotoSlackUpload({
        messageId: claim.message.messageId,
        jkNumber: match.jkNumber,
        category: match.category,
        receivedAt: claim.message.receivedAt,
        jobDate: date,
        truck: match.truck || "",
        status: "pending",
      });
    }
    stage = "downloading";
    const filePath = await downloadWhatsAppImage(claim.message);
    stage = "uploading";
    const verification = await uploadJunkwareJobPhoto({
      appointmentId,
      jkNumber: match.jkNumber,
      filePath,
      category: match.category,
    });
    if (match.method === "jk_number") {
      recordVerifiedWhatsAppJobPhoto({
        messageId: claim.message.messageId,
        jkNumber: match.jkNumber,
        jobDate: date,
        senderPhone: claim.message.senderPhone,
        phoneNumberId: claim.message.phoneNumberId,
        receivedAt: claim.message.receivedAt,
      });
    }
    if (match.method === "jk_number" && whatsAppPhotoSlackNotificationsEnabled()) {
      recordWhatsAppPhotoSlackUpload({
        messageId: claim.message.messageId,
        jkNumber: match.jkNumber,
        category: match.category,
        receivedAt: claim.message.receivedAt,
        jobDate: date,
        truck: match.truck || "",
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
    const requeued = requeueWhatsAppImage(claim.file, message);
    if (!requeued && loadPhotoTruck) recordTruckLoadPhotoFailure(claim.message, loadPhotoTruck, error);
    return requeued ? "retried" : "failed";
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
  const crewExpenseTransactions = await processCrewExpenseTransactions();
  const slack = await deliverWhatsAppPhotoSlackNotifications();
  const photoQueue = whatsappQueueCounts();
  const photoConfirmations = queueVerifiedWhatsAppJobPhotoBatchConfirmations(new Date(), {
    hasUnfinishedPhotos: photoQueue.incoming > 0 || photoQueue.processing > 0,
  });
  const expenseReplies = await deliverCrewExpenseReplies();
  const processedCount = Object.values(results).reduce((sum, count) => sum + count, 0);
  if (processedCount || slack.attempted || photoConfirmations.queued || Object.values(crewExpenseTransactions).some(Boolean) || Object.values(expenseReplies).some(Boolean)) {
    process.stdout.write(`${JSON.stringify({ ok: true, processed: results, queue: photoQueue, slack, photoConfirmations, crewExpenseTransactions, expenseReplies, crewExpenses: crewExpenseQueueCounts() })}\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`[whatsapp-photo-worker] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
