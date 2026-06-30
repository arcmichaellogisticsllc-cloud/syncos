# Rollback Runbook

## Purpose

This runbook defines how to respond when a SyncOS release fails during or after deployment.

Rollback is not a single command. Application artifacts are usually reversible. Database migrations may not be. Every rollback decision must identify whether the failure is in the web service, API service, worker service, database migration, configuration, infrastructure, or data state.

## Rollback Principles

- Protect production data first.
- Stop new damage before restoring convenience.
- Prefer app rollback for app-only failures.
- Treat database rollback as high risk unless the migration has a rehearsed rollback.
- Use forward-fix only when rollback is riskier and owners explicitly approve it.
- Preserve logs and artifacts before restarting or redeploying over evidence.
- Do not run E2E demo seed against production.
- Do not weaken certification to escape a failed release.

## Roles During Rollback

| Role | Responsibility |
|---|---|
| Incident commander | Coordinates decision-making and communication. |
| Release manager | Owns release timeline and rollback execution checklist. |
| Application engineer | Diagnoses API, web, and worker failures. |
| Database owner | Owns migration, backup, restore, and data integrity decisions. |
| Operations owner | Owns infrastructure, logs, alerts, and service status. |
| Security owner | Reviews auth, secrets, tenant isolation, and audit exposure failures. |
| Product owner | Decides user-facing acceptance where business impact exists. |

Production rollback should not proceed without a database owner if database state may be affected.

## Failure Classification

### App-Only Failure

Examples:

- Web route renders incorrectly.
- API process crashes after deploy but migrations are healthy.
- Worker process fails to start.
- Misconfigured API base URL.
- Static asset issue.

Preferred response:

- Roll back the failing service artifact to the previous known-good version.
- Keep database at current migrated version unless proven incompatible.

### Configuration Failure

Examples:

- Missing environment variable.
- Wrong API URL.
- Wrong database URL.
- Invalid secret.
- Incorrect port.

Preferred response:

- Correct configuration.
- Restart affected service.
- Do not redeploy code unless needed.
- Verify secrets were not exposed in logs.

### Migration Failure Before App Promotion

Examples:

- `db:migrate` fails.
- Migration times out.
- Migration locks critical tables.

Preferred response:

- Do not deploy new app version.
- Preserve migration logs.
- Assess partial migration state.
- Restore from backup only if the database owner confirms it is required.
- Otherwise repair with a controlled migration fix.

### Migration Failure After App Promotion

Examples:

- App was deployed against partially migrated schema.
- Runtime errors show schema mismatch.
- Data mutation occurred under new schema.

Preferred response:

- Stop or isolate affected app traffic.
- Engage database owner.
- Decide between app rollback, forward migration fix, or restore.
- Do not blindly roll back app if older app cannot run against new schema.

### Data Integrity Failure

Examples:

- Tenant isolation issue.
- Unauthorized mutation.
- Forbidden downstream creation.
- Accounting/bank/payment mutation outside contract.

Preferred response:

- Treat as critical incident.
- Stop affected writes.
- Preserve audit logs.
- Identify affected tenants and rows.
- Do not run cleanup scripts without database owner and product approval.
- Decide whether restore, compensating correction, or forward-fix is required.

### Security Failure

Examples:

- Secret exposed.
- Unauthorized audit access.
- Token leak.
- Permission bypass.

Preferred response:

- Stop affected service or route if possible.
- Rotate exposed secrets.
- Preserve logs.
- Identify access window.
- Notify security owner.
- Roll back or hotfix depending on blast radius.

## Rollback Decision Tree

1. Is production data at risk?
   - Yes: stop writes if possible and involve database owner.
   - No: continue.

2. Did migrations run?
   - No: app rollback is usually safe.
   - Yes: check whether previous app version is compatible with migrated schema.

3. Did any new writes occur after deployment?
   - No: app rollback is safer.
   - Yes: database owner must assess data compatibility.

4. Is the failure caused by configuration?
   - Yes: fix configuration and restart.
   - No: continue.

5. Is there a known-good previous artifact compatible with current database?
   - Yes: roll back service artifact.
   - No: forward-fix or restore decision required.

6. Is restore required?
   - Yes: execute restore plan with database owner.
   - No: execute service rollback or forward-fix.

## Immediate Response Checklist

Use this when a release is failing.

1. Announce rollback investigation.
2. Freeze further deploys.
3. Record current commit SHA.
4. Record previous known-good commit SHA.
5. Record migration status.
6. Record whether writes occurred after deploy.
7. Capture logs and artifacts.
8. Classify failure type.
9. Select rollback, config fix, forward-fix, or restore.
10. Get required owner approval.
11. Execute decision.
12. Verify health.
13. Record final state.

## App Rollback Procedure

Use this for app-only failures where the previous app version is compatible with the current database.

### 1. Identify Versions

Record:

- Current deployed commit.
- Previous known-good commit.
- API artifact version.
- Web artifact version.
- Worker artifact version.
- Database migration version.

### 2. Roll Back API

Deploy previous API artifact.

Verify:

```bash
curl -fsS <api-url>/health
```

Check:

- API logs.
- Database connection.
- Auth permission read.
- No startup exceptions.

### 3. Roll Back Worker

Deploy previous worker artifact.

Verify:

- Worker process is running.
- Worker logs show no startup error.
- Job failures are not increasing.

### 4. Roll Back Web

Deploy previous web artifact.

Verify:

```bash
curl -fsS -I <web-url>
```

Check:

- Browser can load the app.
- Web can reach API.
- No obvious 500s.

### 5. Post-Rollback Smoke

Run production-safe smoke checks:

- API health.
- DB health.
- Web root.
- Read-only route per critical domain.
- Auth permission read.

Do not run E2E demo seed.

## Configuration Fix Procedure

Use this when the code artifact is correct but runtime configuration is wrong.

1. Identify incorrect variable.
2. Confirm correct value with environment owner.
3. Update secret/config store.
4. Restart only affected service.
5. Verify health.
6. Confirm no secret was printed in logs.
7. Record the config change in release notes.

Common variables:

- `DATABASE_URL`
- `AUTH_JWT_SECRET`
- `PORT`
- `API_BASE_URL`
- `SYNCOS_API_BASE_URL`
- `WEB_BASE_URL`
- `NEXT_PUBLIC_API_BASE_URL`

## Database Restore Procedure

Use only when database owner approves restore.

### Preconditions

Required:

- Backup ID.
- Restore target.
- Expected data loss window.
- Product owner approval if user data may be lost.
- Security owner approval if incident involves unauthorized access.
- Communication plan.

### Steps

1. Stop writes or put app in maintenance mode if supported.
2. Record current database state.
3. Preserve logs and failed migration output.
4. Restore backup into isolated database first if time allows.
5. Validate restored database.
6. Promote restored database or restore production database according to provider procedure.
7. Deploy app artifact compatible with restored schema.
8. Run health checks.
9. Run production-safe smoke checks.
10. Record restore completion time and data loss window.

### Restore Verification

Minimum:

- API health passes.
- DB health passes.
- Critical read-only routes respond.
- Auth permissions work.
- No obvious tenant leakage.
- No migration loop on startup.

## Forward-Fix Procedure

Use only when rollback is riskier than a controlled fix.

Forward-fix requires:

- Incident commander approval.
- Database owner approval if schema/data is involved.
- Security owner approval if auth/audit/data exposure is involved.
- Product owner approval if user-facing behavior is affected.

Steps:

1. Define minimal fix.
2. Confirm no unrelated refactor.
3. Run targeted test.
4. Run required static check.
5. Build affected service.
6. Deploy fix.
7. Verify health.
8. Run production-safe smoke.
9. Schedule full release validation follow-up.

Forward-fix does not waive the need for later full certification.

## Failed E2E Release Gate Response

If `npm run e2e:ci:release` fails before production deployment:

- Do not deploy production.
- Inspect Playwright error context.
- Inspect API logs.
- Identify failure category:
  - Product bug.
  - Seed issue.
  - Selector ambiguity.
  - Environment readiness.
  - Real certification gap.
- Fix root cause.
- Rerun targeted test.
- Rerun full release gate.

Forbidden responses:

- Do not add `test.skip`.
- Do not add `test.only`.
- Do not add `.fixme`.
- Do not remove assertions.
- Do not set `forbiddenTables: []`.
- Do not claim certification without a passing full gate.

## Failed Release Validation Response

If `npm run release:validate` fails:

- Do not deploy production.
- Identify failing stage:
  - Certification status.
  - Typecheck.
  - Build.
  - Unit test.
  - Migration verification.
  - API startup.
  - Smoke test.
- Fix root cause.
- Recreate clean validation database if database state may have changed.
- Rerun full `release:validate`.

## Failed Health Check Response

### API Health Fails

Check:

- Process is running.
- Correct `PORT`.
- Correct `DATABASE_URL`.
- Database reachable.
- Migration state.
- Startup logs.
- Secret/config availability.

Response:

- If new artifact is faulty, roll back API.
- If config is faulty, fix config and restart API.
- If DB is faulty, involve database owner.

### Web Health Fails

Check:

- Web process is running.
- Correct `PORT`.
- Correct API base URL.
- API health.
- Build artifact.

Response:

- If new artifact is faulty, roll back web.
- If API dependency is faulty, fix API first.
- If config is faulty, fix config and restart web.

### Worker Health Fails

Check:

- Worker process is running.
- Correct `DATABASE_URL`.
- Worker logs.
- Job failure rate.

Response:

- If worker-only failure, roll back worker.
- If DB-related, involve database owner.
- If queue/integration-related, disable affected job only if product and operations approve.

## Communication Templates

### Rollback Started

```text
Rollback investigation started for SyncOS release <version> at <time>.
Current commit: <sha>.
Previous known-good commit: <sha>.
Observed failure: <summary>.
Writes after deploy: yes/no/unknown.
Next update by: <time>.
```

### Rollback Executed

```text
Rollback executed for SyncOS release <version> at <time>.
Rolled back services: API / web / worker / database.
Current running commit: <sha>.
Health status: <summary>.
Known residual risk: <summary>.
```

### Forward-Fix Executed

```text
Forward-fix deployed for SyncOS release <version> at <time>.
Fix commit: <sha>.
Reason rollback was not selected: <summary>.
Validation completed: <summary>.
Required follow-up: full release validation / incident review / data audit.
```

## Post-Incident Review

Required after rollback or forward-fix:

- Timeline.
- Root cause.
- Detection path.
- Impacted users or tenants.
- Impacted data.
- Why release gates did or did not catch it.
- What artifact/log showed the failure.
- What changed.
- Follow-up tests.
- Follow-up docs.
- Owner and due date.

## Rollback Evidence Template

| Item | Value |
|---|---|
| Incident start time |  |
| Release version |  |
| Failed commit |  |
| Previous known-good commit |  |
| Failure type | App / Config / Migration / Data / Security / Infra |
| Writes after deploy | Yes / No / Unknown |
| Database migration status | Not started / Complete / Partial / Failed |
| Decision | Rollback / Config fix / Restore / Forward-fix |
| Approvers |  |
| Services changed | API / Web / Worker / DB |
| Final commit in production |  |
| Health result | PASS / FAIL |
| Residual risk |  |
| Follow-up owner |  |

