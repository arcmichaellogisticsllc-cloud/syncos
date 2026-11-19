const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Client } = require('pg');
const database = process.env.SYNCOS_REPAIR_TEST_DATABASE_URL;
test('submitted payment failure metadata is allowed without reopening frozen instructions', { skip: !database }, async () => {
  const url = new URL(database);
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname) && /^syncos_synthetic_/.test(url.pathname.slice(1)));
  const db = new Client({ connectionString: database });
  await db.connect();
  try {
    const tenant = (await db.query("INSERT INTO tenants(name,slug) VALUES('Synthetic failure guard',$1) RETURNING id", [randomUUID()])).rows[0].id;
    async function fixture(batchState = 'submitted', itemState = 'submitted_later') {
      const payable = (await db.query("INSERT INTO contractor_payables(tenant_id,payable_number,payable_type,payable_party_type,net_payable_amount) VALUES($1,$2,'subcontractor','capacity_provider',100) RETURNING id", [tenant, randomUUID()])).rows[0].id;
      const batch = (await db.query("INSERT INTO payment_batches(tenant_id,payment_batch_number,batch_type,payment_method) VALUES($1,$2,'contractor_payable','manual') RETURNING id", [tenant, randomUUID()])).rows[0].id;
      const item = (await db.query("INSERT INTO payment_items(tenant_id,payment_batch_id,source_type,contractor_payable_id,payee_type,payee_name,payment_method,payment_amount,status,execution_status) VALUES($1,$2,'contractor_payable',$3,'capacity_provider','Synthetic','manual',10,$4,$5) RETURNING id", [tenant,batch,payable,itemState,itemState === 'draft' ? 'not_submitted' : itemState])).rows[0].id;
      await db.query('UPDATE payment_batches SET status=$2 WHERE id=$1', [batch,batchState]);
      return item;
    }
    const item = await fixture();
    for (const extra of [', payment_amount=20', ", payee_name='Changed'", ', contractor_payable_id=NULL']) {
      await assert.rejects(db.query("UPDATE payment_items SET status='failed',execution_status='failed',failure_reason='Synthetic decline'" + extra + ' WHERE id=$1', [item]), /Withdraw approval/);
      const row = (await db.query('SELECT status,payment_amount,failure_reason FROM payment_items WHERE id=$1', [item])).rows[0];
      assert.equal(row.status, 'submitted_later');
      assert.equal(Number(row.payment_amount), 10);
      assert.equal(row.failure_reason, null);
    }
    await db.query("UPDATE payment_items SET status='failed',execution_status='failed',failure_reason='Synthetic decline',failure_note='Local test only' WHERE id=$1", [item]);
    assert.equal((await db.query('SELECT failure_reason FROM payment_items WHERE id=$1',[item])).rows[0].failure_reason, 'Synthetic decline');
    await assert.rejects(db.query("UPDATE payment_items SET failure_note='Rewrite' WHERE id=$1",[item]), /Withdraw approval/);
    for (const [batch, child] of [['approved','submitted_later'], ['executed_later','submitted_later'], ['submitted','draft']]) {
      const blocked = await fixture(batch, child);
      await assert.rejects(db.query("UPDATE payment_items SET status='failed',execution_status='failed',failure_reason='Forbidden transition' WHERE id=$1",[blocked]), /Withdraw approval/);
    }
  } finally { await db.end(); }
});
