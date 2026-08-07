import assert from "node:assert/strict";
import { crewMemberForEmail, normalizeCrewEmail } from "../lib/crew-auth";
import {
  opsAccessConfigured,
  verifyCloudflareAccessJwt,
  verifyOpsAccessJwt,
} from "../lib/cloudflare-access";

function base64Url(value: Uint8Array | string): string {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  return Buffer.from(bytes).toString("base64url");
}

async function main() {
  process.env.OPS_CREW_ACCESS_TEAM_DOMAIN = "https://crew-test.cloudflareaccess.com";
  process.env.OPS_CREW_ACCESS_AUD = "crew-test-audience";
  process.env.OPS_ACCESS_TEAM_DOMAIN = "https://crew-test.cloudflareaccess.com";
  process.env.OPS_ACCESS_AUD = "ops-test-audience";
  process.env.OPS_CREW_ROSTER_JSON = JSON.stringify([
    { employee: "Test Crew Member", email: "crew@example.com", active: true },
  ]);

  assert.equal(normalizeCrewEmail(" Crew@Example.com "), "crew@example.com");
  assert.equal(crewMemberForEmail("CREW@example.com")?.employee, "Test Crew Member");

  const keyPair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  const kid = "crew-test-key";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ keys: [{ ...publicJwk, kid }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

  try {
    const now = Math.floor(Date.now() / 1000);
    const header = base64Url(JSON.stringify({ alg: "RS256", kid, typ: "JWT" }));
    const payload = base64Url(JSON.stringify({
      iss: process.env.OPS_CREW_ACCESS_TEAM_DOMAIN,
      aud: process.env.OPS_CREW_ACCESS_AUD,
      email: "crew@example.com",
      iat: now,
      exp: now + 300,
    }));
    const unsigned = `${header}.${payload}`;
    const signature = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      keyPair.privateKey,
      new TextEncoder().encode(unsigned),
    );
    const token = `${unsigned}.${base64Url(new Uint8Array(signature))}`;

    assert.equal(await verifyCloudflareAccessJwt(token), "crew@example.com");
    assert.equal(await verifyCloudflareAccessJwt(`${token}tampered`), null);

    const opsPayload = base64Url(JSON.stringify({
      iss: process.env.OPS_ACCESS_TEAM_DOMAIN,
      aud: process.env.OPS_ACCESS_AUD,
      email: "operator@junk-king.com",
      iat: now,
      exp: now + 300,
    }));
    const opsUnsigned = `${header}.${opsPayload}`;
    const opsSignature = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      keyPair.privateKey,
      new TextEncoder().encode(opsUnsigned),
    );
    const opsToken = `${opsUnsigned}.${base64Url(new Uint8Array(opsSignature))}`;

    assert.equal(opsAccessConfigured(), true);
    assert.equal(await verifyOpsAccessJwt(opsToken), "operator@junk-king.com");
    assert.equal(await verifyOpsAccessJwt(token), null);
    console.log("Crew and OpsCenter Cloudflare Access JWT checks passed.");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
