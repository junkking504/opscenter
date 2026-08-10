import type { PoolClient } from "pg";
import type { PlatformActor } from "@/lib/platform/contracts";
import { createPlatformId } from "@/lib/platform/identifiers";
import { getKernelPool } from "@/lib/platform/persistence/pool";
import { withKernelTransaction } from "@/lib/platform/persistence/transaction";

type ActorRow = {
  id: string;
  kind: PlatformActor["kind"];
  external_identity: string;
  display_name: string;
};

async function rolesForActor(client: PoolClient, actorId: string): Promise<PlatformActor["roles"]> {
  const result = await client.query<{ role: PlatformActor["roles"][number]["role"]; resource_scope: string }>(
    "SELECT role, resource_scope FROM opscenter_kernel.actor_roles WHERE actor_id = $1 ORDER BY role, resource_scope",
    [actorId],
  );
  return result.rows.map((row) => ({ role: row.role, resourceScope: row.resource_scope }));
}

export async function ensureHumanOperator(email: string): Promise<PlatformActor> {
  const identity = String(email || "").trim().toLowerCase();
  if (!identity) throw new Error("An authenticated identity is required.");

  return withKernelTransaction(async (client) => {
    const result = await client.query<ActorRow>(
      `
        INSERT INTO opscenter_kernel.actors (id, kind, external_identity, display_name)
        VALUES ($1, 'human', $2, $3)
        ON CONFLICT (kind, external_identity)
        DO UPDATE SET display_name = EXCLUDED.display_name, updated_at = now()
        RETURNING id, kind, external_identity, display_name
      `,
      [createPlatformId("actor"), identity, identity.split("@")[0] || identity],
    );
    const actor = result.rows[0];
    await client.query(
      `
        INSERT INTO opscenter_kernel.actor_roles (actor_id, role, resource_scope)
        VALUES ($1, 'operator', '*')
        ON CONFLICT DO NOTHING
      `,
      [actor.id],
    );
    return {
      id: actor.id,
      kind: actor.kind,
      externalIdentity: actor.external_identity,
      displayName: actor.display_name,
      roles: await rolesForActor(client, actor.id),
    };
  });
}

export async function actorDisplayNames(actorIds: string[]): Promise<Map<string, string>> {
  const uniqueIds = Array.from(new Set(actorIds.filter(Boolean)));
  if (!uniqueIds.length) return new Map();
  const result = await getKernelPool().query<{ id: string; display_name: string }>(
    "SELECT id, display_name FROM opscenter_kernel.actors WHERE id = ANY($1::text[])",
    [uniqueIds],
  );
  return new Map(result.rows.map((row) => [row.id, row.display_name]));
}
