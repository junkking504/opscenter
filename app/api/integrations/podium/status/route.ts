import { NextResponse } from "next/server";
import { getPodiumConfig } from "@/lib/podium-config";
import { podiumTokenStoreStatus } from "@/lib/podium-token-store";
import { readPodiumGoogleReviewsSnapshot } from "@/lib/podium-reviews";

export const dynamic = "force-dynamic";

export function GET() {
  const config = getPodiumConfig();
  const token = podiumTokenStoreStatus();
  const snapshot = readPodiumGoogleReviewsSnapshot();
  return NextResponse.json({
    ok: config.ready && token.connected,
    configured: config.ready,
    connected: token.connected,
    missingConfig: config.missing,
    redirectUri: config.redirectUri,
    scopes: config.scopes,
    token: {
      encrypted: token.encrypted,
      updatedAt: token.updatedAt,
      expiresAt: token.expiresAt,
      scope: token.scope,
      error: token.error,
    },
    snapshot: snapshot ? {
      fetchedAt: snapshot.fetchedAt,
      locations: snapshot.locations.length,
      googleReviewCount: snapshot.locations.reduce((sum, location) => sum + location.reviewCount, 0),
    } : null,
  }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
