const test = require('node:test');
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const {Pool} = require('pg');
const {SyncfieldController} = require('../apps/api/dist/routes/syncfield.controller');
const url = process.env.SYNCOS_COMMERCIAL_TEST_DATABASE_URL;

test('company safety, production and customer QC history reach older records with scoped cursors', {skip: !url}, async () => {
  const pool = new Pool({connectionString:url});
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Temporary copies exercise the real controller joins without adding business records.
    for (const table of ['daily_jsas','daily_production_reports']) {
      const sample = (await client.query(`SELECT * FROM public.${table} WHERE deleted_at IS NULL LIMIT 1`)).rows[0];
      assert.ok(sample, `Seed a synthetic ${table} fixture first`);
      await client.query(`CREATE TEMP TABLE ${table} AS SELECT * FROM public.${table} WITH NO DATA`);
      const columns = Object.keys(sample);
      const replacements = {id:'gen_random_uuid()', created_at:"'2026-01-01'::timestamptz + (n % 3)*interval '1 microsecond'"};
      // Preserve native enum types by selecting the original typed row.
      const selected = columns.map(column => replacements[column] || `source."${column}"`).join(',');
      await client.query(`INSERT INTO ${table} SELECT ${selected} FROM public.${table} source CROSS JOIN generate_series(1,205) n WHERE source.id=$1`,[sample.id]);
      if(table === 'daily_production_reports') await client.query("UPDATE daily_production_reports SET status='submitted',general_notes='History % literal'");
      const controller = new SyncfieldController(pool,{});
      controller.withClient = operation => operation(client);
      controller.requirePartnerAdmin = async () => ({tenant_id:sample.tenant_id,organization:{id:sample.organization_id}});
      const methods = table === 'daily_jsas' ? ['partnerJsas'] : ['partnerProductionReports','customerQcCompletenessQueue'];
      for(const method of methods){
        const seen = new Set(); let before;
        do {
          const query = before ? {before} : {};
          const rows = await controller[method]({auth:{tenantId:sample.tenant_id,userId:randomUUID()},query}, query);
          assert.ok(rows.length<=100);
          for(const row of rows){assert.ok(row._history_cursor);assert.ok(!seen.has(row.id));seen.add(row.id);}
          before=rows.length===100?rows.at(-1)._history_cursor:null;
        } while(before);
        assert.equal(seen.size,205,method);
        const query={history_q:'%'};
        if(table==='daily_production_reports')assert.equal((await controller[method]({auth:{tenantId:sample.tenant_id},query},query)).length,100);
        await assert.rejects(controller[method]({auth:{tenantId:sample.tenant_id},query:{before:'invalid'}},{before:'invalid'}),/Invalid activity/);
        if(method==='customerQcCompletenessQueue')assert.equal((await controller[method]({auth:{tenantId:randomUUID()},query:{}})).length,0);
        else{
          controller.requirePartnerAdmin=async()=>({tenant_id:sample.tenant_id,organization:{id:randomUUID()}});
          assert.equal((await controller[method]({auth:{tenantId:sample.tenant_id},query:{}},{})).length,0);
          controller.requirePartnerAdmin=async()=>({tenant_id:sample.tenant_id,organization:{id:sample.organization_id}});
        }
      }
    }
  } finally {await client.query('ROLLBACK');client.release();await pool.end();}
});
