const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { Client } = require('pg');

test('demo crew repair preserves existing ownership and unrelated records', { skip: !process.env.SYNCOS_REPAIR_TEST_DATABASE_URL }, async () => {
  const url = new URL(process.env.SYNCOS_REPAIR_TEST_DATABASE_URL);
  assert.match(url.pathname, /(?:test|rehearsal)/, 'requires a disposable test database');
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  await client.query('BEGIN');
  try {
    const id = '823b9068-cb2d-5556-a1c4-9a0d788d2614';
    const expected = 'a289a7f6-2459-5402-867f-809d8981a6b8';
    // Session-local synthetic tables make the migration regression independent of seed data.
    await client.query(`
      CREATE TEMP TABLE tenants (id uuid PRIMARY KEY, slug text);
      CREATE TEMP TABLE capacity_providers (id uuid PRIMARY KEY, tenant_id uuid, organization_id uuid, deleted_at timestamptz);
      CREATE TEMP TABLE organizations (id uuid PRIMARY KEY, tenant_id uuid);
      CREATE TEMP TABLE crews (id uuid PRIMARY KEY, tenant_id uuid, capacity_provider_id uuid, organization_id uuid, deleted_at timestamptz);
      INSERT INTO tenants VALUES ('8b4ceb5b-5614-5b83-bfc4-16c793832202','arc-syncos-demo');
      INSERT INTO organizations VALUES ('a289a7f6-2459-5402-867f-809d8981a6b8','8b4ceb5b-5614-5b83-bfc4-16c793832202'), ('00000000-0000-4000-8000-000000000001','8b4ceb5b-5614-5b83-bfc4-16c793832202');
      INSERT INTO capacity_providers VALUES ('0d64b6e6-7fa7-5317-8bf2-17e3b505d116','8b4ceb5b-5614-5b83-bfc4-16c793832202','a289a7f6-2459-5402-867f-809d8981a6b8',NULL);
      INSERT INTO crews VALUES ('823b9068-cb2d-5556-a1c4-9a0d788d2614','8b4ceb5b-5614-5b83-bfc4-16c793832202','0d64b6e6-7fa7-5317-8bf2-17e3b505d116',NULL,NULL), ('00000000-0000-4000-8000-000000000002','8b4ceb5b-5614-5b83-bfc4-16c793832202','0d64b6e6-7fa7-5317-8bf2-17e3b505d116','00000000-0000-4000-8000-000000000001',NULL);
    `);
    const sql = fs.readFileSync(require.resolve('../packages/database/migrations/069_demo_crew_organization_link.sql'), 'utf8');
    const before = await client.query('SELECT id, organization_id FROM crews WHERE id <> $1 ORDER BY id', [id]);
    assert.equal((await client.query('UPDATE crews SET organization_id=NULL WHERE id=$1 RETURNING id', [id])).rowCount, 1);
    assert.equal((await client.query(sql)).rowCount, 1);
    assert.equal((await client.query('SELECT organization_id FROM crews WHERE id=$1', [id])).rows[0].organization_id, expected);
    assert.equal((await client.query(sql)).rowCount, 0, 'rerun must be idempotent');
    const other = (await client.query('SELECT id FROM organizations WHERE id <> $1 AND tenant_id=$2 LIMIT 1', [expected, '8b4ceb5b-5614-5b83-bfc4-16c793832202'])).rows[0].id;
    await client.query('UPDATE crews SET organization_id=$2 WHERE id=$1', [id, other]);
    assert.equal((await client.query(sql)).rowCount, 0, 'existing non-null ownership is never overwritten');
    assert.equal((await client.query('SELECT organization_id FROM crews WHERE id=$1', [id])).rows[0].organization_id, other);
    assert.deepEqual((await client.query('SELECT id, organization_id FROM crews WHERE id <> $1 ORDER BY id', [id])).rows, before.rows);
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
});
