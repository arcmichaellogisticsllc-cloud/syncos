ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS legal_name TEXT,
  ADD COLUMN IF NOT EXISTS dba_name TEXT,
  ADD COLUMN IF NOT EXISTS website TEXT,
  ADD COLUMN IF NOT EXISTS main_phone TEXT,
  ADD COLUMN IF NOT EXISTS main_email TEXT,
  ADD COLUMN IF NOT EXISTS address_line_1 TEXT,
  ADD COLUMN IF NOT EXISTS address_line_2 TEXT,
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS state TEXT,
  ADD COLUMN IF NOT EXISTS postal_code TEXT,
  ADD COLUMN IF NOT EXISTS country TEXT,
  ADD COLUMN IF NOT EXISTS organization_type TEXT,
  ADD COLUMN IF NOT EXISTS relationship_owner_user_id UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS strategic_flag BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS influence_score INTEGER CHECK (influence_score IS NULL OR (influence_score >= 0 AND influence_score <= 100)),
  ADD COLUMN IF NOT EXISTS work_relevance_score INTEGER CHECK (work_relevance_score IS NULL OR (work_relevance_score >= 0 AND work_relevance_score <= 100)),
  ADD COLUMN IF NOT EXISTS capacity_relevance_score INTEGER CHECK (capacity_relevance_score IS NULL OR (capacity_relevance_score >= 0 AND capacity_relevance_score <= 100)),
  ADD COLUMN IF NOT EXISTS payment_relevance_score INTEGER CHECK (payment_relevance_score IS NULL OR (payment_relevance_score >= 0 AND payment_relevance_score <= 100)),
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS archive_reason TEXT,
  ADD COLUMN IF NOT EXISTS archive_note TEXT,
  ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS qualified_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS qualified_at TIMESTAMPTZ;

UPDATE organizations
SET organization_type = CASE type
  WHEN 'carrier' THEN 'isp_carrier'
  WHEN 'contractor' THEN 'prime_contractor'
  WHEN 'agency' THEN 'municipality'
  WHEN 'partner' THEN 'vendor'
  WHEN 'unknown' THEN NULL
  ELSE type
END
WHERE organization_type IS NULL;

UPDATE organizations
SET actor_roles = ARRAY(
  SELECT DISTINCT CASE role
    WHEN 'owner' THEN 'work_creator'
    WHEN 'influencer' THEN 'work_influencer'
    WHEN 'distributor' THEN 'work_distributor'
    WHEN 'provider' THEN 'capacity_provider'
    WHEN 'validator' THEN 'work_validator'
    WHEN 'payer' THEN 'cash_controller'
    ELSE lower(regexp_replace(trim(role), '[^a-zA-Z0-9]+', '_', 'g'))
  END
  FROM unnest(actor_roles) AS role
)
WHERE actor_roles IS NOT NULL;

UPDATE organizations
SET actor_roles = ARRAY(
  SELECT DISTINCT CASE role
    WHEN 'vendor_enabler' THEN 'vendor_enabler'
    WHEN 'regulatory_public_actor' THEN 'regulatory_public_actor'
    WHEN 'work_creator' THEN 'work_creator'
    WHEN 'work_influencer' THEN 'work_influencer'
    WHEN 'work_distributor' THEN 'work_distributor'
    WHEN 'capacity_provider' THEN 'capacity_provider'
    WHEN 'work_validator' THEN 'work_validator'
    WHEN 'cash_controller' THEN 'cash_controller'
  END
  FROM unnest(actor_roles) AS role
  WHERE role IN (
    'vendor_enabler',
    'regulatory_public_actor',
    'work_creator',
    'work_influencer',
    'work_distributor',
    'capacity_provider',
    'work_validator',
    'cash_controller'
  )
)
WHERE actor_roles IS NOT NULL;

ALTER TABLE organizations
  ALTER COLUMN trust_level TYPE TEXT
  USING CASE
    WHEN trust_level IS NULL THEN NULL
    WHEN trust_level >= 90 THEN 'verified'
    WHEN trust_level >= 70 THEN 'high'
    WHEN trust_level >= 40 THEN 'medium'
    WHEN trust_level > 0 THEN 'low'
    ELSE 'unverified'
  END;

ALTER TABLE organizations
  ADD CONSTRAINT organizations_organization_type_check
    CHECK (
      organization_type IS NULL OR organization_type IN (
        'utility',
        'isp_carrier',
        'broadband_office',
        'municipality',
        'engineering_firm',
        'prime_contractor',
        'general_contractor_program_manager',
        'subcontractor',
        'vendor',
        'equipment_provider',
        'staffing_partner',
        'customer',
        'internal_company'
      )
    ),
  ADD CONSTRAINT organizations_actor_roles_check
    CHECK (
      actor_roles <@ ARRAY[
        'work_creator',
        'work_influencer',
        'work_distributor',
        'capacity_provider',
        'work_validator',
        'cash_controller',
        'vendor_enabler',
        'regulatory_public_actor'
      ]::text[]
    ),
  ADD CONSTRAINT organizations_trust_level_check
    CHECK (trust_level IS NULL OR trust_level IN ('unverified', 'low', 'medium', 'high', 'verified')),
  ADD CONSTRAINT organizations_archive_reason_check
    CHECK (archive_reason IS NULL OR archive_reason IN ('duplicate', 'inactive', 'not_relevant', 'bad_data', 'merged', 'out_of_territory', 'no_longer_target', 'other'));

CREATE INDEX IF NOT EXISTS organizations_tenant_type_idx ON organizations(tenant_id, organization_type);
CREATE INDEX IF NOT EXISTS organizations_tenant_status_idx ON organizations(tenant_id, status);
CREATE INDEX IF NOT EXISTS organizations_tenant_territory_idx ON organizations(tenant_id, territory_id);
CREATE INDEX IF NOT EXISTS organizations_tenant_owner_idx ON organizations(tenant_id, relationship_owner_user_id);
CREATE INDEX IF NOT EXISTS organizations_tenant_strategic_idx ON organizations(tenant_id, strategic_flag);
CREATE INDEX IF NOT EXISTS organizations_tenant_trust_idx ON organizations(tenant_id, trust_level);
CREATE INDEX IF NOT EXISTS organizations_tenant_archived_idx ON organizations(tenant_id, archived_at);
