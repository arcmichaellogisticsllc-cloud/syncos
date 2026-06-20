import { Controller, Get, Inject } from "@nestjs/common";
import net from "node:net";
import type { Pool } from "pg";
import { validateEnvironment } from "../config/environment";
import { DATABASE_POOL } from "../modules/database.module";
import { Public } from "../security/public.decorator";

@Public()
@Controller("health")
export class HealthController {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  @Get()
  health() {
    return { ok: true, service: "syncos-api" };
  }

  @Get("db")
  async databaseHealth() {
    const result = await this.pool.query<{ ok: number }>("SELECT 1 AS ok");
    return { ok: result.rows[0]?.ok === 1 };
  }

  @Get("startup")
  async startupHealth() {
    const environment = validateEnvironment();
    const database = await this.checkDatabase();
    const migrations = await this.checkMigrations();
    const requiredTables = await this.checkRequiredTables();
    const permissionSeed = await this.checkPermissionSeed();
    const requiredRoles = await this.checkRequiredRoles();
    const redis = await this.checkRedis();
    const ok = environment.ok && database.ok && migrations.ok && requiredTables.ok && permissionSeed.ok && requiredRoles.ok && redis.ok;
    return { ok, environment, database, migrations, requiredTables, redis, permissionSeed, requiredRoles };
  }

  private async checkDatabase() {
    try {
      const result = await this.pool.query<{ ok: number }>("SELECT 1 AS ok");
      return { ok: result.rows[0]?.ok === 1 };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private async checkMigrations() {
    const expected = [
      "001_tenants_users_roles_permissions.sql",
      "002_territories_organizations.sql",
      "003_contacts_relationships.sql",
      "004_signals_evidence.sql",
      "005_relationship_maps_paths.sql",
      "006_opportunity_candidates_opportunities.sql",
      "007_capacity_providers_crews_workers_equipment.sql",
      "008_compliance_documents_capacity_records.sql",
      "009_projects_work_orders_production.sql",
      "010_contracts_rates_settlements_invoices_payments.sql",
      "011_constraints_recommendations.sql",
      "012_events_actions_approvals_audit.sql",
      "013_workflows_tasks_escalations.sql",
      "014_kpis_learning.sql",
      "015_files_file_links.sql",
      "016_tenant_fk_hardening.sql",
      "017_intelligence_signal_contract_hardening.sql",
      "018_organization_contract_hardening.sql",
      "019_contact_contract_hardening.sql",
      "020_relationship_contract_hardening.sql",
      "021_opportunity_candidate_contract_hardening.sql",
      "022_opportunity_pipeline_contract_hardening.sql",
    ];
    const result = await this.pool.query<{ id: string }>("SELECT id FROM schema_migrations ORDER BY id");
    const applied = result.rows.map((row) => row.id);
    const missing = expected.filter((id) => !applied.includes(id));
    return { ok: missing.length === 0 && applied.join("|") === [...applied].sort().join("|"), appliedCount: applied.length, missing };
  }

  private async checkRequiredTables() {
    const tables = ["tenants", "users", "roles", "permissions", "events", "event_payloads", "audit_logs", "system_actions", "learning_events", "learning_scores", "score_history"];
    const result = await this.pool.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1)",
      [tables],
    );
    const found = new Set(result.rows.map((row) => row.table_name));
    const missing = tables.filter((table) => !found.has(table));
    return { ok: missing.length === 0, missing };
  }

  private async checkPermissionSeed() {
    const required = ["admin.manage_users", "admin.manage_roles", "learning_score.recalculate", "dashboard.executive.read"];
    const result = await this.pool.query<{ key: string }>("SELECT key FROM permissions WHERE key = ANY($1)", [required]);
    const found = new Set(result.rows.map((row) => row.key));
    const missing = required.filter((key) => !found.has(key));
    return { ok: missing.length === 0, missing };
  }

  private async checkRequiredRoles() {
    const required = ["Executive", "System Admin", "Operations Manager", "Finance Manager"];
    const result = await this.pool.query<{ name: string }>("SELECT DISTINCT name FROM roles WHERE name = ANY($1)", [required]);
    const found = new Set(result.rows.map((row) => row.name));
    const missing = required.filter((name) => !found.has(name));
    return { ok: missing.length === 0, missing };
  }

  private async checkRedis() {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl && process.env.NODE_ENV !== "production") {
      return { ok: true, configured: false, skipped: true };
    }
    if (!redisUrl) return { ok: false, configured: false, error: "REDIS_URL is required in production" };
    return this.pingTcp(redisUrl);
  }

  private async pingTcp(value: string) {
    const url = new URL(value);
    const port = Number(url.port || 6379);
    return new Promise<{ ok: boolean; configured: true; host: string; port: number; error?: string }>((resolve) => {
      const socket = net.createConnection({ host: url.hostname, port, timeout: 1000 });
      socket.once("connect", () => {
        socket.end();
        resolve({ ok: true, configured: true, host: url.hostname, port });
      });
      socket.once("timeout", () => {
        socket.destroy();
        resolve({ ok: false, configured: true, host: url.hostname, port, error: "timeout" });
      });
      socket.once("error", (error) => resolve({ ok: false, configured: true, host: url.hostname, port, error: error.message }));
    });
  }
}
