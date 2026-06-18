# 004 Signals, Evidence

## Purpose

Track observed signals and supporting evidence used by relationship, opportunity, and recommendation models.

## Tables

- `signals`: normalized observations about market activity, relationships, compliance, or capacity.
- `signal_sources`: source systems, users, documents, integrations, or imports.
- `evidence`: supporting facts, excerpts, links, records, or attachments.
- `signal_evidence`: join table connecting signals to evidence.
- `signal_entities`: organizations, contacts, territories, or projects associated with a signal.

## Key Relationships

- `signals.tenant_id` references `tenants.id`.
- `signals.source_id` references `signal_sources.id`.
- `evidence.tenant_id` references `tenants.id`.
- `signal_evidence.signal_id` references `signals.id`.
- `signal_evidence.evidence_id` references `evidence.id`.

## Notes

- Store signal type, status, confidence, occurred date, and ingestion metadata.
- Evidence should preserve provenance and immutable source references where possible.
