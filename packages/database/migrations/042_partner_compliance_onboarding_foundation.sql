CREATE UNIQUE INDEX IF NOT EXISTS files_tenant_id_id_uidx ON files(tenant_id, id);

CREATE TABLE partner_company_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL,
  capacity_provider_id UUID,
  legal_business_name TEXT NOT NULL,
  dba_name TEXT,
  state_of_formation TEXT,
  entity_type TEXT,
  business_address JSONB NOT NULL DEFAULT '{}'::jsonb,
  primary_business_phone TEXT,
  primary_business_email TEXT,
  primary_contact_name TEXT,
  primary_contact_email TEXT,
  primary_contact_phone TEXT,
  settlement_contact_name TEXT,
  settlement_contact_email TEXT,
  settlement_contact_phone TEXT,
  compliance_contact_name TEXT,
  compliance_contact_email TEXT,
  compliance_contact_phone TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'under_review', 'verified', 'returned', 'rejected', 'superseded')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  submitted_by_user_id UUID REFERENCES users(id),
  submitted_at TIMESTAMPTZ,
  reviewed_by_user_id UUID REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  external_return_reason TEXT,
  internal_review_notes TEXT,
  last_material_change_at TIMESTAMPTZ,
  supersedes_profile_id UUID,
  superseded_by_profile_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT partner_company_profiles_tenant_org_fk
    FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations(tenant_id, id),
  CONSTRAINT partner_company_profiles_tenant_capacity_provider_fk
    FOREIGN KEY (tenant_id, capacity_provider_id) REFERENCES capacity_providers(tenant_id, id)
);

CREATE UNIQUE INDEX partner_company_profiles_current_uidx
  ON partner_company_profiles(tenant_id, organization_id)
  WHERE deleted_at IS NULL AND status <> 'superseded';
CREATE UNIQUE INDEX partner_company_profiles_tenant_id_uidx ON partner_company_profiles(tenant_id, id);
CREATE INDEX partner_company_profiles_tenant_status_idx ON partner_company_profiles(tenant_id, status);

CREATE TABLE partner_tax_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL,
  capacity_provider_id UUID,
  legal_name_on_w9 TEXT NOT NULL,
  dba_name_on_w9 TEXT,
  federal_tax_classification TEXT NOT NULL,
  tin_type TEXT NOT NULL CHECK (tin_type IN ('ein', 'ssn')),
  tin_last_four TEXT NOT NULL CHECK (tin_last_four ~ '^[0-9]{4}$'),
  signed_date DATE,
  received_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('not_submitted', 'submitted', 'under_review', 'verified', 'returned', 'rejected', 'superseded')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  evidence_id UUID,
  verified_by_user_id UUID REFERENCES users(id),
  verified_at TIMESTAMPTZ,
  external_return_reason TEXT,
  internal_review_notes TEXT,
  submitted_by_user_id UUID REFERENCES users(id),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  supersedes_tax_profile_id UUID,
  superseded_by_tax_profile_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT partner_tax_profiles_tenant_org_fk
    FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations(tenant_id, id),
  CONSTRAINT partner_tax_profiles_tenant_capacity_provider_fk
    FOREIGN KEY (tenant_id, capacity_provider_id) REFERENCES capacity_providers(tenant_id, id)
);

CREATE UNIQUE INDEX partner_tax_profiles_current_uidx
  ON partner_tax_profiles(tenant_id, organization_id)
  WHERE deleted_at IS NULL AND status <> 'superseded';
CREATE UNIQUE INDEX partner_tax_profiles_tenant_id_uidx ON partner_tax_profiles(tenant_id, id);
CREATE INDEX partner_tax_profiles_tenant_status_idx ON partner_tax_profiles(tenant_id, status);

CREATE TABLE partner_payment_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL,
  capacity_provider_id UUID,
  primary_payment_method TEXT NOT NULL DEFAULT 'priority_passport' CHECK (primary_payment_method IN ('priority_passport')),
  priority_passport_status TEXT NOT NULL DEFAULT 'not_started' CHECK (priority_passport_status IN ('not_started', 'pending', 'active', 'hold')),
  provider_reference TEXT,
  account_last_four TEXT CHECK (account_last_four IS NULL OR account_last_four ~ '^[0-9]{4}$'),
  card_last_four TEXT CHECK (card_last_four IS NULL OR card_last_four ~ '^[0-9]{4}$'),
  enrollment_contact_name TEXT,
  enrollment_contact_email TEXT,
  enrollment_contact_phone TEXT,
  status TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started', 'submitted', 'under_review', 'active', 'hold', 'rejected', 'superseded')),
  backup_ach_status TEXT NOT NULL DEFAULT 'not_provided' CHECK (backup_ach_status IN ('not_provided', 'submitted', 'under_review', 'verified', 'rejected', 'superseded')),
  bank_display_name TEXT,
  account_type TEXT CHECK (account_type IS NULL OR account_type IN ('checking', 'savings', 'business_checking', 'other')),
  ach_evidence_id UUID,
  bank_verification_evidence_id UUID,
  verified_by_user_id UUID REFERENCES users(id),
  verified_at TIMESTAMPTZ,
  hold_reason TEXT,
  external_return_reason TEXT,
  internal_review_notes TEXT,
  submitted_by_user_id UUID REFERENCES users(id),
  submitted_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  supersedes_payment_profile_id UUID,
  superseded_by_payment_profile_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT partner_payment_profiles_tenant_org_fk
    FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations(tenant_id, id),
  CONSTRAINT partner_payment_profiles_tenant_capacity_provider_fk
    FOREIGN KEY (tenant_id, capacity_provider_id) REFERENCES capacity_providers(tenant_id, id)
);

CREATE UNIQUE INDEX partner_payment_profiles_current_uidx
  ON partner_payment_profiles(tenant_id, organization_id)
  WHERE deleted_at IS NULL AND status <> 'superseded';
CREATE UNIQUE INDEX partner_payment_profiles_tenant_id_uidx ON partner_payment_profiles(tenant_id, id);
CREATE INDEX partner_payment_profiles_tenant_status_idx ON partner_payment_profiles(tenant_id, status);

CREATE TABLE partner_insurance_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL,
  capacity_provider_id UUID,
  policy_type TEXT NOT NULL CHECK (policy_type IN (
    'commercial_general_liability',
    'commercial_auto',
    'umbrella_excess',
    'workers_compensation',
    'employers_liability'
  )),
  carrier TEXT NOT NULL,
  policy_reference TEXT,
  effective_date DATE NOT NULL,
  expiration_date DATE NOT NULL,
  occurrence_limit_cents BIGINT,
  general_aggregate_cents BIGINT,
  products_completed_operations_aggregate_cents BIGINT,
  combined_single_auto_limit_cents BIGINT,
  employer_liability_accident_limit_cents BIGINT,
  employer_liability_disease_each_employee_limit_cents BIGINT,
  employer_liability_disease_policy_limit_cents BIGINT,
  workers_compensation_statutory BOOLEAN NOT NULL DEFAULT false,
  owned_auto_covered BOOLEAN,
  hired_rented_auto_covered BOOLEAN,
  non_owned_auto_covered BOOLEAN,
  additional_insured_status TEXT NOT NULL DEFAULT 'not_provided' CHECK (additional_insured_status IN ('not_provided', 'submitted', 'verified', 'not_required')),
  waiver_of_subrogation_status TEXT NOT NULL DEFAULT 'not_provided' CHECK (waiver_of_subrogation_status IN ('not_provided', 'submitted', 'verified', 'not_required')),
  primary_non_contributory_status TEXT NOT NULL DEFAULT 'not_provided' CHECK (primary_non_contributory_status IN ('not_provided', 'submitted', 'verified', 'not_required')),
  cancellation_notice_status TEXT,
  coi_evidence_id UUID,
  endorsement_evidence_ids UUID[] NOT NULL DEFAULT '{}'::uuid[],
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('draft', 'submitted', 'under_review', 'verified', 'returned', 'rejected', 'expired', 'superseded')),
  verified_by_user_id UUID REFERENCES users(id),
  verified_at TIMESTAMPTZ,
  external_return_reason TEXT,
  internal_review_notes TEXT,
  submitted_by_user_id UUID REFERENCES users(id),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  supersedes_policy_id UUID,
  superseded_by_policy_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT partner_insurance_policies_dates_check CHECK (expiration_date >= effective_date),
  CONSTRAINT partner_insurance_policies_tenant_org_fk
    FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations(tenant_id, id),
  CONSTRAINT partner_insurance_policies_tenant_capacity_provider_fk
    FOREIGN KEY (tenant_id, capacity_provider_id) REFERENCES capacity_providers(tenant_id, id),
  CONSTRAINT partner_insurance_policies_superseded_fk
    FOREIGN KEY (superseded_by_policy_id) REFERENCES partner_insurance_policies(id)
);

CREATE UNIQUE INDEX partner_insurance_policies_current_type_uidx
  ON partner_insurance_policies(tenant_id, organization_id, policy_type)
  WHERE deleted_at IS NULL AND status <> 'superseded';
CREATE UNIQUE INDEX partner_insurance_policies_tenant_id_uidx ON partner_insurance_policies(tenant_id, id);
CREATE INDEX partner_insurance_policies_tenant_status_idx ON partner_insurance_policies(tenant_id, status);
CREATE INDEX partner_insurance_policies_expiration_idx ON partner_insurance_policies(tenant_id, expiration_date);

CREATE TABLE partner_restricted_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL,
  capacity_provider_id UUID,
  category TEXT NOT NULL CHECK (category IN (
    'partner_w9',
    'partner_ach_authorization',
    'partner_bank_verification',
    'partner_coi',
    'partner_insurance_endorsement',
    'partner_insurance_policy_evidence'
  )),
  related_entity_type TEXT,
  related_entity_id UUID,
  file_id UUID,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL CHECK (size_bytes >= 0),
  checksum TEXT,
  storage_provider TEXT,
  bucket TEXT,
  object_key TEXT,
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'under_review', 'verified', 'returned', 'rejected', 'superseded')),
  restricted BOOLEAN NOT NULL DEFAULT true,
  uploaded_by_user_id UUID REFERENCES users(id),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_by_user_id UUID REFERENCES users(id),
  verified_at TIMESTAMPTZ,
  external_return_reason TEXT,
  internal_review_notes TEXT,
  supersedes_evidence_id UUID REFERENCES partner_restricted_evidence(id),
  superseded_by_evidence_id UUID REFERENCES partner_restricted_evidence(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT partner_restricted_evidence_tenant_org_fk
    FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations(tenant_id, id),
  CONSTRAINT partner_restricted_evidence_tenant_capacity_provider_fk
    FOREIGN KEY (tenant_id, capacity_provider_id) REFERENCES capacity_providers(tenant_id, id),
  CONSTRAINT partner_restricted_evidence_tenant_file_fk
    FOREIGN KEY (tenant_id, file_id) REFERENCES files(tenant_id, id)
);

CREATE UNIQUE INDEX partner_restricted_evidence_tenant_id_uidx ON partner_restricted_evidence(tenant_id, id);
CREATE INDEX partner_restricted_evidence_org_category_idx ON partner_restricted_evidence(tenant_id, organization_id, category);
CREATE INDEX partner_restricted_evidence_related_idx ON partner_restricted_evidence(tenant_id, related_entity_type, related_entity_id);

ALTER TABLE partner_tax_profiles ADD CONSTRAINT partner_tax_profiles_tenant_evidence_fk
  FOREIGN KEY (tenant_id, evidence_id) REFERENCES partner_restricted_evidence(tenant_id, id);
ALTER TABLE partner_payment_profiles ADD CONSTRAINT partner_payment_profiles_tenant_ach_evidence_fk
  FOREIGN KEY (tenant_id, ach_evidence_id) REFERENCES partner_restricted_evidence(tenant_id, id);
ALTER TABLE partner_payment_profiles ADD CONSTRAINT partner_payment_profiles_tenant_bank_evidence_fk
  FOREIGN KEY (tenant_id, bank_verification_evidence_id) REFERENCES partner_restricted_evidence(tenant_id, id);
ALTER TABLE partner_insurance_policies ADD CONSTRAINT partner_insurance_policies_tenant_coi_evidence_fk
  FOREIGN KEY (tenant_id, coi_evidence_id) REFERENCES partner_restricted_evidence(tenant_id, id);

ALTER TABLE partner_company_profiles ADD CONSTRAINT partner_company_profiles_supersedes_fk
  FOREIGN KEY (supersedes_profile_id) REFERENCES partner_company_profiles(id);
ALTER TABLE partner_company_profiles ADD CONSTRAINT partner_company_profiles_superseded_by_fk
  FOREIGN KEY (superseded_by_profile_id) REFERENCES partner_company_profiles(id);
ALTER TABLE partner_tax_profiles ADD CONSTRAINT partner_tax_profiles_supersedes_fk
  FOREIGN KEY (supersedes_tax_profile_id) REFERENCES partner_tax_profiles(id);
ALTER TABLE partner_tax_profiles ADD CONSTRAINT partner_tax_profiles_superseded_by_fk
  FOREIGN KEY (superseded_by_tax_profile_id) REFERENCES partner_tax_profiles(id);
ALTER TABLE partner_payment_profiles ADD CONSTRAINT partner_payment_profiles_supersedes_fk
  FOREIGN KEY (supersedes_payment_profile_id) REFERENCES partner_payment_profiles(id);
ALTER TABLE partner_payment_profiles ADD CONSTRAINT partner_payment_profiles_superseded_by_fk
  FOREIGN KEY (superseded_by_payment_profile_id) REFERENCES partner_payment_profiles(id);
ALTER TABLE partner_insurance_policies ADD CONSTRAINT partner_insurance_policies_supersedes_fk
  FOREIGN KEY (supersedes_policy_id) REFERENCES partner_insurance_policies(id);
