import { MiddlewareConsumer, Module, NestModule, RequestMethod } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { CorrelationMiddleware } from "../instrumentation/correlation.middleware";
import { AuthController } from "../routes/auth.controller";
import { CapacityController } from "../routes/capacity.controller";
import { CashController } from "../routes/cash.controller";
import { ConstraintsController } from "../routes/constraints.controller";
import { DashboardsController } from "../routes/dashboards.controller";
import { HealthController } from "../routes/health.controller";
import { ContactsController } from "../routes/contacts.controller";
import { KpisController } from "../routes/kpis.controller";
import { LearningController } from "../routes/learning.controller";
import { OpportunityCandidatesController } from "../routes/opportunity-candidates.controller";
import { OpportunitiesController } from "../routes/opportunities.controller";
import { OrganizationsController } from "../routes/organizations.controller";
import { ProductionController } from "../routes/production.controller";
import { RelationshipMapsController } from "../routes/relationship-maps.controller";
import { ReportsController } from "../routes/reports.controller";
import { SearchController } from "../routes/search.controller";
import { SecurityTestController } from "../routes/security-test.controller";
import { SettlementsController } from "../routes/settlements.controller";
import { SignalsController } from "../routes/signals.controller";
import { TestObjectsController } from "../routes/test-objects.controller";
import { TerritoriesController } from "../routes/territories.controller";
import { WorkflowsController } from "../routes/workflows.controller";
import { AuthenticatedGuard } from "../security/authenticated.guard";
import { PermissionGuard } from "../security/permission.guard";
import { TenantIsolationGuard } from "../security/tenant-isolation.guard";
import { DatabaseModule } from "./database.module";

@Module({
  imports: [DatabaseModule],
  controllers: [
    HealthController,
    AuthController,
    SecurityTestController,
    TestObjectsController,
    TerritoriesController,
    OrganizationsController,
    ContactsController,
    SignalsController,
    RelationshipMapsController,
    OpportunityCandidatesController,
    OpportunitiesController,
    CapacityController,
    ProductionController,
    SettlementsController,
    CashController,
    ConstraintsController,
    DashboardsController,
    WorkflowsController,
    KpisController,
    LearningController,
    ReportsController,
    SearchController,
  ],
  providers: [
    { provide: APP_GUARD, useClass: AuthenticatedGuard },
    { provide: APP_GUARD, useClass: TenantIsolationGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationMiddleware).forRoutes({ path: "*", method: RequestMethod.ALL });
  }
}
