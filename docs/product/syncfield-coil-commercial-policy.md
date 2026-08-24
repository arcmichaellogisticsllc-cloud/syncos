# SyncField Coil Commercial Policy

## Rule

Field construction truth, customer commercial treatment, and Partner commercial treatment are separate.

Foremen record required and actual coil/slack. Finance and Operations configure what accepted coil means commercially.

## Treatments

Supported customer and Partner treatments:

- `BILLABLE_AS_FOOTAGE`
- `INCLUDED_IN_ROUTE_RATE`
- `SEPARATE_PAY_ITEM`
- `NON_BILLABLE`
- `UNCONFIRMED`

`UNCONFIRMED` is the default. It never creates a BillableItem, settlement item, contractor payable, or payment eligibility.

## Customer And Partner Independence

Customer coil policy controls customer billing only.

Partner coil policy controls Partner settlement/payable eligibility only.

Supported differential example:

- Customer: billable as footage
- Partner: included in route rate

For 3,000 FT accepted route and 540 FT accepted coil:

- customer eligible quantity may be 3,540 FT;
- Partner eligible quantity may remain 3,000 FT;
- base accepted route quantity remains 3,000 FT.

The reverse differential is also supported when contract truth requires it.

## Accepted-Production Boundary

CoilObservation alone cannot bill.

Policy alone cannot bill.

Financial effect requires:

1. submitted coil/slack observation;
2. linked ProductionRecord;
3. current Customer QC acceptance for that ProductionRecord;
4. applicable policy;
5. valid rate or separate production-code mapping.

Base accepted ProductionRecord quantity is never overwritten by coil footage.

## Versioning And Evidence

Every policy stores:

- party type;
- Work Order scope;
- counterparty organization;
- coil type and easement specificity where applicable;
- treatment;
- effective dates;
- version;
- source type;
- source reference, notes, or restricted source file;
- creator and creation time.

Confirmed non-`UNCONFIRMED` policy requires source evidence.

Most specific applicable policy wins. If no policy applies, the result is `UNCONFIRMED`.

## Historical Locking

Financial source rows generated from coil policy lock:

- source kind;
- coil observation;
- policy id;
- policy version;
- treatment;
- rate schedule/rate code used.

Later policy changes do not rewrite historical invoices, settlements, or payables.

## Retroactive Clarification

If coil is recorded while policy is `UNCONFIRMED`, an authorized internal user may later create a policy effective for the work period. Previously recorded accepted coil can then be reviewed and converted through controlled financial generation.

Issued invoices and historical settlements are not silently rewritten. Adjustments, credit/rebill, or payable adjustments must use controlled finance mechanisms.

## Boundaries

Foremen do not configure or choose commercial treatment.

Partner Admins do not configure customer policy and do not see Sync margin or customer economics.

Live automated payout behavior remains outside this policy.

GIS, inventory ERP, configurable forms, native mobile, and automated PDF extraction remain out of scope.
