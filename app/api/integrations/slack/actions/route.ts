import { NextResponse } from "next/server";
import {
  applySlackInteraction,
  parseSlackInteraction,
  refreshSlackInteractionMessage,
  verifySlackSignature,
} from "@/lib/slack-interactions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function response(body: unknown, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

export async function POST(request: Request) {
  if (!/^(1|true|yes|on)$/i.test(String(process.env.SLACK_OPSCENTER_ACTIONS_ENABLED || ""))) {
    return response({ error: "Slack OpsCenter actions are disabled." }, 503);
  }

  const signingSecret = String(process.env.SLACK_SIGNING_SECRET || "").trim();
  if (!signingSecret) return response({ error: "Slack signing is not configured." }, 503);

  const rawBody = await request.text();
  const valid = verifySlackSignature({
    rawBody,
    timestamp: String(request.headers.get("x-slack-request-timestamp") || ""),
    signature: String(request.headers.get("x-slack-signature") || ""),
    signingSecret,
  });
  if (!valid) return response({ error: "Invalid Slack signature." }, 401);

  const payload = parseSlackInteraction(rawBody);
  if (!payload) return response({ error: "Invalid Slack payload." }, 400);
  const result = applySlackInteraction(payload);
  if (!result.ok || !result.action) {
    return response({ response_type: "ephemeral", text: result.message }, result.status);
  }

  const refreshed = result.responseUrl
    ? await refreshSlackInteractionMessage(result.responseUrl, result.action)
    : false;
  if (!refreshed) {
    return response({
      response_type: "ephemeral",
      text: `${result.message}. The action was saved in OpsCenter, but this Slack message could not be refreshed.`,
    }, 200);
  }
  return new NextResponse(null, { status: 200, headers: { "Cache-Control": "no-store, max-age=0" } });
}
