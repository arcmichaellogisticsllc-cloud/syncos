import { BadRequestException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { requireCustomerAcceptedBilling } from './customer-accepted-billing';
import { lockWorkSafety } from './work-safety';

// Closing an operational record is not customer acceptance. Recheck the source
// records in the same transaction before allowing the lifecycle transition.
export async function requireWorkOrderCloseout(client: PoolClient, tenant: string, workOrder: string) {
  await lockWorkSafety(client, tenant, workOrder);
  const blocked = await client.query(`SELECT
    EXISTS(SELECT 1 FROM work_safety_controls WHERE tenant_id=$1 AND work_order_id=$2 AND control_type='stop' AND status='active')
    OR EXISTS(SELECT 1 FROM production_records WHERE tenant_id=$1 AND work_order_id=$2 AND stop_work_status='active') AS safety,
    EXISTS(SELECT 1 FROM daily_production_reports WHERE tenant_id=$1 AND work_order_id=$2 AND deleted_at IS NULL AND status <> 'void'
      AND (status <> 'submitted' OR completeness_status IS DISTINCT FROM 'complete')) AS reports,
    EXISTS(SELECT 1 FROM production_corrections pc JOIN production_records pr ON pr.tenant_id=pc.tenant_id AND pr.id=pc.production_record_id
      WHERE pr.tenant_id=$1 AND pr.work_order_id=$2 AND pc.deleted_at IS NULL AND pc.status NOT IN ('resolved','cancelled')) AS corrections`, [tenant, workOrder]);
  if (blocked.rows[0].safety) throw new BadRequestException('Release active safety holds before closing work');
  if (blocked.rows[0].reports) throw new BadRequestException('Submit and review all daily reports before closing work');
  if (blocked.rows[0].corrections) throw new BadRequestException('Resolve customer corrections before closing work');
  const records = await client.query(`SELECT id FROM production_records WHERE tenant_id=$1 AND work_order_id=$2 AND deleted_at IS NULL
    AND COALESCE(quantity_submitted, quantity, 0)>0 ORDER BY id`, [tenant, workOrder]);
  if (!records.rows.length) throw new BadRequestException('Customer-accepted production is required before closing work');
  for (const record of records.rows) await requireCustomerAcceptedBilling(client, tenant, record.id);
}
