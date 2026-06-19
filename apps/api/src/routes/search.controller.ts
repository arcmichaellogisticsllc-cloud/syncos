import { Controller, Get, Inject, Query, Req } from "@nestjs/common";
import type { Pool } from "pg";
import { DATABASE_POOL } from "../modules/database.module";
import { RequirePermission } from "../security/require-permission.decorator";
import type { AuthenticatedRequest } from "./intelligence.types";

@Controller("search")
export class SearchController {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  @Get()
  @RequirePermission("search.read")
  async search(@Req() request: AuthenticatedRequest, @Query("q") q?: string) {
    const query = typeof q === "string" ? q.trim() : "";
    if (!query) return [];
    const search = `%${query}%`;
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `
        SELECT 'territory' AS object_type, id, name AS title, status, name AS snippet
        FROM territories
        WHERE tenant_id = $1 AND deleted_at IS NULL AND (name ILIKE $2 OR code ILIKE $2)
        UNION ALL
        SELECT 'organization' AS object_type, id, name AS title, status, concat_ws(' ', name, type, source_name) AS snippet
        FROM organizations
        WHERE tenant_id = $1 AND deleted_at IS NULL AND (name ILIKE $2 OR type ILIKE $2 OR source_name ILIKE $2)
        UNION ALL
        SELECT 'contact' AS object_type, id, coalesce(full_name, concat_ws(' ', first_name, last_name)) AS title, status, concat_ws(' ', full_name, first_name, last_name, email, phone) AS snippet
        FROM contacts
        WHERE tenant_id = $1 AND deleted_at IS NULL AND (
          full_name ILIKE $2 OR first_name ILIKE $2 OR last_name ILIKE $2 OR email ILIKE $2 OR phone ILIKE $2
        )
        UNION ALL
        SELECT 'signal' AS object_type, id, title, status, concat_ws(' ', title, description, signal_type, signal_category, source_name) AS snippet
        FROM signals
        WHERE tenant_id = $1 AND deleted_at IS NULL AND (
          title ILIKE $2 OR description ILIKE $2 OR signal_type ILIKE $2 OR signal_category ILIKE $2 OR source_name ILIKE $2
        )
        UNION ALL
        SELECT 'relationship_map' AS object_type, id, name AS title, status, concat_ws(' ', name, status, root_entity_type, target_object_type) AS snippet
        FROM relationship_maps
        WHERE tenant_id = $1 AND deleted_at IS NULL AND (
          name ILIKE $2 OR status ILIKE $2 OR root_entity_type ILIKE $2 OR target_object_type ILIKE $2
        )
        UNION ALL
        SELECT 'opportunity_candidate' AS object_type, id, coalesce(name, title) AS title, status, concat_ws(' ', name, title, work_type, evidence_summary, status) AS snippet
        FROM opportunity_candidates
        WHERE tenant_id = $1 AND deleted_at IS NULL AND (
          name ILIKE $2 OR title ILIKE $2 OR work_type ILIKE $2 OR evidence_summary ILIKE $2 OR status ILIKE $2
        )
        LIMIT 50
        `,
        [request.auth.tenantId, search],
      );
      return result.rows;
    } finally {
      client.release();
    }
  }
}
