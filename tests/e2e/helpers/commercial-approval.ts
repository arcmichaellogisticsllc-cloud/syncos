import {expect,type APIRequestContext} from '@playwright/test';
import type {Client} from 'pg';
import {randomUUID} from 'node:crypto';
export async function approveFixtureCommercialTerms(db:Client,request:APIRequestContext,bearer:string,tenant:string,schedule:string,party:'customer'|'partner',retainage=0){
 const row=(await db.query('SELECT * FROM rate_schedules WHERE tenant_id=$1 AND id=$2',[tenant,schedule])).rows[0];
 let agreement=row.contract_id;
 if(party==='partner'&&!agreement){const governing=(await db.query('SELECT DISTINCT a.contract_id FROM partner_work_order_versions w JOIN partner_agreement_versions a ON a.tenant_id=w.tenant_id AND a.id=w.governing_agreement_version_id WHERE w.tenant_id=$1 AND w.rate_schedule_id=$2 AND w.deleted_at IS NULL',[tenant,schedule])).rows;expect(governing).toHaveLength(1);agreement=governing[0].contract_id;await db.query('UPDATE rate_schedules SET contract_id=$3 WHERE tenant_id=$1 AND id=$2',[tenant,schedule,agreement]);}
 if(!agreement){agreement=randomUUID();await db.query("INSERT INTO contracts(id,tenant_id,organization_id,name,status) VALUES($1,$2,$3,'SYNTHETIC executed commercial agreement','active')",[agreement,tenant,row.organization_id]);await db.query('UPDATE rate_schedules SET contract_id=$3 WHERE tenant_id=$1 AND id=$2',[tenant,schedule,agreement]);}
 const url=process.env.API_BASE_URL;
 const headers={authorization:`Bearer ${bearer}`};
 const read=await request.get(`${url}/commercial-terms/rate-schedules/${schedule}`,{headers});expect(read.ok(),await read.text()).toBeTruthy();const preview=await read.json();
 const result=await request.post(`${url}/commercial-terms/rate-schedules/${schedule}/approve`,{headers,data:{party_type:party,payment_trigger:party==='customer'?'invoice_acceptance':'customer_payment',payment_days:14,time_zone:'America/New_York',retainage_percent:retainage,effective_from:'2020-01-01',effective_until:'2099-12-31',source_reference:'SYNTHETIC verified agreement and pricing fixture, not an operational approval',verified:true,client_mutation_id:randomUUID(),preview_fingerprint:preview.preview_fingerprint}});
 expect(result.ok(),await result.text()).toBeTruthy();return agreement;
}
export async function verifyInvoicePackageLifecycle(request:APIRequestContext,bearer:string,invoice:string,contract:string){
 const headers={authorization:`Bearer ${bearer}`},base=process.env.API_BASE_URL;
 const post=async(path:string,data:any)=>{const r=await request.post(`${base}/invoice-packages/${path}`,{headers,data});expect(r.ok(),await r.text()).toBeTruthy();return r.json();};
 await post(`contracts/${contract}/requirements`,{required_documents:['Prime cover sheet'],source_reference:'SYNTHETIC prime invoice packet policy',verified:true});
 const missing=await request.post(`${base}/invoice-packages/invoices/${invoice}/prepare`,{headers,data:{}});expect(missing.status()).toBe(400);expect(await missing.text()).toContain('Prime cover sheet');
 await post(`invoices/${invoice}/documents`,{document_kind:'Prime cover sheet',file_name:'synthetic-cover.pdf',content_base64:Buffer.from('%PDF-1.4\nSYNTHETIC reviewed cover sheet fixture\n%%EOF').toString('base64'),verified:true});
 const packet=await post(`invoices/${invoice}/prepare`,{});const repeat=await post(`invoices/${invoice}/prepare`,{});expect(repeat.id).toBe(packet.id);
 const download=await request.get(`${base}/invoice-packages/${packet.id}/download`,{headers});expect(download.ok()).toBeTruthy();expect((await download.body()).subarray(0,2).toString()).toBe('PK');
 const early=await request.post(`${base}/invoice-packages/invoices/${invoice}/acceptance`,{headers,data:{package_id:packet.id,occurred_at:new Date().toISOString(),recipient:'Synthetic customer',proof_reference:'SYNTHETIC response',notes:'Synthetic event',verified:true,client_mutation_id:randomUUID()}});expect(early.status()).toBe(400);
 for(const event of ['delivered','rejected','resubmitted','accepted']){
  const body={package_id:packet.id,event_type:event,occurred_at:new Date().toISOString(),recipient:'Synthetic customer',proof_reference:'SYNTHETIC '+event+' receipt',notes:'Synthetic event verified in controlled test',verified:true,client_mutation_id:randomUUID()};
  const path=`invoices/${invoice}/${event==='accepted'?'acceptance':'delivery'}`;const first=await post(path,body),again=await post(path,body);expect(again.id).toBe(first.id);
 }
 const read=await request.get(`${base}/invoice-packages/invoices/${invoice}`,{headers});const state=await read.json();expect(state.events.map((e:any)=>e.event_type)).toEqual(['delivered','rejected','resubmitted','accepted']);expect(state.invoice.due_date).toBeTruthy();
 const accepted=new Date(state.events[3].occurred_at);const due=new Date(state.invoice.due_date);expect(due.getTime()-accepted.getTime()).toBeGreaterThan(12*86400000);
}
