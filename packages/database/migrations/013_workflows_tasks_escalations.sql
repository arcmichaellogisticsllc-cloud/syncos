CREATE TABLE workflow_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  workflow_name TEXT,
  workflow_category TEXT CHECK (workflow_category IS NULL OR workflow_category IN ('intelligence', 'opportunity', 'relationship', 'capacity', 'execution', 'settlement', 'cash', 'constraint', 'recommendation', 'governance')),
  trigger_event_type TEXT,
  start_status TEXT,
  end_status TEXT,
  sla_hours INTEGER CHECK (sla_hours IS NULL OR sla_hours > 0),
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (tenant_id, name, version)
);

CREATE TABLE workflow_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  workflow_definition_id UUID NOT NULL REFERENCES workflow_definitions(id),
  step_key TEXT NOT NULL,
  step_type TEXT NOT NULL,
  step_order INTEGER,
  step_name TEXT,
  owner_role TEXT,
  required_action TEXT,
  sla_hours INTEGER CHECK (sla_hours IS NULL OR sla_hours > 0),
  approval_required BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  sort_order INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (workflow_definition_id, step_order)
);

CREATE TABLE workflow_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  workflow_definition_id UUID NOT NULL REFERENCES workflow_definitions(id),
  entity_type TEXT,
  entity_id UUID,
  source_object_type TEXT,
  source_object_id UUID,
  owner_user_id UUID REFERENCES users(id),
  due_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancel_reason TEXT,
  status TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'started', 'in_progress', 'completed', 'cancelled', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE workflow_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  workflow_instance_id UUID REFERENCES workflow_instances(id),
  step_id UUID REFERENCES workflow_steps(id),
  assigned_to UUID REFERENCES users(id),
  assigned_role TEXT,
  assigned_user_id UUID REFERENCES users(id),
  assigned_role_id UUID REFERENCES roles(id),
  title TEXT NOT NULL,
  task_name TEXT,
  completion_note TEXT,
  reassignment_reason TEXT,
  escalation_reason TEXT,
  completed_at TIMESTAMPTZ,
  reassigned_at TIMESTAMPTZ,
  escalated_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'completed', 'reassigned', 'escalated', 'cancelled', 'archived')),
  due_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE workflow_escalations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  workflow_task_id UUID NOT NULL REFERENCES workflow_tasks(id),
  workflow_instance_id UUID REFERENCES workflow_instances(id),
  escalated_by UUID REFERENCES users(id),
  escalated_to_role TEXT,
  escalated_to_role_id UUID REFERENCES roles(id),
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX workflow_definitions_tenant_id_idx ON workflow_definitions(tenant_id);
CREATE INDEX workflow_steps_tenant_id_idx ON workflow_steps(tenant_id);
CREATE INDEX workflow_instances_tenant_id_idx ON workflow_instances(tenant_id);
CREATE INDEX workflow_tasks_tenant_id_idx ON workflow_tasks(tenant_id);
CREATE INDEX workflow_escalations_tenant_id_idx ON workflow_escalations(tenant_id);
