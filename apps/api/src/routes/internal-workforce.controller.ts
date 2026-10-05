import {workspaceChoices} from './workspace-history';
import { createHash, randomBytes } from "node:crypto";
import { hashPassword, validatePassword } from "@syncos/auth";
import { Public } from "../security/public.decorator";
import { BadRequestException, Body, Controller, ForbiddenException, Get, Inject, NotFoundException, Param, Post, Req } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import { appendAuditLog, executeWriteAction } from "@syncos/shared";
import { DATABASE_POOL } from "../modules/database.module";
import { RequirePermission } from "../security/require-permission.decorator";
import type { AuthenticatedRequest } from "./intelligence.types";
import { requireString } from "./intelligence.types";
const checks = ["customer_authorization", "crew_qualifications", "insurance", "equipment_inspection", "safety_plan"];
@Controller("internal-workforce")
export class InternalWorkforceController {
    constructor(
    @Inject(DATABASE_POOL)
    private readonly pool: Pool) { }
    private async authorize(client: PoolClient, req: AuthenticatedRequest) {
        const allowed = await client.query(`SELECT 1 FROM tenant_users tu
      JOIN user_roles ur ON ur.tenant_id=tu.tenant_id AND ur.tenant_user_id=tu.id
      JOIN roles r ON r.tenant_id=tu.tenant_id AND r.id=ur.role_id
      WHERE tu.tenant_id=$1 AND tu.user_id=$2 AND tu.status='active' AND tu.deleted_at IS NULL
      AND ur.scope_type='tenant' AND r.system_key IN ('system_admin','executive','operations_manager') AND r.deleted_at IS NULL`, [req.auth.tenantId, req.auth.userId]);
        if (!allowed.rows.length)
            throw new ForbiddenException("Sync management authority is required");
    }
    private async write(req: AuthenticatedRequest, action: string, fn: (client: PoolClient) => Promise<any>) {
        const client = await this.pool.connect();
        try {
            await this.authorize(client, req);
            return await executeWriteAction(client, { tenantId: req.auth.tenantId, actorUserId: req.auth.userId, action, aggregateType: "internal_workforce", eventType: action, write: fn });
        }
        finally {
            client.release();
        }
    }
    @Get('choices') @RequirePermission('crew.read')
    async choices(@Req() req:AuthenticatedRequest){const c=await this.pool.connect();try{await this.authorize(c,req);return workspaceChoices(this.pool,req.auth.tenantId,'work_orders',req.query.q,['work_orders'],typeof req.query.before==='string'?req.query.before:undefined);}finally{c.release();}}
    @Get()
    @RequirePermission("crew.read")
    async list(
    @Req()
    req: AuthenticatedRequest) {
        const c = await this.pool.connect();
        try {
            await this.authorize(c, req);
            const t = req.auth.tenantId;
            const organizations = await c.query("SELECT id,name FROM organizations WHERE tenant_id=$1 AND deleted_at IS NULL ORDER BY name", [t]);
            const users = await c.query(`SELECT u.id,u.display_name,u.email FROM users u JOIN tenant_users tu ON tu.user_id=u.id
        WHERE tu.tenant_id=$1 AND tu.status='active' AND tu.deleted_at IS NULL AND u.status='active' AND u.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.tenant_id=tu.tenant_id AND ur.tenant_user_id=tu.id AND r.system_key IN ('partner_admin','partner_foreman'))`, [t]);
            const crews = await c.query(`SELECT c.*,o.name AS organization_name FROM crews c JOIN capacity_providers cp ON cp.tenant_id=c.tenant_id AND cp.id=c.capacity_provider_id
        JOIN organizations o ON o.tenant_id=c.tenant_id AND o.id=c.organization_id WHERE c.tenant_id=$1 AND cp.provider_type='internal_workforce' AND c.deleted_at IS NULL`, [t]);
            const workOrders = await c.query("SELECT id,work_order_number,title,project_id FROM work_orders WHERE tenant_id=$1 AND deleted_at IS NULL AND status NOT IN ('archived','cancelled','closed') ORDER BY created_at DESC LIMIT 250", [t]);
            const assignments = await c.query(`SELECT v.id,v.work_order_id,v.work_order_number,v.organization_id,v.status,c.name AS crew_name,cl.status AS clearance_status,cl.valid_until,cl.evidence_reference
        FROM partner_work_order_versions v JOIN crews c ON c.tenant_id=v.tenant_id AND c.id=v.assigned_crew_id
        LEFT JOIN internal_field_clearances cl ON cl.tenant_id=v.tenant_id AND cl.work_order_version_id=v.id
        WHERE v.tenant_id=$1 AND v.execution_model='internal' AND v.deleted_at IS NULL`, [t]);
            return { organizations: organizations.rows, users: users.rows, crews: crews.rows, work_orders: workOrders.rows, assignments: assignments.rows, required_checks: checks };
        }
        finally {
            c.release();
        }
    }
    @Post("accounts")
    @RequirePermission("worker.create")
    async inviteAccount(
    @Req()
    req: AuthenticatedRequest,
    @Body()
    body: Record<string, unknown>) {
        const token = randomBytes(32).toString("base64url");
        const email = requireString(body.email, "Email is required").trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
            throw new BadRequestException("Valid email is required");
        const result = await this.write(req, "internal_account.invited", async (c) => {
            await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`internal-account:${email}`]);
            let user = (await c.query("SELECT id,email,display_name,password_hash IS NOT NULL AS activated FROM users WHERE lower(email)=$1 AND deleted_at IS NULL AND status='active' FOR UPDATE", [email])).rows[0];
            if (user) {
                const previous = await c.query("SELECT id FROM internal_account_invitations WHERE tenant_id=$1 AND user_id=$2", [req.auth.tenantId, user.id]);
                if (user.activated || !previous.rows.length)
                    throw new BadRequestException("An account already exists for this email. Select the existing Sync account or contact the administrator.");
                await c.query("UPDATE internal_account_invitations SET revoked_at=now() WHERE tenant_id=$1 AND user_id=$2 AND accepted_at IS NULL AND revoked_at IS NULL", [req.auth.tenantId, user.id]);
            }
            else {
                user = (await c.query("INSERT INTO users (email,display_name) VALUES ($1,$2) RETURNING id,email,display_name", [email, requireString(body.display_name, "Name is required")])).rows[0];
                await c.query("INSERT INTO tenant_users (tenant_id,user_id) VALUES ($1,$2)", [req.auth.tenantId, user.id]);
            }
            const invitation = (await c.query("INSERT INTO internal_account_invitations (tenant_id,user_id,token_hash,expires_at,created_by) VALUES ($1,$2,$3,now()+interval '24 hours',$4) RETURNING id,expires_at", [req.auth.tenantId, user.id, createHash("sha256").update(token).digest("hex"), req.auth.userId])).rows[0];
            return { entityType: "internal_account_invitation", entityId: invitation.id, afterState: { ...invitation, ...user } };
        });
        return { ...(result as Record<string, unknown>), activation_path: `/activate-employee?token=${encodeURIComponent(token)}` };
    }
    @Post("activate")
    @Public()
    async activate(
    @Body()
    body: Record<string, unknown>) {
        const token = requireString(body.token, "Invitation is required");
        const password = requireString(body.password, "Password is required");
        const invalid = validatePassword(password);
        if (invalid)
            throw new BadRequestException(invalid);
        const c = await this.pool.connect();
        try {
            await c.query("BEGIN");
            const invitation = (await c.query("SELECT * FROM internal_account_invitations WHERE token_hash=$1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>now() FOR UPDATE", [createHash("sha256").update(token).digest("hex")])).rows[0];
            if (!invitation)
                throw new BadRequestException("Invitation is invalid or expired");
            const user = await c.query("UPDATE users SET password_hash=$2,updated_at=now() WHERE id=$1 AND password_hash IS NULL AND deleted_at IS NULL AND status='active' RETURNING id", [invitation.user_id, hashPassword(password)]);
            if (!user.rows.length)
                throw new BadRequestException("Account is already activated or unavailable");
            await c.query("UPDATE internal_account_invitations SET accepted_at=now() WHERE id=$1", [invitation.id]);
            await appendAuditLog(c, { tenantId: invitation.tenant_id, actorUserId: invitation.user_id, action: "internal_account.activated", entityType: "internal_account_invitation", entityId: invitation.id, afterState: { activated: true } });
            await c.query("COMMIT");
            return { activated: true };
        }
        catch (e) {
            await c.query("ROLLBACK");
            throw e;
        }
        finally {
            c.release();
        }
    }
    @Post("crews")
    @RequirePermission("crew.create")
    async createCrew(
    @Req()
    req: AuthenticatedRequest,
    @Body()
    body: Record<string, unknown>) {
        return this.write(req, "internal_crew.created", async (c) => {
            const org = requireString(body.organization_id, "organization_id is required");
            const result = await c.query("SELECT id FROM organizations WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE", [req.auth.tenantId, org]);
            if (!result.rows.length)
                throw new NotFoundException("Sync organization not found");
            const existing = await c.query("SELECT * FROM capacity_providers WHERE tenant_id=$1 AND organization_id=$2 AND deleted_at IS NULL", [req.auth.tenantId, org]);
            if (existing.rows.some(r => r.provider_type !== "internal_workforce"))
                throw new BadRequestException("Use the Sync operating organization, not an external partner organization");
            let provider = existing.rows[0];
            if (!provider)
                provider = (await c.query("INSERT INTO capacity_providers (tenant_id,organization_id,name,provider_type,status,verification_status) VALUES ($1,$2,'Sync workforce','internal_workforce','activated','verified') RETURNING *", [req.auth.tenantId, org])).rows[0];
            const target = Number(body.target_staffing_level ?? 4);
            if (!Number.isInteger(target) || target < 1 || target > 100)
                throw new BadRequestException("Staffing level must be 1–100");
            const type = requireString(body.crew_type, "crew_type is required");
            if (!['aerial', 'bore', 'trench', 'splicing', 'drop', 'restoration', 'inspection', 'project_management'].includes(type))
                throw new BadRequestException("Invalid crew type");
            const crew = (await c.query("INSERT INTO crews (tenant_id,organization_id,capacity_provider_id,name,crew_type,target_staffing_level) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *", [req.auth.tenantId, org, provider.id, requireString(body.name, "Crew name is required"), type, target])).rows[0];
            return { entityType: "crew", entityId: crew.id, afterState: crew };
        });
    }
    @Post("crews/:id/members")
    @RequirePermission("worker.create")
    async addMember(
    @Req()
    req: AuthenticatedRequest,
    @Param("id")
    id: string,
    @Body()
    body: Record<string, unknown>) {
        return this.write(req, "internal_crew.member_added", async (c) => {
            const crew = await this.crew(c, req.auth.tenantId, id);
            const role = body.role === 'foreman' ? 'foreman' : 'member';
            const userId = typeof body.user_id === 'string' && body.user_id ? body.user_id : null;
            let tu: any;
            if (role === 'foreman' && !userId)
                throw new BadRequestException("Select an existing Sync user for the foreman");
            if (userId) {
                tu = (await c.query(`SELECT tu.* FROM tenant_users tu JOIN users u ON u.id=tu.user_id AND u.status='active' AND u.deleted_at IS NULL
          WHERE tu.tenant_id=$1 AND tu.user_id=$2 AND tu.status='active' AND tu.deleted_at IS NULL FOR UPDATE OF tu`, [req.auth.tenantId, userId])).rows[0];
                if (!tu)
                    throw new BadRequestException("Active Sync account required");
                const external = await c.query("SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.tenant_id=$1 AND ur.tenant_user_id=$2 AND r.system_key IN ('partner_admin','partner_foreman')", [req.auth.tenantId, tu.id]);
                if (external.rows.length)
                    throw new BadRequestException("External partner accounts cannot become Sync employees");
                const linked = await c.query("SELECT id FROM partner_worker_user_links WHERE tenant_id=$1 AND tenant_user_id=$2 AND status='active' AND deleted_at IS NULL", [req.auth.tenantId, tu.id]);
                if (linked.rows.length)
                    throw new BadRequestException("Account is already linked to a worker");
            }
            if (role === 'foreman') {
                const foreman = await c.query("SELECT id FROM partner_crew_memberships WHERE tenant_id=$1 AND crew_id=$2 AND membership_role='foreman' AND status='active' AND deleted_at IS NULL", [req.auth.tenantId, id]);
                if (foreman.rows.length)
                    throw new BadRequestException("Crew already has a foreman");
            }
            const worker = (await c.query("INSERT INTO workers (tenant_id,organization_id,capacity_provider_id,crew_id,first_name,last_name,review_status) VALUES ($1,$2,$3,$4,$5,$6,'draft') RETURNING *", [req.auth.tenantId, crew.organization_id, crew.capacity_provider_id, id, requireString(body.first_name, "First name is required"), requireString(body.last_name, "Last name is required")])).rows[0];
            await c.query("INSERT INTO partner_crew_memberships (tenant_id,organization_id,capacity_provider_id,crew_id,worker_id,membership_role,status) VALUES ($1,$2,$3,$4,$5,$6,'active')", [req.auth.tenantId, crew.organization_id, crew.capacity_provider_id, id, worker.id, role]);
            if (tu) {
                await c.query("INSERT INTO partner_worker_user_links (tenant_id,organization_id,worker_id,tenant_user_id,status) VALUES ($1,$2,$3,$4,'active')", [req.auth.tenantId, crew.organization_id, worker.id, tu.id]);
                if (role === 'foreman')
                    await c.query("INSERT INTO user_roles (tenant_id,tenant_user_id,role_id,scope_type,scope_id) SELECT $1,$2,id,'organization',$3 FROM roles WHERE tenant_id=$1 AND system_key='sync_foreman' ON CONFLICT DO NOTHING", [req.auth.tenantId, tu.id, crew.organization_id]);
            }
            await c.query("UPDATE internal_field_clearances SET status='held',updated_at=now() WHERE tenant_id=$1 AND work_order_version_id IN (SELECT id FROM partner_work_order_versions WHERE tenant_id=$1 AND assigned_crew_id=$2)", [req.auth.tenantId, id]);
            return { entityType: "worker", entityId: worker.id, afterState: worker };
        });
    }
    @Post("assignments")
    @RequirePermission("work_order.assign")
    async assign(
    @Req()
    req: AuthenticatedRequest,
    @Body()
    body: Record<string, unknown>) {
        return this.write(req, "internal_work.assigned", async (c) => {
            const crew = await this.crew(c, req.auth.tenantId, requireString(body.crew_id, "Crew is required"));
            const wo = (await c.query("SELECT * FROM work_orders WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL AND status NOT IN ('archived','cancelled','closed') FOR UPDATE", [req.auth.tenantId, requireString(body.work_order_id, "Work order is required")])).rows[0];
            if (!wo)
                throw new NotFoundException("Work order not found");
            if ((await c.query("SELECT id FROM partner_work_order_versions WHERE tenant_id=$1 AND work_order_id=$2 AND deleted_at IS NULL AND status IN ('draft','issued','partially_executed','executed','active','suspended')", [req.auth.tenantId, wo.id])).rows.length)
                throw new BadRequestException("Work order already has an active assignment version");
            const v = (await c.query(`INSERT INTO partner_work_order_versions (tenant_id,organization_id,capacity_provider_id,project_id,work_order_id,assigned_crew_id,work_order_number,scope_summary,primary_work_area,map_work_package_ref,production_unit,status,execution_model,created_by_user_id,version_number)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'active','internal',$12,(SELECT COALESCE(max(version_number),0)+1 FROM partner_work_order_versions WHERE tenant_id=$1 AND work_order_id=$5)) RETURNING *`, [req.auth.tenantId, crew.organization_id, crew.capacity_provider_id, wo.project_id, wo.id, crew.id, wo.work_order_number || wo.id, requireString(body.scope_summary, "Scope is required"), requireString(body.work_area, "Work area is required"), requireString(body.map_reference, "Map reference is required"), wo.unit_type, req.auth.userId])).rows[0];
            await c.query("INSERT INTO partner_work_order_crew_assignments (tenant_id,organization_id,capacity_provider_id,work_order_id,work_order_version_id,crew_id,assigned_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7)", [req.auth.tenantId, crew.organization_id, crew.capacity_provider_id, wo.id, v.id, crew.id, req.auth.userId]);
            await c.query("UPDATE work_orders SET assigned_capacity_provider_id=$3,assigned_crew_id=$4,updated_at=now() WHERE tenant_id=$1 AND id=$2", [req.auth.tenantId, wo.id, crew.capacity_provider_id, crew.id]);
            return { entityType: "work_order_version", entityId: v.id, afterState: v };
        });
    }
    @Post("assignments/:id/clearance")
    @RequirePermission("work_order.start")
    async clearance(
    @Req()
    req: AuthenticatedRequest,
    @Param("id")
    id: string,
    @Body()
    body: Record<string, unknown>) {
        return this.write(req, "internal_work.clearance_recorded", async (c) => {
            const v = (await c.query("SELECT * FROM partner_work_order_versions WHERE tenant_id=$1 AND id=$2 AND execution_model='internal' AND deleted_at IS NULL FOR UPDATE", [req.auth.tenantId, id])).rows[0];
            if (!v)
                throw new NotFoundException("Internal assignment not found");
            const status = body.status;
            if (!['authorized', 'held', 'revoked'].includes(String(status)))
                throw new BadRequestException("Invalid readiness decision");
            const checklist = body.checklist as Record<string, unknown>;
            const until = requireString(body.valid_until, "Review expiry date is required");
            if (!/^\d{4}-\d{2}-\d{2}$/.test(until) || !Number.isFinite(Date.parse(until)) || new Date(until).toISOString().slice(0, 10) !== until || until < new Date().toISOString().slice(0, 10))
                throw new BadRequestException("A current expiry date is required");
            if (status === 'authorized') {
                if (!checklist || !checks.every(k => checklist[k] === true))
                    throw new BadRequestException("All readiness checks must be verified against the evidence package");
                const crew = await this.crew(c, req.auth.tenantId, v.assigned_crew_id);
                const members = await c.query("SELECT m.membership_role FROM partner_crew_memberships m JOIN workers w ON w.tenant_id=m.tenant_id AND w.id=m.worker_id WHERE m.tenant_id=$1 AND m.crew_id=$2 AND m.status='active' AND m.deleted_at IS NULL AND w.status='active' AND w.deleted_at IS NULL", [req.auth.tenantId, crew.id]);
                if (members.rows.length < crew.target_staffing_level || !members.rows.some(m => m.membership_role === 'foreman'))
                    throw new BadRequestException("An active foreman and the full crew are required");
            }
            const r = (await c.query(`INSERT INTO internal_field_clearances (tenant_id,work_order_version_id,status,evidence_reference,checklist,valid_until,authorized_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (tenant_id,work_order_version_id) DO UPDATE SET status=EXCLUDED.status,evidence_reference=EXCLUDED.evidence_reference,checklist=EXCLUDED.checklist,valid_until=EXCLUDED.valid_until,authorized_by=EXCLUDED.authorized_by,updated_at=now() RETURNING *`, [req.auth.tenantId, id, status, requireString(body.evidence_reference, "Evidence package reference is required"), JSON.stringify(checklist ?? {}), until, req.auth.userId])).rows[0];
            return { entityType: "internal_field_clearance", entityId: r.id, afterState: r };
        });
    }
    private async crew(c: PoolClient, t: string, id: string) {
        const r = await c.query("SELECT c.* FROM crews c JOIN capacity_providers p ON p.tenant_id=c.tenant_id AND p.id=c.capacity_provider_id WHERE c.tenant_id=$1 AND c.id=$2 AND c.deleted_at IS NULL AND c.lifecycle_status='active' AND p.provider_type='internal_workforce' AND p.status='activated' AND p.deleted_at IS NULL FOR UPDATE OF c", [t, id]);
        if (!r.rows[0])
            throw new NotFoundException("Active Sync crew not found");
        return r.rows[0];
    }
}
