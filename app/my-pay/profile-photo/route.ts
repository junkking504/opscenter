import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { CREW_IDENTITY_HEADER } from "@/lib/crew-auth";
import { crewProfileImageError, crewProfileImageForEmployee, deleteCrewProfileImage, saveCrewProfileImage } from "@/lib/crew-profile-image";

export const dynamic = "force-dynamic";

function response(payload: Record<string, unknown>, status = 200): NextResponse {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store, max-age=0" } });
}

async function employee(): Promise<string> { return String((await headers()).get(CREW_IDENTITY_HEADER) || "").trim(); }

function sameOrigin(request: Request): boolean {
  const origin = String(request.headers.get("origin") || "").trim();
  if (!origin) return true;
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}

export async function GET() {
  const current = await employee();
  if (!current) return response({ error: "not-authenticated" }, 401);
  return response({ image: await crewProfileImageForEmployee(current) });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return response({ error: "forbidden" }, 403);
  const current = await employee();
  if (!current) return response({ error: "not-authenticated" }, 401);
  let image: unknown;
  try { image = (await request.json()).image; } catch { return response({ error: "invalid-image" }, 400); }
  const error = crewProfileImageError(image);
  if (error) return response({ error }, 400);
  await saveCrewProfileImage(current, String(image));
  return response({ image });
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return response({ error: "forbidden" }, 403);
  const current = await employee();
  if (!current) return response({ error: "not-authenticated" }, 401);
  await deleteCrewProfileImage(current);
  return response({ image: null });
}
