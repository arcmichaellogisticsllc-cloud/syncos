# 008 Compliance Documents, Capacity Records

## Purpose

Track compliance requirements, documents, expirations, and verified capacity history.

## Tables

- `compliance_requirements`: required licenses, certifications, insurance, training, and documents.
- `compliance_documents`: submitted or imported documents.
- `compliance_document_reviews`: review state and reviewer decisions.
- `entity_compliance_status`: current compliance snapshot by entity.
- `capacity_records`: historical declared or verified capacity records.
- `capacity_record_evidence`: evidence supporting capacity records.

## Key Relationships

- `compliance_requirements.tenant_id` references `tenants.id`.
- `compliance_documents.requirement_id` references `compliance_requirements.id`.
- `compliance_document_reviews.document_id` references `compliance_documents.id`.
- `capacity_records.provider_id` references `capacity_providers.id`.
- `capacity_record_evidence.capacity_record_id` references `capacity_records.id`.
- `capacity_record_evidence.evidence_id` references `evidence.id`.

## Notes

- Track expiration, warning windows, review state, and issuer metadata.
- Keep status snapshots reproducible from underlying document and review records.
