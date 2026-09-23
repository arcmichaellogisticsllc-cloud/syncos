// Synthetic smoke data only. Do not call against a shared staging or production database.
const crypto = require('node:crypto');

async function createCustomerAcceptanceFixture(client, input) {
  const { tenantId, userId, organizationId, providerId, crewId, projectId, workOrderId, productionId, quantity, unit } = input;
  const suffix = crypto.randomUUID().slice(0, 8);
  const provider = (await client.query('SELECT provider_type FROM capacity_providers WHERE tenant_id=$1 AND id=$2', [tenantId, providerId])).rows[0];
  if (!provider || !userId) throw new Error('Customer acceptance fixture requires a provider and recording user');
  const executionModel = provider.provider_type === 'internal_workforce' ? 'internal' : 'partner';
  let agreementId = null;
  let rateScheduleId = null;
  if (executionModel === 'partner') {
    const contract = (await client.query("INSERT INTO contracts (tenant_id,organization_id,name,status) VALUES ($1,$2,$3,'active') RETURNING id", [tenantId,organizationId,`Acceptance fixture ${suffix}`])).rows[0];
    rateScheduleId = (await client.query("INSERT INTO rate_schedules (tenant_id,contract_id,organization_id,name,effective_date,status) VALUES ($1,$2,$3,$4,current_date,'active') RETURNING id", [tenantId,contract.id,organizationId,`Acceptance fixture ${suffix}`])).rows[0].id;
    agreementId = (await client.query('INSERT INTO partner_agreement_versions (tenant_id,organization_id,capacity_provider_id,contract_id,version_number) VALUES ($1,$2,$3,$4,1) RETURNING id', [tenantId,organizationId,providerId,contract.id])).rows[0].id;
  }
  const worker = (await client.query("INSERT INTO workers (tenant_id,capacity_provider_id,crew_id,first_name,last_name) VALUES ($1,$2,$3,'Acceptance','Fixture') RETURNING id", [tenantId,providerId,crewId])).rows[0];
  const version = (await client.query("INSERT INTO partner_work_order_versions (tenant_id,organization_id,capacity_provider_id,project_id,work_order_id,assigned_crew_id,work_order_number,scope_summary,map_work_package_ref,production_unit,execution_model,governing_agreement_version_id,rate_schedule_id) VALUES ($1,$2,$3,$4,$5,$6,$7,'Acceptance fixture','fixture-map',$8,$9,$10,$11) RETURNING id", [tenantId,organizationId,providerId,projectId,workOrderId,crewId,`ACCEPT-${suffix}`,unit,executionModel,agreementId,rateScheduleId])).rows[0];
  const common = [tenantId,projectId,workOrderId,version.id,organizationId,providerId,crewId,worker.id,userId];
  const jsa = (await client.query("INSERT INTO daily_jsas (tenant_id,project_id,work_order_id,work_order_version_id,organization_id,capacity_provider_id,crew_id,foreman_worker_id,foreman_user_id,work_date,work_location) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,current_date,'Acceptance fixture') RETURNING id", common)).rows[0];
  const report = (await client.query('INSERT INTO daily_production_reports (tenant_id,project_id,work_order_id,work_order_version_id,organization_id,capacity_provider_id,crew_id,foreman_worker_id,foreman_user_id,work_date,daily_jsa_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,current_date,$10) RETURNING id', [...common,jsa.id])).rows[0];
  const revision = (await client.query("INSERT INTO daily_production_report_revisions (tenant_id,daily_report_id,revision_number,snapshot_json) VALUES ($1,$2,1,'{}') RETURNING id", [tenantId,report.id])).rows[0];
  const cycle = (await client.query("INSERT INTO customer_qc_cycles (tenant_id,project_id,work_order_id,work_order_version_id,daily_report_id,daily_report_revision_id,partner_organization_id,crew_id,qc_authority_organization_id,cycle_number,status,source_reference) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$7,1,'accepted','synthetic-customer-evidence') RETURNING id", [tenantId,projectId,workOrderId,version.id,report.id,revision.id,organizationId,crewId])).rows[0];
  const decision = (await client.query("INSERT INTO customer_qc_decisions (tenant_id,qc_cycle_id,production_record_id,decision,reported_quantity,customer_accepted_quantity,unit_of_measure,recorded_by_user_id,source_reference) VALUES ($1,$2,$3,'accepted',$4,$4,$5,$6,'synthetic-customer-evidence') RETURNING id", [tenantId,cycle.id,productionId,quantity,unit,userId])).rows[0];
  return decision.id;
}
module.exports = { createCustomerAcceptanceFixture };
