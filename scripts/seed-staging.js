const { spawnSync } = require("node:child_process");

function main() {
  if (process.env.NODE_ENV !== "staging") throw new Error("NODE_ENV=staging is required for seed:staging");
  if (process.env.STAGING_SYNTHETIC_SEED_CONFIRM !== "true") throw new Error("STAGING_SYNTHETIC_SEED_CONFIRM=true is required");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  process.env.SYNCOS_SEED_LABEL = "STAGING";
  const result = spawnSync("npm", ["run", "seed:e2e-demo"], { stdio: "inherit", env: process.env });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

main();
