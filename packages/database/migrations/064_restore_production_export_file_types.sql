-- Repair databases where 060 removed the export types introduced by 049.
ALTER TABLE partner_restricted_file_objects DROP CONSTRAINT IF EXISTS partner_restricted_file_objects_category_check;
-- This shared P4 table is cumulative: retain every category valid through 059,
-- then add the C2A Partner Compliance categories introduced here.
ALTER TABLE partner_restricted_file_objects ADD CONSTRAINT partner_restricted_file_objects_category_check CHECK (category IN (
  'worker_headshot',
  'worker_credential_evidence',
  'partner_msa_executed',
  'partner_msa_amendment_executed',
  'partner_work_order_executed',
  'partner_vehicle_agreement_executed',
  'syncfield_map_original_pdf',
  'syncfield_production_export',
  'partner_w9',
  'partner_coi',
  'partner_insurance_endorsement',
  'partner_insurance_policy_evidence'
));
ALTER TABLE partner_restricted_file_objects DROP CONSTRAINT IF EXISTS partner_restricted_file_objects_related_entity_type_check;
-- Preserve all pre-060 relationship types alongside the Compliance source.
ALTER TABLE partner_restricted_file_objects ADD CONSTRAINT partner_restricted_file_objects_related_entity_type_check CHECK (related_entity_type IN (
  'worker', 'worker_headshot', 'worker_credential',
  'partner_agreement_version', 'partner_work_order_version', 'partner_vehicle_assignment',
  'syncfield_map_version', 'production_export_artifact', 'partner_compliance'
));
