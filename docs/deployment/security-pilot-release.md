# Security release preparation — September 22, 2026

## Scope

This release updates the field-readiness candidate for known dependency vulnerabilities and accurate deployment verification. It preserves the agreed pilot scope: Sync employee crews and external partner crews; customer QC controls billing; externally completed payments are recorded with proof; automated payment execution remains disabled.

## Dependencies and compatibility

- Next.js 15.5.26 maintenance release replaces unsupported 14.2.35. React and React DOM move together to 19.3.0. Dynamic page parameters, optional search parameters and API proxy parameters are awaited under the new framework contract.
- Nest common/core/Express adapter move together to 11.2.5. The correlation middleware uses the named catch-all route syntax supported by Express 5. Nest CLI 11.0.24 supports the server's Node 20 runtime.
- Nodemailer moved to 9.1 in the original release; the September 29 pre-payment candidate updates it to 10.0.12 after a new advisory. See the candidate acceptance report and current audit.
- Root overrides require patched compatible lines for Multer 2.4, PostCSS 8.5.28, Nano ID 3.3.19, and qs 6.16. These overrides must stay until upstream packages declare safe versions themselves. Do not force a major-version audit fix without checking compatibility.
- The lockfile was regenerated from a clean workspace dependency tree; it is the reproducible installation source for npm ci.

Sources: [Next.js security release](https://nextjs.org/blog/august-2026-security-release), [Next.js 15 migration](https://nextjs.org/docs/app/guides/upgrading/version-15), [Nest migration guide](https://docs.nestjs.com/migration-guide), [Nest SSE advisory](https://github.com/advisories/GHSA-36xv-jgw5-4q75). Exact dependency and audit results must be rechecked when deploying; a clean audit is not a guarantee against undiscovered vulnerabilities.

## Release gates

`packages/database/src/migration-manifest.json` lists every shipped migration. Unit tests require it to match the migration directory. API startup, staging migration verification and production migration verification use the shared checker. Missing intermediate migrations, unexpected migrations and duplicate entries fail verification, even when the last migration is present.

Staging migrations additionally require `STAGING_DB_BACKUP_CONFIRMED=true`; this is an operator assertion after verifying the backup, not an automated backup guarantee. The deployment script requires an explicit branch and SHA, runs the production dependency audit before migrations, checks startup JSON against the release manifest, and writes the deployment record only after API and web health pass.

`npm run release:validate` includes the production dependency audit gate. Full npm audit must also be recorded for this security release.

## Hostinger preparation

Verified active staging uses API 3237 and web 3238 on srv1818105. Generic 3137/3138 services belong to the legacy installation. Preserve that distinction; older runbooks list obsolete ports.

The active SyncOS domains are staging-app.synccommsystems.com and staging-api.synccommsystems.com. They already have HTTPS. Do not redirect the public marketing site or point staging to the legacy ports.

Before cutover:

1. Record current SHA and get fresh successful database/private-file backups.
2. Confirm backup recovery evidence and sufficient disk space.
3. Install/build the exact committed candidate in its own release directory. Require a clean audit and completed functional verification.
4. Rehearse the actual staging upgrade in a disposable restored database under the application database role.
5. Keep application settings on the server, keep persistent private storage, and explicitly bind the API to 127.0.0.1. Do not place secrets in Git or build artifacts.
6. After authorized activation, verify every migration in the candidate manifest, role/permission readiness, login, worker health and private-file access.
7. Rehearse both workforce types with synthetic data before introducing real crew pilot records.

## Backup wrapper

The Hostinger backup failure was caused by scripts rereading a root-only settings file after systemd had already loaded it. `scripts/run-staging-backup.sh postgres|files` uses the inherited settings and looks up the release metadata. Configure backup units with their existing EnvironmentFile entries, User/Group=syncos and UMask=0077, then invoke this wrapper through bash. Preserve api.env permissions. Do not make credentials broadly readable to resolve a backup startup failure.

Daily local application backups do not provide daily total-server-loss recovery while off-server VPS backups remain weekly. The crew pilot still needs named crew leads, a selected customer/work order, actual evidence and maps, device testing, and operational alert/backup ownership.

## Validation record

Results are recorded in the accompanying release handoff once the checks finish. This document itself is not deployment approval or evidence of a completed live crew pilot.
