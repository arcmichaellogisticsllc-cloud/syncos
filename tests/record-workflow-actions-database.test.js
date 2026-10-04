const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{Pool}=require('pg');
const {ConstraintsController}=require('../apps/api/dist/routes/constraints.controller');
const {RelationshipMapsController}=require('../apps/api/dist/routes/relationship-maps.controller');
const url=process.env.SYNCOS_COMMERCIAL_TEST_DATABASE_URL;
test('record actions preserve tenant boundaries, audit once and reject changed retry payloads',{skip:!url},async()=>{
 const pool=new Pool({connectionString:url});try{
 const tag=randomUUID(),tenant=(await pool.query("INSERT INTO tenants(name,slug) VALUES('Synthetic actions',$1) RETURNING id",['actions-'+tag])).rows[0].id;
 const other=(await pool.query("INSERT INTO tenants(name,slug) VALUES('Synthetic other actions',$1) RETURNING id",['other-actions-'+tag])).rows[0].id;
 const user=(await pool.query("INSERT INTO users(email,display_name) VALUES($1,'Synthetic action owner') RETURNING id",[tag+'@synthetic.test'])).rows[0].id;
 const contacts=(await pool.query("INSERT INTO contacts(tenant_id,full_name) VALUES($1,'Synthetic first'),($1,'Synthetic second'),($2,'Other tenant') RETURNING *",[tenant,other])).rows;
 const req={auth:{tenantId:tenant,userId:user}},controller=new ConstraintsController(pool);
 const body={client_mutation_id:randomUUID(),affected_object_type:'contact',affected_object_id:contacts[0].id,constraint_type:'relationship',title:'Synthetic missing evidence',description:'Synthetic review',severity:'high'};
 const [a,b]=await Promise.all([controller.createConstraint(req,body),controller.createConstraint(req,body)]);assert.equal(a.id,b.id);
 await assert.rejects(controller.createConstraint(req,{...body,title:'Changed'}),/different constraint/);
 await assert.rejects(controller.createConstraint(req,{...body,client_mutation_id:randomUUID(),affected_object_id:contacts[2].id}),/not found/);
 await assert.rejects(controller.createConstraint(req,{...body,affected_object_type:'unknown'}),/Unsupported/);
 const map=(await pool.query("INSERT INTO relationship_maps(tenant_id,name) VALUES($1,'Synthetic map') RETURNING id",[tenant])).rows[0].id;
 const paths=new RelationshipMapsController(pool),path={client_mutation_id:randomUUID(),from_contact_id:contacts[0].id,to_contact_id:contacts[1].id,path_name:'Synthetic path',path_summary:'Synthetic documented relationship'};
 const first=await paths.createPath(req,map,path),again=await paths.createPath(req,map,path);assert.equal(first.id,again.id);
 await assert.rejects(paths.createPath(req,map,{...path,path_name:'Changed'}),/different relationship/);
 await assert.rejects(paths.createPath(req,map,{...path,client_mutation_id:randomUUID(),to_contact_id:contacts[2].id}),/not found/);
 const count=(await pool.query("SELECT count(*)::int n FROM audit_logs WHERE tenant_id=$1 AND action IN ('constraint.create','relationship_path.create')",[tenant])).rows[0].n;assert.equal(count,2);
 }finally{await pool.end();}
});
