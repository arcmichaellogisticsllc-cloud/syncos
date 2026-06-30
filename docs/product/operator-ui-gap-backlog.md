# Operator UI Gap Backlog

## Backlog

| ID | Page/domain | Problem | User impact | Recommended fix | Priority | Blocks operator use | Blocks staging | Blocks production | Dependencies |
|---|---|---|---|---|---|---|---|---|---|
| OUX-001 | Signal Feed / global auth | Developer token/session UI visible. | Operators see implementation controls and may enter unsafe auth state. | Hide outside dev/test; replace with authenticated user state and login-required card. | P0 | Yes | Yes | Yes | Auth UI decision. |
| OUX-002 | Global navigation | Top nav overloaded with 24 flat links. | Users cannot identify daily workspace or priority. | Implement role/workspace nav model. | P0 | Yes | Yes | Yes | Persona nav matrix. |
| OUX-003 | Signal Feed | Sign-in token warning appears in main content. | Operator sees developer instructions instead of product guidance. | Replace with login-required card. | P0 | Yes | Yes | Yes | OUX-001. |
| OUX-004 | Dashboards | Zero metrics lack context. | Users cannot tell whether zero is good, empty, or broken. | Add metric definitions, targets, trends, and drill-down links. | P1 | No | Yes | Yes | Dashboard data contract. |
| OUX-005 | All workspaces | No role landing pages. | Every user starts from same generic route/nav. | Build Command Center role views. | P0 | Yes | Yes | Yes | Persona workflow maps. |
| OUX-006 | Queue/list pages | Filters too prominent. | Operators start by filtering instead of working a queue. | Collapse advanced filters and add priority queue tabs. | P0 | Yes | Yes | Yes | Page templates. |
| OUX-007 | Queue/list pages | No next-best-action guidance. | Users do not know which record to open first. | Add default queue, SLA/age, next action, review-next button. | P0 | Yes | Yes | Yes | Queue priority rules. |
| OUX-008 | Many pages | Database-object language. | Users must understand implementation model. | Rename surfaces to workflow terms and keep object type secondary. | P1 | No | Yes | Yes | Content design pass. |
| OUX-009 | All action pages | Inconsistent action button priority. | Primary/destructive actions compete visually. | Use standard action area hierarchy and button styles. | P0 | Yes | Yes | Yes | Shared ActionArea component. |
| OUX-010 | All action pages | Unclear disabled states. | Users cannot tell whether action is unavailable due to state, data, or permission. | Add disabled reason convention. | P0 | Yes | Yes | Yes | Shared ActionButton. |
| OUX-011 | All pages | Insufficient empty states. | Empty queues feel broken and provide no next step. | Standard empty state per page type. | P1 | No | Yes | Yes | Page templates. |
| OUX-012 | All pages | Insufficient error states. | Failures may expose technical text or leave user stranded. | Standard error pattern with retry, correlation, preserved state. | P1 | No | Yes | Yes | API error envelope. |
| OUX-013 | Mobile/compact | Mobile not reviewed. | Operators on tablets/field devices may hit layout issues. | Add mobile screenshot review for page templates. | P1 | No | Yes | Yes | Page templates. |
| OUX-014 | Command Center | Command center not mature. | Landing does not direct daily work. | Build role-specific priority dashboard. | P0 | Yes | Yes | Yes | Role workflows, dashboard data. |
| OUX-015 | Global | Dev/test UI mixed with operator UI. | Production trust risk. | Explicit environment gates for dev-only components. | P0 | Yes | Yes | Yes | OUX-001. |
| OUX-016 | Payment Execution | Payment language can imply external money movement. | Operators may believe SyncOS sends ACH/wire/card/check. | Add internal-only boundary badge and copy. | P0 | Yes | Yes | Yes | Financial control template. |
| OUX-017 | Payroll | Payroll language can imply provider submission. | Operator may believe payroll was filed/submitted externally. | Add internal-ready language and no-provider boundary. | P0 | Yes | Yes | Yes | Financial control template. |
| OUX-018 | Accounting Export | Export language can imply QuickBooks/GL integration. | Operator may believe external accounting was updated. | Add internal export lifecycle copy. | P0 | Yes | Yes | Yes | Accounting export template. |
| OUX-019 | Bank Reconciliation | Bank page can imply bank feed/import. | Operator may believe SyncOS connects to bank. | Label manual/internal transaction records and no-feed boundary. | P0 | Yes | Yes | Yes | Reconciliation template. |
| OUX-020 | Signal Feed | No priority queue. | High-confidence or incomplete signals are buried. | Add Today's Priorities and queue tabs. | P0 | Yes | Yes | Yes | Signal redesign. |
| OUX-021 | Signal Feed | Create button lacks context. | Users do not know what makes a useful signal. | Add header purpose and create modal guidance. | P1 | No | Yes | Yes | Signal redesign. |
| OUX-022 | Signal Feed | Does not explain actionability. | Verification/candidate readiness criteria unclear. | Add readiness checklist per row/detail. | P1 | No | Yes | Yes | Signal redesign. |
| OUX-023 | Work Orders | No role-first daily queue. | Field and ops users hunt through records. | Add Today, Blocked, Ready, Overdue queues. | P0 | Yes | Yes | Yes | Queue template. |
| OUX-024 | Production | Correction workflow not prominent enough. | Returned work may be missed. | Add correction-requested queue and next action card. | P0 | Yes | Yes | Yes | Review template. |
| OUX-025 | QC | Review decision context weak. | Reviewers lack evidence checklist. | Add review template with evidence and approve/correct actions. | P0 | Yes | Yes | Yes | Review template. |
| OUX-026 | Billing | Revenue lifecycle split across object pages. | Finance user cannot see end-to-end billing work. | Add Billing Workbench. | P1 | No | Yes | Yes | Nav redesign. |
| OUX-027 | Collections | Actions separated from cases. | Collection specialists lose context. | Nest actions under collection case and provide due queue. | P1 | No | Yes | Yes | Cash/Collections template. |
| OUX-028 | Payables | Payables/payroll/payment split without readiness overview. | Admin cannot prioritize cost/labor work. | Add Payables Workbench. | P1 | No | Yes | Yes | Nav redesign. |
| OUX-029 | Reconciliation | Match screens need side-by-side comparison. | Accounting user may select wrong match. | Add transaction/source comparison panel. | P0 | Yes | Yes | Yes | Reconciliation template. |
| OUX-030 | Audit | Audit/timeline not consistently first-class. | Operators cannot verify consequences easily. | Standard Timeline and Audit tabs on details. | P1 | No | Yes | Yes | Detail template. |
| OUX-031 | All create/edit pages | Generic CRUD forms. | Users do not know prerequisites or consequences. | Convert to guided forms with business copy and validation. | P2 | No | No | Yes | Page templates. |
| OUX-032 | Admin | No production admin/config pages. | System admins lack supported controls. | Add Admin IA and future pages. | P1 | No | Yes | Yes | Auth/permission product decision. |
| OUX-033 | Read-only | Read-only role context not visible enough. | Auditors may not understand why buttons are absent. | Add read-only banner and action-area replacement. | P1 | No | Yes | Yes | Persona UI. |
| OUX-034 | E2E | Template-level UX assertions not defined. | Redesign could regress operator standards. | Add E2E for nav, queues, disabled reasons, modal semantics. | P1 | No | Yes | Yes | Implementation phases. |
| OUX-035 | Content | Boundary copy tone varies by domain. | High-risk actions feel inconsistent. | Standard financial boundary copy. | P1 | No | Yes | Yes | Content design pass. |

## Top 10 UX Problems

1. Developer token/session UI is visible in the operator experience.
2. Top navigation is overloaded and route-driven.
3. Pages are database-object-first instead of workflow-first.
4. Filters dominate list pages while priority queues are missing.
5. There are no role-specific landing pages.
6. Financial actions do not consistently announce internal-only boundaries.
7. Disabled actions do not consistently explain why.
8. Empty and zero states do not explain meaning or next action.
9. Button hierarchy is inconsistent across domains.
10. Command Center does not yet direct daily work.
