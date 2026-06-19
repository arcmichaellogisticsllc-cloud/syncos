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

export async function insertTenantRecord<T extends QueryResultRow>(
  client: PoolClient,
  tableName: string,
  tenantId: string,
  values: Record<string, unknown>,
  returning: string[] = ["*"],
): Promise<T> {
  assertSafeIdentifier(tableName);
  for (const column of [...Object.keys(values), ...returning.filter((column) => column !== "*")]) {
    assertSafeIdentifier(column);
  }

  const columns = ["tenant_id", ...Object.keys(values)];
  const parameters = [tenantId, ...Object.values(values)];
  const placeholders = parameters.map((_, index) => `$${index + 1}`);
  const result = await client.query<T>(
    `
    INSERT INTO ${tableName} (${columns.join(", ")})
    VALUES (${placeholders.join(", ")})
    RETURNING ${returning.join(", ")}
    `,
    parameters,
  );
  return result.rows[0];
}

export async function listTenantRecords<T extends QueryResultRow>(
  client: PoolClient,
  tableName: string,
  tenantId: string,
  options: {
    searchColumns?: string[];
    search?: string;
    orderBy?: string;
    limit?: number;
  } = {},
): Promise<T[]> {
  assertSafeIdentifier(tableName);
  for (const column of [...(options.searchColumns ?? []), options.orderBy ? options.orderBy : "created_at"]) {
    assertSafeIdentifier(column);
  }

  const parameters: unknown[] = [tenantId];
  const clauses = ["tenant_id = $1", "deleted_at IS NULL"];
  if (options.search && options.searchColumns?.length) {
    const searchClauses = options.searchColumns.map((column) => `${column} ILIKE $2`);
    parameters.push(`%${options.search}%`);
    clauses.push(`(${searchClauses.join(" OR ")})`);
  }

  const result = await client.query<T>(
    `
    SELECT *
    FROM ${tableName}
    WHERE ${clauses.join(" AND ")}
    ORDER BY ${options.orderBy ?? "created_at"} DESC
    LIMIT ${options.limit ?? 100}
    `,
    parameters,
  );
  return result.rows;
}

export async function updateTenantRecord<T extends QueryResultRow>(
  client: PoolClient,
  tableName: string,
  tenantId: string,
  id: string,
  values: Record<string, unknown>,
  returning: string[] = ["*"],
): Promise<T | null> {
  assertSafeIdentifier(tableName);
  for (const column of [...Object.keys(values), ...returning.filter((column) => column !== "*")]) {
    assertSafeIdentifier(column);
  }
  if (!Object.keys(values).length) {
    return findTenantRecordById<T>(client, tableName, tenantId, id);
  }

  const assignments = Object.keys(values).map((column, index) => `${column} = $${index + 3}`);
  if (!Object.prototype.hasOwnProperty.call(values, "updated_at")) {
    assignments.push("updated_at = now()");
  }
  const result = await client.query<T>(
    `
    UPDATE ${tableName}
    SET ${assignments.join(", ")}
    WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
    RETURNING ${returning.join(", ")}
    `,
    [tenantId, id, ...Object.values(values)],
  );
  return result.rows[0] ?? null;
}

function assertSafeIdentifier(identifier: string): void {
  if (!/^[a-z_][a-z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe SQL identifier: ${identifier}`);
  }
}
