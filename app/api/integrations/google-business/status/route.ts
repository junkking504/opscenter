import { NextResponse } from "next/server";
import { googleBusinessProfileStatus } from "@/lib/google-business-profile";

export const dynamic = "force-dynamic";
export function GET() { return NextResponse.json(googleBusinessProfileStatus(), { headers: { "Cache-Control": "no-store, max-age=0" } }); }
