import "reflect-metadata";
import { json } from "express";
import { NestFactory } from "@nestjs/core";
import { assertValidEnvironment } from "./config/environment";
import { AppModule } from "./modules/app.module";

async function bootstrap() {
  assertValidEnvironment();
  const app = await NestFactory.create(AppModule);
  // Scope the larger base64 body allowance to the bounded field-evidence upload.
  app.use("/syncfield/foreman/evidence", json({ limit: "28mb" }));
  // Private onboarding JSON carries base64 evidence; binary limits remain enforced per file.
  // Two-document policy/payment submissions need room for two 5 MB files after base64 expansion.
  app.use(/^\/partner-compliance\/me\/(payment-profile|insurance-policies)\/?$/, json({ limit: "14mb" }));
  app.use(/^\/partner-compliance\/me\/w9\/?$/, json({ limit: "7mb" }));
  app.use(/^\/partner-workforce\/me\/workers\/[^/]+\/credentials\/?$/, json({ limit: "7mb" }));
  app.use(/^\/partner-workforce\/me\/workers\/[^/]+\/headshots\/?$/, json({ limit: "3mb" }));
  app.use(/^\/invoice-packages\/invoices\/[^/]+\/documents\/?$/, json({ limit: "28mb" }));
  app.use(/^\/customer-inquiries\/[^/]+\/files\/?$/, json({ limit: "7mb" }));
  // Nest detects a registered jsonParser by name, even when scoped. Keep the
  // ordinary JSON parser explicit after the bounded upload exceptions.
  app.use(json({ limit: "100kb" }));
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
  await app.listen(port, process.env.HOST ?? "127.0.0.1");
}

void bootstrap();
