import { NextResponse } from "next/server";
import { actionControlSnapshot, requestAction } from "@/lib/platform/actions/engine";
import type { EntityReference } from "@/lib/platform/contracts";
import { authenticatedPlatformActor } from "@/lib/platform/request-actor";

export const dynamic = "force-dynamic";

function response(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

function requestError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown action request failure.";
  if (/not found/i.test(message)) return response({ error: message }, 404);
  if (/permission|approval|different manager/i.test(message)) return response({ error: message }, 403);
  if (/required|invalid|mismatch|support|future|version|cannot contain|choose/i.test(message)) return response({ error: message }, 400);
  return response({ error: "The OpsBot action request could not be completed." }, 503);
}

export async function GET(request: Request) {
  try {
    const actor = await authenticatedPlatformActor();
    if (!actor) return response({ error: "Authentication required." }, 401);
    const workItemId = new URL(request.url).searchParams.get("workItemId") || undefined;
    return response(await actionControlSnapshot(workItemId));
  } catch (error) {
    return requestError(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await authenticatedPlatformActor();
    if (!actor) return response({ error: "Authentication required." }, 401);
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return response({ error: "A JSON action request is required." }, 400);
    const entityValue = body.entity && typeof body.entity === "object"
      ? body.entity as Record<string, unknown>
      : {};
    const entity: EntityReference = {
      type: String(entityValue.type || "platform") as EntityReference["type"],
      id: String(entityValue.id || "").trim(),
      label: String(entityValue.label || "").trim() || undefined,
    };
    if (!entity.id) return response({ error: "An action entity is required." }, 400);
    const result = await requestAction({
      actor,
      actionKey: String(body.actionKey || ""),
      entity,
      workItemId: String(body.workItemId || "").trim() || undefined,
      rawInput: body.input,
      requestKey: String(body.requestKey || "").trim() || undefined,
    });
    return response(result, result.created ? (result.run.status === "awaiting_approval" ? 202 : 201) : 200);
  } catch (error) {
    return requestError(error);
  }
}
