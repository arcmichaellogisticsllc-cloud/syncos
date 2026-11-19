require('reflect-metadata');
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{Pool}=require('pg');
const {StaffingController}=require('../apps/api/dist/routes/staffing.controller');
const {staffingRoles,staffingBlockers}=require('../apps/api/dist/routes/staffing');
const {safetyBlockers}=require('../apps/api/dist/routes/work-safety');
const {staffingFixture}=require('./helpers/staffing-fixture');
const url=process.env.SYNCOS_COMMERCIAL_TEST_DATABASE_URL;
const requirements=[{code:'production',minimum:3,qualification:'Synthetic production qualification'},{code:'traffic',minimum:2,qualification:'Synthetic traffic-control qualification'}];
const future=(hours=8)=>new Date(Date.now()+hours*3600000).toISOString();
test('staffing requirements reject duplicate roles, invented minima and malformed requirements',()=>{
 assert.deepEqual(staffingRoles(requirements),requirements);
 for(const input of [[],[requirements[0],requirements[0]],[{code:'traffic',minimum:0,qualification:'x'}],[{code:'x',minimum:1.5,qualification:'x'}],[{code:'x',minimum:1,qualification:''}]])assert.throws(()=>staffingRoles(input));
});
async function setup(db,kind,tenant){const f=await staffingFixture(db,kind,tenant),c=new StaffingController(db);
 const plan=await c.propose(f.foreman,f.v,f.crew,{phase:'Synthetic active phase',requirements,plan_reference:'SYNTHETIC plans',pause_instructions:'SYNTHETIC pause production, maintain protective traffic coverage'});
 await c.approve(f.supervisor,plan.id,{review_reference:'SYNTHETIC qualified plan review'});
 for(let i=0;i<f.workers.length;i++)await c.eligibility(f.supervisor,plan.id,{worker_id:f.workers[i],role_code:i<3?'production':'traffic',valid_until:future(12),evidence_reference:'SYNTHETIC verified qualification',revoked:false});
 const coverage=f.workers.slice(0,5).map((worker_id,i)=>({worker_id,role_code:i<3?'production':'traffic'}));
 async function check(changes={}){const current=(await c.read(f.foreman,f.v,f.crew)).check;return c.check(f.foreman,f.v,f.crew,{plan_id:plan.id,daily_jsa_id:f.jsa.id,client_mutation_id:randomUUID(),expected_check_id:current?.id??null,coverage,shift_ends_at:future(),reason:'SYNTHETIC start/recheck',...changes});}
 async function blockers(){const client=await db.connect();try{await client.query('BEGIN');const result=await safetyBlockers(client,f.t,f.wo,f.crew,f.jsa,false);await client.query('ROLLBACK');return result;}finally{client.release();}}
 return {...f,c,plan,coverage,check,blockers};
}
for(const kind of ['internal','partner'])test(`${kind}: wrong-role headcount pauses work, restoration needs supervisor, retries preserve one check`,{skip:!url},async()=>{
 const db=new Pool({connectionString:url});try{
 const f=await setup(db,kind);
 assert.ok((await f.blockers()).includes('current_shift_staffing_check_required'));
 await assert.rejects(f.c.approve(f.foreman,f.plan.id,{review_reference:'x'}),/supervisor/);
 await assert.rejects(f.c.read(f.admin,f.v,f.crew),/field organization/);
 const other=await staffingFixture(db,kind,f.t);
 await assert.rejects(f.c.read(other.foreman,f.v,f.crew),/foreman/);
 await assert.rejects(f.c.read({...f.supervisor,auth:{...f.supervisor.auth,tenantId:randomUUID()}},f.v,f.crew));
 const wrong=f.coverage.map(x=>({...x,role_code:'production'}));
 const bad=await f.check({coverage:wrong});assert.ok(bad.findings.some(x=>x.startsWith('staffing_shortfall:traffic')));assert.ok(bad.case_id);
 assert.ok((await f.blockers()).includes('staffing_pause_requires_supervisor_release'));
 const good=await f.check();assert.equal(good.case_id,bad.case_id);assert.deepEqual(good.findings,[]);
 assert.equal((await f.c.read(f.foreman,f.v,f.crew)).cases[0].status,'awaiting_release');
 await assert.rejects(f.c.release(f.foreman,bad.case_id,{check_id:good.id,release_reference:'x'}),/supervisor/);
 await assert.rejects(f.c.release(f.admin,bad.case_id,{check_id:good.id,release_reference:'x'}),/supervisor/);
 await assert.rejects(f.c.release(f.supervisor,bad.case_id,{check_id:bad.id,release_reference:'x'}),/Coverage changed/);
 await f.c.acknowledge(f.supervisor,bad.case_id,{contact_note:'SYNTHETIC spoke to crew'});
 const release={check_id:good.id,release_reference:'SYNTHETIC current plan and coverage reviewed'};
 assert.equal((await f.c.release(f.supervisor,bad.case_id,release)).status,'released');
 assert.equal((await f.c.release(f.supervisor,bad.case_id,release)).status,'released');assert.deepEqual(await f.blockers(),[]);
 const body={plan_id:f.plan.id,daily_jsa_id:f.jsa.id,client_mutation_id:randomUUID(),expected_check_id:good.id,coverage:f.coverage,shift_ends_at:future(),reason:'SYNTHETIC stable coverage'};
 const [a,b]=await Promise.all([f.c.check(f.foreman,f.v,f.crew,body),f.c.check(f.foreman,f.v,f.crew,body)]);assert.equal(a.id,b.id);
 await assert.rejects(f.c.check(f.foreman,f.v,f.crew,{...body,reason:'changed'}),/different facts/);
 await assert.rejects(f.check({coverage:[...f.coverage,f.coverage[0]]}),/one simultaneous role/);
 assert.equal((await db.query('SELECT count(*)::int n FROM audit_logs WHERE entity_id=$1',[a.id])).rows[0].n,1);
 }finally{await db.end();}
});
test('eligibility expiry, revocation, membership changes, unsafe concerns, fresh checks and plan revisions fail closed',{skip:!url},async()=>{
 const db=new Pool({connectionString:url});try{
 const f=await setup(db,'internal');let check=await f.check();assert.deepEqual(check.findings,[]);
 // Continuous relief retains two qualified traffic workers, without opening a hold.
 check=await f.check({coverage:f.coverage.map((x,i)=>i===4?{worker_id:f.workers[5],role_code:'traffic'}:x),reason:'SYNTHETIC continuous relief'});assert.equal(check.case_id,null);
 const concern=await f.c.concern(f.foreman,f.v,f.crew,{reason:'SYNTHETIC unsafe conditions despite adequate staffing'});
 await assert.rejects(f.c.release(f.supervisor,concern.id,{check_id:check.id,release_reference:'x'}),/fresh crew check/);
 check=await f.check();
 await f.c.concern(f.foreman,f.v,f.crew,{reason:'SYNTHETIC new hazard before release'});
 await assert.rejects(f.c.release(f.supervisor,concern.id,{check_id:check.id,release_reference:'x'}),/fresh crew check/);
 check=await f.check();await f.c.release(f.supervisor,concern.id,{check_id:check.id,release_reference:'SYNTHETIC condition corrected'});
 await f.c.eligibility(f.supervisor,f.plan.id,{worker_id:f.workers[4],role_code:'traffic',valid_until:future(12),evidence_reference:'SYNTHETIC qualification revoked',revoked:true});
 assert.ok((await f.blockers()).some(x=>x.startsWith('worker_not_eligible')));
 const hold=(await f.c.read(f.foreman,f.v,f.crew)).cases[0];assert.equal(hold.status,'open');
 await f.c.eligibility(f.supervisor,f.plan.id,{worker_id:f.workers[4],role_code:'traffic',valid_until:future(12),evidence_reference:'SYNTHETIC reverified',revoked:false});
 await assert.rejects(f.c.release(f.supervisor,hold.id,{check_id:check.id,release_reference:'x'}),/fresh crew check/);
 check=await f.check();await f.c.release(f.supervisor,hold.id,{check_id:check.id,release_reference:'SYNTHETIC fresh verification'});
 await db.query("UPDATE partner_crew_memberships SET status='ended' WHERE tenant_id=$1 AND worker_id=$2",[f.t,f.workers[4]]);
 assert.ok((await f.blockers()).some(x=>x.startsWith('worker_not_eligible')));await f.c.tick();assert.equal((await f.c.read(f.foreman,f.v,f.crew)).cases[0].status,'open');
 await db.query("UPDATE partner_crew_memberships SET status='active' WHERE tenant_id=$1 AND worker_id=$2",[f.t,f.workers[4]]);
 const proposal=await f.c.propose(f.foreman,f.v,f.crew,{previous_plan_id:f.plan.id,phase:'New phase',requirements,plan_reference:'New SYNTHETIC plan',pause_instructions:'Maintain protective traffic coverage'});
 await f.c.approve(f.supervisor,proposal.id,{review_reference:'New SYNTHETIC review'});
 assert.ok((await f.blockers()).includes('staffing_plan_changed_recheck_required'));
 await assert.rejects(f.check(),/current approved staffing plan/);
 await assert.rejects(f.c.approve(f.supervisor,f.plan.id,{review_reference:'SYNTHETIC qualified plan review'}),/newer plan/);
 }finally{await db.end();}
});
test('no worker can cover concurrent crews; expired or ended shifts cannot release pauses; escalation is durable',{skip:!url},async()=>{
 const db=new Pool({connectionString:url});try{
 const a=await setup(db,'internal'),b=await setup(db,'partner',a.t);
 // Share a member legitimately between rosters, but not between simultaneous duties.
 const worker=a.workers[4];await db.query('INSERT INTO partner_crew_memberships(tenant_id,organization_id,capacity_provider_id,crew_id,worker_id,primary_membership) VALUES($1,$2,$3,$4,$5,false)',[a.t,b.org,b.cp,b.crew,worker]);
 await db.query('INSERT INTO daily_jsa_participants(tenant_id,daily_jsa_id,worker_id,acknowledged,acknowledged_by,acknowledged_at) VALUES($1,$2,$3,true,$4,now())',[a.t,b.jsa.id,worker,b.foreman.auth.userId]);
 await b.c.eligibility(b.supervisor,b.plan.id,{worker_id:worker,role_code:'traffic',valid_until:future(12),evidence_reference:'SYNTHETIC cross roster eligibility',revoked:false});
 const [ca,cb]=await Promise.all([a.check(),b.check({coverage:b.coverage.map((x,i)=>i===4?{worker_id:worker,role_code:'traffic'}:x)})]);
 assert.equal([ca,cb].filter(x=>x.findings.some(f=>f.startsWith('worker_already_covering_other_work'))).length,1);
 const failed=ca.case_id?{f:a,check:ca}:{f:b,check:cb};
 await db.query("UPDATE staffing_cases SET created_at=now()-interval '11 minutes' WHERE id=$1",[failed.check.case_id]);await a.c.tick();await a.c.tick();
 assert.equal((await db.query('SELECT count(*)::int n FROM staffing_notices WHERE case_id=$1',[failed.check.case_id])).rows[0].n,3);
 const fresh=await failed.f.check({coverage:[]});assert.equal(fresh.case_id,failed.check.case_id);
 await failed.f.c.endShift(failed.f.foreman,failed.f.v,failed.f.crew,{check_id:fresh.id,reason:'SYNTHETIC shift completed'});
 assert.ok((await failed.f.blockers()).includes('staffing_shift_ended'));
 await assert.rejects(failed.f.c.release(failed.f.supervisor,fresh.case_id,{check_id:fresh.id,release_reference:'x'}),/fresh crew check|not ready/);
 const all=(await a.c.scopes(a.foreman)).scopes;assert.ok(all.every(x=>x.crew_id===a.crew));
 }finally{await db.end();}
});

test('linked credential changes invalidate coverage; absent plan and expired check remain blocked',{skip:!url},async()=>{
 const db=new Pool({connectionString:url});try{
 const fresh=await staffingFixture(db,'partner');const client=await db.connect();try{const blockers=await staffingBlockers(client,fresh.t,fresh.wo,fresh.crew,fresh.jsa);assert.ok(blockers.includes('approved_role_staffing_plan_required'));}finally{client.release();}
 const controller=new StaffingController(db);const concern=await controller.concern(fresh.foreman,fresh.v,fresh.crew,{reason:'SYNTHETIC hazard before a staffing plan exists'});assert.equal(concern.status,'open');
 await controller.escalate(fresh.foreman,concern.id,{target:'backup_supervisor',contact_note:'SYNTHETIC primary unavailable'});
 assert.equal((await controller.scopes(fresh.foreman)).scopes[0].open_cases,1);
 await controller.acknowledge(fresh.supervisor,concern.id,{contact_note:'SYNTHETIC contact established'});await db.query("UPDATE staffing_cases SET created_at=now()-interval '12 minutes' WHERE id=$1",[concern.id]);await controller.tick();
 assert.equal((await db.query("SELECT count(*)::int n FROM staffing_notices WHERE case_id=$1 AND target='business_owner'",[concern.id])).rows[0].n,0);
 const f=await setup(db,'partner');
 const credential=(await db.query("INSERT INTO partner_worker_credentials(tenant_id,organization_id,capacity_provider_id,worker_id,credential_type,status,expiration_date,verified_at) VALUES($1,$2,$3,$4,'traffic_control','verified',CURRENT_DATE+30,now()) RETURNING id",[f.t,f.org,f.cp,f.workers[4]])).rows[0].id;
 const input={worker_id:f.workers[4],role_code:'traffic',valid_until:future(12),evidence_reference:'SYNTHETIC linked traffic credential',revoked:false,credential_ids:[credential]};
 await assert.rejects(f.c.eligibility(f.supervisor,f.plan.id,{...input,worker_id:f.workers[3]}),/belong to this worker/);
 await f.c.eligibility(f.supervisor,f.plan.id,input);const check=await f.check();assert.deepEqual(check.findings,[]);
 await db.query("UPDATE partner_worker_credentials SET status='rejected' WHERE id=$1",[credential]);assert.ok((await f.blockers()).some(x=>x.startsWith('worker_not_eligible')));await f.c.tick();
 assert.equal((await f.c.read(f.foreman,f.v,f.crew)).cases[0].status,'open');
 await db.query("UPDATE staffing_checks SET shift_ends_at=now()-interval '1 minute' WHERE id=$1",[check.id]);assert.ok((await f.blockers()).includes('staffing_shift_check_expired'));
 }finally{await db.end();}
});
