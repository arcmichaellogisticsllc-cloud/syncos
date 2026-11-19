import {workspaceHistory,type HistoryQuery} from './workspace-history';
import {BadRequestException,Controller,Get,Inject,Param,Post,Req,Query,type OnModuleInit,type OnModuleDestroy} from '@nestjs/common';
import type {Pool} from 'pg';
import {DATABASE_POOL} from '../modules/database.module';
import {RequirePermission,TenantPermissionOnly} from '../security/require-permission.decorator';
import type {AuthenticatedRequest} from './intelligence.types';
import {inquiryOwnerAvailable} from './public-customer-intake.controller';
import {sendOperationalMail} from '../email/operational-mail';
@Controller('customer-inquiry-notifications') @TenantPermissionOnly()
export class InquiryNotificationsController implements OnModuleInit,OnModuleDestroy {
 private timer?:ReturnType<typeof setInterval>;private running=false;
 constructor(@Inject(DATABASE_POOL) private readonly pool:Pool){}
 onModuleInit(){this.timer=setInterval(()=>{void this.tick().catch(()=>{console.error('Operational notification scheduler failed; inspect database health.');});},60000);this.timer.unref();}
 onModuleDestroy(){if(this.timer)clearInterval(this.timer);}
 @Get() @RequirePermission('customer_inquiry.manage')
 async list(@Req() r:AuthenticatedRequest,@Query() query:HistoryQuery={}){return workspaceHistory(this.pool,r.auth.tenantId,'notifications',query);}
 @Post(':id/retry') @RequirePermission('customer_inquiry.manage')
 async retry(@Req() r:AuthenticatedRequest,@Param('id') id:string){if(!/^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id))throw new BadRequestException('Invalid notification.');const c=await this.pool.connect();try{await c.query('BEGIN');const n=(await c.query(`UPDATE inquiry_follow_up_notifications SET status='pending',attempts=0,next_attempt_at=now(),last_error=NULL WHERE tenant_id=$1 AND id=$2 AND status='failed' RETURNING id`,[r.auth.tenantId,id])).rows[0];if(!n)throw new BadRequestException('Only failed notifications can be retried.');await c.query("INSERT INTO inquiry_notification_attempts(notification_id,status,actor_user_id) VALUES($1,'retry_requested',$2)",[id,r.auth.userId]);await c.query('COMMIT');return {id};}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
 async tick(){if(this.running)return;this.running=true;try{
  await this.pool.query(`INSERT INTO inquiry_follow_up_notifications(tenant_id,inquiry_id,recipient_user_id,kind,dedupe_key)
   SELECT i.tenant_id,i.id,c.escalation_user_id,'overdue','overdue:'||i.id::text||':'||i.revision::text||':'||c.escalation_user_id::text
   FROM customer_service_inquiries i JOIN public_intake_receipts p ON p.tenant_id=i.tenant_id AND p.inquiry_id=i.id JOIN customer_intake_channels c ON c.id=p.channel_id
   WHERE i.due_at<=now() AND i.status NOT IN ('closed','qualified')
   AND NOT EXISTS(SELECT 1 FROM inquiry_follow_up_notifications n WHERE n.tenant_id=i.tenant_id AND n.dedupe_key='overdue:'||i.id::text||':'||i.revision::text||':'||c.escalation_user_id::text)
   ORDER BY i.due_at,i.id LIMIT 1000 ON CONFLICT DO NOTHING`);
  await this.pool.query("DELETE FROM public_intake_limits WHERE window_start<now()-interval '2 days'");
  if(process.env.INQUIRY_NOTIFICATION_DELIVERY_ENABLED!=='true')return;
  for(let count=0;count<20;count++){if(!await this.deliverOne())break;}
 }finally{this.running=false;}}
 async deliverOne(tenantId?:string){const c=await this.pool.connect();try{await c.query('BEGIN');const n=(await c.query(`SELECT n.*,i.status AS inquiry_status,i.owner_user_id,u.email FROM inquiry_follow_up_notifications n JOIN customer_service_inquiries i ON i.tenant_id=n.tenant_id AND i.id=n.inquiry_id JOIN users u ON u.id=n.recipient_user_id WHERE n.status='pending' AND n.next_attempt_at<=now() AND ($1::uuid IS NULL OR n.tenant_id=$1) ORDER BY n.created_at LIMIT 1 FOR UPDATE OF n SKIP LOCKED`,[tenantId??null])).rows[0];if(!n){await c.query('COMMIT');return false;}
  let status='cancelled';
  // Re-evaluate the exact escalation generation at delivery, not just when queued.
  // A later deadline or escalation-owner change must not send an obsolete reminder.
  const eligible=n.kind==='assigned'?n.owner_user_id===n.recipient_user_id:Boolean((await c.query(`SELECT 1 FROM customer_service_inquiries i JOIN public_intake_receipts p ON p.tenant_id=i.tenant_id AND p.inquiry_id=i.id JOIN customer_intake_channels channel ON channel.id=p.channel_id AND channel.tenant_id=i.tenant_id WHERE i.tenant_id=$1 AND i.id=$2 AND i.due_at<=now() AND channel.escalation_user_id=$3 AND $4='overdue:'||i.id::text||':'||i.revision::text||':'||channel.escalation_user_id::text`,[n.tenant_id,n.inquiry_id,n.recipient_user_id,n.dedupe_key])).rowCount);
  if(!['closed','qualified'].includes(n.inquiry_status)&&eligible&&await inquiryOwnerAvailable(c,n.tenant_id,n.recipient_user_id)){
   try{await this.send(n.email,n.kind,n.id);status='sent';await c.query("UPDATE inquiry_follow_up_notifications SET status='sent',attempts=attempts+1,sent_at=now(),last_error=NULL WHERE id=$1",[n.id]);}
   catch{status='failed';await c.query(`UPDATE inquiry_follow_up_notifications SET status=$2,attempts=attempts+1,next_attempt_at=now()+$3::int*interval '1 minute',last_error='Delivery was not confirmed. Check provider configuration and retry.' WHERE id=$1`,[n.id,n.attempts>=4?'failed':'pending',Math.min(60,2**n.attempts)]);}
  }else await c.query("UPDATE inquiry_follow_up_notifications SET status='cancelled',last_error='Inquiry closed, ownership or deadline changed, or recipient access removed.' WHERE id=$1",[n.id]);
  await c.query('INSERT INTO inquiry_notification_attempts(notification_id,status) VALUES($1,$2)',[n.id,status]);await c.query('COMMIT');return true;
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
 protected async send(to:string,kind:string,id:string){await sendOperationalMail(to,kind==='overdue'?'SyncOS inquiry follow-up overdue':'SyncOS inquiry assigned','/customer-inquiries',id);}
}
