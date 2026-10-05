import {BadRequestException} from '@nestjs/common';
import type {Pool} from 'pg';
export type HistoryQuery={before?:string;q?:string};
const resources={
 notifications:{table:'inquiry_follow_up_notifications',search:"concat_ws(' ',kind,status,last_error)",select:"i.*, (SELECT subject FROM customer_service_inquiries c WHERE c.tenant_id=i.tenant_id AND c.id=i.inquiry_id) AS subject, (SELECT display_name FROM users u WHERE u.id=i.recipient_user_id) AS recipient_name"},
 forms:{table:'supplemental_form_versions',search:"schema->>'name'",select:'*'},
 records:{table:'supplemental_form_records',search:"schema_snapshot->>'name'",select:'*'},
 movements:{table:'material_movements',search:"concat_ws(' ',kind,reference,reason)",select:'*'},
 inquiries:{table:'customer_service_inquiries',search:"concat_ws(' ',customer_name,email,subject,details)",select:"i.*, (SELECT count(*)::int FROM customer_service_inquiries other WHERE other.tenant_id=i.tenant_id AND other.id<>i.id AND lower(other.email)=lower(i.email) AND lower(other.subject)=lower(i.subject)) AS possible_duplicates"}
} as const;
export async function workspaceHistory(pool:Pool,tenant:string,resource:keyof typeof resources,query:HistoryQuery={}){
 const {table,search,select}=resources[resource];
 if(query.before!==undefined&&(typeof query.before!=='string'||!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(query.before)))throw new BadRequestException('Invalid history position. Refresh the list.');
 if(query.q!==undefined&&(typeof query.q!=='string'||query.q.length>200))throw new BadRequestException('Search must be text up to 200 characters.');
 const values:unknown[]=[tenant];const filters=['i.tenant_id=$1'];
 if(query.before){values.push(query.before);filters.push(`(i.created_at,i.id)<(SELECT created_at,id FROM ${table} WHERE tenant_id=$1 AND id=$${values.length})`);}
 if(query.q?.trim()){values.push('%'+query.q.trim().replace(/[\\%_]/g,'\\$&')+'%');filters.push(`(${search}) ILIKE $${values.length}`);}
 return (await pool.query(`SELECT ${select} FROM ${table} i WHERE ${filters.join(' AND ')} ORDER BY i.created_at DESC,i.id DESC LIMIT 200`,values)).rows;
}

export async function workspaceChoices(pool:Pool,tenant:string,kind:string,q:unknown,allowed:readonly string[],before?:string){
 const definitions:Record<string,[string,string]>={crews:['crews','name'],work_orders:['work_orders','work_order_number'],opportunities:['opportunities','title'],projects:['projects','name']};
 if(!allowed.includes(kind)||!definitions[kind])throw new BadRequestException('Invalid selection list.');
 if(q!==undefined&&(typeof q!=='string'||q.length>200))throw new BadRequestException('Search must be text up to 200 characters.');
 if(before&&!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(before))throw new BadRequestException('Invalid selection position.');
 const [table,label]=definitions[kind];const search='%'+String(q??'').trim().replace(/[\\%_]/g,'\\$&')+'%';
 return (await pool.query(`SELECT id,${label} AS label FROM ${table} WHERE tenant_id=$1 AND deleted_at IS NULL AND ${label} ILIKE $2 AND ($3::uuid IS NULL OR (${label},id)>(SELECT ${label},id FROM ${table} WHERE tenant_id=$1 AND id=$3 AND deleted_at IS NULL)) ORDER BY ${label},id LIMIT 200`,[tenant,search,before??null])).rows;
}
