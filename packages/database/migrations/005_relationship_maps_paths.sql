CREATE TABLE relationship_maps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  root_entity_type TEXT,
  root_entity_id UUID,
  target_organization_id UUID REFERENCES organizations(id),
  target_contact_id UUID REFERENCES contacts(id),
  target_object_type TEXT,
  target_object_id UUID,
  status TEXT NOT NULL DEFAULT 'no_path' CHECK (status IN ('no_path', 'weak_path', 'identified_path', 'introduction_requested', 'conversation_opened', 'relationship_active', 'strategic_access', 'dormant', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE relationship_paths (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  relationship_map_id UUID NOT NULL REFERENCES relationship_maps(id),
  source_entity_type TEXT,
  source_entity_id UUID,
  target_entity_type TEXT,
  target_entity_id UUID,
  from_contact_id UUID REFERENCES contacts(id),
  to_contact_id UUID REFERENCES contacts(id),
  intermediary_contact_ids UUID[] NOT NULL DEFAULT '{}'::uuid[],
  strength_score INTEGER CHECK (strength_score IS NULL OR (strength_score >= 0 AND strength_score <= 100)),
  confidence_score INTEGER CHECK (confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 100)),
  rank INTEGER CHECK (rank IS NULL OR rank > 0),
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'active', 'inactive', 'archived')),
  score NUMERIC(8,4),
  path JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX relationship_maps_tenant_id_idx ON relationship_maps(tenant_id);
CREATE INDEX relationship_paths_tenant_id_idx ON relationship_paths(tenant_id);
