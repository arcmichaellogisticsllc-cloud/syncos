CREATE TABLE IF NOT EXISTS partner_company_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL,
  capacity_provider_id UUID,
  submission_scope TEXT NOT NULL DEFAULT 'COMPANY_FOUNDATION' CHECK (submission_scope IN ('COMPANY_FOUNDATION')),
  revision INTEGER NOT NULL CHECK (revision > 0),
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'under_review', 'action_required', 'resubmitted', 'approved', 'superseded')),
  submitted_by_user_id UUID NOT NULL REFERENCES users(id),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  client_mutation_id TEXT NOT NULL,
  reviewed_by_user_id UUID REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  external_return_reason TEXT,
  internal_review_notes TEXT,
  supersedes_submission_id UUID REFERENCES partner_company_submissions(id),
  superseded_by_submission_id UUID REFERENCES partner_company_submissions(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT partner_company_submissions_tenant_org_fk
    FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations(tenant_id, id),
  CONSTRAINT partner_company_submissions_tenant_capacity_provider_fk
    FOREIGN KEY (tenant_id, capacity_provider_id) REFERENCES capacity_providers(tenant_id, id)
);

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
ALTER TABLE partner_restricted_evidence ADD COLUMN IF NOT EXISTS restricted_file_object_id UUID;
ALTER TABLE partner_restricted_evidence ADD COLUMN IF NOT EXISTS client_mutation_id TEXT;
ALTER TABLE partner_restricted_evidence ADD CONSTRAINT partner_restricted_evidence_p4_file_fk FOREIGN KEY (tenant_id, restricted_file_object_id) REFERENCES partner_restricted_file_objects(tenant_id, id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS partner_restricted_evidence_p4_file_idx ON partner_restricted_evidence(tenant_id, restricted_file_object_id);

CREATE UNIQUE INDEX IF NOT EXISTS partner_company_submissions_current_uidx
  ON partner_company_submissions(tenant_id, organization_id, submission_scope)
  WHERE status <> 'superseded';
CREATE UNIQUE INDEX IF NOT EXISTS partner_company_submissions_revision_uidx
  ON partner_company_submissions(tenant_id, organization_id, submission_scope, revision);
CREATE UNIQUE INDEX IF NOT EXISTS partner_company_submissions_mutation_uidx
  ON partner_company_submissions(tenant_id, client_mutation_id);
CREATE UNIQUE INDEX IF NOT EXISTS partner_company_submissions_tenant_id_uidx
  ON partner_company_submissions(tenant_id, id);
CREATE INDEX IF NOT EXISTS partner_company_submissions_org_status_idx
  ON partner_company_submissions(tenant_id, organization_id, status);

CREATE TABLE IF NOT EXISTS partner_company_submission_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  submission_id UUID NOT NULL,
  section_code TEXT NOT NULL CHECK (section_code IN ('COMPANY_PROFILE','W9','PAYMENT_SETUP','INSURANCE')),
  source_type TEXT NOT NULL,
  source_id UUID,
  restricted_file_object_id UUID,
  artifact_checksum TEXT,
  safe_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_required BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT partner_company_submission_items_submission_fk FOREIGN KEY (tenant_id, submission_id) REFERENCES partner_company_submissions(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT partner_company_submission_items_file_fk FOREIGN KEY (tenant_id, restricted_file_object_id) REFERENCES partner_restricted_file_objects(tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX IF NOT EXISTS partner_company_submission_items_section_uidx ON partner_company_submission_items(tenant_id, submission_id, section_code);

CREATE TABLE IF NOT EXISTS partner_company_submission_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  submission_id UUID NOT NULL,
  review_sequence INTEGER NOT NULL CHECK (review_sequence > 0),
  reviewer_user_id UUID NOT NULL REFERENCES users(id),
  decision TEXT NOT NULL CHECK (decision IN ('VERIFIED','ACTION_REQUIRED','HOLD')),
  affected_section_code TEXT,
  partner_visible_reason TEXT,
  internal_notes TEXT,
  client_mutation_id TEXT NOT NULL,
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT partner_company_submission_reviews_submission_fk FOREIGN KEY (tenant_id, submission_id) REFERENCES partner_company_submissions(tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX IF NOT EXISTS partner_company_submission_reviews_sequence_uidx ON partner_company_submission_reviews(tenant_id, submission_id, review_sequence);
CREATE UNIQUE INDEX IF NOT EXISTS partner_company_submission_reviews_mutation_uidx ON partner_company_submission_reviews(tenant_id, client_mutation_id);
