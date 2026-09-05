import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { after, NextResponse } from "next/server";
import { linxupBearerToken, normalizeLinxupV3Position, validLinxupPushToken } from "@/lib/linxup-push";
import { enqueueLinxupPush, InvalidLinxupPush } from "@/lib/linxup-push-queue";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const runFile = promisify(execFile);
const MAX_BODY_BYTES = 512 * 1024;
let draining: Promise<unknown> | null = null;

async function kickDrain() {
  if (draining) return draining;
  draining = runFile(path.join(process.cwd(), 'scripts', 'run-linxup-push.sh'), ['--drain'], {
    cwd: process.cwd(), maxBuffer: 64 * 1024, env: process.env,
  }).catch(() => { console.error('LinxUp queue drain failed; durable entries retained for the minute collector.'); })
    .finally(() => { draining = null; });
  return draining;
}

function noStore(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store, max-age=0" } });
}

export async function POST(request: Request) {
  if (!validLinxupPushToken(linxupBearerToken(request))) return noStore({ ok: false, error: "Unauthorized." }, 401);
  const raw = await request.text();
  if (!raw || Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) return noStore({ ok: false, error: "Invalid push payload." }, 400);
  const payload = await Promise.resolve().then(() => JSON.parse(raw) as unknown).catch(() => null);
  if (!normalizeLinxupV3Position(payload)) {
    return noStore({ ok: false, accepted: false, processed: false, error: "Invalid LinxUp V3 position payload." }, 422);
  }

  try {
    enqueueLinxupPush(raw);
  } catch (error) {
    if (error instanceof InvalidLinxupPush) return noStore({ok:false,accepted:false,error:'Invalid or unmapped LinxUp position.'},422);
    console.error('LinxUp push could not be durably queued.');
    return noStore({ok:false,accepted:false,error:'Unable to queue position; retry required.'},503);
  }
  after(kickDrain);
  return noStore({ok:true,accepted:true,queued:true,processed:false});
}
