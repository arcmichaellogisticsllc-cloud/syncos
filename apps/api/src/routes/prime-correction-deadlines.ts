import { BadRequestException } from '@nestjs/common';
import type { PoolClient } from 'pg';
const { DateTime, IANAZone } = require('luxon');
export type CorrectionPolicy = { duration:number; duration_unit:string; trigger_event:string; time_zone:string; holidays:string[]; effective_from:string; effective_until:string|null };
export function absoluteTime(value:unknown,label:string) {
  if(typeof value!=='string'||!/(Z|[+-]\d{2}:\d{2})$/.test(value))throw new BadRequestException(`${label} requires a date, time and UTC offset`);
  const time=DateTime.fromISO(value,{setZone:true});
  if(!time.isValid)throw new BadRequestException(`${label} is invalid`);
  return time.toUTC().toISO() as string;
}
export function correctionPolicyInput(b:Record<string,unknown>):CorrectionPolicy {
  const duration=Number(b.duration),unit=String(b.duration_unit),zone=String(b.time_zone),trigger=String(b.trigger_event);
  if(b.duration===null||b.duration===''||!Number.isInteger(duration)||duration<0||duration>3660)throw new BadRequestException('Choose a whole deadline duration between 0 and 3660');
  if(!['hours','calendar_days','business_days'].includes(unit)||!['customer_received','decision_recorded'].includes(trigger))throw new BadRequestException('Choose the approved duration unit and triggering event');
  if(!IANAZone.isValidZone(zone))throw new BadRequestException('Use a valid IANA time zone such as America/New_York');
  const holidays=b.holidays;
  if(!Array.isArray(holidays)||holidays.length>1000||holidays.some(day=>typeof day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(day)||!DateTime.fromISO(day).isValid)||new Set(holidays).size!==holidays.length)throw new BadRequestException('Provide distinct valid holiday dates, or explicitly approve an empty holiday calendar');
  const effective_from=absoluteTime(b.effective_from,'Policy effective time');
  const effective_until=b.effective_until?absoluteTime(b.effective_until,'Policy end time'):null;
  if(effective_until&&effective_until<=effective_from)throw new BadRequestException('Policy end must follow its effective time');
  return {duration,duration_unit:unit,trigger_event:trigger,time_zone:zone,holidays:[...holidays].sort(),effective_from,effective_until};
}
export function calculateCorrectionDeadline(policy:CorrectionPolicy,trigger:string) {
  const validated=correctionPolicyInput(policy as unknown as Record<string,unknown>);
  let due=DateTime.fromISO(absoluteTime(trigger,'Deadline trigger')).setZone(validated.time_zone);
  if(validated.duration_unit==='hours')due=due.plus({hours:validated.duration});
  else if(validated.duration_unit==='calendar_days')due=due.plus({days:validated.duration});
  else for(let remaining=validated.duration;remaining>0;){due=due.plus({days:1});if(due.weekday<=5&&!validated.holidays.includes(due.toISODate()))remaining--;}
  return {due_at:due.toUTC().toISO() as string,due_date:due.toISODate() as string,deadline_time_zone:validated.time_zone};
}
export function verifiedReceivedTime(value:unknown,recordedAt:Date|string) {
  if(value===undefined||value===null||value==='')return null;
  const time=absoluteTime(value,'Customer finding received time');
  if(new Date(time).getTime()>new Date(recordedAt).getTime())throw new BadRequestException('Customer finding received time cannot follow its recorded time');
  return time;
}
export async function scheduleCorrectionDeadline(c:PoolClient,tenant:string,id:string) {
  const correction=(await c.query(`SELECT p.*,d.recorded_at,cycle.work_order_version_id
    FROM production_corrections p JOIN customer_qc_decisions d ON d.tenant_id=p.tenant_id AND d.id=p.customer_qc_decision_id
    JOIN customer_qc_cycles cycle ON cycle.tenant_id=p.tenant_id AND cycle.id=p.qc_cycle_id
    WHERE p.tenant_id=$1 AND p.id=$2 AND p.deleted_at IS NULL FOR UPDATE OF p`,[tenant,id])).rows[0];
  if(!correction)throw new BadRequestException('Correction is unavailable');
  if(correction.deadline_status==='scheduled')return correction; // New policies do not silently reset an existing deadline.
  const reference=correction.customer_received_at??correction.recorded_at;
  const policy=(await c.query(`SELECT * FROM prime_correction_policies WHERE tenant_id=$1 AND work_order_version_id=$2
    AND effective_from<=CASE WHEN trigger_event='decision_recorded' THEN $4::timestamptz ELSE $3::timestamptz END
    AND (effective_until IS NULL OR effective_until>CASE WHEN trigger_event='decision_recorded' THEN $4::timestamptz ELSE $3::timestamptz END) ORDER BY revision_number DESC LIMIT 1`,[tenant,correction.work_order_version_id,reference,correction.recorded_at])).rows[0];
  if(!policy)return correction;
  if(policy.trigger_event==='customer_received'&&!correction.customer_received_at){
    return (await c.query("UPDATE production_corrections SET deadline_status='needs_received_time',updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *",[tenant,id])).rows[0];
  }
  const trigger=policy.trigger_event==='customer_received'?correction.customer_received_at:correction.recorded_at;
  const deadline=calculateCorrectionDeadline({...policy,effective_from:new Date(policy.effective_from).toISOString(),effective_until:policy.effective_until?new Date(policy.effective_until).toISOString():null},new Date(trigger).toISOString());
  return (await c.query(`UPDATE production_corrections SET deadline_policy_id=$3,deadline_status='scheduled',deadline_trigger_at=$4,
    due_at=$5,due_date=$6,deadline_time_zone=$7,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *`,[tenant,id,policy.id,trigger,deadline.due_at,deadline.due_date,deadline.deadline_time_zone])).rows[0];
}
