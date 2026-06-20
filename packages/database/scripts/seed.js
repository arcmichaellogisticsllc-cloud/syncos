const { Client } = require("pg");
const crypto = require("node:crypto");

const roles = [
  "Executive",
  "Growth Director",
  "Regional Director",
  "Operations Manager",
  "Project Manager",
  "Foreman",
  "Recruiter",
  "Compliance Manager",
  "Safety Manager",
  "QC Manager",
  "Billing Manager",
  "Finance Manager",
  "Contractor Admin",
  "Contractor Foreman",
  "Customer Viewer",
  "Customer Validator",
  "Customer Financial Authority",
  "System Admin",
  "AI/System",
];

const permissions = [
  "territory.read",
  "territory.create",
  "territory.update",
  "territory.archive",
  "organization.read",
  "signal.create",
  "signal.verify",
  "organization.create",
  "organization.update",
  "organization.qualify",
  "organization.archive",
  "organization.assign_owner",
  "organization.timeline.read",
  "organization.audit.read",
  "contact.read",
  "contact.create",
  "contact.update",
  "contact.verify",
  "contact.archive",
  "contact.assign_owner",
  "contact.mark_invalid",
  "contact.mark_relationship_active",
  "contact.timeline.read",
  "contact.audit.read",
  "relationship.manage",
  "candidate.convert",
  "opportunity.approve",
  "capacity.qualify",
  "capacity.verify",
  "capacity.activate",
  "capacity.deploy",
  "production.submit",
  "production.qc_review",
  "production.approve",
  "production.mark_billable",
  "contract.read",
  "contract.create",
  "contract.update",
  "contract.archive",
  "rate_schedule.read",
  "rate_schedule.create",
  "rate_schedule.update",
  "rate_schedule.archive",
  "rate_code.read",
  "rate_code.create",
  "rate_code.update",
  "rate_code.archive",
  "settlement.read",
  "settlement.create",
  "settlement.update",
  "settlement.internal_review",
  "settlement.ready_to_submit",
  "settlement.submit",
  "settlement.customer_review",
  "settlement.approve",
  "settlement.dispute",
  "settlement.archive",
  "settlement_item.read",
  "settlement_item.create",
  "settlement_item.update",
  "settlement_item.archive",
  "invoice.read",
  "invoice.create",
  "invoice.update",
  "invoice.submit",
  "invoice.mark_overdue",
  "invoice.archive",
  "ar.read",
  "ar.archive",
  "payment.read",
  "payment.create",
  "payment.update",
  "payment.reconcile",
  "payment.archive",
  "payment.record",
  "constraint.read",
  "constraint.create",
  "constraint.update",
  "constraint.assign",
  "constraint.escalate",
  "constraint.resolve",
  "constraint.verify",
  "constraint.close",
  "constraint.archive",
  "constraint.detect",
  "recommendation.read",
  "recommendation.create",
  "recommendation.update",
  "recommendation.approve",
  "recommendation.reject",
  "recommendation.defer",
  "recommendation.convert_workflow",
  "recommendation.complete",
  "recommendation.measure",
  "recommendation.archive",
  "workflow_definition.read",
  "workflow_definition.create",
  "workflow_definition.update",
  "workflow_definition.archive",
  "workflow_step.read",
  "workflow_step.create",
  "workflow_step.update",
  "workflow_step.archive",
  "workflow_instance.read",
  "workflow_instance.create",
  "workflow_instance.update",
  "workflow_instance.start",
  "workflow_instance.complete",
  "workflow_instance.cancel",
  "workflow_instance.archive",
  "workflow_task.read",
  "workflow_task.update",
  "workflow_task.complete",
  "workflow_task.reassign",
  "workflow_task.escalate",
  "workflow_task.archive",
  "kpi.read",
  "kpi.create",
  "kpi.update",
  "kpi.archive",
  "kpi.calculate",
  "kpi_history.read",
  "kpi_alert.read",
  "kpi_alert.archive",
  "dashboard.executive.read",
  "dashboard.growth.read",
  "dashboard.operations.read",
  "dashboard.finance.read",
  "dashboard.constraints.read",
  "dashboard.recommendations.read",
  "dashboard.workflows.read",
  "dashboard.kpis.read",
  "learning_event.read",
  "learning_event.create",
  "learning_event.update",
  "learning_event.archive",
  "learning_score.read",
  "learning_score.create",
  "learning_score.update",
  "learning_score.recalculate",
  "learning_score.archive",
  "score_history.read",
  "stop_work.issue",
  "signal.read",
  "signal.update",
  "signal.categorize",
  "signal.score",
  "signal.archive",
  "signal.assign_owner",
  "signal.timeline.read",
  "signal.audit.read",
  "signal_evidence.read",
  "signal_evidence.create",
  "signal_evidence.update",
  "signal_evidence.archive",
  "signal_entity.create",
  "signal_entity.archive",
  "search.read",
  "relationship_map.read",
  "relationship_map.create",
  "relationship_map.update",
  "relationship_map.archive",
  "relationship_map.status",
  "relationship_path.read",
  "relationship_path.create",
  "relationship_path.update",
  "relationship_path.archive",
  "relationship_path.rank",
  "opportunity_candidate.read",
  "opportunity_candidate.create",
  "opportunity_candidate.update",
  "opportunity_candidate.monitor",
  "opportunity_candidate.investigate",
  "opportunity_candidate.qualify",
  "opportunity_candidate.reject",
  "opportunity_candidate.archive",
  "opportunity_candidate.score",
  "candidate_signal.read",
  "candidate_signal.create",
  "candidate_signal.update",
  "candidate_signal.archive",
  "opportunity.read",
  "opportunity.create",
  "opportunity.update",
  "opportunity.pursuit_approve",
  "opportunity.pursue",
  "opportunity.proposal",
  "opportunity.negotiation",
  "opportunity.award",
  "opportunity.lost",
  "opportunity.defer",
  "opportunity.archive",
  "opportunity.score",
  "capacity_requirement.read",
  "capacity_requirement.create",
  "capacity_requirement.update",
  "capacity_requirement.archive",
  "capacity_provider.read",
  "capacity_provider.create",
  "capacity_provider.update",
  "capacity_provider.qualify",
  "capacity_provider.verify",
  "capacity_provider.contract",
  "capacity_provider.activate",
  "capacity_provider.suspend",
  "capacity_provider.archive",
  "crew.read",
  "crew.create",
  "crew.update",
  "crew.archive",
  "worker.read",
  "worker.create",
  "worker.update",
  "worker.archive",
  "equipment.read",
  "equipment.create",
  "equipment.update",
  "equipment.archive",
  "compliance_document.read",
  "compliance_document.create",
  "compliance_document.update",
  "compliance_document.verify",
  "compliance_document.archive",
  "capacity_record.read",
  "capacity_record.create",
  "capacity_record.update",
  "capacity_record.score",
  "capacity_record.archive",
  "capacity_gap_analysis.read",
  "capacity_gap_analysis.create",
  "project.read",
  "project.create",
  "project.update",
  "project.archive",
  "work_order.read",
  "work_order.create",
  "work_order.update",
  "work_order.assign",
  "work_order.start",
  "work_order.archive",
  "production_record.read",
  "production_record.create",
  "production_record.update",
  "production_record.submit",
  "production_record.correction_required",
  "production_record.archive",
  "qc.review",
  "qc.accept",
  "qc.reject",
  "qc.approve",
  "production.clear_correction",
  "stop_work.release",
  "production_evidence.read",
  "production_evidence.create",
  "production_evidence.update",
  "production_evidence.archive",
  "admin.manage_users",
  "admin.manage_roles",
  "system.test_object.read",
  "system.test_object.write",
];

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }

  const client = new Client({ connectionString });
  await client.connect();
  await client.query("BEGIN");
  try {
    const tenantResult = await client.query(
      `
      INSERT INTO tenants (name, slug)
      VALUES ('Jackson Telcom', 'jackson-telcom')
      ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
      RETURNING id
      `,
    );
    const tenantId = tenantResult.rows[0].id;

    for (const key of permissions) {
      await client.query(
        `
        INSERT INTO permissions (key, name)
        VALUES ($1, $2)
        ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name
        `,
        [key, key],
      );
    }

    for (const name of roles) {
      await client.query(
        `
        INSERT INTO roles (tenant_id, name, system_key)
        VALUES ($1, $2, $3)
        ON CONFLICT (tenant_id, name) DO UPDATE SET system_key = EXCLUDED.system_key
        `,
        [tenantId, name, name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")],
      );
    }

    const passwordHash = crypto.createHash("sha256").update("local-dev-password").digest("hex");
    const userResult = await client.query(
      `
      INSERT INTO users (email, display_name, password_hash)
      VALUES ('admin@jackson-telcom.local', 'Jackson Telcom Admin', $1)
      ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name, password_hash = EXCLUDED.password_hash
      RETURNING id
      `,
      [passwordHash],
    );
    const userId = userResult.rows[0].id;
    const tenantUserResult = await client.query(
      `
      INSERT INTO tenant_users (tenant_id, user_id)
      VALUES ($1, $2)
      ON CONFLICT (tenant_id, user_id) DO UPDATE SET status = 'active'
      RETURNING id
      `,
      [tenantId, userId],
    );
    const tenantUserId = tenantUserResult.rows[0].id;
    const systemAdminRole = await client.query(
      "SELECT id FROM roles WHERE tenant_id = $1 AND name = 'System Admin'",
      [tenantId],
    );

    await client.query(
      `
      INSERT INTO user_roles (tenant_id, tenant_user_id, role_id, scope_type, scope_id)
      VALUES ($1, $2, $3, 'tenant', $1)
      ON CONFLICT (tenant_user_id, role_id, scope_type, scope_id) DO NOTHING
      `,
      [tenantId, tenantUserId, systemAdminRole.rows[0].id],
    );

    await client.query(
      `
      INSERT INTO role_permissions (tenant_id, role_id, permission_id)
      SELECT $1, $2, p.id
      FROM permissions p
      ON CONFLICT (role_id, permission_id) DO NOTHING
      `,
      [tenantId, systemAdminRole.rows[0].id],
    );

    await client.query("COMMIT");
    console.log(`seeded tenant ${tenantId}`);
    console.log(`seeded admin user ${userId}`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
