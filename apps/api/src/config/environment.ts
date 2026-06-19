export type EnvironmentValidationResult = {
  ok: boolean;
  nodeEnv: string;
  errors: string[];
  warnings: string[];
};

const allowedNodeEnvs = new Set(["development", "test", "production"]);

export function validateEnvironment(env: NodeJS.ProcessEnv = process.env): EnvironmentValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const nodeEnv = env.NODE_ENV || "development";
  if (!allowedNodeEnvs.has(nodeEnv)) errors.push("NODE_ENV must be one of development, test, production");
  if (!env.DATABASE_URL) errors.push("DATABASE_URL is required");
  if (!env.AUTH_JWT_SECRET) errors.push("AUTH_JWT_SECRET is required");
  if (env.AUTH_JWT_SECRET && env.AUTH_JWT_SECRET.length < 16) errors.push("AUTH_JWT_SECRET must be at least 16 characters");
  if (nodeEnv === "production") {
    if (!env.API_BASE_URL && !env.PUBLIC_API_URL) errors.push("API_BASE_URL or PUBLIC_API_URL is required in production");
    if (!env.REDIS_URL) errors.push("REDIS_URL is required in production for worker connectivity");
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
