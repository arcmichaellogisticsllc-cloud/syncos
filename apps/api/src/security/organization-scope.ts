import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { PermissionKey } from "@syncos/permissions";

export type OrganizationScope =
  | { kind: "tenant" }
  | { kind: "organizations"; organizationIds: string[] };

type ScopedPermissionRow = {
  scope_type: string;
  scope_id: string | null;
  organization_id: string | null;
};

@Injectable()
export class OrganizationScopeService {
  async resolveForPermission(client: PoolClient, tenantId: string, userId: string, permission: PermissionKey): Promise<OrganizationScope> {
    const result = await client.query<ScopedPermissionRow>(
      `
      SELECT ur.scope_type, ur.scope_id, cp.organization_id
      FROM tenant_users tu
      JOIN user_roles ur ON ur.tenant_user_id = tu.id
      JOIN role_permissions rp ON rp.role_id = ur.role_id
      JOIN permissions p ON p.id = rp.permission_id
      LEFT JOIN capacity_providers cp
        ON cp.tenant_id = tu.tenant_id
       AND cp.id = ur.scope_id
       AND cp.deleted_at IS NULL
      LEFT JOIN organizations scoped_org
        ON scoped_org.tenant_id = tu.tenant_id
       AND scoped_org.id = ur.scope_id
       AND scoped_org.deleted_at IS NULL
      WHERE tu.tenant_id = $1
        AND tu.user_id = $2
        AND tu.status = 'active'
        AND tu.deleted_at IS NULL
        AND p.key = $3
        AND (
          ur.scope_type = 'tenant'
          OR (ur.scope_type = 'organization' AND scoped_org.id IS NOT NULL)
          OR (ur.scope_type = 'contractor' AND cp.organization_id IS NOT NULL)
        )
      `,
      [tenantId, userId, permission],
    );

    if (result.rows.some((row) => row.scope_type === "tenant")) {
      return { kind: "tenant" };
    }

    const organizationIds = Array.from(new Set(result.rows.flatMap((row) => {
      if (row.scope_type === "organization" && row.scope_id) return [row.scope_id];
      if (row.scope_type === "contractor" && row.organization_id) return [row.organization_id];
      return [];
    })));

    if (!organizationIds.length) {
      throw new ForbiddenException(`Missing organization scope for permission: ${permission}`);
    }

    return { kind: "organizations", organizationIds };
  }

  async requireOrganizationAccess(
    client: PoolClient,
    tenantId: string,
    userId: string,
    organizationId: string,
    permission: PermissionKey,
  ): Promise<OrganizationScope> {
    const organization = await client.query(
      "SELECT id FROM organizations WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL LIMIT 1",
      [tenantId, organizationId],
    );
    if (!organization.rows[0]) {
      throw new NotFoundException("partner organization not found");
    }

    const scope = await this.resolveForPermission(client, tenantId, userId, permission);
    if (this.scopeIncludesOrganization(scope, organizationId)) {
      return scope;
    }

    throw new NotFoundException("partner organization not found");
  }

  async requireCapacityProviderAccess(
    client: PoolClient,
    tenantId: string,
    userId: string,
    organizationId: string,
    capacityProviderId: string,
    permission: PermissionKey,
  ) {
    await this.requireOrganizationAccess(client, tenantId, userId, organizationId, permission);
    const result = await client.query(
      `
      SELECT cp.*
      FROM capacity_providers cp
      WHERE cp.tenant_id = $1
        AND cp.id = $2
        AND cp.organization_id = $3
        AND cp.deleted_at IS NULL
      LIMIT 1
      `,
      [tenantId, capacityProviderId, organizationId],
    );
    if (!result.rows[0]) {
      throw new NotFoundException("partner capacity provider not found");
    }
    return result.rows[0];
  }

  appendOrganizationScope(where: string[], values: unknown[], scope: OrganizationScope, columnSql: string) {
    if (scope.kind === "tenant") return;
    if (!scope.organizationIds.length) {
      where.push("FALSE");
      return;
    }
    values.push(scope.organizationIds);
    where.push(`${columnSql} = ANY($${values.length}::uuid[])`);
  }

  private scopeIncludesOrganization(scope: OrganizationScope, organizationId: string): boolean {
    return scope.kind === "tenant" || scope.organizationIds.includes(organizationId);
  }
}
