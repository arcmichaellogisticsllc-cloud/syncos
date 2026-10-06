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
    // Build session-local typed fixtures so the test also works on a freshly migrated CI database.
    const tenant=randomUUID(),organization=randomUUID(),crew=randomUUID(),worker=randomUUID(),version=randomUUID(),project=randomUUID(),order=randomUUID();
    for(const table of ['crews','workers','partner_work_order_versions','work_orders','projects','organizations','daily_jsas','daily_production_reports'])await client.query(`CREATE TEMP TABLE ${table} AS SELECT * FROM public.${table} WITH NO DATA`);
    await client.query("INSERT INTO crews(id,tenant_id,name) VALUES($1,$2,'Synthetic history crew')",[crew,tenant]);
    await client.query("INSERT INTO workers(id,tenant_id,first_name,last_name) VALUES($1,$2,'Synthetic','Foreman')",[worker,tenant]);
    await client.query("INSERT INTO partner_work_order_versions(id,tenant_id,work_order_number) VALUES($1,$2,'SYNTHETIC-HISTORY')",[version,tenant]);
    await client.query('INSERT INTO work_orders(id,tenant_id) VALUES($1,$2)',[order,tenant]);
    await client.query("INSERT INTO projects(id,tenant_id,name) VALUES($1,$2,'Synthetic history project')",[project,tenant]);
    await client.query("INSERT INTO organizations(id,tenant_id,name) VALUES($1,$2,'Synthetic history partner')",[organization,tenant]);
    for (const table of ['daily_jsas','daily_production_reports']) {
      const sample={tenant_id:tenant,organization_id:organization};
      const common='id,tenant_id,organization_id,crew_id,work_order_version_id,work_date,created_at';
      const values="gen_random_uuid(),$1,$2,$3,$4,'2026-01-01'::date,'2026-01-01'::timestamptz+(n % 3)*interval '1 microsecond'";
      if(table==='daily_jsas')await client.query(`INSERT INTO daily_jsas(${common},foreman_worker_id) SELECT ${values},$5 FROM generate_series(1,205)n`,[tenant,organization,crew,version,worker]);
      else await client.query(`INSERT INTO daily_production_reports(${common},work_order_id,project_id) SELECT ${values},$5,$6 FROM generate_series(1,205)n`,[tenant,organization,crew,version,order,project]);
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
