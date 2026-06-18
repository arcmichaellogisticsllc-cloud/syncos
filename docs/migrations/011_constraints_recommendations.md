# 011 Constraints, Recommendations

## Purpose

Store business constraints and generated recommendations used to guide decisions.

## Tables

- `constraints`: tenant-defined operational, compliance, capacity, or commercial constraints.
- `constraint_entities`: entities affected by constraints.
- `recommendations`: generated suggestions for opportunities, staffing, compliance, routing, or relationship actions.
- `recommendation_reasons`: explainability records and scoring factors.
- `recommendation_feedback`: user acceptance, rejection, comments, and outcome feedback.

## Key Relationships

- `constraints.tenant_id` references `tenants.id`.
- `constraint_entities.constraint_id` references `constraints.id`.
- `recommendations.tenant_id` references `tenants.id`.
- `recommendation_reasons.recommendation_id` references `recommendations.id`.
- `recommendation_feedback.recommendation_id` references `recommendations.id`.

## Notes

- Include severity, active window, enforcement mode, and source.
- Recommendations should include model version, confidence, status, and target entity references.
