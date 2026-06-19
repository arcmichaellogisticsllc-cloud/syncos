import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { assertValidEnvironment } from "./config/environment";
import { AppModule } from "./modules/app.module";

async function bootstrap() {
  assertValidEnvironment();
  const app = await NestFactory.create(AppModule);
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}

void bootstrap();
