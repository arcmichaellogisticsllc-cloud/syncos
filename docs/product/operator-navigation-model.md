# Operator Navigation Model

## Current Navigation Critique

The current `CommandShell` exposes a flat nav with 24 links:

- Intelligence, Opportunity, Projects, Work Orders, Production, QC, Billable, Settlements, Invoices, Cash Application, Collections, Contractor Payables, Payroll, Payments, Bank Reconciliation, Accounting Exports.
- Executive, Growth, Operations, Finance, Constraints, Recommendations, Workflows, KPIs.

This is useful for route certification but weak for operators:

- It mixes dashboards, queues, object lists, and financial control pages in one row.
- It forces users to understand database-domain boundaries before doing work.
- It gives equal visual weight to daily queues and secondary dashboards.
- It does not reflect role, permission, or daily workflow.
- It duplicates concepts: Growth dashboard versus Intelligence, Finance dashboard versus Billing/Cash/Payables/Reconciliation/Accounting.
- It does not show what needs attention.
- It cannot scale as admin/config pages are added.

## Recommended Top-Level Navigation

Recommended model: full operator workspace navigation.

| Top-level item | Purpose | Primary roles | Contains |
|---|---|---|---|
| Command Center | Role landing page, priority work, cross-domain exceptions. | All roles, tailored by persona. | `/`, `/executive`, `/growth`, `/operations`, `/finance`, `/constraints-center`, `/recommendations-center`, `/workflows-center`, `/kpis-center` as dashboard modules. |
| Growth | Market intelligence and relationship qualification. | Growth Operator, Executive, System Admin. | Signals, organizations, contacts, relationship maps. |
| Opportunities | Candidate, pipeline, coverage, approval preparation. | Growth Operator, Operations Manager. | Candidates, opportunities, coverage plans. |
| Operations | Projects and work orders. | Operations Manager, Field Supervisor. | Projects, work orders, operational blockers. |
| Production | Field production submission and correction. | Field Supervisor, Operations Manager. | Production records, production review status. |
| Quality | QC review queues. | QC Manager, Operations Manager. | QC reviews, correction requested work. |
| Billing | Billable, settlement, invoice lifecycle. | Billing / Finance User. | Billable items, settlements, invoices. |
| Cash | Cash receipts, payment applications, collections. | Billing / Finance User, Collections Specialist. | Cash receipts, payment applications, collection cases/actions. |
| Payables | Contractor payables, payroll, payment batches. | Payables / Payroll Admin, Accounting Manager. | Contractor payables, payroll, payment execution. |
| Reconciliation | Bank accounts, bank transactions, match review. | Accounting Manager. | Bank reconciliation, reconciliation matches. |
| Accounting Export | Internal export review and acceptance tracking. | Accounting Manager. | Export batches, export items. |
| Admin | Tenant, users, roles, permissions, audit configuration. | System Admin. | Future admin/config pages. |

## Alternative Compact Navigation

| Compact item | Contains | Tradeoff |
|---|---|---|
| Command Center | Role landing, executive/growth/operations/finance dashboards. | Best first screen, low clutter. |
| Growth | Intelligence and opportunity discovery. | Combines signals, relationships, candidates, opportunities. |
| Operations | Projects, work orders, production, QC. | Good for field orgs, but QC can be buried. |
| Finance | Billing, cash, collections, payables, payroll, reconciliation, accounting export. | Reduces nav, but finance workflows become too dense. |
| Admin | Tenant/user/config/audit. | Clear system boundary. |

Recommendation: start with the full operator workspace model for desktop. Use compact nav for mobile and constrained sidebars. The full model maps more directly to daily ownership and avoids burying high-risk finance controls under a single Finance bucket.

## Role-Based Navigation

| Role | Default landing | Visible nav |
|---|---|---|
| Executive | Command Center | Command Center, Growth, Opportunities, Operations, Production, Quality, Billing, Cash, Payables, Reconciliation, Accounting Export. Read-only by default. |
| Growth Operator | Growth Command | Command Center, Growth, Opportunities. |
| Operations Manager | Operations Board | Command Center, Opportunities, Operations, Production, Quality. |
| Field Supervisor | Production Queue | Command Center, Operations, Production, Quality read-only. |
| QC Manager | Quality Review Queue | Command Center, Production read-only, Quality. |
| Billing / Finance User | Billing Workbench | Command Center, Billing, Cash, Payables read-only as needed. |
| Collections Specialist | Collections Queue | Command Center, Cash, Collections under Cash. |
| Payables / Payroll Admin | Payables Workbench | Command Center, Payables. |
| Accounting Manager | Reconciliation Board | Command Center, Cash read-only, Payables read-only, Reconciliation, Accounting Export. |
| Read-only Auditor | Audit Command Center | Command Center plus all readable workspaces, no write controls. |
| System Admin | Admin | All nav items plus Admin. |

## Workspace Route Placement

### Command Center

- `/`
- `/executive`
- `/growth`
- `/operations`
- `/finance`
- `/constraints-center`
- `/recommendations-center`
- `/workflows-center`
- `/kpis-center`

These should become modules/cards within a role-specific Command Center, not independent top-nav peers.

### Growth

- `/intelligence`
- `/intelligence/signals`
- `/intelligence/signals/[id]`
- `/intelligence/organizations`
- `/intelligence/organizations/new`
- `/intelligence/organizations/[id]`
- `/intelligence/organizations/[id]/edit`
- `/intelligence/contacts`
- `/intelligence/contacts/new`
- `/intelligence/contacts/[id]`
- `/intelligence/contacts/[id]/edit`
- `/intelligence/relationship-maps`
- `/intelligence/relationship-maps/new`
- `/intelligence/relationship-maps/[id]`
- `/intelligence/relationship-maps/[id]/edit`

### Opportunities

- `/opportunities`
- `/opportunities/pipeline`
- `/opportunities/new`
- `/opportunities/[id]`
- `/opportunities/[id]/edit`
- `/opportunities/candidates`
- `/opportunities/candidates/new`
- `/opportunities/candidates/[id]`
- `/opportunities/candidates/[id]/edit`
- `/opportunities/coverage`
- `/opportunities/coverage/new`
- `/opportunities/coverage/[id]`
- `/opportunities/coverage/[id]/edit`

### Operations

- `/projects`
- `/projects/[id]`
- `/projects/[id]/edit`
- `/work-orders`
- `/work-orders/new`
- `/work-orders/[id]`
- `/work-orders/[id]/edit`

### Production

- `/production`
- `/production/new`
- `/production/[id]`
- `/production/[id]/edit`

### Quality

- `/qc`
- `/qc/new`
- `/qc/[id]`
- `/qc/[id]/edit`

### Billing

- `/billable`
- `/billable/new`
- `/billable/[id]`
- `/billable/[id]/edit`
- `/settlements`
- `/settlements/new`
- `/settlements/[id]`
- `/settlements/[id]/edit`
- `/invoices`
- `/invoices/new`
- `/invoices/[id]`
- `/invoices/[id]/edit`

### Cash

- `/cash`
- `/cash/receipts/new`
- `/cash/receipts/[id]`
- `/cash/receipts/[id]/edit`
- `/payment-applications`
- `/payment-applications/[id]`
- `/collections`
- `/collections/new`
- `/collections/[id]`
- `/collections/[id]/edit`
- `/collection-actions`
- `/collection-actions/[id]`

### Payables

- `/contractor-payables`
- `/contractor-payables/new`
- `/contractor-payables/[id]`
- `/contractor-payables/[id]/edit`
- `/payroll`
- `/payroll/new`
- `/payroll/[id]`
- `/payroll/[id]/edit`
- `/payments`
- `/payments/new`
- `/payments/[id]`
- `/payments/[id]/edit`
- `/payment-items/[id]`

### Reconciliation

- `/bank-reconciliation`
- `/bank-reconciliation/accounts/new`
- `/bank-reconciliation/accounts/[id]`
- `/bank-reconciliation/accounts/[id]/edit`
- `/bank-reconciliation/transactions/new`
- `/bank-reconciliation/transactions/[id]`
- `/bank-reconciliation/transactions/[id]/edit`
- `/reconciliation-matches/[id]`

### Accounting Export

- `/accounting-exports`
- `/accounting-exports/new`
- `/accounting-exports/[id]`
- `/accounting-exports/[id]/edit`
- `/accounting-export-items/[id]`

### Admin

No production admin route exists yet. Future Admin should include user management, role templates, tenant settings, integration placeholders, audit policy, and environment status. It must not expose dev token/session controls.

## Nav Behavior Rules

- Hide items when a persona has no read permission for the workspace.
- Keep read-only nav visible for auditors and executives where policy grants read access.
- Show action badges such as Needs Review, Exceptions, Ready, Overdue only when backed by actual data.
- Do not show integration nav for bank feeds, QuickBooks, ACH, wire, card, check, payroll provider, GL, tax, or payment processor until integrations are built and certified.
- On mobile, collapse to Command Center, Growth, Operations, Finance, Admin with submenus.

## Phase 2 Implementation Status

Implemented:

- `OperatorNavigation` defines the compact workspace model: Command Center, Growth, Operations, Finance, and planned Admin.
- Each workspace and subnav item now carries label, route, workspace, description, permission hint, and status.
- `CommandShell` renders the shared operator navigation for command, growth, operations, and finance pages without changing certified routes.
- Active workspace subnavigation follows the current route and marks the active link with `aria-current`.
- Admin is shown as planned because production admin routes are not implemented.
- Client-side permission filtering is display-only. Backend authorization remains the source of truth.

Remaining:

- Route access should eventually use a generated permission matrix instead of hand-maintained display hints.
- Role landing pages still need dedicated content per persona.
- Admin should remain planned or hidden until supported routes, permissions, and audit behavior are implemented.
- Workspace counts and badges need a backend-backed summary contract before they appear in navigation.

Route matrix implication:

The navigation intentionally links only workspace entry points and readable queue/list routes. Mutation routes, create routes, edit routes, and detail routes remain reachable through workflow actions, tables, and the existing route matrix, not primary navigation.
