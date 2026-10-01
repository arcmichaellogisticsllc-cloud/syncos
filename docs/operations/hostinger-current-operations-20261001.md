# Current Hostinger operations reference

Read alongside `docs/deployment/security-pilot-release.md`. Historical generic deployment documents may describe proposed cloud services or old release hashes; they are not instructions to replace the active staging layout.

## Observed October 1, 2026

- Host: `srv1818105.hstgr.cloud`; staging current release `/opt/syncos/staging/releases/f60c466` (84 migrations).
- Service units: `syncos-staging-api`, `syncos-staging-web`, `syncos-staging-worker`. All active at inspection. Legacy units are not the deployment target.
- API/web listen on loopback 3237/3238 behind HTTPS. Startup health confirms database, Redis, manifest and required permissions/roles.
- Database and private-file backup timers are active. Last service results: success, exit 0. Local retention is seven; an independent backup destination is not configured.
- The previous coordinated backup/restore rehearsal is documented in `docs/acceptance/pilot-closure-20261001.md`. Same-server restore is not independent disaster recovery.
- Application credentials stay on the server. Do not print environment files, export JWT/database credentials to a workstation or store them with logs.

## Before any new activation

1. Record exact candidate commit, passing evidence and full migration manifest. Do not confuse a tested local candidate with the active deployment.
2. Confirm target services, database and private-file paths without exposing secrets. Inventory record counts/provenance and preserve shared demo data.
3. Make a fresh coordinated database/private-file backup, verify checksums, rehearse candidate migrations on an isolated restored database under the application role, and compare preserved records.
4. Define code-plus-schema recovery using that coordinated pair. Do not assume an old binary can use a newer schema.
5. Activate only the approved candidate; verify HTTPS, authentication/permissions, migration ceiling, private files, services and disabled payment automation.
6. Recheck scheduled backups, capture sanitized evidence and update this release pointer.

## Open operational acceptance

- Assign named release, incident, recovery and business acceptance owners.
- Configure an approved independent encrypted backup destination with least-privilege credentials and documented retention. Test upload failures and monitoring; a timer alone is not an alerting system.
- Retrieve backups without the source VPS, provision an independent target, restore DB/files, verify source links/private access, and measure actual recovery time and data loss window.
- Establish the recipient/channel and escalation policy for failed health/backup checks. Test a failure alert and acknowledgment before calling monitoring operational.
- Define an approved maintenance/restart window after workload and recovery review. A system restart notice alone does not authorize an immediate reboot.

No real customer communication or payment is performed by this runbook. Current operational ownership, independent recovery and supervised crew acceptance remain release gates.
