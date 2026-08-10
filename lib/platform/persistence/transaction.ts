import type { PoolClient } from "pg";
import { getKernelPool } from "@/lib/platform/persistence/pool";

export async function withKernelTransaction<T>(
  callback: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getKernelPool().connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the original transaction error. Pool disposal handles a broken client.
    }
    throw error;
  } finally {
    client.release();
  }
}
