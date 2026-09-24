const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { Client } = require('pg');

test('existing demo roles recover execution duties without reseeding or widening other roles', {
  skip: !process.env.ROLE_PERMISSION_TEST_DATABASE_URL,
}, async () => {
  const client = new Client({ connectionString: process.env.ROLE_PERMISSION_TEST_DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    // All names resolve to temporary tables. No application records are changed.
    await client.query(`
      CREATE TEMP TABLE tenants (id text PRIMARY KEY, slug text);
      CREATE TEMP TABLE roles (id text PRIMARY KEY, tenant_id text, system_key text, deleted_at timestamptz);
      CREATE TEMP TABLE permissions (id text PRIMARY KEY, key text UNIQUE);
      CREATE TEMP TABLE role_permissions (tenant_id text, role_id text, permission_id text, UNIQUE(role_id, permission_id));
      INSERT INTO tenants VALUES ('demo', 'arc-syncos-demo'), ('other', 'another-tenant');
      INSERT INTO roles VALUES
        ('ops', 'demo', 'e2e_ops_manager', NULL),
        ('field', 'demo', 'e2e_field_supervisor', NULL),
        ('reviewer', 'demo', 'e2e_qc_reviewer', NULL),
        ('billing', 'demo', 'e2e_billing_manager', NULL),
        ('unrelated', 'demo', 'custom_field_supervisor', NULL),
        ('other-tenant', 'other', 'e2e_ops_manager', NULL),
        ('deleted', 'demo', 'e2e_ops_manager', now());
    `);
    const catalog = [
      'production_record.read', 'production_record.create', 'production_record.update', 'production_record.submit',
      'production.timeline.read', 'dashboard.operations.read', 'qc_review.read',
      'production_record.archive', 'qc_review.approve', 'qc_review.request_correction',
      'payment_batch.mark_executed', 'invoice.create', 'existing.custom.read',
      'billing.read', 'billing.create_billable', 'billing.create_invoice',
    ];
    for (const key of catalog) await client.query('INSERT INTO permissions VALUES ($1, $1)', [key]);
    await client.query("INSERT INTO role_permissions VALUES ('demo','ops','existing.custom.read')");
    const sql = fs.readFileSync('packages/database/migrations/065_demo_execution_permission_reconciliation.sql', 'utf8');
    await client.query(sql);
    const first = (await client.query('SELECT * FROM role_permissions ORDER BY role_id, permission_id')).rows;
    await client.query(sql);
    assert.deepEqual((await client.query('SELECT * FROM role_permissions ORDER BY role_id, permission_id')).rows, first, 'upgrade is idempotent');
    const grants = role => first.filter(row => row.role_id === role).map(row => row.permission_id).sort();
    const execution = ['production_record.read', 'production_record.create', 'production_record.update', 'production_record.submit'];
    assert.deepEqual(grants('ops'), [...execution, 'production.timeline.read', 'dashboard.operations.read', 'qc_review.read', 'existing.custom.read'].sort());
    assert.deepEqual(grants('field'), execution.sort());
    assert.deepEqual(grants('reviewer'), ['production_record.read']);
    for (const role of ['unrelated', 'other-tenant', 'deleted']) assert.deepEqual(grants(role), [], role);
    assert.deepEqual(grants('billing'), ['billing.read', 'billing.create_billable', 'billing.create_invoice'].sort());
    assert.equal(first.length, 16);
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
});
