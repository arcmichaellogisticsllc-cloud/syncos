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
