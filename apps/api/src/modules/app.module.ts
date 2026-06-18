import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { HealthController } from "../routes/health.controller";
import { SecurityTestController } from "../routes/security-test.controller";
import { TestObjectsController } from "../routes/test-objects.controller";
import { AuthenticatedGuard } from "../security/authenticated.guard";
import { PermissionGuard } from "../security/permission.guard";
import { TenantIsolationGuard } from "../security/tenant-isolation.guard";
import { DatabaseModule } from "./database.module";

@Module({
  imports: [DatabaseModule],
  controllers: [HealthController, SecurityTestController, TestObjectsController],
  providers: [
    { provide: APP_GUARD, useClass: AuthenticatedGuard },
    { provide: APP_GUARD, useClass: TenantIsolationGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
})
export class AppModule {}
