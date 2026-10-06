import {expect} from '@playwright/test';
import {Pool} from 'pg';
import {randomUUID} from 'node:crypto';
// This helper is used only by synthetic local acceptance fixtures. The transport is
// replaced before the worker is called; no prime receives a package.
export async function verifyPreparedPrimeDelivery(bearer:string,invoice:string,contract:string,packet:{id:string;archive_checksum:string}){
 const {PrimeDeliveryController}=require('../../../apps/api/dist/routes/prime-delivery.controller');
 const {verifyAuthToken}=require('@syncos/auth');const claims=verifyAuthToken(bearer,process.env.AUTH_JWT_SECRET);
 const pool=new Pool({connectionString:process.env.DATABASE_URL}),controller=new PrimeDeliveryController(pool),second=new PrimeDeliveryController(pool),req={auth:{tenantId:claims.tenant_id,userId:claims.sub}};
 const before=process.env.PRIME_DELIVERY_ENABLED,hosts=process.env.PRIME_DELIVERY_ALLOWED_HOSTS;process.env.PRIME_DELIVERY_ENABLED='true';process.env.PRIME_DELIVERY_ALLOWED_HOSTS='synthetic-delivery.invalid';
 try{
  const destination=await controller.destination(req,contract,{name:'Synthetic approved delivery',endpoint:'https://synthetic-delivery.invalid/packages',credential_env:'PRIME_DELIVERY_TOKEN_SYNTHETIC',recipient:'Synthetic prime',source_reference:'Synthetic receiver contract only',enabled:true,verified:true});
  const input=()=>({package_id:packet.id,destination_id:destination.id,client_mutation_id:randomUUID()});
  let body=input(),job=await controller.queue(req,invoice,body);expect((await controller.queue(req,invoice,body)).id).toBe(job.id);
  await expect(controller.queue(req,invoice,input())).rejects.toThrow(/existing delivery/);
  await controller.cancel(req,job.id,{reason:'Synthetic cancellation before sending'});
  body=input();job=await controller.queue(req,invoice,body);let calls=0;
  controller.transmit=async()=>{calls++;throw Error('Synthetic lost receipt after possible delivery');};await controller.processNext();expect(calls).toBe(1);
  expect((await pool.query('SELECT status FROM prime_delivery_jobs WHERE id=$1',[job.id])).rows[0].status).toBe('review');await controller.processNext();expect(calls).toBe(1);
  await expect(controller.resolve(req,job.id,{resolution:'delivery_recorded',proof_reference:'synthetic',verified:true})).rejects.toThrow(/Record the verified delivery/);
  await controller.resolve(req,job.id,{resolution:'not_delivered',proof_reference:'Synthetic prime confirms no package received',verified:true});
  job=await controller.queue(req,invoice,input());controller.transmit=async()=>{calls++;throw Object.assign(Error('Synthetic rate limit'),{retryable:true});};await controller.processNext();
  expect((await pool.query('SELECT status FROM prime_delivery_jobs WHERE id=$1',[job.id])).rows[0].status).toBe('queued');
  await pool.query('UPDATE prime_delivery_jobs SET next_attempt_at=now() WHERE id=$1',[job.id]);
  const send=async()=>{calls++;return {receipt_id:'SYNTHETIC-'+job.id,status:'delivered',received_at:new Date().toISOString(),package_checksum:packet.archive_checksum};};controller.transmit=send;second.transmit=send;
  await Promise.all([controller.processNext(),second.processNext()]);expect(calls).toBe(3);
  const delivered=(await pool.query('SELECT * FROM prime_delivery_jobs WHERE id=$1',[job.id])).rows[0];expect(delivered.status).toBe('delivered');expect(delivered.attempts).toBe(2);
  expect((await pool.query('SELECT count(*)::int n FROM invoice_delivery_events WHERE invoice_id=$1',[invoice])).rows[0].n).toBe(1);
  const financial=(await pool.query('SELECT customer_acceptance_status,contract_trigger_at FROM invoices WHERE id=$1',[invoice])).rows[0];expect(financial.customer_acceptance_status).toBe('pending');expect(financial.contract_trigger_at).toBeNull();
  await controller.revoke(req,destination.id,{reason:'Synthetic destination retirement'});expect((await controller.read(req,invoice)).destinations).toHaveLength(0);
 }finally{await pool.end();if(before===undefined)delete process.env.PRIME_DELIVERY_ENABLED;else process.env.PRIME_DELIVERY_ENABLED=before;if(hosts===undefined)delete process.env.PRIME_DELIVERY_ALLOWED_HOSTS;else process.env.PRIME_DELIVERY_ALLOWED_HOSTS=hosts;}
}
