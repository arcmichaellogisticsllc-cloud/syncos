CREATE TABLE revoked_auth_sessions (
 token_hash text PRIMARY KEY CHECK(length(token_hash)=64),
 user_id uuid NOT NULL REFERENCES users(id),
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX revoked_auth_sessions_expiry ON revoked_auth_sessions(expires_at);
