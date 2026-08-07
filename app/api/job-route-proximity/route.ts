import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie } from "@/lib/auth";
import { buildJobRouteProximity, JobRouteProximityInput } from "@/lib/job-route-proximity";

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const auth = await verifyAuthSessionCookie(cookieStore.get(AUTH_SESSION_COOKIE)?.value || "");
  if (!auth) {
    return NextResponse.json(
      { error: "Authentication required.", loginPath: "/login" },
      { status: 401, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }

  const body = await request.json().catch(() => null);
  const date = String(body?.date || "").trim();
  const rawJobs = Array.isArray(body?.jobs) ? body.jobs.slice(0, 40) : [];
  const jobs: JobRouteProximityInput[] = rawJobs
    .map((job: Record<string, unknown>) => ({
      jobKey: String(job?.jobKey || "").trim().slice(0, 500),
      address: String(job?.address || "").trim().slice(0, 500),
    }))
    .filter((job: JobRouteProximityInput) => job.jobKey && job.address && job.address !== "—");

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !jobs.length) {
    return NextResponse.json(
      { error: "Valid route jobs and a date are required." },
      { status: 400, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }

  const payload = await buildJobRouteProximity(date, jobs);
  return NextResponse.json(payload, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
