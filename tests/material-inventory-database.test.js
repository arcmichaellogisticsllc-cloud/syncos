const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{Pool}=require('pg');
const {MaterialInventoryController}=require('../apps/api/dist/routes/material-inventory.controller');
const url=process.env.SYNCOS_COMMERCIAL_TEST_DATABASE_URL;
test('material ledger conserves stock through retries, concurrent transfers, scrap and approved count reconciliation',{skip:!url},async()=>{
 const pool=new Pool({connectionString:url});try{
 const tag=randomUUID(),tenant=(await pool.query("INSERT INTO tenants(name,slug) VALUES('Synthetic materials',$1) RETURNING id",['materials-'+tag])).rows[0].id;
 const other=(await pool.query("INSERT INTO tenants(name,slug) VALUES('Other materials',$1) RETURNING id",['materials-other-'+tag])).rows[0].id;
 const user=(await pool.query("INSERT INTO users(email,display_name) VALUES($1,'Synthetic material owner') RETURNING id",[tag+'@synthetic.test'])).rows[0].id;
 const r={auth:{tenantId:tenant,userId:user}},foreign={auth:{tenantId:other,userId:user}},c=new MaterialInventoryController(pool);
 const lot=await c.lot(r,{label:'Fiber',serial_number:'SYNTHETIC-REEL',unit:'feet'}),wh=await c.location(r,{label:'Warehouse'}),crew=await c.location(r,{label:'Crew custody'});
 const receipt={lot_id:lot.id,to_location_id:wh.id,quantity:'1000.0001',kind:'receipt',reference:'Synthetic supplier receipt',reason:'Opening receipt',request_key:randomUUID()};
 const [a,b]=await Promise.all([c.move(r,receipt),c.move(r,receipt)]);assert.equal(a.id,b.id);
 await assert.rejects(c.move(r,{...receipt,quantity:'1000.0002'}),/different/);
 await assert.rejects(c.move(foreign,{...receipt,request_key:randomUUID()}),/unavailable/);
 const transfer={lot_id:lot.id,from_location_id:wh.id,to_location_id:crew.id,quantity:'600',kind:'transfer',reference:'Synthetic transfer sheet',reason:'Crew issue'};
 const attempts=await Promise.allSettled([c.move(r,{...transfer,request_key:randomUUID()}),c.move(r,{...transfer,request_key:randomUUID()})]);assert.equal(attempts.filter(a=>a.status==='fulfilled').length,1);
 await c.move(r,{lot_id:lot.id,from_location_id:crew.id,kind:'scrap',quantity:'0.0001',reference:'Synthetic scrap record',reason:'Damaged end',request_key:randomUUID()});
 const adjustment={lot_id:lot.id,to_location_id:crew.id,quantity:'-10',reference:'Synthetic signed count',reason:'Count discrepancy',request_key:randomUUID(),approved:true};
 await assert.rejects(c.adjust(r,{...adjustment,approved:false}),/approval/);await c.adjust(r,adjustment);
 await assert.rejects(c.adjust(r,{...adjustment,quantity:'-1000',request_key:randomUUID()}),/Insufficient/);
 await assert.rejects(c.move(r,{...receipt,kind:'adjustment',request_key:randomUUID()}),/approved/);
 await assert.rejects(c.move(r,{...transfer,kind:'installed',to_location_id:null,request_key:randomUUID()}),/work order/);
 const data=await c.list(r);assert.equal(data.balances.find(b=>b.location_id===wh.id).balance,'400.0001');assert.equal(data.balances.find(b=>b.location_id===crew.id).balance,'589.9999');assert.equal((await c.list(foreign)).lots.length,0);
 await assert.rejects(pool.query('DELETE FROM material_movements WHERE id=$1',[a.id]),/immutable/);
 assert.equal((await pool.query("SELECT count(*)::int n FROM audit_logs WHERE tenant_id=$1 AND action='inventory.movement_recorded'",[tenant])).rows[0].n,4);
 const project=(await pool.query("INSERT INTO projects(tenant_id,name) VALUES($1,'Synthetic material project') RETURNING id",[tenant])).rows[0].id;
 const work=(await pool.query("INSERT INTO work_orders(tenant_id,project_id,title,work_type,expected_units,unit_type) VALUES($1,$2,'Synthetic install','fiber',100,'feet') RETURNING id",[tenant,project])).rows[0].id;
 await c.move(r,{lot_id:lot.id,from_location_id:crew.id,kind:'installed',quantity:'100',work_order_id:work,reference:'Synthetic installation record',reason:'Physical usage',request_key:randomUUID()});
 const usage=(await c.list(r)).usage;assert.equal(usage[0].quantity,'100.0000');assert.equal(usage[0].project_name,'Synthetic material project');
 assert.equal((await pool.query('SELECT count(*)::int n FROM contractor_payables WHERE tenant_id=$1',[tenant])).rows[0].n,0);

 }finally{await pool.end();}
});
