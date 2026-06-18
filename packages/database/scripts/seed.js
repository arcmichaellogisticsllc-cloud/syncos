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
  "signal.create",
  "signal.verify",
  "organization.create",
  "organization.qualify",
  "contact.verify",
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
  "settlement.create",
  "settlement.submit",
  "invoice.create",
  "payment.record",
  "constraint.assign",
  "constraint.close",
  "recommendation.approve",
  "stop_work.issue",
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
