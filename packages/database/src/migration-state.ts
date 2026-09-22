import expectedMigrations from "./migration-manifest.json";

export const migrationManifest: readonly string[] = expectedMigrations;
export const currentMigrationCeiling = expectedMigrations[expectedMigrations.length - 1];

export function checkMigrationState(applied: string[]) {
  const missing = expectedMigrations.filter(id => !applied.includes(id));
  const unexpected = applied.filter(id => !expectedMigrations.includes(id));
  const hasCurrentCeiling = applied.includes(currentMigrationCeiling);
  return {
    ok: missing.length === 0 && unexpected.length === 0 && new Set(applied).size === applied.length,
    appliedCount: applied.length,
    missing,
    unexpected,
    currentCeiling: currentMigrationCeiling,
    hasCurrentCeiling,
  };
}
