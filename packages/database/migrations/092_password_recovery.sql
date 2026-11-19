ALTER TABLE users ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 0 CHECK(auth_version>=0);
CREATE TABLE password_recovery_requests (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),user_id UUID NOT NULL REFERENCES users(id),
 token_hash TEXT NOT NULL UNIQUE,expires_at TIMESTAMPTZ NOT NULL,used_at TIMESTAMPTZ,
 encrypted_message TEXT,delivery_status TEXT NOT NULL DEFAULT 'pending' CHECK(delivery_status IN ('pending','sent','failed','expired')),
 attempts INTEGER NOT NULL DEFAULT 0,next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX password_recovery_delivery ON password_recovery_requests(next_attempt_at) WHERE delivery_status='pending';
CREATE TABLE password_recovery_limits (key_hash TEXT PRIMARY KEY,window_start TIMESTAMPTZ NOT NULL,attempts INTEGER NOT NULL);
CREATE TABLE password_recovery_audit(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),user_id UUID NOT NULL REFERENCES users(id),request_id UUID NOT NULL REFERENCES password_recovery_requests(id),event_type TEXT NOT NULL CHECK(event_type IN ('password_reset','delivery_failed')),created_at TIMESTAMPTZ NOT NULL DEFAULT now());
