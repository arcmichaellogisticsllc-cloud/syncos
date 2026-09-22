import { ForbiddenException } from "@nestjs/common";
import type { PoolClient } from "pg";
/** Resolve field access from trusted roles and provider ownership, never from browser scope. */
export async function resolveFieldIdentity(client: PoolClient, tenantId: string, userId: string) {
    const result = await client.query(`
    SELECT u.id AS user_id, u.display_name, tu.id AS tenant_user_id,
      o.id AS organization_id,o.name AS organization_name,o.status AS organization_status,
      cp.id AS provider_id,cp.name AS provider_name,cp.provider_type,cp.status AS provider_status,
      cp.verification_status,cp.contract_status,r.system_key
    FROM tenant_users tu
    JOIN users u ON u.id=tu.user_id AND u.status='active' AND u.deleted_at IS NULL
    JOIN user_roles ur ON ur.tenant_id=tu.tenant_id AND ur.tenant_user_id=tu.id AND ur.scope_type='organization'
    JOIN roles r ON r.tenant_id=tu.tenant_id AND r.id=ur.role_id AND r.deleted_at IS NULL
    JOIN organizations o ON o.tenant_id=tu.tenant_id AND o.id=ur.scope_id AND o.deleted_at IS NULL
    JOIN capacity_providers cp ON cp.tenant_id=o.tenant_id AND cp.organization_id=o.id AND cp.deleted_at IS NULL
    WHERE tu.tenant_id=$1 AND tu.user_id=$2 AND tu.status='active' AND tu.deleted_at IS NULL
      AND o.status NOT IN ('inactive','suspended','archived') AND cp.status NOT IN ('suspended','archived')
      AND ((r.system_key='sync_foreman' AND cp.provider_type='internal_workforce')
        OR (r.system_key='partner_foreman' AND cp.provider_type IN ('subcontractor','crew_provider')))
  `, [tenantId, userId]);
    if (result.rows.length !== 1)
        throw new ForbiddenException("An active, unambiguous field organization assignment is required");
    const r = result.rows[0];
    return {
        tenant_id: tenantId, persona: "partner_foreman" as const,
        workforce_kind: r.provider_type === "internal_workforce" ? "internal" as const : "partner" as const,
        user: { id: r.user_id, display_name: r.display_name, tenant_user_id: r.tenant_user_id },
        organization: { id: r.organization_id, name: r.organization_name, status: r.organization_status },
        capacityProvider: { id: r.provider_id, name: r.provider_name, provider_type: r.provider_type, status: r.provider_status, verification_status: r.verification_status, contract_status: r.contract_status },
    };
}
