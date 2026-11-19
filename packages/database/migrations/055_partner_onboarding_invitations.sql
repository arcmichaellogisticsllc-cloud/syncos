CREATE TABLE IF NOT EXISTS partner_inquiries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_name TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  territory TEXT NOT NULL,
  capability TEXT NOT NULL,
  crew_count INTEGER CHECK (crew_count IS NULL OR crew_count >= 0),
  availability TEXT,
  equipment TEXT,
  experience_notes TEXT,
  source TEXT NOT NULL DEFAULT 'public_website',
  status TEXT NOT NULL DEFAULT 'NEW'
    CHECK (status IN ('NEW','REVIEWING','CONTACT_REQUIRED','CONTACTED','QUALIFIED','FUTURE_CAPACITY','NOT_A_FIT','INVITED','CONVERTED','CLOSED')),
  owner_user_id UUID REFERENCES users(id),
  territory_verified BOOLEAN NOT NULL DEFAULT false,
  capability_verified BOOLEAN NOT NULL DEFAULT false,
  crew_count_verified BOOLEAN NOT NULL DEFAULT false,
  availability_verified BOOLEAN NOT NULL DEFAULT false,
  equipment_verified BOOLEAN NOT NULL DEFAULT false,
  qualification_decision TEXT CHECK (qualification_decision IS NULL OR qualification_decision IN ('QUALIFIED','FUTURE_CAPACITY','NOT_A_FIT','CLOSED')),
  qualified_organization_id UUID,
  potential_capacity_signal JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_ip_hash TEXT,
  user_agent_summary TEXT,
  contacted_at TIMESTAMPTZ,
  qualified_at TIMESTAMPTZ,
  invited_at TIMESTAMPTZ,
  converted_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CONSTRAINT partner_inquiries_tenant_qualified_org_fk
    FOREIGN KEY (tenant_id, qualified_organization_id) REFERENCES organizations(tenant_id, id),
  CONSTRAINT partner_inquiries_email_check CHECK (email = lower(email) AND email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
);

CREATE UNIQUE INDEX IF NOT EXISTS partner_inquiries_tenant_id_uidx ON partner_inquiries(tenant_id, id);
CREATE INDEX IF NOT EXISTS partner_inquiries_status_idx ON partner_inquiries(tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS partner_inquiries_email_idx ON partner_inquiries(tenant_id, email, created_at DESC);
CREATE INDEX IF NOT EXISTS partner_inquiries_source_idx ON partner_inquiries(tenant_id, source, created_at DESC);

CREATE TABLE IF NOT EXISTS partner_inquiry_qualification_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  inquiry_id UUID NOT NULL,
  event_type TEXT NOT NULL
    CHECK (event_type IN ('OWNER_ASSIGNED','CONTACT_RECORDED','QUALIFICATION_UPDATED','INVITE_SENT','STATUS_CHANGED','NOTE')),
  note TEXT,
  safe_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT partner_inquiry_qualification_events_tenant_inquiry_fk
    FOREIGN KEY (tenant_id, inquiry_id) REFERENCES partner_inquiries(tenant_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS partner_inquiry_qualification_events_tenant_id_uidx
  ON partner_inquiry_qualification_events(tenant_id, id);
CREATE INDEX IF NOT EXISTS partner_inquiry_qualification_events_inquiry_idx
  ON partner_inquiry_qualification_events(tenant_id, inquiry_id, created_at DESC);

CREATE TABLE IF NOT EXISTS partner_onboarding_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL,
  inquiry_id UUID,
  invitation_type TEXT NOT NULL DEFAULT 'partner_admin'
    CHECK (invitation_type IN ('partner_admin','partner_foreman')),
  invitation_source TEXT NOT NULL DEFAULT 'MANUAL_INTERNAL'
    CHECK (invitation_source IN ('PUBLIC_INQUIRY','MANUAL_INTERNAL','REFERRAL','EXISTING_RELATIONSHIP','OPPORTUNITY_CAPACITY_GAP','PRIME_CUSTOMER_INTRODUCTION','PARTNER_NETWORK_RECRUITING','OTHER')),
  primary_contact_name TEXT NOT NULL,
  email TEXT NOT NULL,
  intended_role_key TEXT NOT NULL DEFAULT 'partner_admin' CHECK (intended_role_key IN ('partner_admin','partner_foreman')),
  worker_id UUID,
  crew_id UUID,
  foreman_membership_id UUID,
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'SENT' CHECK (status IN ('SENT','ACCEPTED','EXPIRED','REVOKED','SUPERSEDED')),
  invited_by_user_id UUID REFERENCES users(id),
  accepted_by_user_id UUID REFERENCES users(id),
  revoked_by_user_id UUID REFERENCES users(id),
  supersedes_invitation_id UUID REFERENCES partner_onboarding_invitations(id),
  superseded_by_invitation_id UUID REFERENCES partner_onboarding_invitations(id),
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revoked_reason TEXT,
  delivery_status TEXT NOT NULL DEFAULT 'LOCAL_PREPARED'
    CHECK (delivery_status IN ('LOCAL_PREPARED','SENT','FAILED')),
  delivery_reference TEXT,
  email_subject TEXT NOT NULL DEFAULT 'Sync Comm Systems has invited you to complete your company onboarding.',
  email_preview TEXT NOT NULL DEFAULT 'Sync Comm Systems has invited you to complete your company onboarding.',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT partner_onboarding_invitations_tenant_org_fk
    FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations(tenant_id, id),
  CONSTRAINT partner_onboarding_invitations_tenant_inquiry_fk
    FOREIGN KEY (tenant_id, inquiry_id) REFERENCES partner_inquiries(tenant_id, id),
  CONSTRAINT partner_onboarding_invitations_tenant_worker_fk
    FOREIGN KEY (tenant_id, worker_id) REFERENCES workers(tenant_id, id),
  CONSTRAINT partner_onboarding_invitations_tenant_crew_fk
    FOREIGN KEY (tenant_id, crew_id) REFERENCES crews(tenant_id, id),
  CONSTRAINT partner_onboarding_invitations_tenant_membership_fk
    FOREIGN KEY (tenant_id, foreman_membership_id) REFERENCES partner_crew_memberships(tenant_id, id),
  CONSTRAINT partner_onboarding_invitations_dates_check CHECK (
    accepted_at IS NULL OR accepted_at >= created_at
  ),
  CONSTRAINT partner_onboarding_invitations_role_type_check CHECK (
    (invitation_type = 'partner_admin' AND intended_role_key = 'partner_admin' AND worker_id IS NULL AND crew_id IS NULL AND foreman_membership_id IS NULL)
    OR
    (invitation_type = 'partner_foreman' AND intended_role_key = 'partner_foreman' AND worker_id IS NOT NULL AND crew_id IS NOT NULL AND foreman_membership_id IS NOT NULL)
  ),
  CONSTRAINT partner_onboarding_invitations_email_check CHECK (email = lower(email) AND email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
);

CREATE UNIQUE INDEX IF NOT EXISTS partner_onboarding_invitations_sent_email_uidx
  ON partner_onboarding_invitations(tenant_id, organization_id, email, invitation_type)
  WHERE status = 'SENT';

CREATE UNIQUE INDEX IF NOT EXISTS partner_onboarding_invitations_sent_foreman_uidx
  ON partner_onboarding_invitations(tenant_id, worker_id, crew_id)
  WHERE status = 'SENT' AND invitation_type = 'partner_foreman';

CREATE UNIQUE INDEX IF NOT EXISTS partner_onboarding_invitations_tenant_id_uidx
  ON partner_onboarding_invitations(tenant_id, id);

CREATE INDEX IF NOT EXISTS partner_onboarding_invitations_org_status_idx
  ON partner_onboarding_invitations(tenant_id, organization_id, status, expires_at);

CREATE INDEX IF NOT EXISTS partner_onboarding_invitations_inquiry_idx
  ON partner_onboarding_invitations(tenant_id, inquiry_id, created_at DESC);
