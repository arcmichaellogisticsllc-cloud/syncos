import { Global, Module } from "@nestjs/common";
import { Pool } from "pg";

export const DATABASE_POOL = Symbol("DATABASE_POOL");

@Global()
@Module({
  providers: [
    {
      provide: DATABASE_POOL,
      useFactory: () => {
        const connectionString = process.env.DATABASE_URL;
        if (!connectionString) {
          throw new Error("DATABASE_URL is required");
        }
        const hosted = process.env.NODE_ENV === "production" || process.env.NODE_ENV === "staging";
        const max = Number(process.env.DB_POOL_MAX ?? (hosted ? 10 : 5));
        return new Pool({
          connectionString,
          max,
          ssl: hosted ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== "false" } : undefined,
        });
      },
    },
  ],
  exports: [DATABASE_POOL],
})
export class DatabaseModule {}
