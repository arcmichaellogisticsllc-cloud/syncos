import { Module } from "@nestjs/common";
import { HealthController } from "../routes/health.controller";
import { SecurityTestController } from "../routes/security-test.controller";
import { TestObjectsController } from "../routes/test-objects.controller";
import { DatabaseModule } from "./database.module";

@Module({
  imports: [DatabaseModule],
  controllers: [HealthController, SecurityTestController, TestObjectsController],
})
export class AppModule {}
