import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie } from "@/lib/auth";
import { attachFleetIssuePhoto, detachFleetIssuePhoto, findFleetIssuePhoto, fleetIssuePhotoDirectory, fleetIssuePhotoFilePath } from "@/lib/fleet-issues";

const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const MAX_BYTES = 5 * 1024 * 1024;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store, max-age=0" } });
}

async function authenticated() {
  const cookieStore = await cookies();
  return verifyAuthSessionCookie(cookieStore.get(AUTH_SESSION_COOKIE)?.value || "");
}

export async function GET(request: Request) {
  if (!(await authenticated())) return json({ error: "Authentication required." }, 401);
  const match = findFleetIssuePhoto(new URL(request.url).searchParams.get("photoId") || "");
  if (!match) return json({ error: "Photo not found." }, 404);
  const filePath = fleetIssuePhotoFilePath(match.photo);
  if (!fs.existsSync(filePath)) return json({ error: "Photo file not found." }, 404);
  return new Response(fs.readFileSync(filePath), { headers: { "Content-Type": match.photo.mimeType, "Content-Length": String(match.photo.size), "Cache-Control": "private, max-age=3600" } });
}

export async function POST(request: Request) {
  if (!(await authenticated())) return json({ error: "Authentication required." }, 401);
  const form = await request.formData().catch(() => null);
  const issueId = String(form?.get("issueId") || "").trim();
  const file = form?.get("photo");
  if (!issueId || !(file instanceof File)) return json({ error: "Repair issue and photo are required." }, 400);
  const extension = TYPES[file.type];
  if (!extension) return json({ error: "Use a JPEG, PNG, or WebP photo." }, 400);
  if (!file.size || file.size > MAX_BYTES) return json({ error: "Photos must be smaller than 5 MB." }, 400);
  const directory = fleetIssuePhotoDirectory();
  fs.mkdirSync(directory, { recursive: true });
  const storageName = `${randomUUID()}.${extension}`;
  const filePath = path.join(directory, storageName);
  fs.writeFileSync(filePath, Buffer.from(await file.arrayBuffer()), { mode: 0o600 });
  const photo = attachFleetIssuePhoto(issueId, { fileName: file.name || `repair-photo.${extension}`, storageName, mimeType: file.type, size: file.size });
  if (!photo) { fs.unlinkSync(filePath); return json({ error: "Repair issue not found." }, 404); }
  return json({ ok: true, photo });
}

export async function DELETE(request: Request) {
  if (!(await authenticated())) return json({ error: "Authentication required." }, 401);
  const photo = detachFleetIssuePhoto(new URL(request.url).searchParams.get("photoId") || "");
  if (!photo) return json({ error: "Photo not found." }, 404);
  const filePath = fleetIssuePhotoFilePath(photo);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  return json({ ok: true });
}
