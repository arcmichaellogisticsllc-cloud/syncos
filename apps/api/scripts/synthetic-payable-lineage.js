'use strict';
const {randomUUID}=require('node:crypto');
const {scheduleFingerprint}=require('../dist/routes/payable-schedule-freshness');
const {createCustomerAcceptanceFixture}=require('./customer-acceptance-fixture');
async function attachSyntheticPayableLineage(c,tenant,user,payableId){
 if(!/^syncos_synthetic_/.test((await c.query('SELECT current_database() name')).rows[0].name))throw new Error('Use a synthetic test database');
 const p=(await c.query('SELECT * FROM contractor_payables WHERE tenant_id=$1 AND id=$2',[tenant,payableId])).rows[0],provider=p.capacity_provider_id;
 const org=(await c.query("INSERT INTO organizations(tenant_id,name,type) VALUES($1,'SYNTHETIC payable partner','subcontractor') RETURNING id",[tenant])).rows[0].id;
 const crew=(await c.query("INSERT INTO crews(tenant_id,capacity_provider_id,name,crew_type,status) VALUES($1,$2,'SYNTHETIC partner crew','splicing','active') RETURNING id",[tenant,provider])).rows[0].id;
 const project=(await c.query("INSERT INTO projects(tenant_id,customer_organization_id,name,status) VALUES($1,$2,'SYNTHETIC payable project','active') RETURNING id",[tenant,org])).rows[0].id;
 const order=(await c.query("INSERT INTO work_orders(tenant_id,project_id,assigned_capacity_provider_id,assigned_crew_id,title,work_type,expected_units,unit_type) VALUES($1,$2,$3,$4,'SYNTHETIC accepted work','splicing',2,'unit') RETURNING id",[tenant,project,provider,crew])).rows[0].id;
 const production=(await c.query("INSERT INTO production_records(tenant_id,project_id,work_order_id,capacity_provider_id,crew_id,production_date,quantity_submitted,quantity,unit,unit_type,status) VALUES($1,$2,$3,$4,$5,current_date,2,2,'unit','unit','approved') RETURNING id",[tenant,project,order,provider,crew])).rows[0].id;
 const decision=await createCustomerAcceptanceFixture(c,{tenantId:tenant,userId:user,organizationId:org,providerId:provider,crewId:crew,projectId:project,workOrderId:order,productionId:production,quantity:2,unit:'unit'});
 const context=(await c.query('SELECT cy.id cycle,cy.daily_report_id report,w.id version,w.governing_agreement_version_id agreement,w.rate_schedule_id schedule,a.contract_id contract FROM customer_qc_decisions d JOIN customer_qc_cycles cy ON cy.id=d.qc_cycle_id JOIN partner_work_order_versions w ON w.id=cy.work_order_version_id JOIN partner_agreement_versions a ON a.id=w.governing_agreement_version_id WHERE d.id=$1',[decision])).rows[0];
 await c.query('UPDATE production_records SET daily_production_report_id=$2,work_order_version_id=$3 WHERE id=$1',[production,context.report,context.version]);
 const file=(await c.query("INSERT INTO partner_restricted_file_objects(tenant_id,organization_id,capacity_provider_id,category,related_entity_type,related_entity_id,file_name,mime_type,size_bytes,checksum,storage_key) VALUES($1,$2,$3,'partner_msa_executed','partner_agreement_version',$4,'synthetic.txt','text/plain',1,'synthetic',$5) RETURNING id",[tenant,org,provider,context.agreement,'synthetic/'+randomUUID()])).rows[0].id;
 await c.query("UPDATE partner_agreement_versions SET status='effective',effective_date='2020-01-01',executed_at=now(),artifact_verified_at=now(),artifact_file_object_id=$2 WHERE id=$1",[context.agreement,file]);
 let settlement=p.settlement_id;
 if(!settlement)settlement=(await c.query("INSERT INTO settlements(tenant_id,status,capacity_provider_id,customer_organization_id) VALUES($1,'approved',$2,$3) RETURNING id",[tenant,provider,org])).rows[0].id;
 let items=(await c.query('SELECT * FROM settlement_items WHERE tenant_id=$1 AND settlement_id=$2 AND deleted_at IS NULL',[tenant,settlement])).rows;
 if(!items.length)items=(await c.query("INSERT INTO settlement_items(tenant_id,settlement_id,quantity,unit_rate,gross_amount,net_amount,amount,unit,status,item_type) VALUES($1,$2,2,100,200,200,200,'unit','payable_ready','contractor_payable') RETURNING *",[tenant,settlement])).rows;
 if(items.length!==1)throw new Error('Synthetic helper expects one settlement item');
 const rate=Number(items[0].net_amount)/2;
 const terms=(await c.query("INSERT INTO commercial_terms_revisions(tenant_id,contract_id,rate_schedule_id,counterparty_organization_id,party_type,revision_number,effective_from,payment_trigger,payment_days,time_zone,retainage_percent,rate_snapshot,source_reference,approved_by,client_mutation_id) VALUES($1,$2,$3,$4,'partner',1,'2020-01-01','customer_payment',14,'America/New_York',0,$5,'SYNTHETIC agreement approval',$6,$7) RETURNING id",[tenant,context.contract,context.schedule,org,JSON.stringify([{code:'SYNTHETIC',unit:'UNIT',rate}]),user,randomUUID()])).rows[0].id;
 const source=(await c.query("INSERT INTO accepted_production_financial_sources(tenant_id,project_id,work_order_id,partner_organization_id,capacity_provider_id,crew_id,production_record_id,customer_qc_cycle_id,customer_qc_decision_id,production_code,accepted_quantity,unit_of_measure,partner_rate,partner_terms_revision_id,source_fingerprint) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'SYNTHETIC',2,'unit',$10,$11,$12) RETURNING id",[tenant,project,order,org,provider,crew,production,context.cycle,decision,rate,terms,randomUUID()])).rows[0].id;
 await c.query('UPDATE settlement_items SET production_record_id=$2,accepted_production_source_id=$3,partner_organization_id=$4,capacity_provider_id=$5 WHERE id=$1',[items[0].id,production,source,org,provider]);
 await c.query('UPDATE contractor_payables SET settlement_id=$2,partner_organization_id=$3 WHERE id=$1',[payableId,settlement,org]);
 if(p.status==='payment_ready'){const fingerprint=await scheduleFingerprint(c,tenant,payableId);await c.query("INSERT INTO contractor_payable_eligibility_snapshots(tenant_id,contractor_payable_id,calculation_version,status,source_fingerprint) VALUES($1,$2,1,'eligible',$3)",[tenant,payableId,fingerprint]);}
}
module.exports={attachSyntheticPayableLineage};
