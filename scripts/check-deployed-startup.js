const { migrationManifest, currentMigrationCeiling } = require('@syncos/database');

function isReleaseHealthy(health) {
  const m = health?.migrations;
  return health?.ok === true && m?.ok === true && m.hasCurrentCeiling === true &&
    m.currentCeiling === currentMigrationCeiling && m.appliedCount === migrationManifest.length &&
    Array.isArray(m.missing) && m.missing.length === 0 &&
    Array.isArray(m.unexpected) && m.unexpected.length === 0;
}

async function main() {
  const url = process.argv[2];
  if (!url) throw new Error('Startup health URL is required');
  for (let attempt = 0; attempt < 15; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (response.ok && isReleaseHealthy(await response.json())) {
        console.log(`Startup verified through ${currentMigrationCeiling}`);
        return;
      }
    } catch { /* Retry transient startup errors without exposing response details. */ }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('Deployed API did not pass the exact release startup checks');
}
module.exports = { isReleaseHealthy };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
