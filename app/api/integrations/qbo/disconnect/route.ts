import { NextResponse } from "next/server";
import { clearQboTokenStore, readQboTokenEnvelope } from "@/lib/qbo-token-store";
import { revokeQboToken } from "@/lib/qbo-oauth";
import { getQboSetupStatus } from "@/lib/qbo-status";

export const dynamic = "force-dynamic";

export async function POST() {
  const envelope = readQboTokenEnvelope();
  if (envelope) await revokeQboToken(envelope);
  clearQboTokenStore();
  return NextResponse.json(
    {
      ok: true,
      message: "QBO access was revoked and the encrypted local token store was cleared.",
      status: getQboSetupStatus(),
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
