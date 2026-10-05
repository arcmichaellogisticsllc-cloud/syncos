import {BadRequestException,Controller,ForbiddenException,Get,Inject,Param,Query,Req} from '@nestjs/common';
import type {Pool} from 'pg';
import {DATABASE_POOL} from '../modules/database.module';
import {AuthenticatedOnly} from '../security/authenticated-only.decorator';
import type {AuthenticatedRequest} from './intelligence.types';
// Only directory metadata is exposed here. Detailed records keep their own guarded APIs.
const resources:Record<string,{label:string;table:string;permission:string;title:string;status:string;route:string|null}>={
 projects:{label:'Projects',table:'projects',permission:'project.read',title:'name',status:'status',route:'/projects/'},
 work_orders:{label:'Work orders',table:'work_orders',permission:'work_order.read',title:"concat_ws(' · ',work_order_number,title)",status:'status',route:'/work-orders/'},
 production:{label:'Production',table:'production_records',permission:'production_record.read',title:"concat_ws(' · ',production_date,description)",status:'status',route:'/production/'},
 qc:{label:'QC reviews',table:'qc_reviews',permission:'qc_review.read',title:"'QC review'",status:'review_status',route:'/qc/'},
 invoices:{label:'Invoices',table:'invoices',permission:'invoice.read',title:'invoice_number',status:'status',route:'/invoices/'},
 payables:{label:'Partner payables',table:'contractor_payables',permission:'contractor_payable.read',title:'payable_number',status:'status',route:'/contractor-payables/'},
 payroll:{label:'Employee payroll',table:'payroll_runs',permission:'payroll_run.read',title:'payroll_run_number',status:'status',route:'/payroll/'},
 payment_batches:{label:'Payment batches',table:'payment_batches',permission:'payment_batch.read',title:'payment_batch_number',status:'status',route:'/payments/'},
 cash:{label:'Customer cash receipts',table:'cash_receipts',permission:'cash_receipt.read',title:"concat_ws(' · ',receipt_number,payer_name)",status:'receipt_status',route:'/cash/receipts/'},
 collections:{label:'Collection cases',table:'collection_cases',permission:'collection_case.read',title:'case_number',status:'case_status',route:'/collections/'},
 exports:{label:'Accounting exports',table:'accounting_export_batches',permission:'accounting_export_batch.read',title:'export_batch_number',status:'status',route:'/accounting-exports/'},
 tasks:{label:'Workflow tasks',table:'workflow_tasks',permission:'workflow_task.read',title:'title',status:'status',route:null},
 instances:{label:'Workflow instances',table:'workflow_instances',permission:'workflow_instance.read',title:"'Workflow instance'",status:'status',route:null},
 organizations:{label:'Organizations',table:'organizations',permission:'organization.read',title:'name',status:'status',route:'/intelligence/organizations/'},
 contacts:{label:'Contacts',table:'contacts',permission:'contact.read',title:"concat_ws(' ',first_name,last_name)",status:'status',route:'/intelligence/contacts/'},
 opportunities:{label:'Opportunities',table:'opportunities',permission:'opportunity.read',title:'title',status:'status',route:'/opportunities/'},
 signals:{label:'Signals',table:'signals',permission:'signal.read',title:'title',status:'status',route:'/intelligence/signals/'},
 billable:{label:'Billable work',table:'billable_items',permission:'billable_item.read',title:"'Billable work'",status:'status',route:'/billable/'},
 settlements:{label:'Settlements',table:'settlements',permission:'settlement.read',title:'settlement_number',status:'status',route:'/settlements/'},
 bank:{label:'Bank transactions',table:'bank_transactions',permission:'bank_transaction.read',title:'description',status:'reconciliation_status',route:'/bank-reconciliation/transactions/'}
};
@Controller('record-history') @AuthenticatedOnly()
export class RecordHistoryController {
 constructor(@Inject(DATABASE_POOL) private readonly pool:Pool){}
 private async permissions(r:AuthenticatedRequest){return new Set((await this.pool.query(`SELECT DISTINCT p.key FROM tenant_users tu JOIN tenants t ON t.id=tu.tenant_id AND t.status='active' AND t.deleted_at IS NULL JOIN users u ON u.id=tu.user_id AND u.status='active' AND u.deleted_at IS NULL JOIN user_roles ur ON ur.tenant_id=tu.tenant_id AND ur.tenant_user_id=tu.id AND ur.scope_type='tenant' JOIN roles ro ON ro.id=ur.role_id AND ro.tenant_id=ur.tenant_id AND ro.deleted_at IS NULL JOIN role_permissions rp ON rp.tenant_id=ro.tenant_id AND rp.role_id=ro.id JOIN permissions p ON p.id=rp.permission_id WHERE tu.tenant_id=$1 AND tu.user_id=$2 AND tu.status='active' AND tu.deleted_at IS NULL`,[r.auth.tenantId,r.auth.userId])).rows.map(row=>row.key));}
 @Get()
 async choices(@Req() r:AuthenticatedRequest){const allowed=await this.permissions(r);return Object.entries(resources).filter(([,v])=>allowed.has(v.permission)).map(([key,{label}])=>({key,label}));}
 @Get(':resource')
 async list(@Req() r:AuthenticatedRequest,@Param('resource') resource:string,@Query() query:{before?:string;q?:string}={}){
  const spec=Object.prototype.hasOwnProperty.call(resources,resource)?resources[resource]:undefined;
  if(!spec||!(await this.permissions(r)).has(spec.permission))throw new ForbiddenException('Your account cannot read this record history.');
  if(query.q!==undefined&&(typeof query.q!=='string'||query.q.length>200))throw new BadRequestException('Search must be text up to 200 characters.');
  if(query.before!==undefined&&(typeof query.before!=='string'||!/^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(query.before)))throw new BadRequestException('Invalid history position.');
  const values:unknown[]=[r.auth.tenantId],where=['tenant_id=$1','deleted_at IS NULL'];
  if(query.before){values.push(query.before);where.push(`(created_at,id)<(SELECT created_at,id FROM ${spec.table} WHERE tenant_id=$1 AND id=$${values.length} AND deleted_at IS NULL)`);}
  if(query.q?.trim()){values.push('%'+query.q.trim().replace(/[\\%_]/g,'\\$&')+'%');where.push(`concat_ws(' ',${spec.title},${spec.status},id) ILIKE $${values.length}`);}
  const rows=(await this.pool.query(`SELECT id,${spec.title} AS title,${spec.status} AS status,created_at FROM ${spec.table} WHERE ${where.join(' AND ')} ORDER BY created_at DESC,id DESC LIMIT 101`,values)).rows;
  return {rows:rows.slice(0,100).map(row=>({...row,href:spec.route?spec.route+row.id:null})),next:rows.length>100?rows[99].id:null};
 }
}
