CREATE TABLE kpi_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  kpi_name TEXT,
  kpi_category TEXT CHECK (kpi_category IS NULL OR kpi_category IN ('intelligence', 'opportunity', 'capacity', 'execution', 'cash', 'optimization')),
  formula_description TEXT,
  calculation_frequency TEXT,
  owner_role TEXT,
  target_value NUMERIC(14,4),
  alert_threshold NUMERIC(14,4),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  calculation TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (tenant_id, key)
);

CREATE TABLE kpi_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  kpi_definition_id UUID NOT NULL REFERENCES kpi_definitions(id),
  value NUMERIC(14,4) NOT NULL,
  snapshot_at TIMESTAMPTZ NOT NULL,
  snapshot_period_start TIMESTAMPTZ,
  snapshot_period_end TIMESTAMPTZ,
  territory_id UUID REFERENCES territories(id),
  object_type TEXT,
  object_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE kpi_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  kpi_definition_id UUID NOT NULL REFERENCES kpi_definitions(id),
  severity TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  related_object_type TEXT,
  related_object_id UUID,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'archived')),
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX kpi_definitions_tenant_id_idx ON kpi_definitions(tenant_id);
CREATE INDEX kpi_snapshots_tenant_id_idx ON kpi_snapshots(tenant_id);
CREATE INDEX kpi_alerts_tenant_id_idx ON kpi_alerts(tenant_id);

CREATE TABLE learning_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  event_type TEXT NOT NULL,
  learning_type TEXT CHECK (learning_type IS NULL OR learning_type IN ('signal', 'relationship', 'organization', 'capacity', 'customer', 'recommendation')),
  source_event_id UUID,
  source_object_type TEXT,
  source_object_id UUID,
  outcome_object_type TEXT,
  outcome_object_id UUID,
  positive BOOLEAN,
  score_delta NUMERIC(8,4),
  entity_type TEXT,
  entity_id UUID,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE learning_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  object_type TEXT,
  object_id UUID,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  score_type TEXT NOT NULL,
  score_value NUMERIC(8,4),
  confidence NUMERIC(8,4),
  score NUMERIC(8,4) NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (tenant_id, score_type, entity_type, entity_id)
);

CREATE TABLE score_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  learning_score_id UUID REFERENCES learning_scores(id),
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  score_type TEXT NOT NULL,
  previous_score NUMERIC(8,4),
  new_score NUMERIC(8,4) NOT NULL,
  reason TEXT,
  source_event_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX learning_events_tenant_id_idx ON learning_events(tenant_id);
CREATE INDEX learning_scores_tenant_id_idx ON learning_scores(tenant_id);
CREATE INDEX score_history_tenant_id_idx ON score_history(tenant_id);
