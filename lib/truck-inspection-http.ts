import { InspectionError } from "./truck-inspection";
export const INSPECTION_PUBLIC_PATHS = ["/truck-inspection", "/truck-inspection/manifest.webmanifest", "/truck-inspection/icon.svg", "/truck-inspection/brand-logo.svg", "/truck-inspection/junk-king-crown-180.png", "/truck-inspection/junk-king-crown-192.png", "/truck-inspection/junk-king-crown-512.png", "/truck-inspection/junk-king-gear-wrench-180.png", "/truck-inspection/junk-king-gear-wrench-192.png", "/truck-inspection/junk-king-gear-wrench-512.png", "/truck-inspection/gear-wrench-180.png", "/truck-inspection/gear-wrench-192.png", "/truck-inspection/gear-wrench-512.png", "/api/truck-inspection"];
export function inspectionResponse(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store, max-age=0" } });
}
export function inspectionFailure(error: unknown) {
  return inspectionResponse({ error: error instanceof InspectionError ? error.message : "OpsCenter could not verify this request. Keep the report and check the saved result." }, error instanceof InspectionError ? error.statusCode : 503);
}
export async function inspectionRequestBody(request: Request, limit = 3_100_000): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new InspectionError("Send a JSON request.", 415);
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || new URL(request.url).host;
  if (request.headers.get("sec-fetch-site") === "cross-site" || (origin && new URL(origin).host !== host)) throw new InspectionError("Use the inspection app to send this request.", 403);
  if (Number(request.headers.get("content-length") || 0) > limit) throw new InspectionError("The report is too large. Use up to three smaller photos.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new InspectionError("Enter an inspection.");
  const chunks: Uint8Array[] = []; let length = 0;
  while (true) { const chunk = await reader.read(); if (chunk.done) break; length += chunk.value.byteLength; if (length > limit) { await reader.cancel(); throw new InspectionError("The report is too large.", 413); } chunks.push(chunk.value); }
  const joined = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.length; }
  let body: unknown;
  try { body = JSON.parse(new TextDecoder().decode(joined)); } catch { throw new InspectionError("Enter a valid report."); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new InspectionError("Enter a valid report.");
  return body as Record<string, unknown>;
}
