CREATE TABLE contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  organization_id UUID REFERENCES organizations(id),
  first_name TEXT,
  last_name TEXT,
  full_name TEXT,
  title TEXT,
  email TEXT,
  phone TEXT,
  mobile TEXT,
  linkedin_url TEXT,
  verification_status TEXT NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('unverified', 'verified', 'invalid')),
  trust_level INTEGER,
  last_verified_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'discovered' CHECK (status IN ('discovered', 'enriched', 'verified', 'contacted', 'engaged', 'relationship_active', 'dormant', 'invalid', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE contact_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  source_contact_id UUID NOT NULL REFERENCES contacts(id),
  target_contact_id UUID NOT NULL REFERENCES contacts(id),
  relationship_type TEXT NOT NULL,
  strength NUMERIC(5,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX contacts_tenant_id_idx ON contacts(tenant_id);
CREATE INDEX contact_relationships_tenant_id_idx ON contact_relationships(tenant_id);
