import { NextRequest, NextResponse } from "next/server";
import { getPodiumConfig, podiumUrl, PODIUM_STATE_COOKIE } from "@/lib/podium-config";
import { exchangePodiumAuthorizationCode } from "@/lib/podium-oauth";

export const dynamic = "force-dynamic";

function jsonError(status: number, message: string) {
  return NextResponse.json(
    { ok: false, message },
    { status, headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}

export async function GET(request: NextRequest) {
  const config = getPodiumConfig();
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const cookieState = request.cookies.get(PODIUM_STATE_COOKIE)?.value || "";
  if (!state || !cookieState || state !== cookieState) return jsonError(400, "Missing or invalid Podium OAuth state.");
  if (!config.ready) return jsonError(503, `Podium connection is missing: ${config.missing.join(", ")}.`);
  if (error) return jsonError(400, `Podium authorization was not completed: ${error}.`);
  if (!code) return jsonError(400, "Podium did not return an authorization code.");
  try {
    await exchangePodiumAuthorizationCode(code);
    const response = NextResponse.redirect(podiumUrl("/marketing?section=reviews&podium=connected"));
    response.cookies.set(PODIUM_STATE_COOKIE, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/api/integrations/podium",
      maxAge: 0,
    });
    response.headers.set("Cache-Control", "no-store, max-age=0");
    return response;
  } catch (caught) {
    return jsonError(502, caught instanceof Error ? caught.message : "Podium token exchange failed.");
  }
}
