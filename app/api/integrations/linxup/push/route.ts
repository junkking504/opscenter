import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { NextResponse } from "next/server";
import { linxupBearerToken, normalizeLinxupV3Position, validLinxupPushToken } from "@/lib/linxup-push";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const runFile = promisify(execFile);
const MAX_BODY_BYTES = 512 * 1024;

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

  const temporary = path.join(os.tmpdir(), `opscenter-linxup-push-${crypto.randomUUID()}.json`);
  fs.writeFileSync(temporary, raw, { encoding: "utf8", mode: 0o600 });
  try {
    await runFile(path.join(process.cwd(), "scripts", "run-linxup-push.sh"), [temporary], {
      cwd: process.cwd(),
      timeout: 45_000,
      maxBuffer: 64 * 1024,
      env: process.env,
    });
    return noStore({ ok: true, accepted: true, processed: true });
  } catch (error) {
    console.error("LinxUp push processing failed", error instanceof Error ? error.message : error);
    return noStore({ ok: false, accepted: true, error: "Push processing failed." }, 503);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}
