import { BadRequestException, Body, Controller, Get, HttpCode, Inject, Post, Req, UnauthorizedException } from "@nestjs/common";
import type { Pool } from "pg";
import { AUTH_JWT_SECRET_MIN_LENGTH, createAuthToken, validatePassword, verifyPassword } from "@syncos/auth";
import { DATABASE_POOL } from "../modules/database.module";
import { AuthenticatedOnly } from "../security/authenticated-only.decorator";
import { Public } from "../security/public.decorator";
import { RequirePermission } from "../security/require-permission.decorator";
import type { AuthenticatedRequest } from "./intelligence.types";

@Controller("auth")
export class AuthController {
  private readonly failedLoginAttempts = new Map<string, LoginAttemptState>();

  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  @Post("login")
  @HttpCode(200)
  @Public()
  async login(@Body() body: Record<string, unknown>) {
    const email = this.normalizeEmail(this.requiredString(body.email, "email is required"));
    const password = this.requiredString(body.password, "password is required");
    const tenantSlug = typeof body.tenant_slug === "string" && body.tenant_slug.trim() ? body.tenant_slug.trim().toLowerCase() : null;
    if (!this.validEmail(email)) throw new BadRequestException("email must be valid");
    const passwordError = validatePassword(password);
    if (passwordError) throw new UnauthorizedException("Invalid email or password");
    this.assertLoginNotThrottled(email);

    const result = await this.pool.query<{
      user_id: string;
      tenant_id: string;
      tenant_slug: string;
      email: string;
      display_name: string;
      password_hash: string | null;
    }>(
      `
      SELECT
        u.id AS user_id,
        tu.tenant_id,
        t.slug AS tenant_slug,
        u.email,
        u.display_name,
        u.password_hash
      FROM users u
      JOIN tenant_users tu ON tu.user_id = u.id
      JOIN tenants t ON t.id = tu.tenant_id
      WHERE lower(u.email) = $1
        AND ($2::text IS NULL OR t.slug = $2)
        AND u.status = 'active'
        AND tu.status = 'active'
        AND t.status = 'active'
        AND u.deleted_at IS NULL
        AND tu.deleted_at IS NULL
        AND t.deleted_at IS NULL
      ORDER BY t.slug
      `,
      [email, tenantSlug],
    );

    if (result.rows.length === 0) {
      this.recordFailedLogin(email);
      throw new UnauthorizedException("Invalid email or password");
    }
    if (!tenantSlug && result.rows.length > 1) throw new BadRequestException("tenant_slug is required for this account");
    const user = result.rows[0];
    if (!verifyPassword(password, user.password_hash)) {
      this.recordFailedLogin(email);
      throw new UnauthorizedException("Invalid email or password");
    }
    this.clearFailedLogin(email);

    const token = this.createSessionToken(user.tenant_id, user.user_id, user.email);
    const context = await this.identityContextFor(user.tenant_id, user.user_id);
    return {
      token,
      user: { id: user.user_id, email: user.email, display_name: user.display_name },
      tenant_id: user.tenant_id,
      tenant_slug: user.tenant_slug,
      context: {
        ...context,
        routing: {
          workspace: this.workspaceFor(context.roles, context.permissions, context.partner_context),
          policy: "server_trusted_workspace_routing_v1",
        },
      },
    };
  }

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
    return this.identityContextFor(request.auth.tenantId, request.auth.userId);
  }

  private async identityContextFor(tenantId: string, userId: string) {
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
      [tenantId, userId],
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
      ORDER BY CASE r.system_key WHEN 'partner_admin' THEN 1 ELSE 2 END, o.name
      LIMIT 1
      `,
      [tenantId, userId],
    );

    const roles = Array.from(new Set(result.rows.map((row) => row.role_key || row.role_name)));
    const roleNames = Array.from(new Set(result.rows.map((row) => row.role_name)));
    const permissions = Array.from(new Set(result.rows.map((row) => row.permission_key)));
    const partnerRow = partner.rows[0];

    return {
      user_id: userId,
      tenant_id: tenantId,
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
    if (!internal && roles.includes("partner_admin")) return "/partner";
    if (!internal && roles.includes("partner_foreman")) return "/syncfield/today";
    if (has("executive_command.read")) return "/command-center";
    if (has("project.read") || has("work_order.read")) return "/operations";
    if (has("invoice.read") || has("billable_item.read")) return "/finance";
    if (has("partner_context.read")) return roles.includes("partner_foreman") && !roles.includes("partner_admin") ? "/syncfield/today" : "/partner";
    return "/";
  }

  private createSessionToken(tenantId: string, userId: string, email: string) {
    const secret = process.env.AUTH_JWT_SECRET;
    if (!secret) throw new UnauthorizedException("AUTH_JWT_SECRET is required");
    if (secret.length < AUTH_JWT_SECRET_MIN_LENGTH) throw new UnauthorizedException("AUTH_JWT_SECRET is too short");
    return createAuthToken({ tenant_id: tenantId, sub: userId, email, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 12 }, secret);
  }

  private assertLoginNotThrottled(email: string) {
    const now = Date.now();
    const current = this.failedLoginAttempts.get(email);
    if (current?.blockedUntil && current.blockedUntil > now) {
      throw new UnauthorizedException("Invalid email or password");
    }
    if (current?.blockedUntil && current.blockedUntil <= now) this.failedLoginAttempts.delete(email);
  }

  private recordFailedLogin(email: string) {
    const now = Date.now();
    const windowMs = 15 * 60 * 1000;
    const blockMs = 15 * 60 * 1000;
    const current = this.failedLoginAttempts.get(email);
    const next: LoginAttemptState = !current || now - current.firstAttemptAt > windowMs
      ? { count: 1, firstAttemptAt: now }
      : { count: current.count + 1, firstAttemptAt: current.firstAttemptAt };
    if (next.count >= 10) next.blockedUntil = now + blockMs;
    this.failedLoginAttempts.set(email, next);
  }

  private clearFailedLogin(email: string) {
    this.failedLoginAttempts.delete(email);
  }

  private requiredString(value: unknown, message: string) {
    if (typeof value !== "string" || !value.trim()) throw new BadRequestException(message);
    return value.trim();
  }

  private normalizeEmail(value: string) {
    return value.trim().toLowerCase();
  }

  private validEmail(value: string) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }
}

type LoginAttemptState = {
  count: number;
  firstAttemptAt: number;
  blockedUntil?: number;
};
