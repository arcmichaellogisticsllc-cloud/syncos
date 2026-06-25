# E2E Action State Gap Backlog

Sprint baseline: Browser E2E Deterministic Action State Foundation
HEAD: `89946b3801a496c0ee76a507069aaa07a08c9dbb`

## Gap Inventory

### GAP-AS-001: Submit-path modal certification

**Status:** Not certified  
**Scope:** All 67 action states  
**Description:** This sprint proves open/cancel round-trips only. Submitting each modal with valid data, asserting the record transitions to the correct next status, and asserting no forbidden downstream objects are created, is not yet covered.  
**Effort estimate:** High — 67 submit-path tests, each needing teardown or idempotent state reset  
**Prerequisite:** Per-test state reset strategy (e.g. transaction rollback, dedicated teardown seeds, or per-test seed variants)  
**Blocker:** None  

### GAP-AS-002: Cross-persona denial matrix

**Status:** Not certified  
**Scope:** 67 × (N-1 personas) denial combinations  
**Description:** Each action state is currently tested with systemAdmin (always allowed) and readOnlyAuditor (always denied). The matrix of "finance-user cannot approve QC", "field-supervisor cannot void invoice", etc. is not covered.  
**Effort estimate:** High — requires persona auth storage states to be confirmed and per-action denial assertions  
**Prerequisite:** All persona auth storage states seeded and stable  
**Blocker:** Persona storage state certification (tracked in existing gap backlog)  

### GAP-AS-003: Sub-item dedicated routes

**Status:** Not certified  
**Scope:** `settlementItemDraft`, `invoiceItemDraft`, `cpayItemDraft`, `payrollItemDraft`  
**Description:** These sub-items are currently tested from the parent record's route because no dedicated `/settlement-items/:id`, `/invoice-items/:id`, etc. routes exist as must-test routes in the certification matrix. If these routes are added to the app and route matrix, action state tests should be updated to use them.  
**Effort estimate:** Low — update `route` field in `action-states.ts` entries once routes exist  
**Blocker:** Product decision on whether sub-item detail routes are added  

### GAP-AS-004: Modal required field exact-match

**Status:** Partial  
**Scope:** All modals with `requiredFields.length > 0`  
**Description:** Required fields are currently asserted using `expectRequiredFields()` with loose RegExp patterns. This confirms the field label is present but not that the field is actually marked required (e.g. asterisk, aria-required). Exact-match required field validation should be certified in a future sprint.  
**Effort estimate:** Low — tighten `expectRequiredFields()` helper to check `aria-required` or `*` marker  
**Blocker:** None  

### GAP-AS-005: Accounting Export aexGenerated expectedStatus

**Status:** Annotation only  
**Scope:** `aexGenerated` action state  
**Description:** The `aexGenerated` record has `status: "draft"` and `export_status: "generated"`. The `expectedStatus` field in `action-states.ts` is set to `"draft"` (the record status), but the meaningful state is `export_status: "generated"`. Tests should verify the export status, not just the top-level record status.  
**Effort estimate:** Very Low — update expectedStatus or add a separate `expectedExportStatus` field  
**Blocker:** None  

### GAP-AS-006: Bank account archivable — account belongs to a different bank account

**Status:** Annotation only  
**Scope:** `bankAccountArchivable`  
**Description:** The archivable bank account (`actionIds.bankAccountArchivable`) is a separate inactive account seeded specifically for the archive test. All bank transactions in the action states use `ids.bankAccount` (the canonical Cedar Ridge bank account), not this archivable account. Tests should confirm the archive action is only available on the inactive account and not the active canonical account.  
**Effort estimate:** Very Low — clarify in test description  
**Blocker:** None  

### GAP-AS-007: Collection action cancel vs completed collision

**Status:** Annotation only  
**Scope:** `collectionActionCompleted`  
**Description:** The `collectionActionCompleted` record has `action_status: "completed"`. The cancel action on a completed action may not be a standard workflow in the product. If the product only allows cancelling `planned` actions, this state key should be renamed and the record's status adjusted.  
**Effort estimate:** Low — verify product behavior, adjust seed and fixture if needed  
**Blocker:** Product decision  

### GAP-AS-008: Screenshot certification for action state modals

**Status:** Not collected  
**Scope:** All modals  
**Description:** The `e2e-ci-artifact-requirements.md` requires screenshots for certification. No screenshots are collected in the action state spec files. Future certification should capture screenshots at modal-open and modal-cancel states.  
**Effort estimate:** Low — add `page.screenshot()` calls in the modal spec  
**Blocker:** CI artifact upload configured  

## Priority Order

1. GAP-AS-001 (submit-path) — highest value, unblocked
2. GAP-AS-004 (required field exact-match) — low effort, unblocked
3. GAP-AS-008 (screenshots) — low effort, unblocked once CI configured
4. GAP-AS-003 (sub-item routes) — blocked on product decision
5. GAP-AS-002 (cross-persona denial) — high effort, needs persona states
6. GAP-AS-005, GAP-AS-006, GAP-AS-007 — annotation only, address when touching those states
