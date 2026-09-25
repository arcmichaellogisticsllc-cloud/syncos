-- Partner declarations require a separate internal review; they never create custody or verified capacity.
CREATE TABLE partner_setup_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  capacity_provider_id uuid NOT NULL REFERENCES capacity_providers(id),
  request_type text NOT NULL CHECK (request_type IN ('equipment', 'capability_territory')),
  description text NOT NULL CHECK (length(description) BETWEEN 1 AND 4000),
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'under_review', 'action_required', 'recorded')),
  response text,
  client_mutation_id uuid NOT NULL,
  submitted_by_user_id uuid NOT NULL REFERENCES users(id),
  reviewed_by_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, organization_id, client_mutation_id)
);
CREATE INDEX partner_setup_requests_queue_idx ON partner_setup_requests(tenant_id, organization_id, status);
