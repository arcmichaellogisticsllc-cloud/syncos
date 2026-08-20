const allowedNodeEnvs = new Set(["development", "test", "production"]);
const productionEmailProviders = new Set(["generic_http", "disabled"]);

function csv(value) {
  return (value || "").split(",").map((entry) => entry.trim()).filter(Boolean);
}

function requireHttpsUrl(errors, name, value) {
  if (!value) {
    errors.push(`${name} is required in production`);
    return;
  }
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") errors.push(`${name} must use https in production`);
  } catch {
    errors.push(`${name} must be a valid URL`);
  }
}

function validateEnvironment(env = process.env) {
  const errors = [];
  const warnings = [];
  const nodeEnv = env.NODE_ENV || "development";
  if (!allowedNodeEnvs.has(nodeEnv)) errors.push("NODE_ENV must be one of development, test, production");
  if (!env.DATABASE_URL) errors.push("DATABASE_URL is required");
  if (!env.AUTH_JWT_SECRET) errors.push("AUTH_JWT_SECRET is required");
  if (env.AUTH_JWT_SECRET && env.AUTH_JWT_SECRET.length < 16) errors.push("AUTH_JWT_SECRET must be at least 16 characters");
  if (nodeEnv === "production") {
    requireHttpsUrl(errors, "API_BASE_URL", env.API_BASE_URL || env.PUBLIC_API_URL);
    requireHttpsUrl(errors, "APPLICATION_BASE_URL", env.APPLICATION_BASE_URL);
    requireHttpsUrl(errors, "WEB_BASE_URL", env.WEB_BASE_URL);
    if (!env.PUBLIC_PARTNER_INQUIRY_TENANT_ID) errors.push("PUBLIC_PARTNER_INQUIRY_TENANT_ID is required in production");
    if (!env.SYNCOS_ALLOWED_ORIGINS) errors.push("SYNCOS_ALLOWED_ORIGINS is required in production");
    for (const origin of csv(env.SYNCOS_ALLOWED_ORIGINS)) {
      if (origin === "*" || origin.includes("*")) errors.push("SYNCOS_ALLOWED_ORIGINS may not contain wildcards in production");
      else requireHttpsUrl(errors, "SYNCOS_ALLOWED_ORIGINS entry", origin);
    }
    if (!env.REDIS_URL) errors.push("REDIS_URL is required in production for worker connectivity");
    if (env.DATABASE_URL && !/(sslmode=require|ssl=true)/i.test(env.DATABASE_URL)) warnings.push("DATABASE_URL should require SSL in production");
    const emailProvider = env.EMAIL_PROVIDER || "local_test";
    if (!productionEmailProviders.has(emailProvider)) errors.push("EMAIL_PROVIDER must be generic_http or disabled in production");
    if (emailProvider === "generic_http") {
      requireHttpsUrl(errors, "EMAIL_HTTP_ENDPOINT", env.EMAIL_HTTP_ENDPOINT);
      if (!env.EMAIL_API_KEY) errors.push("EMAIL_API_KEY is required when EMAIL_PROVIDER=generic_http");
      if (!env.EMAIL_FROM) errors.push("EMAIL_FROM is required when EMAIL_PROVIDER=generic_http");
    }
    if (env.EMAIL_PROVIDER === "disabled") warnings.push("Outbound invitation email is disabled in production until a provider is configured");
    if (env.LIVE_AUTOMATED_PARTNER_PAYMENTS !== "false") errors.push("LIVE_AUTOMATED_PARTNER_PAYMENTS=false is required until live payout provider certification");
  } else if (!env.REDIS_URL) {
    warnings.push("REDIS_URL is not set; Redis startup readiness is skipped outside production");
  }
  return { ok: errors.length === 0, nodeEnv, errors, warnings };
}

if (require.main === module) {
  const result = validateEnvironment();
  if (!result.ok) {
    console.error(JSON.stringify(result, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify(result, null, 2));
}

module.exports = { validateEnvironment };
