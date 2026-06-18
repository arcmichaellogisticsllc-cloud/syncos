# 006 Opportunity Candidates, Opportunities

## Purpose

Move detected opportunity candidates through qualification into managed opportunities.

## Tables

- `opportunity_candidates`: potential work or revenue opportunities inferred from signals.
- `candidate_scores`: scoring breakdowns for candidates.
- `opportunities`: qualified opportunities.
- `opportunity_contacts`: stakeholders associated with opportunities.
- `opportunity_organizations`: customer, partner, vendor, and competitor organizations.
- `opportunity_stages`: configurable stage catalog.
- `opportunity_stage_history`: stage transitions over time.

## Key Relationships

- `opportunity_candidates.tenant_id` references `tenants.id`.
- `opportunity_candidates.signal_id` references `signals.id`.
- `candidate_scores.candidate_id` references `opportunity_candidates.id`.
- `opportunities.tenant_id` references `tenants.id`.
- `opportunities.candidate_id` references `opportunity_candidates.id`.
- `opportunity_contacts.opportunity_id` references `opportunities.id`.
- `opportunity_organizations.opportunity_id` references `opportunities.id`.

## Notes

- Candidates should support rejected, promoted, duplicate, and archived states.
- Opportunities should track value estimate, probability, close date, owner, and stage.
