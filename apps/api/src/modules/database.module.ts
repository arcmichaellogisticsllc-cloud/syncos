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
        return new Pool({ connectionString });
      },
    },
  ],
  exports: [DATABASE_POOL],
})
export class DatabaseModule {}
