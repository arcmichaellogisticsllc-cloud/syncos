import { Controller, Get, Inject } from "@nestjs/common";
import type { Pool } from "pg";
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
}
