ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS department TEXT,
  ADD COLUMN IF NOT EXISTS contact_role TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS secondary_email TEXT,
  ADD COLUMN IF NOT EXISTS territory_id UUID,
  ADD COLUMN IF NOT EXISTS verification_method TEXT,
  ADD COLUMN IF NOT EXISTS verification_source TEXT,
  ADD COLUMN IF NOT EXISTS verification_note TEXT,
  ADD COLUMN IF NOT EXISTS verified_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS relationship_owner_user_id UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS influence_score INTEGER,
  ADD COLUMN IF NOT EXISTS decision_authority_score INTEGER,
  ADD COLUMN IF NOT EXISTS relationship_strength_score INTEGER,
  ADD COLUMN IF NOT EXISTS preferred_contact_method TEXT,
  ADD COLUMN IF NOT EXISTS best_time_to_contact TEXT,
  ADD COLUMN IF NOT EXISTS source TEXT,
  ADD COLUMN IF NOT EXISTS source_url TEXT,
  ADD COLUMN IF NOT EXISTS source_confidence INTEGER,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS do_not_contact_flag BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS archive_reason TEXT,
  ADD COLUMN IF NOT EXISTS archive_note TEXT,
  ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS invalid_reason TEXT,
  ADD COLUMN IF NOT EXISTS invalid_note TEXT,
  ADD COLUMN IF NOT EXISTS last_contacted_at TIMESTAMPTZ;

ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_verification_status_check;
ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_status_check;
ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_contact_role_check;
ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_verification_method_check;
ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_score_range_check;
ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_source_confidence_range_check;
ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_archive_reason_check;
ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_invalid_reason_check;

UPDATE contacts
SET contact_role = 'unknown'
WHERE contact_role IS NULL OR contact_role = '';

ALTER TABLE contacts
  ADD CONSTRAINT contacts_verification_status_check
    CHECK (verification_status IN ('unverified', 'partially_verified', 'verified', 'invalid', 'stale')),
  ADD CONSTRAINT contacts_status_check
    CHECK (status IN ('discovered', 'enriched', 'verified', 'contacted', 'engaged', 'relationship_active', 'dormant', 'invalid', 'archived')),
  ADD CONSTRAINT contacts_contact_role_check
    CHECK (contact_role IN (
      'decision_maker',
      'executive_sponsor',
      'economic_buyer',
      'technical_buyer',
      'procurement_contact',
      'vendor_manager',
      'construction_manager',
      'project_manager',
      'field_supervisor',
      'field_inspector',
      'qc_contact',
      'safety_contact',
      'engineering_contact',
      'design_contact',
      'permitting_contact',
      'row_contact',
      'ap_contact',
      'billing_contact',
      'contract_manager',
      'subcontractor_owner',
      'subcontractor_foreman',
      'equipment_contact',
      'staffing_contact',
      'gatekeeper',
      'relationship_bridge',
      'influencer',
      'unknown'
    )),
  ADD CONSTRAINT contacts_verification_method_check
    CHECK (
      verification_method IS NULL OR verification_method IN (
        'direct_confirmation',
        'email_validated',
        'phone_validated',
        'linkedin_confirmed',
        'organization_website',
        'public_source',
        'relationship_source',
        'internal_note'
      )
    ),
  ADD CONSTRAINT contacts_score_range_check
    CHECK (
      (influence_score IS NULL OR (influence_score >= 0 AND influence_score <= 100))
      AND (decision_authority_score IS NULL OR (decision_authority_score >= 0 AND decision_authority_score <= 100))
      AND (relationship_strength_score IS NULL OR (relationship_strength_score >= 0 AND relationship_strength_score <= 100))
    ),
  ADD CONSTRAINT contacts_source_confidence_range_check
    CHECK (source_confidence IS NULL OR (source_confidence >= 0 AND source_confidence <= 100)),
  ADD CONSTRAINT contacts_archive_reason_check
    CHECK (archive_reason IS NULL OR archive_reason IN ('duplicate', 'left_company', 'not_relevant', 'bad_data', 'inactive', 'other')),
  ADD CONSTRAINT contacts_invalid_reason_check
    CHECK (invalid_reason IS NULL OR invalid_reason IN ('bad_email', 'bad_phone', 'left_company', 'wrong_person', 'duplicate', 'not_relevant', 'other'));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contacts_tenant_territory_fk'
  ) THEN
    ALTER TABLE contacts
      ADD CONSTRAINT contacts_tenant_territory_fk
      FOREIGN KEY (tenant_id, territory_id) REFERENCES territories(tenant_id, id) NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS contacts_tenant_organization_idx ON contacts(tenant_id, organization_id);
CREATE INDEX IF NOT EXISTS contacts_tenant_role_idx ON contacts(tenant_id, contact_role);
CREATE INDEX IF NOT EXISTS contacts_tenant_status_idx ON contacts(tenant_id, status);
CREATE INDEX IF NOT EXISTS contacts_tenant_verification_idx ON contacts(tenant_id, verification_status);
CREATE INDEX IF NOT EXISTS contacts_tenant_owner_idx ON contacts(tenant_id, relationship_owner_user_id);
CREATE INDEX IF NOT EXISTS contacts_tenant_territory_idx ON contacts(tenant_id, territory_id);
CREATE INDEX IF NOT EXISTS contacts_tenant_archived_idx ON contacts(tenant_id, archived_at);
CREATE INDEX IF NOT EXISTS contacts_tenant_last_verified_idx ON contacts(tenant_id, last_verified_at);
CREATE INDEX IF NOT EXISTS contacts_tenant_last_contacted_idx ON contacts(tenant_id, last_contacted_at);
