import { BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, Inject, NotFoundException, Param, Post, Query, Req } from "@nestjs/common";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { executeWriteAction, type WriteActionResult } from "@syncos/shared";
import { DATABASE_POOL } from "../modules/database.module";
import { OrganizationScopeService } from "../security/organization-scope";
import { RequirePermission } from "../security/require-permission.decorator";
import type { AuthenticatedRequest } from "./intelligence.types";
import { requireAllowed, requireString } from "./intelligence.types";

const partnerProviderTypes = new Set(["subcontractor", "crew_provider"]);
const partnerRoleKeys = new Set(["partner_admin", "partner_foreman"]);
const partnerPermissionsByRole: Record<string, string[]> = {
  partner_admin: ["partner_context.read", "partner_profile.read", "partner_actions.read"],
  partner_foreman: ["partner_context.read", "partner_actions.read"],
};

type PartnerScopeRow = QueryResultRow & {
  user_id: string;
  display_name: string;
  tenant_user_id: string;
  role_id: string;
  role_name: string;
  role_key: string;
  organization_id: string;
  organization_name: string;
  organization_status: string;
  capacity_provider_id: string;
  capacity_provider_name: string;
  provider_type: string;
  provider_status: string;
  verification_status: string;
  contract_status: string;
};

type PartnerContext = {
  user: {
    id: string;
    display_name: string;
  };
  tenant_id: string;
  persona: "partner_admin" | "partner_foreman";
  organization: {
    id: string;
    name: string;
    status: string;
  };
  capacityProvider: {
    id: string;
    name: string;
    provider_type: string;
    status: string;
    verification_status: string;
    contract_status: string;
  };
};

@Controller("partner-personas")
export class PartnerPersonasController {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly organizationScope: OrganizationScopeService,
  ) {}

  @Get("me/context")
  @RequirePermission("partner_context.read")
  async context(@Req() request: AuthenticatedRequest, @Query() query: Record<string, string | undefined>) {
    return this.withClient(async (client) => {
      const context = await this.resolvePartnerContext(client, request, query.organization_id);
      return this.safeContext(context);
    });
  }

  @Get("me/organization")
  @RequirePermission("partner_profile.read")
  async ownOrganization(@Req() request: AuthenticatedRequest, @Query() query: Record<string, string | undefined>) {
    return this.withClient(async (client) => {
      const context = await this.resolvePartnerContext(client, request, query.organization_id);
      return {
        organization: context.organization,
        capacity_provider: context.capacityProvider,
      };
    });
  }

  @Get("me/actions")
  @RequirePermission("partner_actions.read")
  async ownActions(@Req() request: AuthenticatedRequest, @Query() query: Record<string, string | undefined>) {
    return this.withClient(async (client) => {
      const context = await this.resolvePartnerContext(client, request, query.organization_id);
      return {
        persona: context.persona,
        organization_id: context.organization.id,
        allowed_actions: this.allowedActions(context.persona),
        route_visibility: this.routeVisibility(context.persona),
      };
    });
  }

  @Post("users/:userId/roles")
  @RequirePermission("admin.manage_roles")
  async assignPartnerRole(@Req() request: AuthenticatedRequest, @Param("userId") userId: string, @Body() body: Record<string, unknown>) {
    const roleKey = this.partnerRoleKey(body.role_key);
    let organizationId: string;
    let scopeType: string;
    try {
      organizationId = requireString(body.organization_id, "organization_id is required");
      scopeType = body.scope_type === undefined ? "organization" : requireAllowed(body.scope_type, new Set(["organization"]), "scope_type");
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
    if (scopeType !== "organization") throw new BadRequestException("Partner roles must be organization scoped");
    if (userId === request.auth.userId) throw new ForbiddenException("Partner users cannot self-elevate");

    return this.withClient((client) =>
      this.assignRole(client, request, {
        userId,
        roleKey,
        organizationId,
        reason: typeof body.reason === "string" ? body.reason : undefined,
      }),
    );
  }

  @Delete("users/:userId/roles/:roleKey/scopes/:organizationId")
  @RequirePermission("admin.manage_roles")
  async revokePartnerRole(
    @Req() request: AuthenticatedRequest,
    @Param("userId") userId: string,
    @Param("roleKey") roleKeyParam: string,
    @Param("organizationId") organizationId: string,
  ) {
    const roleKey = this.partnerRoleKey(roleKeyParam);
    return this.withClient((client) =>
      this.revokeRole(client, request, {
        userId,
        roleKey,
        organizationId,
      }),
    );
  }

  private async resolvePartnerContext(client: PoolClient, request: AuthenticatedRequest, queryOrganizationId?: string) {
    const requestedScope = this.requestedOrganizationScope(request, queryOrganizationId);
    const rows = await this.partnerScopeRows(client, request.auth.tenantId, request.auth.userId, requestedScope);
    if (!rows.length) {
      if (requestedScope) throw new ForbiddenException("Partner organization scope is not assigned");
      throw new ForbiddenException("Partner role with active organization scope is required");
    }

    const organizationIds = Array.from(new Set(rows.map((row) => row.organization_id)));
    if (!requestedScope && organizationIds.length > 1) {
      throw this.partnerAccountOrganizationConflict();
    }

    const selectedOrganizationId = requestedScope ?? organizationIds[0];
    const selectedRows = rows.filter((row) => row.organization_id === selectedOrganizationId);
    if (!selectedRows.length) throw new ForbiddenException("Partner organization scope is not assigned");

    const persona = this.highestPersona(selectedRows.map((row) => row.role_key));
    const first = selectedRows[0];
    return {
      user: {
        id: first.user_id,
        display_name: first.display_name,
      },
      tenant_id: request.auth.tenantId,
      persona,
      organization: {
        id: first.organization_id,
        name: first.organization_name,
        status: first.organization_status,
      },
      capacityProvider: {
        id: first.capacity_provider_id,
        name: first.capacity_provider_name,
        provider_type: first.provider_type,
        status: first.provider_status,
        verification_status: first.verification_status,
        contract_status: first.contract_status,
      },
    };
  }

  private async partnerScopeRows(client: PoolClient, tenantId: string, userId: string, organizationId?: string) {
    const values: unknown[] = [tenantId, userId, Array.from(partnerRoleKeys), Array.from(partnerProviderTypes)];
    const organizationPredicate = organizationId ? "AND o.id = $5" : "";
    if (organizationId) values.push(organizationId);
    const result = await client.query<PartnerScopeRow>(
      `
      SELECT
        u.id AS user_id,
        u.display_name,
        tu.id AS tenant_user_id,
        r.id AS role_id,
        r.name AS role_name,
        r.system_key AS role_key,
        o.id AS organization_id,
        o.name AS organization_name,
        o.status AS organization_status,
        cp.id AS capacity_provider_id,
        cp.name AS capacity_provider_name,
        cp.provider_type,
        cp.status AS provider_status,
        cp.verification_status,
        cp.contract_status
      FROM users u
      JOIN tenant_users tu
        ON tu.user_id = u.id
       AND tu.tenant_id = $1
       AND tu.status = 'active'
       AND tu.deleted_at IS NULL
      JOIN user_roles ur
        ON ur.tenant_user_id = tu.id
       AND ur.tenant_id = tu.tenant_id
       AND ur.scope_type = 'organization'
       AND ur.scope_id IS NOT NULL
      JOIN roles r
        ON r.id = ur.role_id
       AND r.tenant_id = tu.tenant_id
       AND r.system_key = ANY($3::text[])
       AND r.deleted_at IS NULL
      JOIN role_permissions rp
        ON rp.role_id = r.id
       AND rp.tenant_id = tu.tenant_id
      JOIN permissions p
        ON p.id = rp.permission_id
       AND p.key = 'partner_context.read'
      JOIN organizations o
        ON o.tenant_id = tu.tenant_id
       AND o.id = ur.scope_id
       AND o.deleted_at IS NULL
      JOIN capacity_providers cp
        ON cp.tenant_id = o.tenant_id
       AND cp.organization_id = o.id
       AND cp.provider_type = ANY($4::text[])
       AND cp.status <> 'archived'
       AND cp.deleted_at IS NULL
      WHERE u.id = $2
        AND u.status = 'active'
        AND u.deleted_at IS NULL
        ${organizationPredicate}
      ORDER BY o.name ASC, r.system_key ASC, cp.created_at ASC
      `,
      values,
    );
    return result.rows;
  }

  private requestedOrganizationScope(request: AuthenticatedRequest, queryOrganizationId?: string): string | undefined {
    const headerScopeType = request.header("x-scope-type");
    const headerScopeId = request.header("x-scope-id");
    if (headerScopeType || headerScopeId || queryOrganizationId) {
      throw new BadRequestException("Partner Portal organization context is resolved from your account, not browser selection");
    }
    return undefined;
  }

  private async requireNoPartnerAccountOrganizationConflict(client: PoolClient, tenantId: string, tenantUserId: string, organizationId: string) {
    const result = await client.query<{ organization_id: string }>(
      `
      SELECT DISTINCT ur.scope_id AS organization_id
      FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id AND r.tenant_id = ur.tenant_id AND r.system_key = ANY($3::text[]) AND r.deleted_at IS NULL
      JOIN organizations o ON o.tenant_id = ur.tenant_id AND o.id = ur.scope_id AND o.deleted_at IS NULL
      JOIN capacity_providers cp ON cp.tenant_id = o.tenant_id AND cp.organization_id = o.id AND cp.provider_type = ANY($4::text[]) AND cp.status <> 'archived' AND cp.deleted_at IS NULL
      WHERE ur.tenant_id = $1
        AND ur.tenant_user_id = $2
        AND ur.scope_type = 'organization'
        AND ur.scope_id IS NOT NULL
      `,
      [tenantId, tenantUserId, Array.from(partnerRoleKeys), Array.from(partnerProviderTypes)],
    );
    const organizationIds = Array.from(new Set(result.rows.map((row) => row.organization_id)));
    if (organizationIds.some((assignedOrganizationId) => assignedOrganizationId !== organizationId)) throw this.partnerAccountOrganizationConflict();
  }

  private async lockPartnerAccountForTransaction(client: PoolClient, tenantId: string, email: string) {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`partner-account:${tenantId}:${email.trim().toLowerCase()}`]);
  }

  private partnerAccountOrganizationConflict() {
    return new ConflictException({
      code: "PARTNER_ACCOUNT_ORGANIZATION_CONFLICT",
      message: "Your account has conflicting company access. Contact Sync Comm Systems support so we can correct your account.",
    });
  }

  private async assignRole(
    client: PoolClient,
    request: AuthenticatedRequest,
    input: { userId: string; roleKey: string; organizationId: string; reason?: string },
  ) {
    await this.requireAssignablePartnerOrganization(client, request.auth.tenantId, request.auth.userId, input.organizationId);
    const tenantUser = await this.requireTenantUser(client, request.auth.tenantId, input.userId);
    const role = await this.ensurePartnerRole(client, request.auth.tenantId, input.roleKey);

    return this.writeWithClient<Record<string, unknown>>(client, request, "partner_role.assign", "partner_role.assigned", "user_role", async (writeClient) => {
      await this.lockPartnerAccountForTransaction(writeClient, request.auth.tenantId, tenantUser.email);
      await this.requireNoPartnerAccountOrganizationConflict(writeClient, request.auth.tenantId, tenantUser.id, input.organizationId);
      const existing = await writeClient.query(
        `
        SELECT ur.*
        FROM user_roles ur
        WHERE ur.tenant_id = $1
          AND ur.tenant_user_id = $2
          AND ur.role_id = $3
          AND ur.scope_type = 'organization'
          AND ur.scope_id = $4
        LIMIT 1
        `,
        [request.auth.tenantId, tenantUser.id, role.id, input.organizationId],
      );
      if (existing.rows[0]) {
        return {
          entityType: "user_role",
          entityId: existing.rows[0].id,
          skipEventAudit: true,
          afterState: {
            tenant_id: request.auth.tenantId,
            user_id: input.userId,
            role_key: input.roleKey,
            scope_type: "organization",
            scope_id: input.organizationId,
            partner_organization_id: input.organizationId,
            user_role_id: existing.rows[0].id,
            reused_existing_assignment: true,
          },
        };
      }
      const inserted = await writeClient.query(
        `
        INSERT INTO user_roles (tenant_id, tenant_user_id, role_id, scope_type, scope_id)
        VALUES ($1, $2, $3, 'organization', $4)
        RETURNING *
        `,
        [request.auth.tenantId, tenantUser.id, role.id, input.organizationId],
      );
      const capacityProviderId = await this.firstPartnerCapacityProviderId(writeClient, request.auth.tenantId, input.organizationId);
      return {
        entityType: "user_role",
        entityId: inserted.rows[0].id,
        afterState: {
          tenant_id: request.auth.tenantId,
          user_id: input.userId,
          tenant_user_id: tenantUser.id,
          role_id: role.id,
          role_key: input.roleKey,
          scope_type: "organization",
          scope_id: input.organizationId,
          partner_organization_id: input.organizationId,
          user_role_id: inserted.rows[0].id,
          capacity_provider_id: capacityProviderId,
          actor_user_id: request.auth.userId,
          reused_existing_assignment: false,
        },
      };
    }, input.reason);
  }

  private async revokeRole(client: PoolClient, request: AuthenticatedRequest, input: { userId: string; roleKey: string; organizationId: string }) {
    await this.requireAssignablePartnerOrganization(client, request.auth.tenantId, request.auth.userId, input.organizationId);
    const tenantUser = await this.requireTenantUser(client, request.auth.tenantId, input.userId);
    const role = await this.requireRole(client, request.auth.tenantId, input.roleKey);
    const existing = await client.query(
      `
      SELECT *
      FROM user_roles
      WHERE tenant_id = $1
        AND tenant_user_id = $2
        AND role_id = $3
        AND scope_type = 'organization'
        AND scope_id = $4
      LIMIT 1
      `,
      [request.auth.tenantId, tenantUser.id, role.id, input.organizationId],
    );
    if (!existing.rows[0]) throw new NotFoundException("Partner role assignment not found");

    return this.writeWithClient(client, request, "partner_role.revoke", "partner_role.revoked", "user_role", async (writeClient) => {
      await writeClient.query("DELETE FROM user_roles WHERE id = $1 AND tenant_id = $2", [existing.rows[0].id, request.auth.tenantId]);
      const capacityProviderId = await this.firstPartnerCapacityProviderId(writeClient, request.auth.tenantId, input.organizationId);
      return {
        entityType: "user_role",
        entityId: existing.rows[0].id,
        beforeState: existing.rows[0],
        afterState: {
          tenant_id: request.auth.tenantId,
          user_id: input.userId,
          tenant_user_id: tenantUser.id,
          role_id: role.id,
          role_key: input.roleKey,
          scope_type: "organization",
          scope_id: input.organizationId,
          partner_organization_id: input.organizationId,
          capacity_provider_id: capacityProviderId,
          actor_user_id: request.auth.userId,
          revoked: true,
        },
      };
    });
  }

  private async requireAssignablePartnerOrganization(client: PoolClient, tenantId: string, actorUserId: string, organizationId: string) {
    await this.organizationScope.requireOrganizationAccess(client, tenantId, actorUserId, organizationId, "admin.manage_roles");
    const result = await client.query(
      `
      SELECT o.id, cp.id AS capacity_provider_id
      FROM organizations o
      JOIN capacity_providers cp
        ON cp.tenant_id = o.tenant_id
       AND cp.organization_id = o.id
       AND cp.provider_type = ANY($3::text[])
       AND cp.status <> 'archived'
       AND cp.deleted_at IS NULL
      WHERE o.tenant_id = $1
        AND o.id = $2
        AND o.deleted_at IS NULL
      LIMIT 1
      `,
      [tenantId, organizationId, Array.from(partnerProviderTypes)],
    );
    if (!result.rows[0]) throw new BadRequestException("Partner role scope must be an approved Partner Organization");
    return result.rows[0];
  }

  private async requireTenantUser(client: PoolClient, tenantId: string, userId: string) {
    const result = await client.query(
      `
      SELECT tu.*, u.email
      FROM tenant_users tu
      JOIN users u ON u.id = tu.user_id
      WHERE tu.tenant_id = $1
        AND tu.user_id = $2
        AND tu.status = 'active'
        AND tu.deleted_at IS NULL
        AND u.status = 'active'
        AND u.deleted_at IS NULL
      LIMIT 1
      `,
      [tenantId, userId],
    );
    if (!result.rows[0]) throw new NotFoundException("active tenant user not found");
    return result.rows[0];
  }

  private async ensurePartnerRole(client: PoolClient, tenantId: string, roleKey: string) {
    await this.ensurePartnerPermissions(client);
    const roleName = roleKey === "partner_admin" ? "Partner Admin" : "Partner Foreman";
    const role = await client.query(
      `
      INSERT INTO roles (tenant_id, name, system_key, description)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (tenant_id, system_key)
      DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description
      RETURNING *
      `,
      [tenantId, roleName, roleKey, `${roleName} external organization-scoped persona`],
    );
    for (const permission of partnerPermissionsByRole[roleKey]) {
      await client.query(
        `
        INSERT INTO role_permissions (tenant_id, role_id, permission_id)
        SELECT $1, $2, id
        FROM permissions
        WHERE key = $3
        ON CONFLICT (role_id, permission_id) DO NOTHING
        `,
        [tenantId, role.rows[0].id, permission],
      );
    }
    return role.rows[0];
  }

  private async ensurePartnerPermissions(client: PoolClient) {
    for (const permission of Object.values(partnerPermissionsByRole).flat()) {
      await client.query(
        `
        INSERT INTO permissions (key, name)
        VALUES ($1, $1)
        ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name
        `,
        [permission],
      );
    }
  }

  private async requireRole(client: PoolClient, tenantId: string, roleKey: string) {
    const result = await client.query(
      "SELECT * FROM roles WHERE tenant_id = $1 AND system_key = $2 AND deleted_at IS NULL LIMIT 1",
      [tenantId, roleKey],
    );
    if (!result.rows[0]) throw new NotFoundException("Partner role not found");
    return result.rows[0];
  }

  private async firstPartnerCapacityProviderId(client: PoolClient, tenantId: string, organizationId: string): Promise<string | null> {
    const result = await client.query<{ id: string }>(
      `
      SELECT id
      FROM capacity_providers
      WHERE tenant_id = $1
        AND organization_id = $2
        AND provider_type = ANY($3::text[])
        AND status <> 'archived'
        AND deleted_at IS NULL
      ORDER BY created_at ASC
      LIMIT 1
      `,
      [tenantId, organizationId, Array.from(partnerProviderTypes)],
    );
    return result.rows[0]?.id ?? null;
  }

  private safeContext(context: PartnerContext) {
    return {
      user: context.user,
      tenant_id: context.tenant_id,
      persona: context.persona,
      organization: context.organization,
      capacity_provider: context.capacityProvider,
      allowed_actions: this.allowedActions(context.persona),
      route_visibility: this.routeVisibility(context.persona),
    };
  }

  private allowedActions(persona: string): string[] {
    const actions = ["partner.context.read", "partner.actions.read"];
    if (persona === "partner_admin") actions.splice(1, 0, "partner.profile.read");
    return actions;
  }

  private routeVisibility(persona: string) {
    const routes = [
      { key: "partner.context", api: "GET /partner-personas/me/context" },
      { key: "partner.actions", api: "GET /partner-personas/me/actions" },
    ];
    if (persona === "partner_admin") routes.splice(1, 0, { key: "partner.organization", api: "GET /partner-personas/me/organization" });
    return routes;
  }

  private highestPersona(roleKeys: string[]): "partner_admin" | "partner_foreman" {
    return roleKeys.includes("partner_admin") ? "partner_admin" : "partner_foreman";
  }

  private partnerRoleKey(value: unknown): string {
    try {
      return requireAllowed(value, partnerRoleKeys, "role_key");
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
  }

  private async writeWithClient<T>(
    client: PoolClient,
    request: AuthenticatedRequest,
    action: string,
    eventType: string,
    aggregateType: string,
    write: (client: PoolClient) => Promise<WriteActionResult<T>>,
    reason?: string,
  ) {
    return executeWriteAction(client, {
      tenantId: request.auth.tenantId,
      actorUserId: request.auth.userId,
      action,
      aggregateType,
      eventType,
      audit: { metadata: reason?.trim() ? { reason: reason.trim() } : {} },
      systemActions: [{ actionType: `${eventType}.processed`, payload: { action } }],
      write,
    });
  }

  private async withClient<T>(callback: (client: PoolClient) => Promise<T>) {
    const client = await this.pool.connect();
    try {
      return await callback(client);
    } finally {
      client.release();
    }
  }
}
