import {expect,type APIRequestContext} from '@playwright/test';
import crypto from 'node:crypto';
export async function reviewFixtureQuantity(request:APIRequestContext,bearer:string,id:string){
 const response=await request.post(`${process.env.API_BASE_URL}/production-quantity/${id}/review`,{headers:{authorization:`Bearer ${bearer}`},data:{disposition:'primary_work',canonical_reference:`synthetic-work-${id}`,source_reference:'SYNTHETIC fixture assigned work; no operational authorization',review_notes:'Synthetic acceptance fixture: independently reconciled work identity and quantity',client_mutation_id:crypto.randomUUID()}});
 expect(response.ok(),await response.text()).toBeTruthy();return response.json();
}
