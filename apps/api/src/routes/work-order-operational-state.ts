import type { PoolClient } from 'pg';

export async function workOrderProductionBlocker(client: PoolClient, tenant: string, workOrder: string): Promise<string | null> {
  const result = await client.query(`SELECT w.status, p.status AS project_status FROM work_orders w
    JOIN projects p ON p.tenant_id=w.tenant_id AND p.id=w.project_id
    WHERE w.tenant_id=$1 AND w.id=$2 AND w.deleted_at IS NULL AND p.deleted_at IS NULL FOR SHARE OF w,p`, [tenant, workOrder]);
  const row = result.rows[0];
  if (!row || ['closed','cancelled','archived','on_hold'].includes(row.status)
    || ['closed','cancelled','archived','on_hold','completed'].includes(row.project_status)) return 'work_order_or_project_not_open_for_production';
  return null;
}
