import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie } from "@/lib/auth";
import { attachFleetIssueAttachment, detachFleetIssueAttachment, findFleetIssueAttachment, fleetIssueAttachmentDirectory, fleetIssueAttachmentFilePath } from "@/lib/fleet-issues";

const TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
};
const MAX_BYTES = 10 * 1024 * 1024;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store, max-age=0" } });
}

async function authenticated() {
  const cookieStore = await cookies();
  return verifyAuthSessionCookie(cookieStore.get(AUTH_SESSION_COOKIE)?.value || "");
}

export async function GET(request: Request) {
  if (!(await authenticated())) return json({ error: "Authentication required." }, 401);
  const match = findFleetIssueAttachment(new URL(request.url).searchParams.get("attachmentId") || "");
  if (!match) return json({ error: "Attachment not found." }, 404);
  const filePath = fleetIssueAttachmentFilePath(match.attachment);
  if (!fs.existsSync(filePath)) return json({ error: "Attachment file not found." }, 404);
  const disposition = match.attachment.mimeType === "application/pdf" ? "inline" : "attachment";
  return new Response(fs.readFileSync(filePath), {
    headers: {
      "Content-Type": match.attachment.mimeType,
      "Content-Length": String(match.attachment.size),
      "Content-Disposition": `${disposition}; filename="${encodeURIComponent(match.attachment.fileName)}"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}

export async function POST(request: Request) {
  if (!(await authenticated())) return json({ error: "Authentication required." }, 401);
  const form = await request.formData().catch(() => null);
  const issueId = String(form?.get("issueId") || "").trim();
  const file = form?.get("attachment");
  if (!issueId || !(file instanceof File)) return json({ error: "Repair issue and file are required." }, 400);
  const extension = TYPES[file.type];
  if (!extension) return json({ error: "Use a PDF, Word, or Excel file." }, 400);
  if (!file.size || file.size > MAX_BYTES) return json({ error: "Files must be smaller than 10 MB." }, 400);
  const directory = fleetIssueAttachmentDirectory();
  fs.mkdirSync(directory, { recursive: true });
  const storageName = `${randomUUID()}.${extension}`;
  const filePath = path.join(directory, storageName);
  fs.writeFileSync(filePath, Buffer.from(await file.arrayBuffer()), { mode: 0o600 });
  const attachment = attachFleetIssueAttachment(issueId, { fileName: file.name || `repair-document.${extension}`, storageName, mimeType: file.type, size: file.size });
  if (!attachment) { fs.unlinkSync(filePath); return json({ error: "Repair issue not found." }, 404); }
  return json({ ok: true, attachment });
}

export async function DELETE(request: Request) {
  if (!(await authenticated())) return json({ error: "Authentication required." }, 401);
  const attachment = detachFleetIssueAttachment(new URL(request.url).searchParams.get("attachmentId") || "");
  if (!attachment) return json({ error: "Attachment not found." }, 404);
  const filePath = fleetIssueAttachmentFilePath(attachment);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  return json({ ok: true });
}
