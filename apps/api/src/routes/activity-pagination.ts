import {BadRequestException} from '@nestjs/common';
import {createHash} from 'node:crypto';
import type {PoolClient} from 'pg';
/** Pages the existing authorized activity query, including its original child scopes.
 * The caller supplies the SQL; no table or column names come from request input.
 */
export async function activityPage(client:PoolClient,sql:string,values:any[],query:any={}){
 const scope=createHash('sha256').update(sql+JSON.stringify(values)).digest('hex');
 let time:string|null=null,id:string|null=null;
 if(query.before!==undefined){try{if(typeof query.before!=='string'||query.before.length>500)throw Error();const cursor=JSON.parse(Buffer.from(query.before,'base64url').toString());if(cursor.scope!==scope||typeof cursor.time!=='string'||!Number.isFinite(Date.parse(cursor.time))||!/^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(cursor.id))throw Error();time=cursor.time;id=cursor.id;}catch{throw new BadRequestException('Invalid activity position. Start from the latest records.');}}
 if(query.history_q!==undefined&&(typeof query.history_q!=='string'||query.history_q.length>200))throw new BadRequestException('Activity search must be text up to 200 characters.');
 const end=sql.lastIndexOf('ORDER BY'),core=end>=0&&/LIMIT\s+(?:50|100|200|250)\s*$/i.test(sql)?sql.slice(0,end):sql,n=values.length;
 if(core===sql)throw Error('Activity query must have an explicit supported final bound');
 const result=await client.query(`WITH authorized_activity AS (${core}) SELECT * FROM authorized_activity h WHERE ($${n+1}::timestamptz IS NULL OR (h.__history_time::timestamptz,h.__history_id)<($${n+1}::timestamptz,$${n+2}::uuid)) AND to_jsonb(h)::text ILIKE $${n+3} ORDER BY h.__history_time::timestamptz DESC,h.__history_id DESC LIMIT 100`,[...values,time,id,'%'+String(query.history_q??'').replace(/[\\%_]/g,'\\$&')+'%']);
 return {...result,rows:result.rows.map(({__history_id,__history_time,...row})=>({...row,_history_cursor:Buffer.from(JSON.stringify({id:__history_id,time:__history_time,scope})).toString('base64url')}))};
}
