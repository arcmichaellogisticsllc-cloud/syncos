import {BadRequestException,Body,Controller,Get,Inject,Post,Req} from '@nestjs/common';
import type {Pool,PoolClient} from 'pg';
import {executeWriteAction} from '@syncos/shared';
import {DATABASE_POOL} from '../modules/database.module';
import {RequirePermission} from '../security/require-permission.decorator';
import type {AuthenticatedRequest} from './intelligence.types';
const id=(v:unknown)=>{if(typeof v!=='string'||!/^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v))throw new BadRequestException('Select a valid record.');return v;};
const scaled=(s:string)=>{const negative=s.startsWith('-');const [whole,fraction='']=s.replace(/^-/,'').split('.');return (BigInt(whole)*10000n+BigInt(fraction.padEnd(4,'0')))*(negative?-1n:1n);};
const text=(v:unknown,label:string)=>{if(typeof v!=='string'||!v.trim()||v.length>1000)throw new BadRequestException(`${label} is required, up to 1000 characters.`);return v.trim();};
@Controller('material-inventory')
export class MaterialInventoryController {
 constructor(@Inject(DATABASE_POOL) private readonly pool:Pool){}
 @Get() @RequirePermission('inventory.read')
 async list(@Req() r:AuthenticatedRequest){const t=r.auth.tenantId;const [lots,locations,movements,balances]=await Promise.all([
  this.pool.query('SELECT * FROM material_lots WHERE tenant_id=$1 ORDER BY label',[t]),
  this.pool.query('SELECT * FROM material_locations WHERE tenant_id=$1 ORDER BY label',[t]),
  this.pool.query('SELECT * FROM material_movements WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 200',[t]),
  this.pool.query(`SELECT lot_id,location_id,sum(quantity)::text AS balance FROM (
   SELECT lot_id,to_location_id AS location_id,quantity FROM material_movements WHERE tenant_id=$1 AND to_location_id IS NOT NULL
   UNION ALL SELECT lot_id,from_location_id,-quantity FROM material_movements WHERE tenant_id=$1 AND from_location_id IS NOT NULL
  ) a GROUP BY lot_id,location_id ORDER BY lot_id,location_id`,[t])]);return {lots:lots.rows,locations:locations.rows,movements:movements.rows,balances:balances.rows,usage:(await this.pool.query(`SELECT m.lot_id,m.work_order_id,w.work_order_number,p.name AS project_name,m.kind,sum(m.quantity)::text AS quantity FROM material_movements m JOIN work_orders w ON w.tenant_id=m.tenant_id AND w.id=m.work_order_id LEFT JOIN projects p ON p.tenant_id=w.tenant_id AND p.id=w.project_id WHERE m.tenant_id=$1 AND m.kind IN ('installed','scrap','offcut') GROUP BY m.lot_id,m.work_order_id,w.work_order_number,p.name,m.kind ORDER BY w.work_order_number,m.kind`,[t])).rows,crews:(await this.pool.query("SELECT id,name AS label FROM crews WHERE tenant_id=$1 AND deleted_at IS NULL ORDER BY name LIMIT 200",[t])).rows,work_orders:(await this.pool.query("SELECT id,work_order_number AS label FROM work_orders WHERE tenant_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 200",[t])).rows};}
 @Post('lots') @RequirePermission('inventory.manage')
 async lot(@Req() r:AuthenticatedRequest,@Body() b:Record<string,unknown>){const label=text(b.label,'Material name'),serial=text(b.serial_number,'Reel or lot identifier');if(!['feet','each'].includes(String(b.unit)))throw new BadRequestException('Choose feet or each.');return this.write(r,'inventory.lot_created',async c=>{
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[r.auth.tenantId+':lot:'+serial]);
  const old=(await c.query('SELECT * FROM material_lots WHERE tenant_id=$1 AND serial_number=$2',[r.auth.tenantId,serial])).rows[0];if(old){if(old.label!==label||old.unit!==b.unit)throw new BadRequestException('This lot identifier already has different material details.');return this.result(old,'material_lot',true);}
  return this.result((await c.query('INSERT INTO material_lots(tenant_id,label,serial_number,unit) VALUES($1,$2,$3,$4) RETURNING *',[r.auth.tenantId,label,serial,b.unit])).rows[0],'material_lot');});}
 @Post('locations') @RequirePermission('inventory.manage')
 async location(@Req() r:AuthenticatedRequest,@Body() b:Record<string,unknown>){const label=text(b.label,'Location name'),crew=b.crew_id?id(b.crew_id):null;return this.write(r,'inventory.location_created',async c=>{
  if(crew&&!(await c.query('SELECT 1 FROM crews WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL',[r.auth.tenantId,crew])).rowCount)throw new BadRequestException('Crew unavailable in this organization.');
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[r.auth.tenantId+':material-location:'+label]);
  const old=(await c.query('SELECT * FROM material_locations WHERE tenant_id=$1 AND label=$2 AND crew_id IS NOT DISTINCT FROM $3::uuid',[r.auth.tenantId,label,crew])).rows[0];if(old)return this.result(old,'material_location',true);
  return this.result((await c.query('INSERT INTO material_locations(tenant_id,label,crew_id) VALUES($1,$2,$3) RETURNING *',[r.auth.tenantId,label,crew])).rows[0],'material_location');});}
 @Post('movements') @RequirePermission('inventory.manage')
 async move(@Req() r:AuthenticatedRequest,@Body() b:Record<string,unknown>){if(b.kind==='adjustment')throw new BadRequestException('Use the approved count-adjustment action.');return this.movement(r,b,false);}
 @Post('adjustments') @RequirePermission('inventory.adjust')
 async adjust(@Req() r:AuthenticatedRequest,@Body() b:Record<string,unknown>){if(b.approved!==true)throw new BadRequestException('A count adjustment requires explicit approval.');return this.movement(r,{...b,kind:'adjustment'},true);}
 private async movement(r:AuthenticatedRequest,b:Record<string,unknown>,adjustment:boolean){
  const lot=id(b.lot_id),key=id(b.request_key),from=b.from_location_id?id(b.from_location_id):null,to=b.to_location_id?id(b.to_location_id):null,work=b.work_order_id?id(b.work_order_id):null;
  const kind=String(b.kind),quantity=String(b.quantity),reference=text(b.reference,'Source document reference'),reason=text(b.reason,'Movement reason');
  if(!/^-?\d{1,12}(\.\d{1,4})?$/.test(quantity)||Number(quantity)===0||(!adjustment&&Number(quantity)<0))throw new BadRequestException('Use a nonzero quantity with at most four decimal places.');
  if(!['receipt','transfer','installed','scrap','offcut','adjustment'].includes(kind))throw new BadRequestException('Invalid movement type.');
  if(kind==='receipt'||adjustment){if(from||!to)throw new BadRequestException('Receipts and count adjustments require only a destination.');}
  else if(kind==='transfer'){if(!from||!to||from===to)throw new BadRequestException('Choose distinct source and destination locations.');}
  else if(!from||to)throw new BadRequestException('Use a source location for installed, scrap or offcut quantities.');
  if(kind==='installed'&&!work)throw new BadRequestException('Installed material requires a work order.');
  return this.write(r,'inventory.movement_recorded',async c=>{
   await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[r.auth.tenantId+':inventory-request:'+key]);
   await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[r.auth.tenantId+':inventory-lot:'+lot]);
   const old=(await c.query('SELECT * FROM material_movements WHERE tenant_id=$1 AND request_key=$2',[r.auth.tenantId,key])).rows[0];
   if(old){if(old.lot_id!==lot||old.from_location_id!==from||old.to_location_id!==to||old.kind!==kind||scaled(old.quantity)!==scaled(quantity)||old.reference!==reference||old.reason!==reason||old.work_order_id!==work)throw new BadRequestException('This request already recorded different material movement.');return this.result(old,'material_movement',true);}
   const item=(await c.query('SELECT * FROM material_lots WHERE tenant_id=$1 AND id=$2',[r.auth.tenantId,lot])).rows[0];if(!item)throw new BadRequestException('Material lot unavailable.');
   if(item.unit==='each'&&scaled(quantity)%10000n!==0n)throw new BadRequestException('Each quantities must be whole numbers.');
   for(const location of [from,to].filter(Boolean))if(!(await c.query('SELECT 1 FROM material_locations WHERE tenant_id=$1 AND id=$2',[r.auth.tenantId,location])).rowCount)throw new BadRequestException('Location unavailable in this organization.');
   if(work&&!(await c.query('SELECT 1 FROM work_orders WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL',[r.auth.tenantId,work])).rowCount)throw new BadRequestException('Work order unavailable.');
   const depleted=from??(Number(quantity)<0?to:null);
   if(depleted){const ok=(await c.query(`SELECT COALESCE(sum(CASE WHEN to_location_id=$3 THEN quantity ELSE 0 END)-sum(CASE WHEN from_location_id=$3 THEN quantity ELSE 0 END),0)>=abs($4::numeric) AS enough FROM material_movements WHERE tenant_id=$1 AND lot_id=$2`,[r.auth.tenantId,lot,depleted,quantity])).rows[0].enough;if(!ok)throw new BadRequestException('Insufficient material at this location. Reconcile the physical count before retrying.');}
   return this.result((await c.query('INSERT INTO material_movements(tenant_id,lot_id,from_location_id,to_location_id,kind,quantity,reference,reason,work_order_id,actor_user_id,request_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *',[r.auth.tenantId,lot,from,to,kind,quantity,reference,reason,work,r.auth.userId,key])).rows[0],'material_movement');
  });
 }
 private result(row:any,type:string,retry=false){return {entityType:type,entityId:row.id,afterState:row,skipEventAudit:retry};}
 private async write(r:AuthenticatedRequest,event:string,write:(c:PoolClient)=>Promise<any>){const c=await this.pool.connect();try{return await executeWriteAction(c,{tenantId:r.auth.tenantId,actorUserId:r.auth.userId,action:event,aggregateType:'material_inventory',eventType:event,write});}finally{c.release();}}
}
