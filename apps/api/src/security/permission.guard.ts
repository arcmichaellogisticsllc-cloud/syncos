import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, MethodNotAllowedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import type { Pool } from "pg";
import type { PermissionKey } from "@syncos/permissions";
import { DATABASE_POOL } from "../modules/database.module";
import { IS_PUBLIC_ROUTE } from "./public.decorator";
import { REQUIRED_PERMISSION } from "./require-permission.decorator";

const partnerScopedPermissions = new Set<PermissionKey>([
  "partner_context.read",
  "partner_profile.read",
  "partner_actions.read",
  "partner_compliance.summary.read",
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
    const scopeType = this.getScopeType(request);
    const scopeId = this.getScopeId(request);
    const isPartnerScopedPermission = partnerScopedPermissions.has(permission);
    const hasExplicitScopeHeader = Boolean(request.header("x-scope-type") || request.header("x-scope-id"));
    const result = await this.pool.query<{ allowed: boolean }>(
      `
      SELECT EXISTS (
        SELECT 1
        FROM tenant_users tu
        JOIN user_roles ur ON ur.tenant_user_id = tu.id
        JOIN role_permissions rp ON rp.role_id = ur.role_id
        JOIN permissions p ON p.id = rp.permission_id
        WHERE tu.tenant_id = $1
          AND tu.user_id = $2
          AND tu.status = 'active'
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
                OR (ur.scope_type = $4 AND ur.scope_id::text = $5)
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
      ],
    );

    if (!result.rows[0]?.allowed) {
      throw new ForbiddenException(`Missing permission: ${permission}`);
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
