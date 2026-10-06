'use strict';
const {randomUUID}=require('node:crypto');
const {createCustomerAcceptanceFixture}=require('./customer-acceptance-fixture');
async function attachSyntheticInvoiceLineage(c,tenant,user,invoiceId){
 if(!/^syncos_synthetic_/.test((await c.query('SELECT current_database() name')).rows[0].name))throw new Error('Use a synthetic test database');
 const i=(await c.query('SELECT * FROM invoices WHERE tenant_id=$1 AND id=$2',[tenant,invoiceId])).rows[0],org=i.customer_organization_id,project=i.project_id;
 const provider=(await c.query("INSERT INTO capacity_providers(tenant_id,organization_id,name,provider_type,status) VALUES($1,$2,'SYNTHETIC internal provider','internal_workforce','activated') RETURNING id",[tenant,org])).rows[0].id;
 const crew=(await c.query("INSERT INTO crews(tenant_id,capacity_provider_id,name,crew_type,status) VALUES($1,$2,'SYNTHETIC crew','splicing','active') RETURNING id",[tenant,provider])).rows[0].id;
 const order=(await c.query("INSERT INTO work_orders(tenant_id,project_id,assigned_capacity_provider_id,assigned_crew_id,title,work_type,expected_units,unit_type) VALUES($1,$2,$3,$4,'SYNTHETIC invoice work','splicing',100,'feet') RETURNING id",[tenant,project,provider,crew])).rows[0].id;
 const production=(await c.query("INSERT INTO production_records(tenant_id,project_id,work_order_id,capacity_provider_id,crew_id,production_date,quantity_submitted,quantity,unit,unit_type,status) VALUES($1,$2,$3,$4,$5,current_date,100,100,'feet','feet','approved') RETURNING id",[tenant,project,order,provider,crew])).rows[0].id;
 const decision=await createCustomerAcceptanceFixture(c,{tenantId:tenant,userId:user,organizationId:org,providerId:provider,crewId:crew,projectId:project,workOrderId:order,productionId:production,quantity:100,unit:'feet'});
 const cycle=(await c.query('SELECT qc_cycle_id FROM customer_qc_decisions WHERE id=$1',[decision])).rows[0].qc_cycle_id;
 const contract=(await c.query("INSERT INTO contracts(tenant_id,organization_id,name,status) VALUES($1,$2,'SYNTHETIC invoice agreement','active') RETURNING id",[tenant,org])).rows[0].id;
 const schedule=(await c.query("INSERT INTO rate_schedules(tenant_id,contract_id,organization_id,name,status) VALUES($1,$2,$3,'SYNTHETIC approved pricing','active') RETURNING id",[tenant,contract,org])).rows[0].id;
 const terms=(await c.query("INSERT INTO commercial_terms_revisions(tenant_id,contract_id,rate_schedule_id,counterparty_organization_id,party_type,revision_number,effective_from,payment_trigger,payment_days,time_zone,retainage_percent,rate_snapshot,source_reference,approved_by,client_mutation_id) VALUES($1,$2,$3,$4,'customer',1,'2020-01-01','invoice_delivery',14,'America/New_York',5,$5,'SYNTHETIC approved terms',$6,$7) RETURNING id",[tenant,contract,schedule,org,JSON.stringify([{code:'SYNTHETIC',unit:'LF',rate:10}]),user,randomUUID()])).rows[0].id;
 const source=(await c.query("INSERT INTO accepted_production_financial_sources(tenant_id,project_id,work_order_id,partner_organization_id,capacity_provider_id,crew_id,production_record_id,customer_qc_cycle_id,customer_qc_decision_id,production_code,accepted_quantity,unit_of_measure,customer_rate,customer_extended_amount,customer_terms_revision_id,source_fingerprint) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'SYNTHETIC',100,'feet',10,1000,$10,$11) RETURNING id",[tenant,project,order,org,provider,crew,production,cycle,decision,terms,randomUUID()])).rows[0].id;
 const billable=(await c.query("INSERT INTO billable_items(tenant_id,project_id,work_order_id,production_record_id,customer_organization_id,approved_quantity,billable_quantity,unit,unit_rate,net_billable_amount,accepted_production_source_id,customer_qc_decision_id) VALUES($1,$2,$3,$4,$5,100,100,'feet',10,1000,$6,$7) RETURNING id",[tenant,project,order,production,org,source,decision])).rows[0].id;
 await c.query('UPDATE invoice_items SET billable_item_id=$3,production_record_id=$4,accepted_production_source_id=$5 WHERE tenant_id=$1 AND invoice_id=$2',[tenant,invoiceId,billable,production,source]);
 await c.query('UPDATE invoices SET commercial_terms_revision_id=$3 WHERE tenant_id=$1 AND id=$2',[tenant,invoiceId,terms]);
 return contract;
}
module.exports={attachSyntheticInvoiceLineage};
