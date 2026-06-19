import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { HealthController } from "../routes/health.controller";
import { ContactsController } from "../routes/contacts.controller";
import { OpportunityCandidatesController } from "../routes/opportunity-candidates.controller";
import { OrganizationsController } from "../routes/organizations.controller";
import { RelationshipMapsController } from "../routes/relationship-maps.controller";
import { SearchController } from "../routes/search.controller";
import { SecurityTestController } from "../routes/security-test.controller";
import { SignalsController } from "../routes/signals.controller";
import { TestObjectsController } from "../routes/test-objects.controller";
import { TerritoriesController } from "../routes/territories.controller";
import { AuthenticatedGuard } from "../security/authenticated.guard";
import { PermissionGuard } from "../security/permission.guard";
import { TenantIsolationGuard } from "../security/tenant-isolation.guard";
import { DatabaseModule } from "./database.module";

@Module({
  imports: [DatabaseModule],
  controllers: [
    HealthController,
    SecurityTestController,
    TestObjectsController,
    TerritoriesController,
    OrganizationsController,
    ContactsController,
    SignalsController,
    RelationshipMapsController,
    OpportunityCandidatesController,
    SearchController,
  ],
  providers: [
    { provide: APP_GUARD, useClass: AuthenticatedGuard },
    { provide: APP_GUARD, useClass: TenantIsolationGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
})
export class AppModule {}
