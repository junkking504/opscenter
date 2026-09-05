import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import { whatsappMediaFile, type WhatsAppImageMessage } from "@/lib/whatsapp-job-photo-queue";
const clean = (value: unknown) => String(value || "").replace(/\s+/g, " ").trim();
function accessToken(): string {
  if (process.env.WHATSAPP_ACCESS_TOKEN_BASE64) return Buffer.from(process.env.WHATSAPP_ACCESS_TOKEN_BASE64, "base64").toString("utf8").trim();
  if (process.env.WHATSAPP_ACCESS_TOKEN) return process.env.WHATSAPP_ACCESS_TOKEN.trim();
  try { return execFileSync("security", ["find-generic-password", "-w", "-s", "opscenter-whatsapp-access-token"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 10_000 }).trim(); } catch { return ""; }
}
function validImage(buffer: Buffer, mimeType: string): boolean {
  return mimeType === "image/jpeg" ? buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255
    : mimeType === "image/png" && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
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

export async function downloadWhatsAppImage(message: WhatsAppImageMessage): Promise<string> {
  const configuredPhone = clean(process.env.WHATSAPP_PHONE_NUMBER_ID || message.phoneNumberId);
  if (!/^\d+$/.test(configuredPhone) || configuredPhone !== message.phoneNumberId) throw new Error("WhatsApp phone number ID mismatch.");
  // Only reuse the original bytes when the inbound checksum verifies them.
  if (message.sha256 && ["image/jpeg", "image/png"].includes(message.mimeType)) {
    const cached = whatsappMediaFile(message.messageId, message.mimeType);
    try {
      const stat = fs.lstatSync(cached);
      if (stat.isFile() && stat.size > 0 && stat.size <= 5 * 1024 * 1024) {
        const bytes = fs.readFileSync(cached);
        if (expectedMediaHash(bytes, message.sha256) && validImage(bytes, message.mimeType)) return cached;
      }
    } catch { /* Download if a verified original is not already cached. */ }
  }
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
  if (!validImage(buffer, mimeType)) throw new Error("The WhatsApp photo contents do not match its image type.");
  if (!expectedMediaHash(buffer, clean(metadata.sha256)) || !expectedMediaHash(buffer, message.sha256)) throw new Error("The WhatsApp photo checksum did not match Meta metadata.");
  const target = whatsappMediaFile(message.messageId, mimeType);
  const temporary = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, buffer, { mode: 0o600 });
  fs.renameSync(temporary, target);
  return target;
}

