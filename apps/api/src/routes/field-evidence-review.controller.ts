import { BadRequestException,Body,Controller,Inject,NotFoundException,Param,Post,Req } from '@nestjs/common';
import type { Pool } from 'pg';
import { executeWriteAction } from '@syncos/shared';
import { DATABASE_POOL } from '../modules/database.module';
import { RequirePermission } from '../security/require-permission.decorator';
import type { AuthenticatedRequest } from './intelligence.types';
import { requireString } from './intelligence.types';
@Controller('field-evidence')
export class FieldEvidenceReviewController {
 constructor(@Inject(DATABASE_POOL) private readonly pool:Pool){}
 @Post(':id/review')
 @RequirePermission('customer_qc.completeness_review')
 async review(@Req() r:AuthenticatedRequest,@Param('id') id:string,@Body() b:Record<string,unknown>){
  if(!['readable','unreadable'].includes(String(b.readability_status)))throw new BadRequestException('Record whether the original file can be opened and its required details read');
  if(b.verified!==true)throw new BadRequestException('Open and inspect the original before recording its readability');
  const notes=requireString(b.review_notes,'Review findings are required');
  const c=await this.pool.connect();
  try{return await executeWriteAction(c,{tenantId:r.auth.tenantId,actorUserId:r.auth.userId,action:'field_evidence.reviewed',eventType:'field_evidence.reviewed',aggregateType:'field_evidence',write:async client=>{
   const before=(await client.query('SELECT id,readability_status FROM syncfield_field_evidence WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[r.auth.tenantId,id])).rows[0];
   if(!before)throw new NotFoundException('Evidence not found');
   const accepted=await client.query("SELECT id FROM customer_qc_decisions WHERE tenant_id=$1 AND $2::uuid=ANY(accepted_evidence_ids) AND current=true AND decision IN ('accepted','partially_accepted') AND deleted_at IS NULL LIMIT 1",[r.auth.tenantId,id]);
   if(accepted.rows.length && b.readability_status!==before.readability_status)throw new BadRequestException('Evidence is linked to recorded customer acceptance and its assessment is preserved. Upload a replacement and route it through correction and customer review');
   const review=(await client.query('INSERT INTO field_evidence_reviews(tenant_id,evidence_id,readability_status,review_notes,reviewed_by) VALUES($1,$2,$3,$4,$5) RETURNING *',[r.auth.tenantId,id,b.readability_status,notes,r.auth.userId])).rows[0];
   await client.query('UPDATE syncfield_field_evidence SET readability_status=$3 WHERE tenant_id=$1 AND id=$2',[r.auth.tenantId,id,b.readability_status]);
   return {entityType:'field_evidence',entityId:id,beforeState:before,afterState:review};
  }});}finally{c.release();}
 }
}
