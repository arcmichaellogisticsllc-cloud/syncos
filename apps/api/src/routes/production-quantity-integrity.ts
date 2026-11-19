import { createHash } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import type { PoolClient } from 'pg';
export function productionQuantityFingerprint(record:Record<string,any>){
 const date=record.production_date instanceof Date?record.production_date.toISOString().slice(0,10):String(record.production_date).slice(0,10);
 return createHash('sha256').update(JSON.stringify([record.id,record.work_order_id,record.crew_id,date,Number(record.quantity_submitted??record.quantity),record.unit??record.unit_type,record.syncfield_production_code_id??record.rate_code_id,record.asset_identifier,record.from_asset_identifier,record.to_asset_identifier,record.quantity_revision_ids??[]])).digest('hex');
}
export function assertQuantityRelationship(disposition:string,quantity:number,related:number[]){
 if(!Number.isFinite(quantity)||quantity<=0||related.some(value=>!Number.isFinite(value)||value<=0))throw new BadRequestException('Positive finite source quantities are required');
 if(disposition==='included_subset'&&(related.length!==1||quantity>related[0]))throw new BadRequestException('An included subset must belong to one work item and cannot exceed its quantity');
 if(disposition==='summary'&&(!related.length||Math.abs(quantity-related.reduce((a,b)=>a+b,0))>0.000001))throw new BadRequestException('Summary quantity must equal its distinct underlying work items; reconcile conflicting totals first');
 if(['primary_work','additional_work'].includes(disposition)&&related.length)throw new BadRequestException('New work must not count quantities already covered by linked work items');
}
export async function productionQuantitySource(c:PoolClient,tenant:string,id:string){
 const original=(await c.query('SELECT * FROM production_records WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL FOR SHARE',[tenant,id])).rows[0];
 if(!original)throw new BadRequestException('Production source is unavailable');
 const revisions=original.daily_production_report_id?(await c.query(`SELECT revision.id,revision.snapshot_json->'proposed_correction' AS proposal FROM daily_production_report_revisions revision
   JOIN production_corrections correction ON correction.tenant_id=revision.tenant_id AND correction.id::text=revision.snapshot_json->'correction'->>'id'
   WHERE revision.tenant_id=$1 AND revision.daily_report_id=$2 AND revision.snapshot_json->>'original_production_record_id'=$3
    AND correction.deleted_at IS NULL AND correction.status IN ('awaiting_customer_reinspection','resolved') ORDER BY revision.revision_number`,[tenant,original.daily_production_report_id,id])).rows:[];
 const source={...original,quantity_revision_ids:revisions.map(r=>r.id)};
 if(!original.daily_production_report_id){
  const corrections=(await c.query('SELECT id,corrected_quantity FROM administrative_production_corrections WHERE tenant_id=$1 AND production_record_id=$2 ORDER BY recorded_at,id',[tenant,id])).rows;
  if(corrections.length){source.quantity_submitted=Number(corrections.at(-1).corrected_quantity);source.quantity_revision_ids=corrections.map(r=>r.id);}
 }
 for(const {proposal} of revisions){
  if(proposal?.reported_quantity!==null&&proposal?.reported_quantity!==undefined)source.quantity_submitted=Number(proposal.reported_quantity);
  if(proposal?.asset_identifier)source.asset_identifier=proposal.asset_identifier;
  if(proposal?.route_endpoint)source.to_asset_identifier=proposal.route_endpoint;
  if(proposal?.production_code_id){source.syncfield_production_code_id=proposal.production_code_id;const code=(await c.query('SELECT unit_of_measure FROM syncfield_production_codes WHERE tenant_id=$1 AND id=$2',[tenant,proposal.production_code_id])).rows[0];if(!code)throw new BadRequestException('Corrected production code is unavailable');source.unit=code.unit_of_measure;source.unit_type=code.unit_of_measure;}
 }
 return source;
}
export async function requireReviewedProductionQuantity(c:PoolClient,tenant:string,id:string){
 const record=await productionQuantitySource(c,tenant,id);
 if(['voided','archived','cancelled','rejected'].includes(record.status))throw new BadRequestException('Retired production cannot advance as reviewed work');
 const review=(await c.query('SELECT * FROM production_quantity_reviews WHERE tenant_id=$1 AND id=$2',[tenant,record.quantity_review_id])).rows[0];
 if(review&&!['primary_work','additional_work'].includes(review.disposition))throw new BadRequestException('Included subsets and summaries are references to existing work, not additional billable production');
 if(!review||review.source_fingerprint!==productionQuantityFingerprint(record))throw new BadRequestException('Review the current production quantity, work identity and overlap before customer acceptance or finance');
 return {record,review};
}

export async function quantityReviewFingerprint(c:PoolClient,tenant:string,record:Record<string,any>,relatedIds:string[]){
 if(!relatedIds.length)return productionQuantityFingerprint(record);
 const related=[];
 for(const id of [...relatedIds].sort()){
  const source=await requireReviewedProductionQuantity(c,tenant,id);
  related.push([id,productionQuantityFingerprint(source.record)]);
 }
 return createHash('sha256').update(JSON.stringify([productionQuantityFingerprint(record),related])).digest('hex');
}
export async function quantityReviewCurrent(c:PoolClient,tenant:string,record:Record<string,any>,review:Record<string,any>|undefined){
 if(!review)return false;
 try{return review.source_fingerprint===await quantityReviewFingerprint(c,tenant,record,review.related_record_ids??[]);}
 catch(error){if(error instanceof BadRequestException)return false;throw error;}
}
