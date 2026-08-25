import type { PoolClient } from "pg";

export function normalizePartnerAccountEmail(email: string) {
  return email.trim().toLowerCase();
}

export function partnerAccountOrganizationLockKey(tenantId: string, email: string) {
  return `partner-account:${tenantId}:${normalizePartnerAccountEmail(email)}`;
}

export async function lockPartnerAccountOrganizationBinding(client: PoolClient, tenantId: string, email: string) {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [partnerAccountOrganizationLockKey(tenantId, email)]);
}
