import crypto from 'node:crypto';
import {expect, type APIRequestContext} from '@playwright/test';
import type {Client} from 'pg';

// Synthetic identity/crew facts are fixture setup; compliance submissions,
// internal verification, agreement/work-order creation and approval use HTTP.
export async function rehearsePartnerOnboarding(request: APIRequestContext, db: Client, f: {
 tenant: string; org: string; provider: string; project: string; crew: string; internalToken: string; adminToken: string;
}) {
 const send=async(token:string,route:string,body:any={})=>request.post(`${process.env.API_BASE_URL}${route}`,{headers:{authorization:`Bearer ${token}`},data:body});
 const post=async(token:string,route:string,body:any={})=>{const r=await send(token,route,body);expect(r.status(),`${route}: ${await r.text()}`).toBeLessThan(400);return r.json();};
 const get=async(route:string)=>{const r=await request.get(`${process.env.API_BASE_URL}${route}`,{headers:{authorization:`Bearer ${f.adminToken}`}});expect(r.ok()).toBe(true);return r.json();};
 const evidence=(name:string)=>({file_name:name,mime_type:'application/pdf',content_base64:Buffer.from('%PDF-1.4\nSYNTHETIC REHEARSAL ONLY\n%%EOF').toString('base64')});
 const prefix=`/partner-compliance/organizations/${f.org}`;
 expect((await get('/partner-compliance/me/summary')).overall_status).toBe('not_started');
 await post(f.adminToken,'/partner-compliance/me/company-profile',{legal_business_name:'Synthetic rehearsal partner',business_address:{line1:'Synthetic site',city:'Test',state:'GA',postal_code:'00000'}});
 await post(f.adminToken,'/partner-compliance/me/w9',{legal_name_on_w9:'Synthetic rehearsal partner',federal_tax_classification:'llc',tin_type:'ein',tin_last_four:'0000',signed_date:'2026-08-15',evidence:evidence('synthetic-w9.pdf')});
 await post(f.adminToken,'/partner-compliance/me/payment-profile',{priority_passport_status:'pending',backup_ach_status:'submitted',bank_display_name:'Synthetic bank',account_type:'business_checking',account_last_four:'0000',ach_evidence:evidence('synthetic-ach.pdf')});
 for(const policy_type of ['commercial_general_liability','commercial_auto','umbrella_excess','workers_compensation','employers_liability']){
  await post(f.adminToken,'/partner-compliance/me/insurance-policies',{policy_type,carrier:'Synthetic carrier',effective_date:'2026-01-01',expiration_date:'2027-08-01',occurrence_limit_cents:200000000,general_aggregate_cents:200000000,products_completed_operations_aggregate_cents:200000000,combined_single_auto_limit_cents:100000000,employer_liability_accident_limit_cents:50000000,employer_liability_disease_each_employee_limit_cents:50000000,employer_liability_disease_policy_limit_cents:50000000,workers_compensation_statutory:true,owned_auto_covered:true,hired_rented_auto_covered:true,non_owned_auto_covered:true,additional_insured_status:'verified',waiver_of_subrogation_status:'verified',primary_non_contributory_status:'verified',coi_evidence:evidence('synthetic-coi.pdf')});
 }
 expect((await send(f.adminToken,`${prefix}/company-profile/review`,{status:'verified'})).status()).toBe(403);
 for(const kind of ['company-profile','w9','payment-profile'])await post(f.internalToken,`${prefix}/${kind}/review`,{status:'verified'});
 for(const policy of await get('/partner-compliance/me/insurance-policies'))await post(f.internalToken,`${prefix}/insurance-policies/${policy.id}/review`,{status:'verified'});
 expect((await get('/partner-compliance/me/summary')).overall_status).toBe('ready');
 const contacts=[];
 for(let i=0;i<2;i++)contacts.push((await db.query("INSERT INTO contacts(tenant_id,organization_id,first_name,last_name,full_name,title,status,verification_status) VALUES($1,$2,'Synthetic',$3,$4,'Representative','verified','verified') RETURNING id",[f.tenant,f.org,`Signer ${i}`,`Synthetic Signer ${i}`])).rows[0].id);
 const agreements=`/partner-agreements/organizations/${f.org}`;
 async function execute(route:string){
  expect((await send(f.internalToken,`${route}/activate`)).status()).toBe(400);
  expect((await send(f.adminToken,`${route}/activate`)).status()).toBe(403);
  for(const [i,signer_role] of ['partner_representative_1','partner_representative_2','sync_representative'].entries()){
   const signer=await post(f.internalToken,`${route}/signatories`,{signer_role,contact_id:contacts[i]??null,full_legal_name:`Synthetic Signer ${i}`,title:'Authorized representative'});
   await post(f.internalToken,`${route}/signatures`,{signatory_id:signer.id,signed_date:'2026-08-22'});
  }
  await post(f.internalToken,`${route}/artifact`,evidence('synthetic-executed.pdf'));
  return post(f.internalToken,`${route}/activate`);
 }
 const agreement=await post(f.internalToken,`${agreements}/agreements`,{name:'Synthetic rehearsal MSA',capacity_provider_id:f.provider,agreement_number:`REHEARSAL-${crypto.randomUUID()}`});
 await execute(`${agreements}/agreements/${agreement.version_id}`);
 const work=await post(f.internalToken,`${agreements}/work-orders`,{project_id:f.project,capacity_provider_id:f.provider,governing_agreement_version_id:agreement.version_id,assigned_crew_id:f.crew,work_order_name:'Synthetic rehearsal WO',work_order_number:`REHEARSAL-${crypto.randomUUID()}`,work_type:'fiber_hanging_overlash',scope_summary:'Synthetic aerial scope',primary_work_area:'Synthetic site',map_work_package_ref:'SYNTHETIC-MAP',production_unit:'feet',performance_target:3000,partner_rate_amount:0.7,rate_code:'accepted_foot',rate_unit:'feet',fuel_tolls_responsibility:'partner'});
 await execute(`${agreements}/work-orders/${work.id}`);
 return work;
}
