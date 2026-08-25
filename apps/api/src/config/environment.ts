export type EnvironmentValidationResult = {
  ok: boolean;
  nodeEnv: string;
  errors: string[];
  warnings: string[];
};

const authJwtSecretMinLength = 32;

const allowedNodeEnvs = new Set(["development", "test", "staging", "production"]);
const productionEmailProviders = new Set(["generic_http", "smtp_relay", "disabled"]);
const hostedNodeEnvs = new Set(["staging", "production"]);

function csv(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function requireHttpsUrl(errors: string[], name: string, value: string | undefined, environmentName = "production") {
  if (!value) {
    errors.push(`${name} is required in ${environmentName}`);
    return;
  }
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") errors.push(`${name} must use https in ${environmentName}`);
  } catch {
    errors.push(`${name} must be a valid URL`);
  }
}

function requireSyncDomainEmail(errors: string[], name: string, value: string | undefined) {
  if (!value) {
    errors.push(`${name} is required when EMAIL_PROVIDER=smtp_relay`);
    return;
  }
  const trimmed = value.trim().toLowerCase();
  const match = trimmed.match(/<([^<>@\s]+@[^<>@\s]+)>$/);
  const email = match ? match[1] : trimmed;
  if (!/^[^@\s<>]+@[^@\s<>]+$/.test(email)) errors.push(`${name} must be a configured email address`);
  else if (!email.endsWith("@synccommsystems.com")) errors.push(`${name} must use a synccommsystems.com sender domain`);
}

function requireBoolean(errors: string[], name: string, value: string | undefined) {
  if (value !== undefined && value !== "true" && value !== "false") errors.push(`${name} must be true or false`);
}

function requireSmtpPort(errors: string[], value: string | undefined) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) errors.push("SMTP_PORT must be an integer from 1 to 65535 when EMAIL_PROVIDER=smtp_relay");
}

export function validateEnvironment(env: NodeJS.ProcessEnv = process.env): EnvironmentValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const nodeEnv = env.NODE_ENV || "development";
  if (!allowedNodeEnvs.has(nodeEnv)) errors.push("NODE_ENV must be one of development, test, staging, production");
  if (!env.DATABASE_URL) errors.push("DATABASE_URL is required");
  if (!env.AUTH_JWT_SECRET) errors.push("AUTH_JWT_SECRET is required");
  if (env.AUTH_JWT_SECRET && env.AUTH_JWT_SECRET.length < authJwtSecretMinLength) errors.push(`AUTH_JWT_SECRET must be at least ${authJwtSecretMinLength} characters`);
  if (hostedNodeEnvs.has(nodeEnv)) {
    const environmentName = nodeEnv;
    requireHttpsUrl(errors, "API_BASE_URL", env.API_BASE_URL ?? env.PUBLIC_API_URL, environmentName);
    requireHttpsUrl(errors, "APPLICATION_BASE_URL", env.APPLICATION_BASE_URL, environmentName);
    requireHttpsUrl(errors, "WEB_BASE_URL", env.WEB_BASE_URL, environmentName);
    if (!env.PUBLIC_PARTNER_INQUIRY_TENANT_ID) errors.push(`PUBLIC_PARTNER_INQUIRY_TENANT_ID is required in ${environmentName}`);
    if (!env.SYNCOS_ALLOWED_ORIGINS) errors.push(`SYNCOS_ALLOWED_ORIGINS is required in ${environmentName}`);
    for (const origin of csv(env.SYNCOS_ALLOWED_ORIGINS)) {
      if (origin === "*" || origin.includes("*")) errors.push(`SYNCOS_ALLOWED_ORIGINS may not contain wildcards in ${environmentName}`);
      else requireHttpsUrl(errors, "SYNCOS_ALLOWED_ORIGINS entry", origin, environmentName);
    }
    if (!env.REDIS_URL) errors.push(`REDIS_URL is required in ${environmentName} for worker connectivity`);
    if (env.DATABASE_URL && !/(sslmode=require|ssl=true)/i.test(env.DATABASE_URL)) warnings.push(`DATABASE_URL should require SSL in ${environmentName}`);
    const emailProvider = env.EMAIL_PROVIDER ?? "local_test";
    if (!productionEmailProviders.has(emailProvider)) errors.push(`EMAIL_PROVIDER must be generic_http, smtp_relay, or disabled in ${environmentName}`);
    if (emailProvider === "generic_http") {
      requireHttpsUrl(errors, "EMAIL_HTTP_ENDPOINT", env.EMAIL_HTTP_ENDPOINT, environmentName);
      if (!env.EMAIL_API_KEY) errors.push("EMAIL_API_KEY is required when EMAIL_PROVIDER=generic_http");
      if (!env.EMAIL_FROM) errors.push("EMAIL_FROM is required when EMAIL_PROVIDER=generic_http");
      if (nodeEnv === "staging" && !env.STAGING_EMAIL_RECIPIENT_ALLOWLIST) errors.push("STAGING_EMAIL_RECIPIENT_ALLOWLIST is required in staging when EMAIL_PROVIDER=generic_http");
    }
    if (emailProvider === "smtp_relay") {
      requireSyncDomainEmail(errors, "EMAIL_FROM", env.EMAIL_FROM);
      if (env.EMAIL_REPLY_TO) requireSyncDomainEmail(errors, "EMAIL_REPLY_TO", env.EMAIL_REPLY_TO);
      if (!env.SMTP_HOST) errors.push("SMTP_HOST is required when EMAIL_PROVIDER=smtp_relay");
      requireSmtpPort(errors, env.SMTP_PORT);
      requireBoolean(errors, "SMTP_SECURE", env.SMTP_SECURE);
      requireBoolean(errors, "SMTP_REQUIRE_TLS", env.SMTP_REQUIRE_TLS);
      if (env.SMTP_REQUIRE_TLS !== "true") errors.push("SMTP_REQUIRE_TLS=true is required when EMAIL_PROVIDER=smtp_relay");
      if (Boolean(env.SMTP_USERNAME) !== Boolean(env.SMTP_PASSWORD)) errors.push("SMTP_USERNAME and SMTP_PASSWORD must either both be set or both be empty when EMAIL_PROVIDER=smtp_relay");
      if (nodeEnv === "staging" && !env.STAGING_EMAIL_RECIPIENT_ALLOWLIST) errors.push("STAGING_EMAIL_RECIPIENT_ALLOWLIST is required in staging when EMAIL_PROVIDER=smtp_relay");
    }
    if (nodeEnv === "production" && env.STAGING_EMAIL_RECIPIENT_ALLOWLIST) errors.push("STAGING_EMAIL_RECIPIENT_ALLOWLIST must not be set in production");
    if (env.EMAIL_PROVIDER === "disabled") warnings.push(`Outbound invitation email is disabled in ${environmentName} until a provider is configured`);
    if (env.LIVE_AUTOMATED_PARTNER_PAYMENTS !== "false") errors.push("LIVE_AUTOMATED_PARTNER_PAYMENTS=false is required until live payout provider certification");
  } else {
    if (!env.REDIS_URL) warnings.push("REDIS_URL is not set; Redis startup readiness is skipped outside production");
  }
  return { ok: errors.length === 0, nodeEnv, errors, warnings };
}

export function assertValidEnvironment(env: NodeJS.ProcessEnv = process.env): EnvironmentValidationResult {
  const result = validateEnvironment(env);
  if (!result.ok) {
    throw new Error(`Invalid SyncOS environment: ${result.errors.join("; ")}`);
  }
  return result;
}
