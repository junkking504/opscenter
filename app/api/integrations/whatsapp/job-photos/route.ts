import { NextResponse } from "next/server";
import {
  enqueueWhatsAppImage,
  parseWhatsAppWebhook,
  recordWhatsAppTextContext,
  verifyMetaSignature,
} from "@/lib/whatsapp-job-photo-queue";
import { ingestCrewExpenseText } from "@/lib/whatsapp-crew-expenses";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function noStore(body: Record<string, unknown>, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

function appSecret(): string {
  const encoded = String(process.env.WHATSAPP_META_APP_SECRET_BASE64 || "").trim();
  if (encoded) {
    try { return Buffer.from(encoded, "base64").toString("utf8"); } catch { return ""; }
  }
  return String(process.env.WHATSAPP_META_APP_SECRET || "");
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode") || "";
  const token = url.searchParams.get("hub.verify_token") || "";
  const challenge = url.searchParams.get("hub.challenge") || "";
  const expectedToken = String(process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || "");
  if (mode !== "subscribe" || !expectedToken || token !== expectedToken || !challenge) {
    return new NextResponse("Forbidden", { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  return new NextResponse(challenge, { status: 200, headers: { "Cache-Control": "no-store", "Content-Type": "text/plain" } });
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  if (!verifyMetaSignature(rawBody, request.headers.get("x-hub-signature-256") || "", appSecret())) {
    return noStore({ ok: false, error: "Invalid webhook signature." }, 401);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody || "null") as unknown;
  } catch {
    return noStore({ ok: false, error: "Invalid webhook payload." }, 400);
  }
  const parsed = parseWhatsAppWebhook(payload);
  const expectedPhoneNumberId = String(process.env.WHATSAPP_PHONE_NUMBER_ID || "").trim();
  if (expectedPhoneNumberId && parsed.phoneNumberIds.some((id) => id !== expectedPhoneNumberId)) {
    return noStore({ ok: false, error: "Unexpected WhatsApp phone number." }, 403);
  }

  const expenseResults = parsed.texts.map((text) => {
    recordWhatsAppTextContext(text);
    return ingestCrewExpenseText(text);
  });
  for (const image of parsed.images) {
    if (!image.caption) continue;
    recordWhatsAppTextContext({
      messageId: image.messageId,
      senderPhone: image.senderPhone,
      receivedAt: image.receivedAt,
      phoneNumberId: image.phoneNumberId,
      text: image.caption,
    });
  }
  let enqueued = 0;
  let duplicates = 0;
  for (const image of parsed.images) {
    const result = enqueueWhatsAppImage(image);
    if (result.duplicate) duplicates += 1;
    else enqueued += 1;
  }

  return noStore({
    ok: true,
    enqueued,
    duplicates,
    textContexts: parsed.texts.length,
    crewExpenses: {
      prompted: expenseResults.filter((result) => result.status === "prompted").length,
      recorded: expenseResults.filter((result) => result.status === "recorded").length,
      review: expenseResults.filter((result) => result.status === "review").length,
    },
  });
}
