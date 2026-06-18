import { Module } from "@nestjs/common";
import { HealthController } from "../routes/health.controller";
import { TestObjectsController } from "../routes/test-objects.controller";
import { DatabaseModule } from "./database.module";

@Module({
  imports: [DatabaseModule],
  controllers: [HealthController, TestObjectsController],
})
export class AppModule {}
