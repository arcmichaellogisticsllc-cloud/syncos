import { BadRequestException, Body, ConflictException, Controller, Get, Inject, NotFoundException, Param, Post, Req } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import { executeWriteAction, type WriteActionResult } from "@syncos/shared";
import { DATABASE_POOL } from "../modules/database.module";
import { OrganizationScopeService } from "../security/organization-scope";
import { RequirePermission } from "../security/require-permission.decorator";
import type { AuthenticatedRequest } from "./intelligence.types";
import { requireAllowed } from "./intelligence.types";

const partnerProviderTypes = new Set(["subcontractor", "crew_provider"]);

@Controller("partner-domain")
export class PartnerDomainController {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly organizationScope: OrganizationScopeService,
  ) {}

  @Get("organizations")
  @RequirePermission("capacity_provider.read")
  async listPartnerOrganizations(@Req() request: AuthenticatedRequest) {
    return this.withClient(async (client) => {
      const scope = await this.organizationScope.resolveForPermission(client, request.auth.tenantId, request.auth.userId, "capacity_provider.read");
      const values: unknown[] = [request.auth.tenantId];
      const where = [
        "o.tenant_id = $1",
        "o.deleted_at IS NULL",
        "cp.deleted_at IS NULL",
        "cp.status <> 'archived'",
        "cp.provider_type = ANY($2::text[])",
      ];
      values.push(Array.from(partnerProviderTypes));
      this.organizationScope.appendOrganizationScope(where, values, scope, "o.id");

      const result = await client.query(
        `
        SELECT
          o.id,
          o.name,
          o.organization_type,
          o.actor_roles,
          o.status AS organization_status,
          jsonb_agg(
            jsonb_build_object(
              'id', cp.id,
              'name', cp.name,
              'provider_type', cp.provider_type,
              'status', cp.status,
              'verification_status', cp.verification_status,
              'contract_status', cp.contract_status
            )
            ORDER BY cp.created_at
          ) AS capacity_providers
        FROM organizations o
        JOIN capacity_providers cp
          ON cp.tenant_id = o.tenant_id
         AND cp.organization_id = o.id
        WHERE ${where.join("\n          AND ")}
        GROUP BY o.id, o.name, o.organization_type, o.actor_roles, o.status
        ORDER BY o.name ASC
        `,
        values,
      );

      return result.rows;
    });
  }

  @Get("organizations/:organizationId")
  @RequirePermission("capacity_provider.read")
  async getPartnerOrganization(@Req() request: AuthenticatedRequest, @Param("organizationId") organizationId: string) {
    return this.withClient(async (client) => {
      await this.organizationScope.requireOrganizationAccess(client, request.auth.tenantId, request.auth.userId, organizationId, "capacity_provider.read");
      const record = await this.partnerOrganizationDetail(client, request.auth.tenantId, organizationId);
      if (!record) throw new NotFoundException("partner organization not found");
      return record;
    });
  }

  @Get("organizations/:organizationId/capacity-providers/:capacityProviderId")
  @RequirePermission("capacity_provider.read")
  async getPartnerCapacityProvider(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId") organizationId: string,
    @Param("capacityProviderId") capacityProviderId: string,
  ) {
    return this.withClient((client) =>
      this.organizationScope.requireCapacityProviderAccess(
        client,
        request.auth.tenantId,
        request.auth.userId,
        organizationId,
        capacityProviderId,
        "capacity_provider.read",
      ),
    );
  }

  @Post("organizations/:organizationId/classify")
  @RequirePermission("capacity_provider.create")
  async classifyPartnerOrganization(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId") organizationId: string,
    @Body() body: Record<string, unknown>,
  ) {
    let providerType: string;
    try {
      providerType = body.provider_type === undefined
        ? "subcontractor"
        : requireAllowed(body.provider_type, partnerProviderTypes, "provider_type");
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }

    const client = await this.pool.connect();
    const lockKey = `${request.auth.tenantId}:${organizationId}:${providerType}`;
    try {
      const organization = await this.requireOrganizationForClassification(client, request.auth.tenantId, request.auth.userId, organizationId);
      await client.query("SELECT pg_advisory_lock(hashtext($1))", [lockKey]);
      const existing = await this.existingActivePartnerProviders(client, request.auth.tenantId, organizationId, providerType);
      if (existing.length > 1) {
        throw new ConflictException("partner organization has ambiguous active capacity provider linkage");
      }
      if (existing.length === 1) {
        return {
          tenant_id: request.auth.tenantId,
          organization_id: organizationId,
          actor_user_id: request.auth.userId,
          capacity_provider_id: existing[0].id,
          organization,
          capacity_provider: existing[0],
          canonical_partner_definition: "organization_with_capacity_provider",
          reused_existing_linkage: true,
        };
      }

      return await this.writeWithClient(client, request, "partner_classification.create", "partner_classification.created", "organization", async (writeClient) => {
        const active = await this.existingActivePartnerProviders(writeClient, request.auth.tenantId, organizationId, providerType);
        if (active.length > 0) {
          throw new ConflictException("partner organization has ambiguous active capacity provider linkage");
        }

        const inserted = await writeClient.query(
          `
          INSERT INTO capacity_providers (
            tenant_id,
            organization_id,
            name,
            provider_type,
            status,
            verification_status,
            contract_status
          )
          VALUES ($1, $2, $3, $4, 'prospect', 'prospect', 'not_started')
          RETURNING *
          `,
          [request.auth.tenantId, organizationId, organization.name, providerType],
        );

        return {
          entityType: "organization",
          entityId: organizationId,
          beforeState: { organization },
          afterState: {
            tenant_id: request.auth.tenantId,
            organization_id: organizationId,
            actor_user_id: request.auth.userId,
            capacity_provider_id: inserted.rows[0].id,
            organization,
            capacity_provider: inserted.rows[0],
            canonical_partner_definition: "organization_with_capacity_provider",
            reused_existing_linkage: false,
          },
        };
      }, body.reason);
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ConflictException) throw error;
      throw new BadRequestException((error as Error).message);
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtext($1))", [lockKey]).catch(() => undefined);
      client.release();
    }
  }

  private async requireOrganizationForClassification(client: PoolClient, tenantId: string, userId: string, organizationId: string) {
    await this.organizationScope.requireOrganizationAccess(client, tenantId, userId, organizationId, "capacity_provider.create");
    const result = await client.query(
      "SELECT * FROM organizations WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL LIMIT 1",
      [tenantId, organizationId],
    );
    if (!result.rows[0]) throw new NotFoundException("partner organization not found");
    return result.rows[0];
  }

  private async existingActivePartnerProviders(client: PoolClient, tenantId: string, organizationId: string, providerType: string) {
    const result = await client.query(
      `
      SELECT *
      FROM capacity_providers
      WHERE tenant_id = $1
        AND organization_id = $2
        AND provider_type = $3
        AND status <> 'archived'
        AND deleted_at IS NULL
      ORDER BY created_at ASC
      `,
      [tenantId, organizationId, providerType],
    );
    return result.rows;
  }

  private async partnerOrganizationDetail(client: PoolClient, tenantId: string, organizationId: string) {
    const result = await client.query(
      `
      SELECT
        o.id,
        o.name,
        o.organization_type,
        o.actor_roles,
        o.status AS organization_status,
        jsonb_agg(
          jsonb_build_object(
            'id', cp.id,
            'name', cp.name,
            'provider_type', cp.provider_type,
            'status', cp.status,
            'verification_status', cp.verification_status,
            'contract_status', cp.contract_status
          )
          ORDER BY cp.created_at
        ) AS capacity_providers
      FROM organizations o
      JOIN capacity_providers cp
        ON cp.tenant_id = o.tenant_id
       AND cp.organization_id = o.id
       AND cp.deleted_at IS NULL
       AND cp.status <> 'archived'
       AND cp.provider_type = ANY($3::text[])
      WHERE o.tenant_id = $1
        AND o.id = $2
        AND o.deleted_at IS NULL
      GROUP BY o.id, o.name, o.organization_type, o.actor_roles, o.status
      LIMIT 1
      `,
      [tenantId, organizationId, Array.from(partnerProviderTypes)],
    );
    return result.rows[0] ?? null;
  }

  private async write<T>(
    request: AuthenticatedRequest,
    action: string,
    eventType: string,
    aggregateType: string,
    write: (client: PoolClient) => Promise<WriteActionResult<T>>,
    reason?: unknown,
  ) {
    const client = await this.pool.connect();
    try {
      return await this.writeWithClient(client, request, action, eventType, aggregateType, write, reason);
    } finally {
      client.release();
    }
  }

  private async writeWithClient<T>(
    client: PoolClient,
    request: AuthenticatedRequest,
    action: string,
    eventType: string,
    aggregateType: string,
    write: (client: PoolClient) => Promise<WriteActionResult<T>>,
    reason?: unknown,
  ) {
    return await executeWriteAction(client, {
      tenantId: request.auth.tenantId,
      actorUserId: request.auth.userId,
      action,
      aggregateType,
      eventType,
      audit: { metadata: typeof reason === "string" && reason.trim() ? { reason: reason.trim() } : {} },
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
