import { expect } from "@playwright/test";
import { countTables, type CountMap } from "./db";

export async function captureBoundaryCounts(tenantId: string, tables: string[]): Promise<CountMap> {
  return countTables(tenantId, tables);
}

export async function expectBoundaryUnchanged(tenantId: string, before: CountMap, label: string): Promise<void> {
  const after = await countTables(tenantId, Object.keys(before));
  for (const [table, beforeCount] of Object.entries(before)) {
    expect(after[table], `${label}: ${table} count changed`).toBe(beforeCount);
  }
}
