# Partner Onboarding UX Contract

This contract governs the Partner invitation activation and Partner onboarding experience.

## Required Separation

Invitation activation and company onboarding are separate flows.

- Invitation activation creates the account, sets display name and password, stores the trusted session, and routes to the correct workspace.
- Company onboarding starts after activation at `/partner/onboarding`.
- Password fields belong only in the invitation/account activation flow, not the company onboarding workspace.

## Partner Onboarding Rules

Partner onboarding must:

- use a responsive full application workspace;
- show the Partner company name prominently;
- show progress from Partner-controlled required tasks only;
- show a clear next action;
- group checklist items by Company, Workforce, Capacity, and Final review;
- distinguish Partner tasks from Sync-only review;
- never expose raw backend enums;
- never expose raw organization, user, worker, crew, storage, or database IDs;
- never allow Partner self-approval;
- support partial completion and return-later behavior through existing section save flows;
- use human-readable state badges;
- preserve company, crew, and project readiness as separate gates;
- work on mobile, tablet, and desktop without horizontal overflow.

## Canonical Flow

1. Account activation
2. Company onboarding
3. Workforce, crew, and capacity setup
4. Partner review and submit
5. Sync internal review
6. Company approval
7. Crew readiness
8. Project-specific mobilization

Mobilization must not appear as a Partner-owned onboarding checklist item. It is an informational future gate that begins after Partner approval and Work Order assignment.

## Partner-Controlled Checklist

The Partner checklist contains only work the Partner can actually complete.

Company:

- Company Setup
- W-9 / Tax Information
- Payment Setup
- Insurance
- Agreements

Workforce:

- Workers
- Foremen
- Crews

Capacity:

- Vehicles / Equipment
- Safety / Compliance

Final:

- Review & Submit

## Sync-Controlled Review

Sync internal review belongs in internal Partner Network/admin workspaces.

Sync reviewers evaluate:

- Company Profile
- W-9
- Payment Setup
- Insurance
- Agreements
- Workers
- Crews
- Equipment
- Capabilities

Partner users may submit information for review where the backend supports that action. Partner users may not approve their own company, crew readiness, or project mobilization.

## Three-Level Readiness Model

Level 1: Company Approved

Meaning: the company may participate in the Sync Partner network.

Level 2: Crew Ready

Meaning: a specific crew has the people, equipment, and compliance posture required for deployable work.

Level 3: Project Mobilization Approved

Meaning: a specific crew is authorized for a specific Work Order.

Company onboarding completion leads toward Level 1 only. It does not imply every crew is ready, and it never authorizes production.

## Presentation Safety

The frontend may map server states for display, but readiness truth remains server-owned. The frontend must not decide that insurance is valid, a crew is ready, a company is approved, an agreement is executed, or Sync review is complete without canonical server state.

Partner-facing screens must show human-readable states:

- NOT STARTED
- IN PROGRESS
- SUBMITTED
- UNDER REVIEW
- COMPLETE
- ACTION REQUIRED
- LOCKED

Backend strings such as `*_REQUIRED`, `*_PENDING`, `*_LOCKED`, `INTERNAL_REVIEW_PENDING`, and `MOBILIZATION_LOCKED` must not render directly.
