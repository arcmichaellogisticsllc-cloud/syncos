# Staging Approval Gate

This is the formal approval checklist before any staging deployment work begins.

## 1. Required Approvals Before Deployment

| Approval area | Approved / not approved | Notes | Date | Approver |
| --- | --- | --- | --- | --- |
| Provider | Not approved | Select managed split or platform bundle unless Mike approves another path. | TBD | Mike |
| Architecture | Not approved | Web, API, Worker, managed Postgres, provider secrets. | TBD | Mike |
| DB provider | Not approved | Managed Postgres recommended. | TBD | Mike |
| Domain/subdomain | Not approved | Staging URL still pending. | TBD | Mike |
| Secrets process | Not approved | Provider secret manager only. | TBD | Mike |
| Tenant/admin bootstrap method | Not approved | Must avoid default local credentials. | TBD | Mike |
| UAT persona users | Not approved | Placeholder user list is proposed. | TBD | Mike |
| Staging data policy | Not approved | No production data or live financial data. | TBD | Mike |
| Backup approach | Not approved | Provider backup and restore process pending. | TBD | Mike |
| Cost category | Not approved | Low/medium staging cost category expected. | TBD | Mike |

## 2. Explicit Non-Approvals

- Production deployment is not approved.
- External integrations are not approved.
- Real money movement is not approved.
- Real payroll is not approved.
- Real bank data is not approved.
- Real tax/accounting filing is not approved.

## 3. Deployment May Begin Only After

- Approval checklist is complete.
- Repo is clean.
- Local release gate is green.
- `npm run staging:check` passes.
- `npm run staging:plan:check` passes.
- Secrets are ready outside the repo.
