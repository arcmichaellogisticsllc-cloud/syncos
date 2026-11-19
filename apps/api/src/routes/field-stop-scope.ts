import type { PoolClient } from 'pg';

// A record-originated stop covers its crew's entire work order. This prevents
// new reports and offline replay from bypassing the stopped record.
export async function lockFieldWork(client: PoolClient, tenantId: string, workOrderId: string, crewId: string) {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${tenantId}:field-work:${workOrderId}:${crewId}`]);
}
export async function hasActiveFieldStop(client: PoolClient, tenantId: string, workOrderId: string, crewId: string) {
  await lockFieldWork(client, tenantId, workOrderId, crewId);
  const result = await client.query(`SELECT id FROM production_records WHERE tenant_id=$1 AND work_order_id=$2
    AND crew_id=$3 AND stop_work_status='active' LIMIT 1`, [tenantId, workOrderId, crewId]);
  // Archiving a record cannot silently release a safety stop.
  return result.rows.length > 0;
}
