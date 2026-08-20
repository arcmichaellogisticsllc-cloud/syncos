import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { assertValidEnvironment } from "./config/environment";
import { AppModule } from "./modules/app.module";

async function bootstrap() {
  assertValidEnvironment();
  const app = await NestFactory.create(AppModule);
  const allowedOrigins = (process.env.SYNCOS_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (allowedOrigins.length > 0) {
    app.enableCors({
      origin: allowedOrigins,
      credentials: true,
      methods: ["GET", "POST", "PATCH", "OPTIONS"],
      allowedHeaders: ["authorization", "content-type", "x-request-id"],
    });
  }
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}

void bootstrap();
