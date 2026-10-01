// Read-only inventory. This deliberately does not approve, reprice, backdate or seed records.
const {Client}=require('pg');
const crypto=require('node:crypto');
// Exact identities from seed-e2e-demo.js, not names or a tenant-wide assumption.
function seedId(value){const h=crypto.createHash('sha1').update('syncos-browser-e2e-cedar-ridge:'+value).digest();h[6]=(h[6]&15)|80;h[8]=(h[8]&63)|128;const x=h.subarray(0,16).toString('hex');return `${x.slice(0,8)}-${x.slice(8,12)}-${x.slice(12,16)}-${x.slice(16,20)}-${x.slice(20)}`;}
const seedRecords=new Set(['invoice:inv-cr-001','contractor-payable:cpay-cr-001',...['draft','under-review','approved','disputed','void'].flatMap(s=>['action-invoice-'+s,'action-cpay-'+s])].map(seedId));
function provenance(row){return row.tenant_id===seedId('tenant:arc-syncos-demo')&&seedRecords.has(row.id)?'exact_seed_record_identity_match_preserve_reference':'unverified_requires_source_review';}

async function main(){
 const client=new Client({connectionString:process.env.DATABASE_URL});await client.connect();
 try{await client.query('BEGIN READ ONLY');
 const rows=await client.query(`SELECT 'invoice' AS kind,i.tenant_id,i.id,i.invoice_number AS record_number,
 i.commercial_terms_revision_id IS NULL AS missing_approved_terms,
 NOT EXISTS(SELECT 1 FROM invoice_items x WHERE x.tenant_id=i.tenant_id AND x.invoice_id=i.id AND x.deleted_at IS NULL AND x.status NOT IN ('voided','archived')) OR EXISTS(
 SELECT 1 FROM invoice_items x LEFT JOIN accepted_production_financial_sources s ON s.tenant_id=x.tenant_id AND s.id=x.accepted_production_source_id WHERE x.tenant_id=i.tenant_id AND x.invoice_id=i.id AND x.deleted_at IS NULL AND x.status NOT IN ('voided','archived') AND (s.id IS NULL OR s.customer_terms_revision_id IS NULL)) AS incomplete_lineage
 FROM invoices i WHERE i.deleted_at IS NULL AND i.status NOT IN ('voided','archived')
 UNION ALL SELECT 'partner_payable',p.tenant_id,p.id,p.payable_number,p.commercial_terms_revision_id IS NULL,
 NOT EXISTS(SELECT 1 FROM contractor_payable_items x WHERE x.tenant_id=p.tenant_id AND x.contractor_payable_id=p.id AND x.deleted_at IS NULL AND x.status NOT IN ('voided','archived')) OR EXISTS(
 SELECT 1 FROM contractor_payable_items x LEFT JOIN accepted_production_financial_sources s ON s.tenant_id=x.tenant_id AND s.id=x.accepted_production_source_id WHERE x.tenant_id=p.tenant_id AND x.contractor_payable_id=p.id AND x.deleted_at IS NULL AND x.status NOT IN ('voided','archived') AND (s.id IS NULL OR s.partner_terms_revision_id IS NULL))
 FROM contractor_payables p WHERE p.deleted_at IS NULL AND p.status NOT IN ('voided','archived') ORDER BY kind,tenant_id,id`);
 await client.query('COMMIT');
 console.log(JSON.stringify({reviewed_at:new Date().toISOString(),mode:'read_only',records:rows.rows.map(r=>({...r,review_status:r.missing_approved_terms||r.incomplete_lineage?'needs_documented_reconciliation':'requires_current_acceptance_check',provenance:provenance(r)}))},null,2));
 }finally{await client.end();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
