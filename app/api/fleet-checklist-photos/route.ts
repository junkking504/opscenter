import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie } from "@/lib/auth";
import {
  attachFleetChecklistPhoto,
  detachFleetChecklistPhoto,
  findFleetChecklistPhoto,
  fleetChecklistPhotoDirectory,
  fleetChecklistPhotoFilePath,
} from "@/lib/fleet-checklists";

const ALLOWED_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store, max-age=0" } });
}

async function authenticated() {
  const cookieStore = await cookies();
  return verifyAuthSessionCookie(cookieStore.get(AUTH_SESSION_COOKIE)?.value || "");
}

export async function GET(request: Request) {
  if (!(await authenticated())) return json({ error: "Authentication required." }, 401);
  const photoId = new URL(request.url).searchParams.get("photoId") || "";
  const match = findFleetChecklistPhoto(photoId);
  if (!match) return json({ error: "Photo not found." }, 404);
  const filePath = fleetChecklistPhotoFilePath(match.photo);
  if (!fs.existsSync(filePath)) return json({ error: "Photo file not found." }, 404);
  return new Response(fs.readFileSync(filePath), {
    status: 200,
    headers: {
      "Content-Type": match.photo.mimeType,
      "Content-Length": String(match.photo.size),
      "Cache-Control": "private, max-age=3600",
      "Content-Disposition": `inline; filename="${match.photo.fileName.replace(/["\\]/g, "")}"`,
    },
  });
}

export async function POST(request: Request) {
  if (!(await authenticated())) return json({ error: "Authentication required." }, 401);
  const form = await request.formData().catch(() => null);
  if (!form) return json({ error: "Enter a valid photo upload." }, 400);
  const entryId = String(form.get("entryId") || "").trim();
  const itemId = String(form.get("itemId") || "").trim();
  const file = form.get("photo");
  if (!entryId || !itemId || !(file instanceof File)) return json({ error: "Checklist, item, and photo are required." }, 400);
  const extension = ALLOWED_TYPES[file.type];
  if (!extension) return json({ error: "Use a JPEG, PNG, or WebP photo." }, 400);
  if (!file.size || file.size > MAX_PHOTO_BYTES) return json({ error: "Photos must be smaller than 5 MB." }, 400);

  const directory = fleetChecklistPhotoDirectory();
  fs.mkdirSync(directory, { recursive: true });
  const storageName = `${randomUUID()}.${extension}`;
  const filePath = path.join(directory, storageName);
  fs.writeFileSync(filePath, Buffer.from(await file.arrayBuffer()), { mode: 0o600 });
  const photo = attachFleetChecklistPhoto(entryId, {
    itemId,
    fileName: file.name || `checklist-photo.${extension}`,
    storageName,
    mimeType: file.type,
    size: file.size,
  });
  if (!photo) {
    fs.unlinkSync(filePath);
    return json({ error: "The checklist item could not be found." }, 404);
  }
  return json({ ok: true, photo });
}

export async function DELETE(request: Request) {
  if (!(await authenticated())) return json({ error: "Authentication required." }, 401);
  const photoId = new URL(request.url).searchParams.get("photoId") || "";
  const photo = detachFleetChecklistPhoto(photoId);
  if (!photo) return json({ error: "Photo not found." }, 404);
  const filePath = fleetChecklistPhotoFilePath(photo);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  return json({ ok: true });
}
