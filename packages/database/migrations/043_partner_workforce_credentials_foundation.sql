ALTER TABLE workers ADD COLUMN IF NOT EXISTS organization_id UUID;
ALTER TABLE workers ADD COLUMN IF NOT EXISTS worker_role TEXT;
ALTER TABLE workers ADD COLUMN IF NOT EXISTS partner_worker_reference TEXT;
ALTER TABLE workers ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'draft'
  CHECK (review_status IN ('draft', 'submitted', 'under_review', 'approved', 'conditional', 'returned', 'rejected', 'suspended', 'inactive'));
ALTER TABLE workers ADD COLUMN IF NOT EXISTS submitted_by_user_id UUID REFERENCES users(id);
ALTER TABLE workers ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ;
ALTER TABLE workers ADD COLUMN IF NOT EXISTS reviewed_by_user_id UUID REFERENCES users(id);
ALTER TABLE workers ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
ALTER TABLE workers ADD COLUMN IF NOT EXISTS external_return_reason TEXT;
ALTER TABLE workers ADD COLUMN IF NOT EXISTS internal_review_notes TEXT;
ALTER TABLE workers ADD COLUMN IF NOT EXISTS suspended_reason TEXT;
ALTER TABLE workers ADD COLUMN IF NOT EXISTS inactive_at TIMESTAMPTZ;
ALTER TABLE workers ADD COLUMN IF NOT EXISTS last_material_change_at TIMESTAMPTZ;

UPDATE workers w
SET organization_id = cp.organization_id
FROM capacity_providers cp
WHERE w.capacity_provider_id = cp.id
  AND w.tenant_id = cp.tenant_id
  AND w.organization_id IS NULL;

ALTER TABLE workers ADD CONSTRAINT workers_tenant_org_fk
  FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations(tenant_id, id);
CREATE INDEX IF NOT EXISTS workers_tenant_org_idx ON workers(tenant_id, organization_id);

ALTER TABLE crews ADD COLUMN IF NOT EXISTS organization_id UUID;
ALTER TABLE crews ADD COLUMN IF NOT EXISTS target_staffing_level INTEGER NOT NULL DEFAULT 4 CHECK (target_staffing_level > 0);
ALTER TABLE crews ADD COLUMN IF NOT EXISTS lifecycle_status TEXT NOT NULL DEFAULT 'active'
  CHECK (lifecycle_status IN ('draft', 'active', 'suspended', 'inactive', 'archived'));
ALTER TABLE crews ADD COLUMN IF NOT EXISTS suspended_reason TEXT;
ALTER TABLE crews ADD COLUMN IF NOT EXISTS inactive_at TIMESTAMPTZ;

UPDATE crews c
SET organization_id = cp.organization_id
FROM capacity_providers cp
WHERE c.capacity_provider_id = cp.id
  AND c.tenant_id = cp.tenant_id
  AND c.organization_id IS NULL;

ALTER TABLE crews ADD CONSTRAINT crews_tenant_org_fk
  FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations(tenant_id, id);
CREATE INDEX IF NOT EXISTS crews_tenant_org_idx ON crews(tenant_id, organization_id);

CREATE UNIQUE INDEX IF NOT EXISTS tenant_users_tenant_id_id_uidx ON tenant_users(tenant_id, id);

CREATE TABLE IF NOT EXISTS partner_worker_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL,
  capacity_provider_id UUID NOT NULL,
  worker_id UUID NOT NULL,
  display_name TEXT,
  home_address JSONB NOT NULL DEFAULT '{}'::jsonb,
  mobile_phone TEXT,
  emergency_contact_name TEXT,
  emergency_contact_phone TEXT,
  driver_operator_status TEXT NOT NULL DEFAULT 'not_driver' CHECK (driver_operator_status IN ('not_driver', 'driver', 'operator', 'driver_operator')),
  driver_license_state TEXT,
  driver_license_class TEXT,
  driver_license_last_four TEXT CHECK (driver_license_last_four IS NULL OR driver_license_last_four ~ '^[0-9A-Za-z]{4}$'),
  driver_license_expiration_date DATE,
  driver_license_verification_status TEXT NOT NULL DEFAULT 'not_required'
    CHECK (driver_license_verification_status IN ('not_required', 'submitted', 'under_review', 'verified', 'returned', 'rejected', 'expired')),
  aerial_experience_years NUMERIC CHECK (aerial_experience_years IS NULL OR aerial_experience_years >= 0),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'under_review', 'approved', 'conditional', 'returned', 'rejected', 'suspended', 'inactive', 'superseded')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  submitted_by_user_id UUID REFERENCES users(id),
  submitted_at TIMESTAMPTZ,
  reviewed_by_user_id UUID REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  external_return_reason TEXT,
  internal_review_notes TEXT,
  supersedes_profile_id UUID REFERENCES partner_worker_profiles(id),
  superseded_by_profile_id UUID REFERENCES partner_worker_profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT partner_worker_profiles_tenant_org_fk
    FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations(tenant_id, id),
  CONSTRAINT partner_worker_profiles_tenant_capacity_provider_fk
    FOREIGN KEY (tenant_id, capacity_provider_id) REFERENCES capacity_providers(tenant_id, id),
  CONSTRAINT partner_worker_profiles_tenant_worker_fk
    FOREIGN KEY (tenant_id, worker_id) REFERENCES workers(tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS partner_worker_profiles_current_uidx
  ON partner_worker_profiles(tenant_id, worker_id)
  WHERE deleted_at IS NULL AND status <> 'superseded';
CREATE UNIQUE INDEX IF NOT EXISTS partner_worker_profiles_tenant_id_uidx ON partner_worker_profiles(tenant_id, id);
CREATE INDEX IF NOT EXISTS partner_worker_profiles_org_idx ON partner_worker_profiles(tenant_id, organization_id, status);

CREATE TABLE IF NOT EXISTS partner_restricted_file_objects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL,
  capacity_provider_id UUID NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('worker_headshot', 'worker_credential_evidence')),
  related_entity_type TEXT NOT NULL CHECK (related_entity_type IN ('worker', 'worker_headshot', 'worker_credential')),
  related_entity_id UUID NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL CHECK (size_bytes > 0),
  checksum TEXT NOT NULL,
  storage_provider TEXT NOT NULL DEFAULT 'local_restricted',
  storage_key TEXT NOT NULL,
  uploaded_by_user_id UUID REFERENCES users(id),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  restricted BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT partner_restricted_file_objects_tenant_org_fk
    FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations(tenant_id, id),
  CONSTRAINT partner_restricted_file_objects_tenant_capacity_provider_fk
    FOREIGN KEY (tenant_id, capacity_provider_id) REFERENCES capacity_providers(tenant_id, id),
  CONSTRAINT partner_restricted_file_objects_storage_key_uidx UNIQUE (storage_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS partner_restricted_file_objects_tenant_id_uidx ON partner_restricted_file_objects(tenant_id, id);
CREATE INDEX IF NOT EXISTS partner_restricted_file_objects_related_idx ON partner_restricted_file_objects(tenant_id, related_entity_type, related_entity_id);

CREATE TABLE IF NOT EXISTS partner_worker_headshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL,
  capacity_provider_id UUID NOT NULL,
  worker_id UUID NOT NULL,
  file_object_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'under_review', 'approved', 'returned', 'rejected', 'superseded')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  attested_by_user_id UUID REFERENCES users(id),
  attested_at TIMESTAMPTZ,
  attestation_version TEXT NOT NULL DEFAULT 'p4_worker_headshot_v1',
  reviewed_by_user_id UUID REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  external_return_reason TEXT,
  internal_review_notes TEXT,
  supersedes_headshot_id UUID REFERENCES partner_worker_headshots(id),
  superseded_by_headshot_id UUID REFERENCES partner_worker_headshots(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT partner_worker_headshots_tenant_org_fk
    FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations(tenant_id, id),
  CONSTRAINT partner_worker_headshots_tenant_capacity_provider_fk
    FOREIGN KEY (tenant_id, capacity_provider_id) REFERENCES capacity_providers(tenant_id, id),
  CONSTRAINT partner_worker_headshots_tenant_worker_fk
    FOREIGN KEY (tenant_id, worker_id) REFERENCES workers(tenant_id, id),
  CONSTRAINT partner_worker_headshots_tenant_file_object_fk
    FOREIGN KEY (tenant_id, file_object_id) REFERENCES partner_restricted_file_objects(tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS partner_worker_headshots_current_uidx
  ON partner_worker_headshots(tenant_id, worker_id)
  WHERE deleted_at IS NULL AND status <> 'superseded';
CREATE UNIQUE INDEX IF NOT EXISTS partner_worker_headshots_tenant_id_uidx ON partner_worker_headshots(tenant_id, id);

CREATE TABLE IF NOT EXISTS partner_worker_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL,
  capacity_provider_id UUID NOT NULL,
  worker_id UUID NOT NULL,
  credential_type TEXT NOT NULL CHECK (credential_type IN (
    'driver_license',
    'osha_10',
    'osha_30',
    'first_aid_cpr',
    'bucket_truck_aerial_lift',
    'fall_protection_harness',
    'pole_climbing',
    'bucket_rescue',
    'pole_top_rescue',
    'traffic_control',
    'background_check',
    'drug_screen',
    'customer_badge_or_clearance',
    'other'
  )),
  credential_level TEXT,
  issuer TEXT,
  credential_identifier_last_four TEXT CHECK (credential_identifier_last_four IS NULL OR credential_identifier_last_four ~ '^[0-9A-Za-z]{4}$'),
  issued_date DATE,
  expiration_date DATE,
  required BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('draft', 'submitted', 'under_review', 'verified', 'returned', 'rejected', 'expired', 'superseded')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  evidence_file_object_id UUID,
  submitted_by_user_id UUID REFERENCES users(id),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_by_user_id UUID REFERENCES users(id),
  verified_at TIMESTAMPTZ,
  external_return_reason TEXT,
  internal_review_notes TEXT,
  supersedes_credential_id UUID REFERENCES partner_worker_credentials(id),
  superseded_by_credential_id UUID REFERENCES partner_worker_credentials(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT partner_worker_credentials_dates_check CHECK (expiration_date IS NULL OR issued_date IS NULL OR expiration_date >= issued_date),
  CONSTRAINT partner_worker_credentials_tenant_org_fk
    FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations(tenant_id, id),
  CONSTRAINT partner_worker_credentials_tenant_capacity_provider_fk
    FOREIGN KEY (tenant_id, capacity_provider_id) REFERENCES capacity_providers(tenant_id, id),
  CONSTRAINT partner_worker_credentials_tenant_worker_fk
    FOREIGN KEY (tenant_id, worker_id) REFERENCES workers(tenant_id, id),
  CONSTRAINT partner_worker_credentials_tenant_file_object_fk
    FOREIGN KEY (tenant_id, evidence_file_object_id) REFERENCES partner_restricted_file_objects(tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS partner_worker_credentials_current_type_uidx
  ON partner_worker_credentials(tenant_id, worker_id, credential_type)
  WHERE deleted_at IS NULL AND status <> 'superseded';
CREATE UNIQUE INDEX IF NOT EXISTS partner_worker_credentials_tenant_id_uidx ON partner_worker_credentials(tenant_id, id);
CREATE INDEX IF NOT EXISTS partner_worker_credentials_org_idx ON partner_worker_credentials(tenant_id, organization_id, credential_type, status);

CREATE TABLE IF NOT EXISTS partner_crew_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL,
  capacity_provider_id UUID NOT NULL,
  crew_id UUID NOT NULL,
  worker_id UUID NOT NULL,
  membership_role TEXT NOT NULL DEFAULT 'member' CHECK (membership_role IN ('member', 'foreman', 'alternate_foreman')),
  primary_membership BOOLEAN NOT NULL DEFAULT true,
  effective_start_date DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_end_date DATE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended', 'superseded')),
  assigned_by_user_id UUID REFERENCES users(id),
  ended_by_user_id UUID REFERENCES users(id),
  ended_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT partner_crew_memberships_dates_check CHECK (effective_end_date IS NULL OR effective_end_date >= effective_start_date),
  CONSTRAINT partner_crew_memberships_tenant_org_fk
    FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations(tenant_id, id),
  CONSTRAINT partner_crew_memberships_tenant_capacity_provider_fk
    FOREIGN KEY (tenant_id, capacity_provider_id) REFERENCES capacity_providers(tenant_id, id),
  CONSTRAINT partner_crew_memberships_tenant_crew_fk
    FOREIGN KEY (tenant_id, crew_id) REFERENCES crews(tenant_id, id),
  CONSTRAINT partner_crew_memberships_tenant_worker_fk
    FOREIGN KEY (tenant_id, worker_id) REFERENCES workers(tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS partner_crew_memberships_active_worker_primary_uidx
  ON partner_crew_memberships(tenant_id, worker_id)
  WHERE deleted_at IS NULL AND status = 'active' AND primary_membership = true;
CREATE UNIQUE INDEX IF NOT EXISTS partner_crew_memberships_active_crew_worker_uidx
  ON partner_crew_memberships(tenant_id, crew_id, worker_id)
  WHERE deleted_at IS NULL AND status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS partner_crew_memberships_active_foreman_uidx
  ON partner_crew_memberships(tenant_id, crew_id)
  WHERE deleted_at IS NULL AND status = 'active' AND membership_role = 'foreman';
CREATE UNIQUE INDEX IF NOT EXISTS partner_crew_memberships_active_alt_foreman_uidx
  ON partner_crew_memberships(tenant_id, crew_id)
  WHERE deleted_at IS NULL AND status = 'active' AND membership_role = 'alternate_foreman';
CREATE UNIQUE INDEX IF NOT EXISTS partner_crew_memberships_tenant_id_uidx ON partner_crew_memberships(tenant_id, id);
CREATE INDEX IF NOT EXISTS partner_crew_memberships_org_idx ON partner_crew_memberships(tenant_id, organization_id, crew_id, status);

CREATE TABLE IF NOT EXISTS partner_worker_user_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL,
  worker_id UUID NOT NULL,
  tenant_user_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'revoked')),
  linked_by_user_id UUID REFERENCES users(id),
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_by_user_id UUID REFERENCES users(id),
  ended_at TIMESTAMPTZ,
  ended_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT partner_worker_user_links_tenant_org_fk
    FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations(tenant_id, id),
  CONSTRAINT partner_worker_user_links_tenant_worker_fk
    FOREIGN KEY (tenant_id, worker_id) REFERENCES workers(tenant_id, id),
  CONSTRAINT partner_worker_user_links_tenant_tenant_user_fk
    FOREIGN KEY (tenant_id, tenant_user_id) REFERENCES tenant_users(tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS partner_worker_user_links_active_worker_uidx
  ON partner_worker_user_links(tenant_id, worker_id)
  WHERE deleted_at IS NULL AND status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS partner_worker_user_links_active_tenant_user_uidx
  ON partner_worker_user_links(tenant_id, tenant_user_id)
  WHERE deleted_at IS NULL AND status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS partner_worker_user_links_tenant_id_uidx ON partner_worker_user_links(tenant_id, id);

CREATE TABLE IF NOT EXISTS partner_workforce_attestations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL,
  capacity_provider_id UUID NOT NULL,
  worker_id UUID,
  crew_id UUID,
  attestation_version TEXT NOT NULL DEFAULT 'p4_partner_workforce_v1',
  attested_by_user_id UUID REFERENCES users(id),
  attested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  attestation_scope TEXT NOT NULL CHECK (attestation_scope IN ('worker', 'crew', 'headshot')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT partner_workforce_attestations_scope_check CHECK (worker_id IS NOT NULL OR crew_id IS NOT NULL),
  CONSTRAINT partner_workforce_attestations_tenant_org_fk
    FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations(tenant_id, id),
  CONSTRAINT partner_workforce_attestations_tenant_capacity_provider_fk
    FOREIGN KEY (tenant_id, capacity_provider_id) REFERENCES capacity_providers(tenant_id, id),
  CONSTRAINT partner_workforce_attestations_tenant_worker_fk
    FOREIGN KEY (tenant_id, worker_id) REFERENCES workers(tenant_id, id),
  CONSTRAINT partner_workforce_attestations_tenant_crew_fk
    FOREIGN KEY (tenant_id, crew_id) REFERENCES crews(tenant_id, id)
);
CREATE INDEX IF NOT EXISTS partner_workforce_attestations_org_idx ON partner_workforce_attestations(tenant_id, organization_id, attestation_scope);
