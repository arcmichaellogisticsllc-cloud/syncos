-- Separate token domains: a sign-in token can never reset a password.
CREATE TABLE magic_link_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id), tenant_id uuid NOT NULL REFERENCES tenants(id),
 auth_version integer NOT NULL, token_hash text NOT NULL UNIQUE,
 expires_at timestamptz NOT NULL, used_at timestamptz,
 encrypted_message text, delivery_status text NOT NULL DEFAULT 'pending' CHECK(delivery_status IN ('pending','sent','failed','expired')),
 attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX magic_link_pending ON magic_link_requests(next_attempt_at) WHERE delivery_status='pending';
CREATE TABLE identity_rate_limits(key_hash text PRIMARY KEY,window_start timestamptz NOT NULL,attempts integer NOT NULL);
CREATE TABLE identity_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid REFERENCES tenants(id), user_id uuid REFERENCES users(id),
 actor_id uuid REFERENCES users(id), event_type text NOT NULL, reference_id uuid, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX identity_audit_tenant ON identity_audit(tenant_id,created_at,id);
CREATE TABLE oidc_connections (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
 name text NOT NULL, issuer text NOT NULL, client_id text NOT NULL, secret_env text NOT NULL,
 authorization_endpoint text NOT NULL, token_endpoint text NOT NULL, jwks_uri text NOT NULL,
 enabled boolean NOT NULL DEFAULT false, version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id)
);
CREATE TABLE oidc_identity_links (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, connection_id uuid NOT NULL,
 user_id uuid NOT NULL REFERENCES users(id), subject text NOT NULL, active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,connection_id) REFERENCES oidc_connections(tenant_id,id),
 UNIQUE(connection_id,subject), UNIQUE(connection_id,user_id)
);
CREATE TABLE oidc_login_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), connection_id uuid NOT NULL REFERENCES oidc_connections(id),
 connection_version integer NOT NULL, state_hash text NOT NULL UNIQUE, binding_hash text NOT NULL,
 nonce text NOT NULL, encrypted_verifier text, expires_at timestamptz NOT NULL,
 used_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX oidc_pending_expiry ON oidc_login_requests(expires_at) WHERE used_at IS NULL;
