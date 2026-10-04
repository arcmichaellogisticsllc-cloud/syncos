const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{Pool}=require('pg');
const {SupplementalFormsController}=require('../apps/api/dist/routes/supplemental-forms.controller');
const url=process.env.SYNCOS_COMMERCIAL_TEST_DATABASE_URL;
test('form publication preserves versions, tenant boundaries, immutable responses and one audit per retry',{skip:!url},async()=>{
 const pool=new Pool({connectionString:url});try{
 const tag=randomUUID(),tenant=(await pool.query("INSERT INTO tenants(name,slug) VALUES('Synthetic forms',$1) RETURNING id",['forms-'+tag])).rows[0].id;
 const other=(await pool.query("INSERT INTO tenants(name,slug) VALUES('Synthetic other',$1) RETURNING id",['forms-other-'+tag])).rows[0].id;
 const user=(await pool.query("INSERT INTO users(email,display_name) VALUES($1,'Synthetic form reviewer') RETURNING id",[tag+'@synthetic.test'])).rows[0].id;
 const req={auth:{tenantId:tenant,userId:user}},foreign={auth:{tenantId:other,userId:user}},controller=new SupplementalFormsController(pool);
 const body={request_key:randomUUID(),schema:{name:'Inspection notes',fields:[{key:'note',label:'Note',type:'text',required:true}]}};
 const [v,retry]=await Promise.all([controller.create(req,body),controller.create(req,body)]);assert.equal(v.id,retry.id);
 await assert.rejects(controller.create(req,{...body,schema:{...body.schema,name:'Changed'}}),/different/);
 await assert.rejects(controller.create(foreign,{...body,family_id:v.family_id,request_key:randomUUID()}),/unavailable/);
 const record={request_key:randomUUID(),version_id:v.id,answers:{note:'Original observation'}};
 await assert.rejects(controller.submit(req,record),/published/);
 await assert.rejects(controller.publish(req,v.id,{approved:false}),/approve/);
 await assert.rejects(controller.publish(foreign,v.id,{approved:true}),/unavailable/);
 await controller.publish(req,v.id,{approved:true});await controller.publish(req,v.id,{approved:true});
 await assert.rejects(controller.submit(req,{...record,answers:{}}),/required/);
 const [a,b]=await Promise.all([controller.submit(req,record),controller.submit(req,record)]);assert.equal(a.id,b.id);
 await assert.rejects(controller.submit(req,{...record,answers:{note:'Changed'}}),/different/);
 await assert.rejects(controller.submit(foreign,record),/published/);
 const newer=await controller.create(req,{...body,request_key:randomUUID(),family_id:v.family_id,schema:{...body.schema,name:'Revised inspection'}});assert.equal(newer.version,2);
 assert.equal((await controller.records(req))[0].schema_snapshot.name,'Inspection notes');assert.equal((await controller.records(foreign)).length,0);
 await assert.rejects(pool.query("UPDATE supplemental_form_versions SET schema='{}' WHERE id=$1",[v.id]),/immutable/);
 await assert.rejects(pool.query("DELETE FROM supplemental_form_records WHERE id=$1",[a.id]),/immutable/);
 assert.equal((await pool.query("SELECT count(*)::int n FROM audit_logs WHERE tenant_id=$1 AND action='form.submitted'",[tenant])).rows[0].n,1);
 }finally{await pool.end();}
});
