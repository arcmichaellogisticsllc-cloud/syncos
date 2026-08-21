import { Controller, Get, Inject, Req } from "@nestjs/common";
import type { Pool } from "pg";
import { DATABASE_POOL } from "../modules/database.module";
import { AuthenticatedOnly } from "../security/authenticated-only.decorator";
import { RequirePermission } from "../security/require-permission.decorator";
import type { AuthenticatedRequest } from "./intelligence.types";

@Controller("auth")
export class AuthController {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  @Get("me")
  @AuthenticatedOnly()
  async me(@Req() request: AuthenticatedRequest) {
    const context = await this.identityContext(request);
    return {
      ...context,
      routing: {
        workspace: this.workspaceFor(context.roles, context.permissions, context.partner_context),
        policy: "server_trusted_workspace_routing_v1",
        precedence: [
          "internal executive",
          "internal operations",
          "internal finance",
          "partner foreman when external partner-only",
          "partner admin when external partner-only",
          "first permitted workspace",
          "safe root",
        ],
      },
      boundary: {
        authentication_is_not_authorization: true,
        routing_uses_server_trusted_roles: true,
        no_sensitive_internal_data: true,
      },
    };
  }

  @Get("me/permissions")
  @RequirePermission("signal.read")
  async permissions(@Req() request: AuthenticatedRequest) {
    const context = await this.identityContext(request);
    return {
      user_id: context.user_id,
      tenant_id: context.tenant_id,
      roles: context.roles,
      permissions: context.permissions,
    };
  }

  private async identityContext(request: AuthenticatedRequest) {
    const result = await this.pool.query(
      `
      SELECT
        r.name AS role_name,
        r.system_key AS role_key,
        p.key AS permission_key
      FROM tenant_users tu
      JOIN user_roles ur ON ur.tenant_user_id = tu.id AND ur.tenant_id = tu.tenant_id
      JOIN roles r ON r.id = ur.role_id AND r.tenant_id = tu.tenant_id
      JOIN role_permissions rp ON rp.role_id = r.id AND rp.tenant_id = tu.tenant_id
      JOIN permissions p ON p.id = rp.permission_id
      WHERE tu.tenant_id = $1 AND tu.user_id = $2 AND tu.status = 'active'
      ORDER BY r.name, p.key
      `,
      [request.auth.tenantId, request.auth.userId],
    );

    const partner = await this.pool.query(
      `
      SELECT
        r.system_key AS role_key,
        o.id AS organization_id,
        o.name AS organization_name,
        o.status AS organization_status,
        cp.id AS capacity_provider_id,
        cp.status AS capacity_provider_status,
        cp.verification_status,
        w.id AS worker_id,
        c.id AS crew_id
      FROM tenant_users tu
      JOIN user_roles ur
        ON ur.tenant_user_id = tu.id
       AND ur.tenant_id = tu.tenant_id
       AND ur.scope_type = 'organization'
       AND ur.scope_id IS NOT NULL
      JOIN roles r
        ON r.id = ur.role_id
       AND r.tenant_id = tu.tenant_id
       AND r.system_key IN ('partner_admin','partner_foreman')
      JOIN organizations o
        ON o.tenant_id = tu.tenant_id
       AND o.id = ur.scope_id
       AND o.deleted_at IS NULL
      LEFT JOIN capacity_providers cp
        ON cp.tenant_id = o.tenant_id
       AND cp.organization_id = o.id
       AND cp.deleted_at IS NULL
      LEFT JOIN partner_worker_user_links link
        ON link.tenant_id = tu.tenant_id
       AND link.tenant_user_id = tu.id
       AND link.organization_id = o.id
       AND link.status = 'active'
       AND link.deleted_at IS NULL
      LEFT JOIN workers w
        ON w.tenant_id = link.tenant_id
       AND w.id = link.worker_id
       AND w.status = 'active'
       AND w.deleted_at IS NULL
      LEFT JOIN partner_crew_memberships pcm
        ON pcm.tenant_id = w.tenant_id
       AND pcm.worker_id = w.id
       AND pcm.status = 'active'
       AND pcm.deleted_at IS NULL
      LEFT JOIN crews c
        ON c.tenant_id = pcm.tenant_id
       AND c.id = pcm.crew_id
       AND c.status = 'active'
       AND c.deleted_at IS NULL
      WHERE tu.tenant_id = $1
        AND tu.user_id = $2
        AND tu.status = 'active'
        AND tu.deleted_at IS NULL
      ORDER BY CASE r.system_key WHEN 'partner_foreman' THEN 1 ELSE 2 END, o.name
      LIMIT 1
      `,
      [request.auth.tenantId, request.auth.userId],
    );

    const roles = Array.from(new Set(result.rows.map((row) => row.role_key || row.role_name)));
    const roleNames = Array.from(new Set(result.rows.map((row) => row.role_name)));
    const permissions = Array.from(new Set(result.rows.map((row) => row.permission_key)));
    const partnerRow = partner.rows[0];

    return {
      user_id: request.auth.userId,
      tenant_id: request.auth.tenantId,
      roles,
      role_names: roleNames,
      permissions,
      partner_context: partnerRow ? {
        persona: partnerRow.role_key,
        organization_id: partnerRow.organization_id,
        organization_name: partnerRow.organization_name,
        organization_status: partnerRow.organization_status,
        capacity_provider_id: partnerRow.capacity_provider_id,
        capacity_provider_status: partnerRow.capacity_provider_status,
        verification_status: partnerRow.verification_status,
        worker_id: partnerRow.worker_id,
        crew_id: partnerRow.crew_id,
      } : null,
    };
  }

  private workspaceFor(roles: string[], permissions: string[], partnerContext: Record<string, unknown> | null) {
    const has = (permission: string) => permissions.includes(permission);
    const internal = roles.some((role) => !["partner_admin", "partner_foreman"].includes(role));
    if (internal && (has("executive_command.read") || has("dashboard.executive.read"))) return "/command-center";
    if (internal && (has("project.read") || has("work_order.read") || has("production.read") || has("qc_review.read"))) return "/operations";
    if (internal && (has("billable_item.read") || has("invoice.read") || has("cash_receipt.read") || has("settlement.read") || has("contractor_payable.read"))) return "/finance";
    if (!internal && partnerContext?.persona === "partner_foreman") return "/partner/field/today";
    if (!internal && partnerContext?.persona === "partner_admin") return "/partner";
    if (has("executive_command.read")) return "/command-center";
    if (has("project.read") || has("work_order.read")) return "/operations";
    if (has("invoice.read") || has("billable_item.read")) return "/finance";
    if (has("partner_context.read")) return partnerContext?.persona === "partner_foreman" ? "/partner/field/today" : "/partner";
    return "/";
  }
}
