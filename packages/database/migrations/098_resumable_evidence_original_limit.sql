-- Widen only the final evidence-original constraint to match the resumable transport.
-- Existing evidence and metadata remain unchanged; other attachment limits are retained.
ALTER TABLE syncfield_field_evidence DROP CONSTRAINT syncfield_field_evidence_content_bytes_check;
ALTER TABLE syncfield_field_evidence ADD CONSTRAINT syncfield_field_evidence_content_bytes_check
 CHECK (octet_length(content_bytes) BETWEEN 1 AND 104857600);
