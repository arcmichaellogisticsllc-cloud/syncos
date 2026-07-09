# Staging Tenant / Admin Execution Plan

## A. Purpose

Create the first staging tenant, admin user, and persona users safely after Mike approves the provider and bootstrap method. This plan does not create users or tenants by itself.

## B. Tenant

- Tenant: Jackson Telcom Staging
- Slug: `jackson-telcom-staging`
- Environment: staging
- Status: active
- Owner/contact: placeholder only until Mike approves the named owner.
- Notes: Controlled UAT tenant. No production data. No external integrations.

## C. First Admin

- Placeholder email: `admin@jacksontelcom.staging.example`
- Role: System Admin
- Password: Do not document. Use secure reset flow, one-time bootstrap secret, or provider-managed secure channel.

## D. Persona Users

| User | Role | Expected landing page | Expected nav | Expected allowed actions | Expected denied actions | UAT path |
| --- | --- | --- | --- | --- | --- | --- |
| `executive@jacksontelcom.staging.example` | Executive | `/executive` | Executive, Operations, Finance overview | Review dashboards and blockers. | Lifecycle mutations outside role. | Command center and executive review. |
| `growth@jacksontelcom.staging.example` | Growth Operator | `/intelligence/signals` | Intelligence workspace | Review/create signal if allowed by role. | Finance and payout mutations. | Signal feed and signal detail. |
| `operations@jacksontelcom.staging.example` | Operations Manager | `/operations` | Operations, work orders, production, QC | Review execution queues and supported operations actions. | Finance-only mutations. | Operations board to work order/production/QC. |
| `field@jacksontelcom.staging.example` | Field Supervisor | `/production` | Production and related execution views | Submit/update supported field production actions. | Billing, payroll, accounting actions. | Production correction/review path. |
| `qc@jacksontelcom.staging.example` | QC Manager | `/qc` | QC and execution context | Review/approve/request correction where permitted. | Invoice, cash, payment, export actions. | QC queue and QC detail. |
| `finance@jacksontelcom.staging.example` | Billing / Finance User | `/invoices` | Revenue and cash workbenches | Review billable, settlements, invoices, cash if permitted. | Payroll/accounting/admin actions outside role. | Revenue and cash cycle. |
| `collections@jacksontelcom.staging.example` | Collections Specialist | `/collections` | Collections and cash follow-up | Manage supported collection actions. | Payment execution and accounting export actions. | Collections follow-up path. |
| `payables@jacksontelcom.staging.example` | Payables / Payroll Admin | `/contractor-payables` | Contractor payables, payroll, payments | Review payout readiness workflows. | Customer cash/accounting actions outside role. | Payables/payroll/payment execution. |
| `accounting@jacksontelcom.staging.example` | Accounting Manager | `/bank-reconciliation` | Reconciliation and accounting exports | Review reconciliation/export workflows. | Operational field mutations outside role. | Bank reconciliation and accounting export. |
| `auditor@jacksontelcom.staging.example` | Read-only Auditor | `/` or representative read-only page | Readable workspaces only | View status, details, audit/timeline. | All lifecycle mutations. | Read-only audit review. |

## E. Bootstrap Mechanism Options

| Option | Current repo capability | Risk | Recommendation |
| --- | --- | --- | --- |
| Existing seed script | `db:seed` creates baseline Jackson Telcom data and local-development admin. | Unsafe if default local credentials are used for real staging. | Use only after approving/staging-hardening bootstrap behavior. |
| Future CLI | Not present yet. | Requires implementation. | Preferred long-term if it requires explicit env vars and fails closed. |
| Temporary SQL runbook | Possible using known schema. | Manual error and password handling risk. | Acceptable only as reviewed temporary procedure. |
| Future Admin UI | Not present yet. | Requires product work. | Useful later, not required for first planning gate. |
| Manual API route | Only if already exists and is permission-safe. | Must not bypass auth/tenant controls. | Verify before use; do not create fake endpoint. |

Safe recommendation: do not create a default-password user script. Prefer a secure reset flow or one-time admin bootstrap command if available. If neither exists, treat bootstrap mechanism verification as a deployment blocker.

## F. Tenant Isolation Smoke

Future smoke must verify:

- Admin can access the staging tenant.
- Persona users see only their tenant data.
- Cross-tenant record access is denied.
- Cross-tenant mutation is denied.
- Read-only auditor can inspect permitted records but cannot mutate lifecycle state.

## G. Approval Required

Mike must approve:

- Tenant name.
- Admin email.
- Persona user list.
- Bootstrap method.
- Password/reset process.
