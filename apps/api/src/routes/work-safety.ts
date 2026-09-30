import { BadRequestException } from '@nestjs/common';
import type { PoolClient } from 'pg';

export async function lockWorkSafety(c: PoolClient, tenant: string, workOrder: string) {
  await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${tenant}:work-safety:${workOrder}`]);
}

export async function safetyBlockers(c: PoolClient, tenant: string, workOrder: string, crew: string | null, jsa: Record<string, any> | undefined | null, preBoreRequired: boolean) {
  await lockWorkSafety(c, tenant, workOrder);
  const blockers: string[] = [];
  // Until maps carry authoritative location boundaries, location notices hold the
  // entire selected crew/work order. Editing a location label cannot evade a stop.
  const stops = await c.query(`SELECT id FROM work_safety_controls WHERE tenant_id=$1 AND work_order_id=$2
    AND control_type='stop' AND status='active' AND ($3::uuid IS NULL OR crew_id IS NULL OR crew_id=$3)`, [tenant, workOrder, crew]);
  if (stops.rows.length) blockers.push('applicable_safety_stop_active');
  if (jsa?.status === 'completed') {
    const restart = await c.query(`SELECT id FROM work_safety_controls WHERE tenant_id=$1 AND work_order_id=$2 AND control_type='stop'
      AND status='released' AND ($3::uuid IS NULL OR crew_id IS NULL OR crew_id=$3) AND created_at > $4::timestamptz LIMIT 1`, [tenant,workOrder,crew,jsa.meeting_completed_at]);
    if (restart.rows.length) blockers.push('jsa_review_after_shutdown_required');
    const attendance=(await c.query(`SELECT count(*) FILTER(WHERE p.participation_status='present')::int AS present,
      bool_or(p.worker_id=$3 AND p.participation_status='present') AS foreman_present,c.target_staffing_level
      FROM daily_jsa_participants p JOIN crews c ON c.tenant_id=p.tenant_id AND c.id=$4
      JOIN workers w ON w.tenant_id=p.tenant_id AND w.id=p.worker_id AND w.status='active' AND w.deleted_at IS NULL
      WHERE p.tenant_id=$1 AND p.daily_jsa_id=$2 AND EXISTS(SELECT 1 FROM partner_crew_memberships m
        WHERE m.tenant_id=p.tenant_id AND m.worker_id=p.worker_id AND m.crew_id=$4 AND m.status='active' AND m.deleted_at IS NULL)
      GROUP BY c.id`,[tenant,jsa.id,jsa.foreman_worker_id,crew])).rows[0];
    if(!attendance || !attendance.foreman_present || attendance.present<Number(attendance.target_staffing_level))blockers.push('daily_crew_attendance_not_ready');
    const membershipChanged=await c.query(`SELECT m.id FROM partner_crew_memberships m JOIN workers w ON w.tenant_id=m.tenant_id AND w.id=m.worker_id AND w.status='active' AND w.deleted_at IS NULL
      WHERE m.tenant_id=$1 AND m.crew_id=$2 AND m.status='active' AND m.deleted_at IS NULL
      AND NOT EXISTS(SELECT 1 FROM daily_jsa_participants p WHERE p.tenant_id=m.tenant_id AND p.daily_jsa_id=$3 AND p.worker_id=m.worker_id)
      UNION ALL SELECT p.id FROM daily_jsa_participants p WHERE p.tenant_id=$1 AND p.daily_jsa_id=$3 AND p.participation_status='present'
      AND NOT EXISTS(SELECT 1 FROM partner_crew_memberships m JOIN workers w ON w.tenant_id=m.tenant_id AND w.id=m.worker_id AND w.status='active' AND w.deleted_at IS NULL
        WHERE m.tenant_id=p.tenant_id AND m.worker_id=p.worker_id AND m.crew_id=$2 AND m.status='active' AND m.deleted_at IS NULL) LIMIT 1`,[tenant,crew,jsa.id]);
    if(membershipChanged.rows.length)blockers.push('crew_changed_requires_jsa_revision');
    const missing = await c.query(`SELECT p.id FROM daily_jsa_participants p
      WHERE p.tenant_id=$1 AND p.daily_jsa_id=$2 AND p.participation_status='present'
      AND (p.acknowledged_by IS NULL OR p.acknowledged_at IS NULL OR NOT p.acknowledged)`, [tenant, jsa.id]);
    if (missing.rows.length) blockers.push('individual_jsa_acknowledgments_required');
    if (preBoreRequired) {
      const approval = await c.query(`SELECT id FROM work_safety_controls WHERE tenant_id=$1 AND work_order_id=$2 AND crew_id=$3
        AND daily_jsa_id=$4 AND control_type='pre_bore' AND status='approved'
        AND lower(trim(work_location))=lower(trim($5))`, [tenant,workOrder,crew,jsa.id,jsa.work_location]);
      if (!approval.rows.length) blockers.push('pre_bore_supervisor_approval_required');
    }
  }
  return blockers;
}

export function verifiedApprovalTime(value: unknown) {
  const date = new Date(String(value ?? ''));
  if (!Number.isFinite(date.getTime()) || date.getTime() > Date.now()) throw new BadRequestException('Actual approval time must be valid and cannot be in the future');
  return date.toISOString();
}
