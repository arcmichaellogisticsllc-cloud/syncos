ALTER TABLE relationship_maps
  ADD COLUMN IF NOT EXISTS map_type TEXT,
  ADD COLUMN IF NOT EXISTS objective TEXT,
  ADD COLUMN IF NOT EXISTS desired_outcome TEXT,
  ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS priority TEXT,
  ADD COLUMN IF NOT EXISTS strategic_flag BOOLEAN,
  ADD COLUMN IF NOT EXISTS due_date DATE,
  ADD COLUMN IF NOT EXISTS related_signal_id UUID REFERENCES signals(id),
  ADD COLUMN IF NOT EXISTS related_candidate_id UUID REFERENCES opportunity_candidates(id),
  ADD COLUMN IF NOT EXISTS related_opportunity_id UUID REFERENCES opportunities(id),
  ADD COLUMN IF NOT EXISTS territory_id UUID REFERENCES territories(id),
  ADD COLUMN IF NOT EXISTS access_score INTEGER,
  ADD COLUMN IF NOT EXISTS relationship_gap_summary JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS recommended_next_action TEXT,
  ADD COLUMN IF NOT EXISTS archive_reason TEXT,
  ADD COLUMN IF NOT EXISTS archive_note TEXT,
  ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

UPDATE relationship_maps
SET
  map_type = COALESCE(map_type, CASE WHEN target_object_type = 'opportunity_candidate' THEN 'opportunity_access' ELSE 'organization_access' END),
  objective = COALESCE(objective, 'Build relationship access to the target organization.'),
  related_candidate_id = COALESCE(related_candidate_id, CASE WHEN target_object_type = 'opportunity_candidate' THEN target_object_id ELSE NULL END)
WHERE map_type IS NULL OR objective IS NULL OR related_candidate_id IS NULL;

ALTER TABLE relationship_maps
  ALTER COLUMN map_type SET DEFAULT 'organization_access',
  ALTER COLUMN objective SET DEFAULT 'Build relationship access to the target organization.',
  ALTER COLUMN strategic_flag SET DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'relationship_maps_map_type_check') THEN
    ALTER TABLE relationship_maps ADD CONSTRAINT relationship_maps_map_type_check
      CHECK (map_type IS NULL OR map_type IN ('organization_access', 'opportunity_access', 'customer_access', 'prime_access', 'engineering_access', 'capacity_access', 'billing_access', 'field_access', 'executive_access'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'relationship_maps_access_score_check') THEN
    ALTER TABLE relationship_maps ADD CONSTRAINT relationship_maps_access_score_check
      CHECK (access_score IS NULL OR (access_score >= 0 AND access_score <= 100));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'relationship_maps_archive_reason_check') THEN
    ALTER TABLE relationship_maps ADD CONSTRAINT relationship_maps_archive_reason_check
      CHECK (archive_reason IS NULL OR archive_reason IN ('no_longer_relevant', 'duplicate', 'target_changed', 'organization_inactive', 'opportunity_lost', 'relationship_no_longer_useful', 'other'));
  END IF;
END $$;

ALTER TABLE relationship_paths
  ADD COLUMN IF NOT EXISTS path_name TEXT,
  ADD COLUMN IF NOT EXISTS path_summary TEXT,
  ADD COLUMN IF NOT EXISTS recommended_action TEXT,
  ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_successful_outcome TEXT,
  ADD COLUMN IF NOT EXISTS risk_notes TEXT,
  ADD COLUMN IF NOT EXISTS blocked_reason TEXT,
  ADD COLUMN IF NOT EXISTS archive_reason TEXT,
  ADD COLUMN IF NOT EXISTS archive_note TEXT,
  ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

UPDATE relationship_paths
SET path_name = COALESCE(path_name, 'Relationship path')
WHERE path_name IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'relationship_paths_archive_reason_check') THEN
    ALTER TABLE relationship_paths ADD CONSTRAINT relationship_paths_archive_reason_check
      CHECK (archive_reason IS NULL OR archive_reason IN ('no_longer_valid', 'duplicate', 'contact_left_company', 'weak_or_unusable', 'replaced_by_better_path', 'target_changed', 'other'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS relationship_maps_tenant_map_type_idx ON relationship_maps(tenant_id, map_type);
CREATE INDEX IF NOT EXISTS relationship_maps_tenant_status_idx ON relationship_maps(tenant_id, status);
CREATE INDEX IF NOT EXISTS relationship_maps_tenant_owner_idx ON relationship_maps(tenant_id, owner_user_id);
CREATE INDEX IF NOT EXISTS relationship_maps_tenant_target_org_idx ON relationship_maps(tenant_id, target_organization_id);
CREATE INDEX IF NOT EXISTS relationship_maps_tenant_target_contact_idx ON relationship_maps(tenant_id, target_contact_id);
CREATE INDEX IF NOT EXISTS relationship_maps_tenant_candidate_idx ON relationship_maps(tenant_id, related_candidate_id);
CREATE INDEX IF NOT EXISTS relationship_maps_tenant_opportunity_idx ON relationship_maps(tenant_id, related_opportunity_id);
CREATE INDEX IF NOT EXISTS relationship_maps_tenant_strategic_idx ON relationship_maps(tenant_id, strategic_flag);
CREATE INDEX IF NOT EXISTS relationship_maps_tenant_archived_idx ON relationship_maps(tenant_id, archived_at);
CREATE INDEX IF NOT EXISTS relationship_maps_tenant_due_date_idx ON relationship_maps(tenant_id, due_date);

CREATE INDEX IF NOT EXISTS relationship_paths_tenant_map_idx ON relationship_paths(tenant_id, relationship_map_id);
CREATE INDEX IF NOT EXISTS relationship_paths_tenant_status_idx ON relationship_paths(tenant_id, status);
CREATE INDEX IF NOT EXISTS relationship_paths_tenant_rank_idx ON relationship_paths(tenant_id, rank);
CREATE INDEX IF NOT EXISTS relationship_paths_tenant_from_contact_idx ON relationship_paths(tenant_id, from_contact_id);
CREATE INDEX IF NOT EXISTS relationship_paths_tenant_to_contact_idx ON relationship_paths(tenant_id, to_contact_id);
CREATE INDEX IF NOT EXISTS relationship_paths_tenant_archived_idx ON relationship_paths(tenant_id, archived_at);
