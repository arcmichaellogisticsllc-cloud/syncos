import type {ScopedWriteRequest} from "./project-write-policy";
import {logStructured} from '../instrumentation/structured-logger';
import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, MethodNotAllowedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import type { Pool } from "pg";
import type { PermissionKey } from "@syncos/permissions";
import { DATABASE_POOL } from "../modules/database.module";
import { IS_PUBLIC_ROUTE } from "./public.decorator";
import { AUTHENTICATED_ONLY_ROUTE } from "./authenticated-only.decorator";
import { REQUIRED_PERMISSION, TENANT_PERMISSION_ONLY } from "./require-permission.decorator";

const partnerScopedPermissions = new Set<PermissionKey>([
  "partner_context.read",
  "partner_profile.read",
  "partner_actions.read",
  "partner_compliance.summary.read",
  "partner_compliance.submission.read",
  "partner_compliance.submission.submit",
  "partner_compliance.profile.read",
  "partner_compliance.profile.submit",
  "partner_compliance.w9.read",
  "partner_compliance.w9.submit",
  "partner_compliance.payment.read",
  "partner_compliance.payment.submit",
  "partner_compliance.insurance.read",
  "partner_compliance.insurance.submit",
  "partner_compliance.evidence.read",
  "partner_workforce.worker.read",
  "partner_workforce.worker.create",
  "partner_workforce.worker.update",
  "partner_workforce.worker.submit",
  "partner_workforce.headshot.read",
  "partner_workforce.headshot.submit",
  "partner_workforce.credential.read",
  "partner_workforce.credential.submit",
  "partner_workforce.crew.read",
  "partner_workforce.crew.create",
  "partner_workforce.crew.update",
  "partner_workforce.membership.manage",
  "partner_workforce.foreman.assign",
  "partner_workforce.readiness.read",
  "partner_workforce.attestation.submit",
  "partner_workforce.foreman_roster.read",
  "partner_agreement.read",
  "partner_agreement.sign",
  "partner_agreement.artifact.read",
  "partner_work_order.read",
  "partner_work_order.rate.read",
  "partner_work_order.sign",
  "partner_work_order.artifact.read",
  "partner_work_order.foreman_summary.read",
  "partner_vehicle_assignment.read",
  "partner_vehicle_assignment.sign",
  "partner_vehicle_assignment.artifact.read",
  "partner_vehicle_assignment.allocation.read",
  "partner_mobilization.read",
  "partner_mobilization.foreman.read",
  "partner_notice.read",
  "partner_notice.acknowledge",
  "partner_notice.foreman.read",
  "partner_notice.foreman.acknowledge",
  "partner_map.read",
  "partner_map.read_assigned",
  "partner_jsa.read",
  "partner_jsa_history.read",
  "partner_jsa.create",
  "partner_jsa.update_draft",
  "partner_jsa.complete",
  "partner_jsa.read_own",
  "partner_daily_production.read",
  "partner_daily_production.create",
  "partner_daily_production.update_draft",
  "partner_daily_production.delete_draft",
  "partner_daily_production.submit",
  "partner_production_record.create",
  "partner_production_record.update_draft",
  "partner_production_record.delete_draft",
  "partner_production_photo.create",
  "partner_field_sync.submit",
  "partner_form.delegate",
  "partner_inventory.report",
  "partner_daily_production.read_org",
  "partner_production.read_org",
  "partner_customer_qc.read",
  "partner_customer_qc.corrections_read",
  "partner_customer_qc.history_read",
  "partner_customer_qc.read_own",
  "partner_correction.read_own",
  "partner_correction.update_allowed",
  "partner_correction.resubmit",
  "partner_production_dashboard.read",
  "partner_production_export.read",
  "partner_production_export.generate",
  "partner_production_history.read_own",
  "partner_production_export.read_own",
  "partner_settlement.read",
  "partner_contractor_payable.read",
  "partner_payment_eligibility.read",
  "partner_payment.read",
  "partner_performance.read_own",
  "partner_foreman_invitation.create",
  "partner_foreman_invitation.read",
  "partner_foreman_invitation.resend",
  "partner_foreman_invitation.revoke",
]);

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(DATABASE_POOL) private readonly pool: Pool,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_ROUTE, [context.getHandler(), context.getClass()]) === true) {
      return true;
    }
    if (this.reflector.getAllAndOverride<boolean>(AUTHENTICATED_ONLY_ROUTE, [context.getHandler(), context.getClass()]) === true) {
      return true;
    }

    const permission = this.reflector.getAllAndOverride<PermissionKey | undefined>(REQUIRED_PERMISSION, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!permission) {
      const request = context.switchToHttp().getRequest<Request>();
      const method = request.method.toUpperCase();
      if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
        throw new MethodNotAllowedException("Write routes must declare explicit permission metadata");
      }
      throw new ForbiddenException("Protected routes must declare explicit permission metadata");
    }

    const request = context.switchToHttp().getRequest<Request & { auth: { tenantId: string; userId: string } }>();
    const tenantOnly = this.reflector.getAllAndOverride<boolean>(TENANT_PERMISSION_ONLY, [context.getHandler(), context.getClass()]) === true;
    const scopeType = tenantOnly ? "tenant" : this.getScopeType(request);
    const scopeId = tenantOnly ? request.auth.tenantId : this.getScopeId(request);
    const isPartnerScopedPermission = !tenantOnly && partnerScopedPermissions.has(permission);
    const hasExplicitScopeHeader = Boolean(request.header("x-scope-type") || request.header("x-scope-id"));
    // Only registered resource policies may consume scoped grants. Client scope
    // headers are selection hints for partner context, never target authority.
    const route = String(request.route?.path ?? "");
    // These exact routes enforce organization/contractor scope in their controller.
    // A shared capacity-provider permission must not unlock other controllers.
    const partnerDomainPolicy = !tenantOnly && (
      (request.method === 'GET' && permission === 'capacity_provider.read' && [
        'partner-domain/organizations',
        'partner-domain/organizations/:organizationId',
        'partner-domain/organizations/:organizationId/capacity-providers/:capacityProviderId',
      ].includes(route.replace(/^\//, ''))) ||
      (request.method === 'POST' && permission === 'capacity_provider.create' && route.replace(/^\//, '') === 'partner-domain/organizations/:organizationId/classify')
    );
    const projectRoute = !tenantOnly && /^\/?projects(?:\/:id(?:\/.*)?)?$/.test(route) && permission.startsWith("project.");
    let projectId = projectRoute && typeof request.params.id === "string" && /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(request.params.id) ? request.params.id : null;
    let projectList = projectRoute && !request.params.id && request.method === "GET" && permission === "project.read";
    // Registered read paths only. Each collection has matching SQL filtering;
    // a new controller must not gain scoped access merely by sharing a prefix.
    const readPolicies: Record<string, {table:string; permission:string}> = {
      "work-orders": {table:"work_orders",permission:"work_order.read"},
      "production-records": {table:"production_records",permission:"production_record.read"},
      "qc-reviews": {table:"qc_reviews",permission:"qc_review.read"},
      "billable-items": {table:"billable_items",permission:"billable_item.read"},
    };
    const readMatch = route.replace(/^\//, "").match(/^(work-orders|production-records|qc-reviews|billable-items)(?:\/:id(?:\/(detail|timeline|audit-summary|evidence))?)?$/);
    const readPolicy = readMatch ? readPolicies[readMatch[1]] : null;
    const additionalReadPermission = readMatch?.[2] === "timeline" ? (readMatch[1] === "production-records" ? "production.timeline.read" : readPolicy?.permission.replace(/\.read$/, ".timeline.read"))
      : readMatch?.[2] === "audit-summary" ? (readMatch[1] === "production-records" ? "production.audit.read" : readPolicy?.permission.replace(/\.read$/, ".audit.read"))
      : readMatch?.[2] === "evidence" && readMatch[1] === "production-records" ? "production_evidence.read" : null;
    if (!tenantOnly && !isPartnerScopedPermission && request.method === "GET" && readPolicy && (permission === readPolicy.permission || permission === additionalReadPermission)) {
      projectList = !request.params.id;
      if (typeof request.params.id === "string" && /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(request.params.id)) {
        const stored = await this.pool.query<{project_id:string}>(`SELECT project_id FROM ${readPolicy.table} WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL`, [request.auth.tenantId, request.params.id]);
        projectId = stored.rows[0]?.project_id ?? null;
      }
    }
    if (!tenantOnly && request.method === "GET") {
      const auxiliary=route.replace(/^\//, "");
      if ((auxiliary === "qc-review-create-options" && permission === "qc_review.create") ||
          (auxiliary === "qc-review-correction-owners" && permission === "qc_review.request_correction") ||
          (auxiliary === "qc/review-queue" && permission === "qc.review")) projectList=true;
      if (auxiliary === "qc/review-queue/:id" && permission === "qc.review" && typeof request.params.id === "string" && /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(request.params.id)) {
        const target=await this.pool.query<{project_id:string}>("SELECT project_id FROM production_records WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL",[request.auth.tenantId,request.params.id]);
        projectId=target.rows[0]?.project_id ?? null;
      }
    }
    const writePolicies: Record<string,{table:string;prefix:string;sourceTable:string;sourceKey:string}> = {
      "work-orders":{table:"work_orders",prefix:"work_order.",sourceTable:"projects",sourceKey:"project_id"},
      "production-records":{table:"production_records",prefix:"production",sourceTable:"work_orders",sourceKey:"work_order_id"},
      "qc-reviews":{table:"qc_reviews",prefix:"qc_review.",sourceTable:"production_records",sourceKey:"production_record_id"},
      "billable-items":{table:"billable_items",prefix:"billable_item.",sourceTable:"qc_reviews",sourceKey:"qc_review_id"},
    };
    const writeMatch=route.replace(/^\//, "").match(/^(work-orders|production-records|qc-reviews|billable-items)(?:\/:id(?:\/[a-z-]+)?)?$/);
    const writePolicy=writeMatch ? writePolicies[writeMatch[1]] : null;
    const scopedRootWrite = !tenantOnly && writePolicy && ["POST","PATCH"].includes(request.method) && (writePolicy.table === "production_records" ? (permission.startsWith("production_record.") || permission.startsWith("production.") || permission.startsWith("qc.")) : permission.startsWith(writePolicy.prefix));
    let sourceTable:string|undefined, sourceId:string|undefined,evidenceId:string|undefined;
    if (scopedRootWrite) {
      sourceTable=request.params.id ? writePolicy.table : writePolicy.sourceTable;
      const target=request.params.id ?? request.body?.[writePolicy.sourceKey];
      if (typeof target === "string" && /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(target)) {
        sourceId=target;
        const row=await this.pool.query<{project_id:string}>(`SELECT ${sourceTable==='projects'?'id':'project_id'} AS project_id FROM ${sourceTable} WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL`,[request.auth.tenantId,target]);
        projectId=row.rows[0]?.project_id ?? null;
      }
    }
    const evidenceRoute=route.replace(/^\//, "");
    const scopedEvidenceWrite=!tenantOnly && permission.startsWith("production_evidence.") &&
      ((request.method==="POST"&&evidenceRoute==="production-records/:id/evidence") ||
       (request.method==="PATCH"&&evidenceRoute==="production-evidence/:id") ||
       (request.method==="POST"&&evidenceRoute==="production-evidence/:id/archive"));
    if(scopedEvidenceWrite && typeof request.params.id === "string" && /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(request.params.id)) {
      const existing=evidenceRoute.startsWith("production-evidence/");
      const target=await this.pool.query<{id:string;project_id:string}>(existing ?
        "SELECT pr.id,pr.project_id FROM production_evidence e JOIN production_records pr ON pr.id=e.production_record_id AND pr.tenant_id=e.tenant_id WHERE e.tenant_id=$1 AND e.id=$2 AND e.deleted_at IS NULL AND pr.deleted_at IS NULL" :
        "SELECT id,project_id FROM production_records WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL",[request.auth.tenantId,request.params.id]);
      projectId=target.rows[0]?.project_id??null;sourceId=target.rows[0]?.id;sourceTable="production_records";
      if(existing)evidenceId=request.params.id;
    }
    const result = await this.pool.query<{ allowed: boolean }>(
      `
      SELECT EXISTS (
        SELECT 1
        FROM tenant_users tu
        JOIN user_roles ur ON ur.tenant_user_id = tu.id AND ur.tenant_id = tu.tenant_id
        JOIN roles active_role ON active_role.id = ur.role_id AND active_role.tenant_id = tu.tenant_id AND active_role.deleted_at IS NULL
        JOIN role_permissions rp ON rp.role_id = ur.role_id AND rp.tenant_id = tu.tenant_id
        JOIN permissions p ON p.id = rp.permission_id
        WHERE tu.tenant_id = $1
          AND tu.user_id = $2
          AND tu.status = 'active'
          AND tu.deleted_at IS NULL
          AND p.key = $3
          AND (
            (
              $6::boolean = true
              AND ur.scope_type = 'organization'
              AND ur.scope_id IS NOT NULL
              AND (
                $7::boolean = false
                OR (ur.scope_type = $4 AND ur.scope_id::text = $5)
              )
            )
            OR (
              $6::boolean = false
              AND (
                ur.scope_type = 'tenant'
                OR ($10::boolean AND ur.scope_type IN ('organization','contractor') AND ur.scope_id IS NOT NULL
                  AND ($7::boolean = false OR (ur.scope_type = $4 AND ur.scope_id::text = $5)))
                OR ($9::boolean AND ur.scope_type IN ('project','customer','territory') AND ur.scope_id IS NOT NULL)
                OR (ur.scope_type IN ('project','customer','territory') AND EXISTS (
                  SELECT 1 FROM projects scoped_project
                  WHERE scoped_project.tenant_id=tu.tenant_id AND scoped_project.deleted_at IS NULL
                    AND ($9::boolean OR scoped_project.id=$8::uuid)
                    AND ((ur.scope_type='project' AND ur.scope_id=scoped_project.id)
                      OR (ur.scope_type='customer' AND ur.scope_id=scoped_project.customer_organization_id)
                      OR (ur.scope_type='territory' AND ur.scope_id=scoped_project.territory_id))
                ))
              )
            )
          )
      ) AS allowed
      `,
      [
        request.auth.tenantId,
        request.auth.userId,
        permission,
        scopeType,
        scopeId,
        isPartnerScopedPermission,
        hasExplicitScopeHeader,
        projectId,
        projectList,
        partnerDomainPolicy,
      ],
    );

    if (!result.rows[0]?.allowed) {
      logStructured('Security','permission_denied',{tenantId:request.auth.tenantId,userId:request.auth.userId,permission});
      throw new ForbiddenException(`Missing permission: ${permission}`);
    }
    if ((scopedRootWrite || scopedEvidenceWrite || projectRoute) && projectId && ["POST", "PATCH"].includes(request.method)) {
      (request as ScopedWriteRequest).projectWritePolicy={projectId,permission,...((scopedRootWrite || scopedEvidenceWrite) && sourceTable && sourceId ? {sourceTable,sourceId,evidenceId} : {})};
    }
    return true;
  }

  private getScopeType(request: Request): string {
    const value = request.header("x-scope-type");
    return value && ["organization", "territory", "project", "customer", "contractor", "tenant"].includes(value)
      ? value
      : "tenant";
  }

  private getScopeId(request: Request & { auth?: { tenantId: string } }): string {
    return request.header("x-scope-id") ?? request.auth?.tenantId ?? "";
  }
}
