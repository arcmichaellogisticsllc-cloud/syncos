# SyncOS Operating Model

## Canonical Product Rule

WEBSITE RECRUITS / EXPLAINS

LOGIN AUTHENTICATES

SYNCOS ROUTES

SYNC ADMIN CONTROLS

SYNCFIELD EXECUTES

COMMAND CENTER PRIORITIZES

This document is the source of truth for future SyncOS, SyncField, Partner Portal, public website, routing, and navigation decisions.

## A. Website

The public website, `synccommsystems.com`, is the public acquisition and trust layer.

Purpose:

- public explanation;
- credibility;
- customer/service inquiries;
- Partner recruiting;
- Become a Partner;
- Login to SyncOS.

The website does not:

- authenticate operational users;
- run Partner onboarding;
- perform Work Orders;
- run field production;
- expose internal operational controls;
- decide user persona;
- expose private operational, financial, Partner, customer, worker, or competitive intelligence.

Public acquisition is not internal operations.

## B. Login

The login layer, `app.synccommsystems.com/login`, is the single trusted gateway into SyncOS.

Purpose:

- authenticate identity;
- handle password/login;
- direct invited users to secure invite acceptance when applicable.

The login page does not:

- act as a marketing landing page;
- ask users to choose their persona manually;
- expose internal product modules as navigation choices;
- manually accept raw invite tokens as a normal login pattern;
- route users based on client-supplied persona choices.

Authentication is not authorization, and authentication is not workspace routing.

Current v0.9.0-rc1 authentication reality:

- invitation acceptance uses `/partner/invite/[token]`;
- normal sign-in uses email and password through `/auth/login`;
- SyncOS stores the returned session token internally after successful authentication;
- users should never be asked to paste an access token as the normal sign-in pattern.

## C. SyncOS

SyncOS is the authenticated operating environment.

Purpose:

- inspect authenticated identity;
- inspect tenant;
- inspect role/persona;
- inspect permissions;
- route the user to the correct workspace;
- enforce tenant boundaries, Partner boundaries, permissions, audit, and operational lifecycle rules.

SyncOS owns the private workflows for demand, Partner network, capacity, work, production, Customer QC, finance, performance, and executive decision support.

## D. Sync Admin

Sync Admin is the internal operating control layer. It should be represented by internal navigation and permissions composed from existing Executive, Operations, Finance, and administrative roles unless a future audit proves a distinct new role is required.

Purpose:

Control the operating loop:

Demand
-> Partner Network
-> Capacity
-> Work
-> Production
-> Customer QC
-> Finance
-> Performance / Command Center

Sync Admin controls source-of-truth actions such as inquiry review, qualification, invitation, Partner review, Work Order management, mobilization, production review, Customer QC, billing, payables, payment readiness, and executive action review.

Field execution is not admin control.

## E. SyncField

SyncField is the Foreman and field-execution layer.

Purpose:

- Today;
- Map;
- JSA;
- ticks / span;
- pole / asset;
- footage;
- fiber sequence;
- evidence;
- submit / correct.

SyncField captures field facts. It does not approve Partners, assign unrelated work, run Customer QC, create invoices, execute payments, or expose internal finance/admin controls.

## F. Command Center

Command Center is the executive prioritization layer.

Purpose:

- executive prioritization;
- throughput visibility;
- blockers;
- daily actions;
- cash / AR / AP operational intelligence;
- Partner risk and capacity intelligence summaries;
- drill-through into canonical operating workflows.

Command Center recommends and prioritizes. It does not automatically award, assign, pay, approve Partners, or change lifecycle state.

## Core Boundary Rules

- Authentication != authorization != workspace routing.
- Public acquisition != internal operations.
- Field execution != admin control.
- Recommendation != assignment.
- Inquiry != onboarding.
- Partner inquiry != Partner approval.
- Capacity signal != verified deployable capacity.
- Website campaign signal != private operating data.

## Public / Private System Model

synccommsystems.com
= marketing, recruiting, lead capture, trust

app.synccommsystems.com
= authentication, workflows, data, operations

api.synccommsystems.com
= secure application backend

## Operating Loop

Customer demand enters through the public website, service relationships, and Sync internal growth activity. SyncOS turns demand into Opportunity records and explicit requirements.

Partner capacity enters through public Partner inquiry, recruiting, referrals, existing relationships, and Sync internal sourcing. SyncOS turns potential capacity into qualified Partner network capacity only after human review and canonical readiness checks.

SyncOS connects customer demand and Partner capacity through requirements, capacity matching, human staffing decisions, Work Orders, mobilization, SyncField execution, Customer QC, billing, payables, performance, and executive prioritization.

## Persona Routing

Post-login routing is deterministic and derived from server-trusted authenticated identity, roles, permissions, and Partner organization scope.

| Persona / Context | Route | Rule |
| --- | --- | --- |
| Internal Executive | `/command-center` | Executive and command permissions route to prioritization first. |
| Internal Operations | `/operations` | Project, Work Order, production, or QC permissions route to the operations workspace. |
| Internal Finance | `/finance` | Billing, invoice, cash, settlement, or payable permissions route to finance. |
| Partner Admin | `/partner` | External Partner Admins route to Partner Portal and onboarding/readiness. |
| Partner Foreman | `/partner/field/today` | External Foremen route to SyncField Today. |
| Limited user | first permitted workspace or `/` | Unknown users do not default to Command Center. |

Role precedence:

1. internal Executive;
2. internal Operations;
3. internal Finance;
4. external Partner Foreman;
5. external Partner Admin;
6. first permitted workspace;
7. safe root.

Internal users with incidental Partner relationships remain internal-first. Partner-only users route to Partner Portal or SyncField.

## Internal Operating Navigation

Sync Admin navigation should present the operating loop without creating duplicate domains.

Demand:

- `/growth`;
- `/intelligence/signals`;
- `/opportunities/candidates`;
- `/opportunities/pipeline`.

Partner Network:

- `/partner-network`;
- `/intelligence/organizations`;
- `/intelligence/contacts`;
- `/intelligence/relationship-maps`;
- `/partner-performance`.

Capacity Matching:

- `/opportunities/capacity-matching`;
- `/opportunities/coverage`;
- `/partner-performance`.

Execution:

- `/operations`;
- `/projects`;
- `/work-orders`;
- `/production`;
- `/production-dashboard`.

QC:

- `/qc`;
- `/production`.

Finance:

- `/finance`;
- `/billable`;
- `/invoices`;
- `/cash`;
- `/collections`;
- `/contractor-payables`;
- `/payroll`;
- `/payments`;
- `/bank-reconciliation`;
- `/accounting-exports`.

Command Center:

- `/command-center`;
- `/executive`;
- `/constraints-center`;
- `/recommendations-center`;
- `/kpis-center`.

## Partner Acquisition Flow

Public website Partner inquiry creates a Partner Inquiry only. It may create a low-confidence, unverified capacity signal, but it does not create a user, Partner approval, Work Order, mobilization, or assignment.

Sync Admin controls the human gate:

Partner Inquiry
-> assign owner
-> record conversation
-> qualify / future capacity / not a fit
-> invite only when qualified
-> Partner Admin accepts invite
-> Partner completes onboarding checklist from canonical P3-P6 state
-> internal review
-> internal approval when readiness policy allows.

Manual Partner invitation may bypass the public inquiry. It does not bypass onboarding, compliance, internal review, approval, Work Order, mobilization, or production authorization.

## Workspace Boundaries

Foreman:

- Today;
- assigned Work Order;
- JSA;
- map;
- ticks / span;
- footage;
- fiber sequence;
- evidence;
- submit / correct assigned work.

Partner Admin:

- company profile;
- compliance;
- workers;
- crews;
- agreements;
- assigned Work Orders;
- vehicles;
- mobilization;
- Partner production visibility;
- Partner-safe settlements/payments/performance where allowed.

Partner users do not receive internal Demand, Partner Network admin, Capacity Matching admin, customer finance, internal QC controls, Command Center, customer rates, Sync margin, or other-Partner intelligence.

## Post-Pilot Demand Intake Limitation

Customer/service inquiry ingestion from the public website into a SyncOS demand inbox is not part of the current focused patch. That remains a post-pilot demand intake integration unless an existing Opportunity workflow is explicitly connected later.
