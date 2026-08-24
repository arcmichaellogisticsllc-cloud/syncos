# SyncField Construction Record Model

## Purpose

SyncField turns an immutable customer engineering print into an auditable construction record without making map markup financially authoritative.

Core rule:

Customer engineering print -> MapDocument / MapVersion / MapPage -> DesignSegment -> Pole/Asset Observations -> SpanCompletion / Redline -> ProductionRecord -> Submission -> Customer QC -> accepted production.

Coil/slack observations are operational material truth attached to pole/asset observations. Recorded coil does not mean billable coil.

## DesignSegment

`syncfield_design_segments` represents planned construction work on an exact immutable map version and page.

It stores planned construction context:

- tenant, Project, Work Order, MapDocument, MapVersion, MapPage;
- optional Work Zone;
- optional ProductionCode;
- From Pole / Asset and To Pole / Asset;
- design label, design quantity, design unit, and design length in feet when known;
- PDF-coordinate geometry;
- source: manual, imported, or derived;
- lifecycle status: active, superseded, or void.

DesignSegments are planned work. They are not reported production, Customer QC acceptance, billable items, invoice items, settlements, or payables.

## Design Immutability

A DesignSegment is bound to the exact MapVersion and MapPage where it was prepared. A new customer print revision does not move old DesignSegments or historical field production. New revisions may get new DesignSegments, and older DesignSegments may be superseded, but submitted field history remains tied to the original source version.

Color rule:

- DESIGN / PLANNED = yellow;
- FIELD COMPLETED / REDLINE = red;
- CUSTOMER ACCEPTANCE = status/check metadata;
- CORRECTION REQUIRED = status/indicator.

The source PDF is never overwritten or recolored.

## Pole / Asset Observation

`syncfield_asset_observations` stores a field observation at a pole or other asset in the active assignment context.

The model is intentionally generic enough for:

- pole;
- handhole;
- pedestal;
- vault;
- cabinet;
- splice point;
- terminal;
- riser;
- anchor;
- other.

Each observation is scoped by tenant, performing organization, Project, Work Order, map assignment, Crew, Foreman Worker, production date, MapDocument, MapVersion, and MapPage.

Pole identifiers are not globally unique. The same pole may be observed multiple times across dates, crews, Work Orders, correction cycles, or print revisions.

## Input / Output Ticks

Input tick and output tick are independent raw field observations.

The system does not assume:

- input tick equals output tick;
- sequence always increases;
- sequence always decreases;
- tick difference is billable footage.

If both ticks are present, SyncField may display `ABS(output_tick - input_tick)` as field context only. That value does not replace `ProductionRecord.quantity_submitted`.

## SpanCompletion / Redline

`syncfield_span_completions` stores completed/as-built span evidence for the active assignment.

It links:

- optional DesignSegment;
- required ProductionRecord;
- optional From and To asset observations;
- exact MapDocument, MapVersion, MapPage;
- redline PDF-coordinate geometry;
- deviation metadata when built geometry differs from planned design.

Preferred flow:

1. Foreman selects a planned DesignSegment.
2. SyncField creates pole observations for From and To assets.
3. SyncField creates a SpanCompletion using the design geometry as the initial redline.
4. Foreman confirms reported footage through the production workflow.

If actual construction differs from planned design, `design_deviation` is set and a reason is required. `OTHER` requires notes.

## ProductionRecord Authority

ProductionRecord remains the authoritative reported-production ledger.

SpanCompletion and pole observations are construction evidence attached to the ProductionRecord. They do not create a second production ledger.

Reported quantity remains explicit. SyncField must not silently set reported quantity from:

- design length;
- redline geometry;
- pole tick difference;
- coil/slack length;
- screen pixels;
- map distance.

## Coil / Slack Operational Truth

`syncfield_coil_observations` stores required and actual coil/slack conditions at a pole or asset. It is a child of `syncfield_asset_observations` because one pole observation may legitimately carry multiple coil conditions, such as front-easement slack and express-splice slack.

Each coil observation is scoped by tenant, performing organization, Project, Work Order, assignment, Crew, Foreman Worker, production date, exact MapDocument, MapVersion, and MapPage. It may link to a DesignSegment, SpanCompletion, and ProductionRecord when that relationship is available.

Supported operational types:

- front easement;
- rear easement;
- express splice;
- butt splice;
- riser slack;
- general slack;
- customer required;
- field condition;
- other.

Supported easement context:

- front;
- rear;
- unknown;
- not applicable.

Required and actual length are separate fields:

- `required_length_ft` records the expected operational requirement;
- `actual_length_ft` records what was installed;
- `variance_ft` is calculated as actual minus required;
- `variance_status` is operational only.

Initial defaults are suggestions:

- front easement defaults to 150 FT;
- rear easement defaults to 80 FT.

Those defaults are not universal law. They are prefill values that the Foreman confirms or overrides. The source of a required value is recorded as project rule, Work Order rule, customer design, customer direction, field requirement, manual, or other.

Input/output tick difference may be displayed beside coil data, but SyncField does not assume `ABS(output_tick - input_tick)` equals coil length. The values can differ because ticks may include slack, risers, splice routing, loops, and other cable usage.

Daily summaries may show:

reported production + recorded actual coil/slack = estimated cable consumption.

Estimated cable consumption is material traceability only. It is not reported production, Customer accepted quantity, billable quantity, settlement quantity, payable quantity, or payment eligibility.

## Customer QC Boundary

Customer QC remains ProductionRecord-level.

Customer decisions may accept, partially accept, reject, or require correction against submitted ProductionRecords. Pole observations and redlines support review, but this slice does not create per-pole financial acceptance or coil/slack acceptance.

## Financial Boundary

Finance derives from accepted ProductionRecord lineage only.

Redlines alone cannot create BillableItems. Pole ticks alone cannot create Partner settlements or contractor payables. Customer rates and Partner rates remain separate downstream policy.

Coil/slack observations do not alter reported quantity, accepted quantity, BillableItems, InvoiceItems, Partner settlements, contractor payables, or payments.

## Coil / Slack Commercial Treatment

Status: not implemented.

Recorded coil is not commercial policy. SyncOS does not yet decide whether coil is:

- billable as footage;
- included in route rate;
- a separate pay item;
- non-billable;
- payable to Partner;
- excluded from Partner compensation.

Those questions belong to a later commercial-policy slice.

## Submission And Revision History

Before submission, draft construction components may be edited in the active assignment context.

After daily production submission:

- ProductionRecords are locked by existing production behavior;
- related Pole/Asset Observations are marked submitted;
- related SpanCompletions are marked submitted;
- related Coil/Slack Observations are marked submitted;
- the daily production revision snapshot includes records, annotations, span completions, asset observations, and coil/slack observations.

The system must be able to answer what the Foreman originally submitted, what ticks were submitted, and what redline geometry was submitted. Corrections must preserve submitted history rather than silently rewriting it.

## Offline Behavior

SyncField supports offline replay after the application is already loaded.

For completed spans, the field client sends one idempotent SpanCompletion mutation with nested From and To pole observations. The API creates and links those observations inside the same server transaction, so replay does not create orphan observations or duplicate completions.

Coil/slack observations use the same field queue and `clientMutationId` idempotency model. Offline replay must create one server effect for each coil observation mutation.

Closed-browser cold-start offline shell support remains outside this slice.

## Export Behavior

Annotated exports may render:

- redline SpanCompletions;
- pole/asset markers;
- compact input/output tick labels;
- compact coil/slack callouts where readable;
- source MapVersion lineage and fingerprint status.

Structured exports include traceability fields for design segment, From/To assets, design length, reported quantity, input/output ticks, coil type, easement type, required coil, actual coil, coil variance, coil rule/source, reel/cable, fiber type, design deviation, deviation reason, and map version/page.

CSV export remains formula-injection protected.

## Security And Scope

Server-side validation controls tenant, organization, assignment, crew, Foreman, Work Order, Project, and map-version scope.

Foremen may only view assigned DesignSegments and create/edit draft observations and completions in their assigned field context. Partner Admins have company-level visibility only unless they also have a canonical Foreman Worker/Crew assignment.

Internal Operations users with map/work-zone permissions may prepare DesignSegments and inspect field evidence.

## Out Of Scope

The following remain outside this slice:

- coil billability;
- Partner coil compensation;
- customer coil commercial policy;
- Partner coil commercial policy;
- material inventory;
- GIS;
- PostGIS;
- MapLibre;
- GeoJSON;
- geographic design geometry;
- full offline map package;
- configurable forms;
- native mobile app.
