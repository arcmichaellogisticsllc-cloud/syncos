import { Controller, Get, Inject, Req } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import { DATABASE_POOL } from "../modules/database.module";
import { RequirePermission } from "../security/require-permission.decorator";
import type { AuthenticatedRequest } from "./intelligence.types";

const REQUIRED_DOCUMENTS_BY_PROVIDER_TYPE: Record<string, string[]> = {
  subcontractor: ["insurance", "w9", "msa", "rate_schedule", "safety_document", "crew_list"],
  crew_provider: ["insurance", "w9", "msa", "rate_schedule", "safety_document", "crew_list"],
  equipment_provider: ["insurance", "w9", "msa", "rate_schedule", "equipment_list"],
  staffing_partner: ["insurance", "w9", "msa", "rate_schedule", "safety_document"],
  vendor: ["insurance", "w9", "msa", "rate_schedule"],
};

@Controller("reports")
export class ReportsController {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  @Get("compliance")
  @RequirePermission("compliance_document.read")
  async compliance(@Req() request: AuthenticatedRequest) {
    return this.withClient(async (client) => {
      const tenantId = request.auth.tenantId;
      return {
        expiredDocuments: await this.expiredDocuments(client, tenantId),
        expiringDocuments: await this.expiringDocuments(client, tenantId),
        missingDocuments: await this.missingDocuments(client, tenantId),
      };
    });
  }

  @Get("billing-completeness")
  @RequirePermission("settlement.read")
  async billingCompleteness(@Req() request: AuthenticatedRequest) {
    return this.withClient(async (client) => {
      const tenantId = request.auth.tenantId;
      return {
        billableProduction: await this.billableProduction(client, tenantId),
        missingRateCodes: await this.missingRateCodes(client, tenantId),
        missingSettlementLinks: await this.missingSettlementLinks(client, tenantId),
        missingInvoiceLinks: await this.missingInvoiceLinks(client, tenantId),
      };
    });
  }

  @Get("constraints")
  @RequirePermission("constraint.read")
  async constraints(@Req() request: AuthenticatedRequest) {
    return this.withClient(async (client) => {
      const tenantId = request.auth.tenantId;
      return {
        openConstraints: await this.openConstraints(client, tenantId),
        byType: await this.groupConstraints(client, tenantId, "constraint_type"),
        bySeverity: await this.groupConstraints(client, tenantId, "severity"),
        byOwner: await this.groupConstraints(client, tenantId, "owner_id"),
      };
    });
  }

  private expiredDocuments(client: PoolClient, tenantId: string) {
    return client
      .query(
        `
        SELECT cd.id, cd.capacity_provider_id, cp.name AS capacity_provider_name, cd.document_type, cd.status, cd.expires_at
        FROM compliance_documents cd
        LEFT JOIN capacity_providers cp ON cp.tenant_id = cd.tenant_id AND cp.id = cd.capacity_provider_id
        WHERE cd.tenant_id = $1
          AND cd.deleted_at IS NULL
          AND cd.status <> 'archived'
          AND (cd.status = 'expired' OR cd.expires_at < current_date)
        ORDER BY cd.expires_at NULLS LAST, cd.created_at DESC
        `,
        [tenantId],
      )
      .then((result) => result.rows);
  }

  private expiringDocuments(client: PoolClient, tenantId: string) {
    return client
      .query(
        `
        SELECT cd.id, cd.capacity_provider_id, cp.name AS capacity_provider_name, cd.document_type, cd.status, cd.expires_at
        FROM compliance_documents cd
        LEFT JOIN capacity_providers cp ON cp.tenant_id = cd.tenant_id AND cp.id = cd.capacity_provider_id
        WHERE cd.tenant_id = $1
          AND cd.deleted_at IS NULL
          AND cd.status <> 'archived'
          AND cd.expires_at >= current_date
          AND cd.expires_at <= current_date + interval '30 days'
        ORDER BY cd.expires_at, cd.created_at DESC
        `,
        [tenantId],
      )
      .then((result) => result.rows);
  }

  private async missingDocuments(client: PoolClient, tenantId: string) {
    const providers = await client.query<{ id: string; name: string; provider_type: string }>(
      `
      SELECT id, name, provider_type
      FROM capacity_providers
      WHERE tenant_id = $1 AND status <> 'archived' AND deleted_at IS NULL
      ORDER BY name
      `,
      [tenantId],
    );
    const documents = await client.query<{ capacity_provider_id: string; document_type: string; status: string }>(
      `
      SELECT capacity_provider_id, document_type, status
      FROM compliance_documents
      WHERE tenant_id = $1
        AND capacity_provider_id IS NOT NULL
        AND status <> 'archived'
        AND deleted_at IS NULL
      `,
      [tenantId],
    );
    const approvedByProvider = new Map<string, Set<string>>();
    for (const document of documents.rows) {
      if (document.status !== "approved") continue;
      if (!approvedByProvider.has(document.capacity_provider_id)) {
        approvedByProvider.set(document.capacity_provider_id, new Set<string>());
      }
      approvedByProvider.get(document.capacity_provider_id)?.add(document.document_type);
    }

    return providers.rows.flatMap((provider) => {
      const required = REQUIRED_DOCUMENTS_BY_PROVIDER_TYPE[provider.provider_type] ?? [];
      const approved = approvedByProvider.get(provider.id) ?? new Set<string>();
      return required
        .filter((documentType) => !approved.has(documentType))
        .map((documentType) => ({
          capacityProviderId: provider.id,
          capacityProviderName: provider.name,
          providerType: provider.provider_type,
          missingDocumentType: documentType,
        }));
    });
  }

  private billableProduction(client: PoolClient, tenantId: string) {
    return client
      .query(
        `
        SELECT id, project_id, work_order_id, capacity_provider_id, quantity_submitted, approved_quantity, unit_type, rate_code_id, created_at
        FROM production_records
        WHERE tenant_id = $1 AND status = 'billable' AND deleted_at IS NULL
        ORDER BY created_at DESC
        LIMIT 100
        `,
        [tenantId],
      )
      .then((result) => result.rows);
  }

  private missingRateCodes(client: PoolClient, tenantId: string) {
    return client
      .query(
        `
        SELECT id, project_id, work_order_id, unit_type, approved_quantity, rate_code_id
        FROM production_records
        WHERE tenant_id = $1
          AND status = 'billable'
          AND deleted_at IS NULL
          AND rate_code_id IS NULL
        ORDER BY created_at DESC
        `,
        [tenantId],
      )
      .then((result) => result.rows);
  }

  private missingSettlementLinks(client: PoolClient, tenantId: string) {
    return client
      .query(
        `
        SELECT pr.id, pr.project_id, pr.work_order_id, pr.unit_type, pr.approved_quantity, pr.rate_code_id
        FROM production_records pr
        LEFT JOIN settlement_items si ON si.tenant_id = pr.tenant_id
          AND si.production_record_id = pr.id
          AND si.status <> 'archived'
          AND si.deleted_at IS NULL
        WHERE pr.tenant_id = $1
          AND pr.status = 'billable'
          AND pr.deleted_at IS NULL
          AND si.id IS NULL
        ORDER BY pr.created_at DESC
        `,
        [tenantId],
      )
      .then((result) => result.rows);
  }

  private missingInvoiceLinks(client: PoolClient, tenantId: string) {
    return client
      .query(
        `
        SELECT s.id, s.contract_id, s.customer_organization_id, s.net_amount, s.status
        FROM settlements s
        LEFT JOIN invoices i ON i.tenant_id = s.tenant_id
          AND i.settlement_id = s.id
          AND i.status <> 'archived'
          AND i.deleted_at IS NULL
        WHERE s.tenant_id = $1
          AND s.status = 'approved'
          AND s.deleted_at IS NULL
          AND i.id IS NULL
        ORDER BY s.created_at DESC
        `,
        [tenantId],
      )
      .then((result) => result.rows);
  }

  private openConstraints(client: PoolClient, tenantId: string) {
    return client
      .query(
        `
        SELECT id, constraint_type, affected_object_type, affected_object_id, title, owner_id, due_date, severity, status, created_at
        FROM constraints
        WHERE tenant_id = $1
          AND status IN ('detected', 'open', 'assigned', 'in_progress', 'blocked')
          AND deleted_at IS NULL
        ORDER BY
          CASE severity
            WHEN 'critical' THEN 1
            WHEN 'high' THEN 2
            WHEN 'medium' THEN 3
            ELSE 4
          END,
          due_date NULLS LAST,
          created_at DESC
        LIMIT 100
        `,
        [tenantId],
      )
      .then((result) => result.rows);
  }

  private groupConstraints(client: PoolClient, tenantId: string, column: "constraint_type" | "severity" | "owner_id") {
    return client
      .query(
        `
        SELECT coalesce(${column}::text, 'unassigned') AS label, count(*)::numeric AS value
        FROM constraints
        WHERE tenant_id = $1
          AND status IN ('detected', 'open', 'assigned', 'in_progress', 'blocked')
          AND deleted_at IS NULL
        GROUP BY label
        ORDER BY label
        `,
        [tenantId],
      )
      .then((result) => result.rows.map((row) => ({ label: row.label, value: Number(row.value) })));
  }

  private async withClient<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      return await callback(client);
    } finally {
      client.release();
    }
  }
}
