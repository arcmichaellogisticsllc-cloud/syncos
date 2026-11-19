import {BadRequestException,Controller,Get,Inject,Param,Post,Req,Query,type OnModuleInit,type OnModuleDestroy} from '@nestjs/common';
import type {Pool} from 'pg';
import {DATABASE_POOL} from '../modules/database.module';
import {RequirePermission,TenantPermissionOnly} from '../security/require-permission.decorator';
import type {AuthenticatedRequest} from './intelligence.types';
import {sendOperationalMail} from '../email/operational-mail';
const uuid=(v:string)=>{if(!/^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v))throw new BadRequestException('Invalid notification reference.');return v;};
@Controller('workflow-notifications') @TenantPermissionOnly()
export class WorkflowNotificationsController implements OnModuleInit,OnModuleDestroy {
 private timer?:ReturnType<typeof setInterval>;private running=false;
 constructor(@Inject(DATABASE_POOL) private readonly pool:Pool){}
 onModuleInit(){this.timer=setInterval(()=>{void this.tick().catch(()=>{console.error('Operational notification scheduler failed; inspect database health.');});},60000);this.timer.unref();}
 onModuleDestroy(){if(this.timer)clearInterval(this.timer);}
 @Get() @RequirePermission('workflow_task.read')
 async list(@Req() r:AuthenticatedRequest,@Query('before') before?:string){const values:unknown[]=[r.auth.tenantId,r.auth.userId];let cursor='';if(before){values.push(uuid(before));cursor='AND (n.created_at,n.id)<(SELECT created_at,id FROM workflow_notifications WHERE tenant_id=$1 AND recipient_user_id=$2 AND id=$3)';}return (await this.pool.query(`SELECT n.*,t.title,t.due_at,t.status AS task_status FROM workflow_notifications n JOIN workflow_tasks t ON t.tenant_id=n.tenant_id AND t.id=n.task_id WHERE n.tenant_id=$1 AND n.recipient_user_id=$2 ${cursor} ORDER BY n.created_at DESC,n.id DESC LIMIT 100`,values)).rows;}
 @Post(':id/retry') @RequirePermission('workflow_task.update')
 async retry(@Req() r:AuthenticatedRequest,@Param('id') id:string){uuid(id);const c=await this.pool.connect();try{await c.query('BEGIN');const n=(await c.query(`UPDATE workflow_notifications SET status='pending',attempts=0,next_attempt_at=now(),last_error=NULL WHERE tenant_id=$1 AND recipient_user_id=$2 AND id=$3 AND status='failed' RETURNING id`,[r.auth.tenantId,r.auth.userId,id])).rows[0];if(!n)throw new BadRequestException('Only your failed notifications can be retried.');await c.query("INSERT INTO workflow_notification_attempts(notification_id,status,actor_user_id) VALUES($1,'retry_requested',$2)",[id,r.auth.userId]);await c.query('COMMIT');return {id};}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
 async tick(){if(this.running)return;this.running=true;try{
  await this.pool.query(`INSERT INTO workflow_notifications(tenant_id,task_id,recipient_user_id,kind,dedupe_key) SELECT c.tenant_id,c.task_id,c.recipient_user_id,c.kind,c.dedupe_key FROM workflow_notice_candidates c WHERE NOT EXISTS(SELECT 1 FROM workflow_notifications n WHERE n.dedupe_key=c.dedupe_key) ORDER BY c.created_at,c.dedupe_key LIMIT 1000 ON CONFLICT DO NOTHING`);
  if(process.env.WORKFLOW_NOTIFICATION_DELIVERY_ENABLED!=='true')return;
  for(let i=0;i<20;i++)if(!await this.deliverOne())break;
 }finally{this.running=false;}}
 async deliverOne(tenantId?:string){const c=await this.pool.connect();try{await c.query('BEGIN');const n=(await c.query(`SELECT n.*,u.email FROM workflow_notifications n JOIN users u ON u.id=n.recipient_user_id WHERE n.status='pending' AND n.next_attempt_at<=now() AND ($1::uuid IS NULL OR n.tenant_id=$1) ORDER BY n.created_at,n.id LIMIT 1 FOR UPDATE OF n SKIP LOCKED`,[tenantId??null])).rows[0];if(!n){await c.query('COMMIT');return false;}
  let status='cancelled';const available=(await c.query('SELECT 1 FROM workflow_notice_candidates WHERE dedupe_key=$1',[n.dedupe_key])).rowCount;
  if(available){try{await this.send(n.email,n.kind,n.id);status='sent';await c.query("UPDATE workflow_notifications SET status='sent',attempts=attempts+1,sent_at=now(),last_error=NULL WHERE id=$1",[n.id]);}catch{status='failed';await c.query(`UPDATE workflow_notifications SET status=$2,attempts=attempts+1,next_attempt_at=now()+$3::int*interval '1 minute',last_error='Delivery was not confirmed. Check provider configuration and retry.' WHERE id=$1`,[n.id,n.attempts>=4?'failed':'pending',Math.min(60,2**n.attempts)]);}}
  else await c.query("UPDATE workflow_notifications SET status='cancelled',last_error='Task closed, ownership changed, deadline changed or recipient access removed.' WHERE id=$1",[n.id]);
  await c.query('INSERT INTO workflow_notification_attempts(notification_id,status) VALUES($1,$2)',[n.id,status]);await c.query('COMMIT');return true;
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
 protected async send(to:string,kind:string,id:string){await sendOperationalMail(to,`SyncOS workflow ${kind}`,'/workflow-notifications',id);}
}
