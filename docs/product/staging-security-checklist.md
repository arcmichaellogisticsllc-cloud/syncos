# Staging Security Checklist

| Area | Requirement | Status |
| --- | --- | --- |
| Secrets | No secrets committed; strong unique `AUTH_JWT_SECRET`; DB URL in provider secret manager. | PARTIAL |
| Auth | `ALLOW_DEV_HEADER_AUTH=false`; `NEXT_PUBLIC_ALLOW_DEV_SESSION_PANEL=false`; no bearer token UI. | REQUIRED |
| Access | Staging URL access policy, named admins, limited tester accounts, deactivation after UAT. | NOT STARTED |
| Database | Least-privilege DB user if possible; backups enabled; no production copy without approval. | NOT STARTED |
| App controls | Tenant isolation, permission, role-nav, and mutation-denied smoke checks. | PLANNED |
| Logging | Logs must not expose JWTs, passwords, DB URLs, or secrets. | REQUIRED |
| External integrations | Bank, payment, payroll, accounting, ERP, GL, tax, email, and automation integrations disabled/no-go. | REQUIRED |
| GitHub | Branch protection and Actions status checks recommended once Actions are available. | PARTIAL |
| UAT | Testers know staging is not production and must not attempt live financial activity. | REQUIRED |

## Staging Access Notes

- Use named users, not shared passwords, whenever possible.
- Keep System Admin users limited.
- Read-only auditor must remain available for verification.
- Disable or rotate temporary accounts after UAT cycles.
