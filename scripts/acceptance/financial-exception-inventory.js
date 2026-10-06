#!/usr/bin/env node
'use strict';
// Read-only evidence inventory. It neither approves links nor reprices history.
const {Client}=require('pg'),fs=require('fs');
(async()=>{if(!process.env.DATABASE_URL&&!process.env.PGDATABASE)throw Error('Supply the reviewed database connection through the environment');const c=new Client(process.env.DATABASE_URL?{connectionString:process.env.DATABASE_URL}:undefined);await c.connect();try{await c.query('BEGIN READ ONLY');await c.query("SET LOCAL statement_timeout='30s'");const records=(await c.query(`
 SELECT 'invoice' AS kind,i.tenant_id,i.id,i.status,
   i.commercial_terms_revision_id IS NULL AS missing_approved_terms,
   NOT EXISTS(SELECT 1 FROM invoice_items x WHERE x.tenant_id=i.tenant_id AND x.invoice_id=i.id AND x.deleted_at IS NULL) AS missing_items,
   EXISTS(SELECT 1 FROM invoice_items x LEFT JOIN accepted_production_financial_sources s ON s.tenant_id=x.tenant_id AND s.id=x.accepted_production_source_id AND s.deleted_at IS NULL WHERE x.tenant_id=i.tenant_id AND x.invoice_id=i.id AND x.deleted_at IS NULL AND s.id IS NULL) AS missing_accepted_work_link
 FROM invoices i WHERE i.deleted_at IS NULL
 UNION ALL
 SELECT 'partner_payable',p.tenant_id,p.id,p.status,
   p.commercial_terms_revision_id IS NULL,
   NOT EXISTS(SELECT 1 FROM contractor_payable_items x WHERE x.tenant_id=p.tenant_id AND x.contractor_payable_id=p.id AND x.deleted_at IS NULL),
   EXISTS(SELECT 1 FROM contractor_payable_items x LEFT JOIN accepted_production_financial_sources s ON s.tenant_id=x.tenant_id AND s.id=x.accepted_production_source_id AND s.deleted_at IS NULL WHERE x.tenant_id=p.tenant_id AND x.contractor_payable_id=p.id AND x.deleted_at IS NULL AND s.id IS NULL)
 FROM contractor_payables p WHERE p.deleted_at IS NULL
 ORDER BY kind,tenant_id,id`)).rows;const review=records.filter(r=>r.missing_approved_terms||r.missing_items||r.missing_accepted_work_link),groups={};for(const r of records){const key=r.kind+':'+r.status;groups[key]=(groups[key]||0)+1;}const summary={status:'inventory_only',capturedAt:new Date().toISOString(),source:process.env.INVENTORY_SOURCE_LABEL||'Reviewed database',scope:'Missing provenance inventory, not business reconciliation or verification of executed agreements. No amounts, links, statuses or approvals changed.',recordsReviewed:records.length,recordsRequiringReview:review.length,missingApprovedTerms:records.filter(r=>r.missing_approved_terms).length,missingItems:records.filter(r=>r.missing_items).length,missingAcceptedWorkLinks:records.filter(r=>r.missing_accepted_work_link).length,statusCounts:groups};await c.query('COMMIT');if(process.env.RECONCILIATION_OUTPUT){const file=process.env.RECONCILIATION_OUTPUT;fs.writeFileSync(file,JSON.stringify({summary,records:review},null,2)+'\n',{mode:0o600,flag:'wx'});}console.log(JSON.stringify(summary,null,2));}finally{await c.end();}})().catch(e=>{console.error(e.message);process.exitCode=1;});
