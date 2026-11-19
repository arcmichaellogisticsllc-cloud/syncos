import {BadRequestException,Controller,ForbiddenException,Get,Inject,Param,Query,Req} from '@nestjs/common';
import type {Pool} from 'pg';
import {DATABASE_POOL} from '../modules/database.module';
import {AuthenticatedOnly} from '../security/authenticated-only.decorator';
import type {AuthenticatedRequest} from './intelligence.types';
// Directory metadata and separately authorized history. No mutation controls.
const resources:Record<string,{label:string;table:string;permission:string;title:string;status:string;route:string|null;link?:string}>={
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
,
handoffs:{"label": "Project handoffs", "table": "project_handoffs", "permission": "project_handoff.read", "title": "'Project handoff'", "status": "status", "route": "/project-handoffs?record="},
coverage:{"label": "Coverage plans", "table": "coverage_plans", "permission": "coverage_plan.read", "title": "'Coverage plan'", "status": "status", "route": "/opportunities/coverage/"},
relationships:{"label": "Relationship maps", "table": "relationship_maps", "permission": "relationship_map.read", "title": "name", "status": "status", "route": "/intelligence/relationship-maps/"},
candidates:{"label": "Opportunity candidates", "table": "opportunity_candidates", "permission": "opportunity_candidate.read", "title": "title", "status": "status", "route": "/opportunities/candidates/"},
applications:{"label": "Customer payment applications", "table": "payment_applications", "permission": "payment_application.read", "title": "concat_ws(' \u00b7 ',application_type,applied_amount)", "status": "application_status", "route": "/cash/applications/"},
collection_actions:{"label": "Collection actions", "table": "collection_actions", "permission": "collection_action.read", "title": "action_type", "status": "action_status", "route": "/collection-actions/"},
receivables:{"label": "Receivable balances", "table": "ar_records", "permission": "ar_record.read", "title": "'Receivable balance'", "status": "status", "route": null},
rates:{"label": "Rate schedules", "table": "rate_schedules", "permission": "rate_schedule.read", "title": "name", "status": "status", "route": null},
rate_codes:{"label": "Rate codes", "table": "rate_codes", "permission": "rate_code.read", "title": "concat_ws(' \u00b7 ',code,description)", "status": "status", "route": null}
,
bank_accounts:{label:'Bank accounts',table:'bank_accounts',permission:'bank_account.read',title:'account_name',status:'status',route:'/bank-reconciliation/accounts/'},
reconciliation_matches:{label:'Reconciliation matches',table:'reconciliation_matches',permission:'reconciliation_match.read',title:"concat_ws(' · ',match_type,matched_amount)",status:'match_status',route:'/bank-reconciliation/transactions/',link:'bank_transaction_id'}
};
const activityRoutes:Record<string,string>={organizations:"organizations",contacts:"contacts",signals:"signals","projects": "projects", "work_orders": "work-orders", "production": "production-records", "qc": "qc-reviews", "invoices": "invoices", "payables": "contractor-payables", "payroll": "payroll-runs", "payment_batches": "payment-batches", "cash": "cash-receipts", "collections": "collection-cases", "exports": "accounting-export-batches", "billable": "billable-items", "bank": "bank-transactions", "handoffs": "project-handoffs", "coverage": "coverage-plans", "relationships": "relationship-maps", "candidates": "opportunity-candidates", "applications": "payment-applications", "collection_actions": "collection-actions", "opportunities": "opportunities"};
@Controller('record-history') @AuthenticatedOnly()
export class RecordHistoryController {
 constructor(@Inject(DATABASE_POOL) private readonly pool:Pool){}
 private async permissions(r:AuthenticatedRequest){return new Set((await this.pool.query(`SELECT DISTINCT p.key FROM tenant_users tu JOIN tenants t ON t.id=tu.tenant_id AND t.status='active' AND t.deleted_at IS NULL JOIN users u ON u.id=tu.user_id AND u.status='active' AND u.deleted_at IS NULL JOIN user_roles ur ON ur.tenant_id=tu.tenant_id AND ur.tenant_user_id=tu.id AND ur.scope_type='tenant' JOIN roles ro ON ro.id=ur.role_id AND ro.tenant_id=ur.tenant_id AND ro.deleted_at IS NULL JOIN role_permissions rp ON rp.tenant_id=ro.tenant_id AND rp.role_id=ro.id JOIN permissions p ON p.id=rp.permission_id WHERE tu.tenant_id=$1 AND tu.user_id=$2 AND tu.status='active' AND tu.deleted_at IS NULL`,[r.auth.tenantId,r.auth.userId])).rows.map(row=>row.key));}
 @Get()
 async choices(@Req() r:AuthenticatedRequest){const allowed=await this.permissions(r);return Object.entries(resources).filter(([,v])=>allowed.has(v.permission)).map(([key,{label,permission}])=>({key,label,activity_route:activityRoutes[key]??null,audit:allowed.has((key==='production'?'production.read':permission).replace(/\.read$/,'.audit.read')),timeline:allowed.has((key==='production'?'production.read':permission).replace(/\.read$/,'.timeline.read'))}));}
 @Get(':resource')
 async list(@Req() r:AuthenticatedRequest,@Param('resource') resource:string,@Query() query:{before?:string;q?:string}={}){
  const spec=Object.prototype.hasOwnProperty.call(resources,resource)?resources[resource]:undefined;
  if(!spec||!(await this.permissions(r)).has(spec.permission))throw new ForbiddenException('Your account cannot read this record history.');
  if(query.q!==undefined&&(typeof query.q!=='string'||query.q.length>200))throw new BadRequestException('Search must be text up to 200 characters.');
  if(query.before!==undefined&&(typeof query.before!=='string'||!/^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(query.before)))throw new BadRequestException('Invalid history position.');
  const values:unknown[]=[r.auth.tenantId],where=['tenant_id=$1','deleted_at IS NULL'];
  if(query.before){values.push(query.before);where.push(`(created_at,id)<(SELECT created_at,id FROM ${spec.table} WHERE tenant_id=$1 AND id=$${values.length} AND deleted_at IS NULL)`);}
  if(query.q?.trim()){values.push('%'+query.q.trim().replace(/[\\%_]/g,'\\$&')+'%');where.push(`concat_ws(' ',${spec.title},${spec.status},id) ILIKE $${values.length}`);}
  const rows=(await this.pool.query(`SELECT id,${spec.link??'id'} AS link_id,${spec.title} AS title,${spec.status} AS status,created_at FROM ${spec.table} WHERE ${where.join(' AND ')} ORDER BY created_at DESC,id DESC LIMIT 101`,values)).rows;
  return {rows:rows.slice(0,100).map(({link_id,...row})=>({...row,href:spec.route?spec.route+link_id:null})),next:rows.length>100?rows[99].id:null};
 }
 @Get(':resource/:id/:kind')
 async activity(@Req() r:AuthenticatedRequest,@Param('resource') resource:string,@Param('id') id:string,@Param('kind') kind:string,@Query() query:{before?:string;q?:string}={}){
  const spec=Object.prototype.hasOwnProperty.call(resources,resource)?resources[resource]:undefined,allowed=await this.permissions(r);
  if(!spec||!['audit','timeline'].includes(kind)||!allowed.has(spec.permission)||!allowed.has(spec.permission.replace(/\.read$/,'.'+kind+'.read')))throw new ForbiddenException('Your account cannot read this activity history.');
  const uuid=(value:string)=>/^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
  if(!uuid(id)||(query.before&&!uuid(query.before))||(query.q!==undefined&&(typeof query.q!=='string'||query.q.length>200)))throw new BadRequestException('Invalid history reference or search.');
  if(!(await this.pool.query(`SELECT id FROM ${spec.table} WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL`,[r.auth.tenantId,id])).rowCount)throw new ForbiddenException('Record unavailable.');
  const table=kind==='audit'?'audit_logs':'events',entity=kind==='audit'?'entity_id':'aggregate_id',typeColumn=kind==='audit'?'entity_type':'aggregate_type',action=kind==='audit'?'action':'event_type';
  const rows=(await this.pool.query(`SELECT id,${action} AS action,actor_user_id,created_at FROM ${table} WHERE tenant_id=$1 AND ${entity}=$2 AND ${typeColumn}=$5 AND ($3::uuid IS NULL OR (created_at,id)<(SELECT created_at,id FROM ${table} WHERE tenant_id=$1 AND ${entity}=$2 AND id=$3)) AND ${action} ILIKE $4 ORDER BY created_at DESC,id DESC LIMIT 101`,[r.auth.tenantId,id,query.before??null,'%'+(query.q??'').replace(/[\\%_]/g,'\\$&')+'%',spec.permission.split('.')[0]])).rows;
  return {rows:rows.slice(0,100),next:rows.length>100?rows[99].id:null};
 }

}
