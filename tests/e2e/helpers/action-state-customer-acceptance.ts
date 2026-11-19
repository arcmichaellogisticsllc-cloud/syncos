import type { Client } from "pg";

/** Add missing customer evidence to isolated action fixtures without resetting their lifecycle states. */
export async function prepareActionCustomerAcceptance(client: Client, tenantId: string, actorId: string, settlementIds: string[], invoiceIds: string[]) {
  const dbUrl = new URL(process.env.DATABASE_URL ?? "");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(dbUrl.hostname) || /staging|production/i.test(dbUrl.pathname)) {
    throw new Error("Action acceptance fixture is restricted to disposable local databases");
  }
  await client.query("BEGIN");
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${tenantId}:action-acceptance-fixture`]);
    const records = await client.query(`SELECT DISTINCT pr.*, v.id AS version_id, v.organization_id AS provider_organization_id,
      v.assigned_crew_id AS version_crew_id, p.customer_organization_id
      FROM production_records pr
      JOIN partner_work_order_versions v ON v.tenant_id=pr.tenant_id AND v.work_order_id=pr.work_order_id AND v.deleted_at IS NULL
      JOIN projects p ON p.tenant_id=pr.tenant_id AND p.id=pr.project_id
      WHERE pr.tenant_id=$1 AND pr.id IN (
        SELECT production_record_id FROM settlement_items WHERE tenant_id=$1 AND settlement_id=ANY($2::uuid[])
        UNION SELECT production_record_id FROM invoice_items WHERE tenant_id=$1 AND invoice_id=ANY($3::uuid[])
      )`, [tenantId, settlementIds.filter(Boolean), invoiceIds.filter(Boolean)]);
    for (const row of records.rows) {
      const existing = await client.query("SELECT id FROM customer_qc_decisions WHERE tenant_id=$1 AND production_record_id=$2 AND deleted_at IS NULL LIMIT 1", [tenantId, row.id]);
      if (existing.rows.length) continue;
      const worker = (await client.query("SELECT worker_id FROM partner_crew_memberships WHERE tenant_id=$1 AND crew_id=$2 AND status='active' AND deleted_at IS NULL ORDER BY (membership_role='foreman') DESC LIMIT 1", [tenantId, row.version_crew_id])).rows[0];
      if (!worker) throw new Error("Action acceptance fixture requires existing crew membership");
      const common = [tenantId,row.project_id,row.work_order_id,row.version_id,row.provider_organization_id,row.capacity_provider_id,row.version_crew_id,worker.worker_id,actorId];
      const jsa = (await client.query("INSERT INTO daily_jsas (tenant_id,project_id,work_order_id,work_order_version_id,organization_id,capacity_provider_id,crew_id,foreman_worker_id,foreman_user_id,work_date,work_location) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,current_date,'Synthetic action-state acceptance') RETURNING id", common)).rows[0];
      const report = (await client.query("INSERT INTO daily_production_reports (tenant_id,project_id,work_order_id,work_order_version_id,organization_id,capacity_provider_id,crew_id,foreman_worker_id,foreman_user_id,work_date,daily_jsa_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,current_date,$10) RETURNING id", [...common,jsa.id])).rows[0];
      const revision = (await client.query("INSERT INTO daily_production_report_revisions (tenant_id,daily_report_id,revision_number,snapshot_json) VALUES ($1,$2,1,'{}') RETURNING id", [tenantId,report.id])).rows[0];
      const cycle = (await client.query("INSERT INTO customer_qc_cycles (tenant_id,project_id,work_order_id,work_order_version_id,daily_report_id,daily_report_revision_id,partner_organization_id,crew_id,qc_authority_organization_id,cycle_number,status,source_reference) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,1,'accepted','synthetic-action-state-customer-evidence') RETURNING id", [tenantId,row.project_id,row.work_order_id,row.version_id,report.id,revision.id,row.provider_organization_id,row.version_crew_id,row.customer_organization_id])).rows[0];
      await client.query("INSERT INTO customer_qc_decisions (tenant_id,qc_cycle_id,production_record_id,decision,reported_quantity,customer_accepted_quantity,unit_of_measure,recorded_by_user_id,source_reference) VALUES ($1,$2,$3,'accepted',$4,$4,$5,$6,'synthetic-action-state-customer-evidence')", [tenantId,cycle.id,row.id,row.quantity_submitted,row.unit ?? row.unit_type,actorId]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
