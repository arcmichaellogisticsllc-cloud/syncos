import type { PoolClient, QueryResultRow } from "pg";

export type TenantScope = {
  tenantId: string;
};

export async function findTenantRecordById<T extends QueryResultRow>(
  client: PoolClient,
  tableName: string,
  tenantId: string,
  id: string,
): Promise<T | null> {
  assertSafeIdentifier(tableName);
  const result = await client.query<T>(
    `SELECT * FROM ${tableName} WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL LIMIT 1`,
    [tenantId, id],
  );
  return result.rows[0] ?? null;
}

export async function assertTenantRecordExists(
  client: PoolClient,
  tableName: string,
  tenantId: string,
  id: string,
): Promise<void> {
  const record = await findTenantRecordById(client, tableName, tenantId, id);
  if (!record) {
    throw new Error(`Record not found in tenant scope: ${tableName}.${id}`);
  }
}

function assertSafeIdentifier(identifier: string): void {
  if (!/^[a-z_][a-z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe SQL identifier: ${identifier}`);
  }
}
