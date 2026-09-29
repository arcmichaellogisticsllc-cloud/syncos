-- Preserve existing evidence and widen only the validated field-upload allowance.
ALTER TABLE syncfield_field_evidence DROP CONSTRAINT syncfield_field_evidence_mime_type_check;
ALTER TABLE syncfield_field_evidence ADD CONSTRAINT syncfield_field_evidence_mime_type_check
 CHECK (mime_type IN ('image/jpeg','image/png','application/pdf','video/mp4'));
ALTER TABLE syncfield_field_evidence DROP CONSTRAINT syncfield_field_evidence_content_bytes_check;
ALTER TABLE syncfield_field_evidence ADD CONSTRAINT syncfield_field_evidence_content_bytes_check
 CHECK (octet_length(content_bytes) BETWEEN 1 AND 20971520);
