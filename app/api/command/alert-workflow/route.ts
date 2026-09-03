import { NextResponse } from "next/server";
import { COMMAND_ALERT_RULE } from "@/lib/command-alert-workflow";
import { toOperationalAlert } from "@/lib/operational-alert-presentation";
import { readSlackDailyDigest } from "@/lib/slack-digest";
import { createCorrelationId } from "@/lib/platform/identifiers";
import { authenticatedPlatformActor } from "@/lib/platform/request-actor";
import { listCommandAlertWorkItems, saveCommandAlertWorkItem } from "@/lib/platform/persistence/work-items";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, max-age=0" };

function operatingDate(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("A valid operating date is required.");
  const parsed = new Date(`${value}T12:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error("A valid operating date is required.");
  return value;
}

export async function GET(request: Request) {
  try {
    const date = operatingDate(new URL(request.url).searchParams.get("date"));
    const actor = await authenticatedPlatformActor();
    if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401, headers });
    return NextResponse.json({ items: await listCommandAlertWorkItems(date), actor: { id: actor.id, displayName: actor.displayName } }, { headers });
  } catch {
    return NextResponse.json({ error: "Shared alert actions are unavailable. Source alerts remain visible; no action has been saved." }, { status: 503, headers });
  }
}

export async function POST(request: Request) {
  const correlationId = createCorrelationId();
  try {
    const actor = await authenticatedPlatformActor();
    if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401, headers });
    const body = await request.json() as Record<string, unknown>;
    const date = operatingDate(body.date);
    if (body.action !== "acknowledge" && body.action !== "add_to_control") throw new Error("Unsupported alert action.");
    const version = Number(body.expectedVersion);
    if (!Number.isInteger(version) || version < 0) throw new Error("A valid expected version is required.");
    // The browser supplies only an identity. Alert facts and source links always
    // come from the server's Slack digest, never from a client-authored record.
    const digest = await readSlackDailyDigest(date);
    const message = digest.messages.find((candidate) => candidate.id === body.alertId);
    if (!message) return NextResponse.json({ error: "The source alert is unavailable. Refresh and try again." }, { status: 404, headers });
    const alert = toOperationalAlert(message);
    const category = alert.domain === "Finance" ? "Finance" : alert.domain === "Fleet" ? "Fleet" : alert.domain === "Krewe" ? "Crew" : "Jobs";
    const item = await saveCommandAlertWorkItem({
      operatingDate: date, rule: COMMAND_ALERT_RULE, category,
      severity: alert.needsAction ? "warning" : "info",
      entity: { type: category === "Fleet" ? "truck" : category === "Crew" ? "employee" : category === "Finance" ? "finance" : "job", id: message.id, label: alert.title.match(/\bJK\d+/)?.[0] || alert.title },
      title: alert.title,
      description: [alert.label, ...alert.facts.map((fact) => `${fact.label}: ${fact.value}`), `Required result: ${alert.next}`, `Source: ${alert.href}`].join("\n"),
      source: "Slack", sourceObservedAt: message.timestamp,
    }, { actorId: actor.id, correlationId, action: body.action, expectedVersion: version });
    return NextResponse.json({ item }, { headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "WORK_ITEM_VERSION_CONFLICT") return NextResponse.json({ error: "Another operator changed this alert. Refresh and review its current state.", correlationId }, { status: 409, headers });
    if (/required|Unsupported|resolved/i.test(message)) return NextResponse.json({ error: message, correlationId }, { status: 400, headers });
    return NextResponse.json({ error: "The alert action was not saved. The shared action service is unavailable.", correlationId }, { status: 503, headers });
  }
}
