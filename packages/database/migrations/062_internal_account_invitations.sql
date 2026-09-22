CREATE TABLE internal_account_invitations (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id UUID NOT NULL REFERENCES tenants(id),
 user_id UUID NOT NULL REFERENCES users(id),
 token_hash TEXT NOT NULL UNIQUE,
 expires_at TIMESTAMPTZ NOT NULL,
 accepted_at TIMESTAMPTZ,
 revoked_at TIMESTAMPTZ,
 created_by UUID NOT NULL REFERENCES users(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
