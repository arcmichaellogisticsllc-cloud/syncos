-- Public channels are explicitly enabled by authorized staff; existing records are preserved.
ALTER TABLE customer_service_inquiries ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE customer_service_inquiries ADD COLUMN due_at TIMESTAMPTZ;
CREATE TABLE customer_intake_channels (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES tenants(id),
 slug TEXT NOT NULL UNIQUE CHECK(slug ~ '^[a-z0-9][a-z0-9-]{7,79}$'),
 label TEXT NOT NULL, privacy_notice TEXT NOT NULL, enabled BOOLEAN NOT NULL DEFAULT false,
 owner_user_id UUID NOT NULL REFERENCES users(id), escalation_user_id UUID NOT NULL REFERENCES users(id),
 follow_up_hours INTEGER NOT NULL CHECK(follow_up_hours BETWEEN 1 AND 720),
 configured_by UUID NOT NULL REFERENCES users(id), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(tenant_id,id)
);
CREATE TABLE public_intake_receipts (
 channel_id UUID NOT NULL REFERENCES customer_intake_channels(id), request_key UUID NOT NULL,
 tenant_id UUID NOT NULL, inquiry_id UUID NOT NULL, payload_hash TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(channel_id,request_key),
 FOREIGN KEY(tenant_id,inquiry_id) REFERENCES customer_service_inquiries(tenant_id,id)
);
CREATE TABLE public_intake_limits(key_hash TEXT PRIMARY KEY,window_start TIMESTAMPTZ NOT NULL DEFAULT now(),attempts INTEGER NOT NULL DEFAULT 1);
CREATE TABLE inquiry_follow_up_notifications (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id UUID NOT NULL,inquiry_id UUID NOT NULL,
 recipient_user_id UUID NOT NULL REFERENCES users(id),kind TEXT NOT NULL CHECK(kind IN ('assigned','overdue')),
 dedupe_key TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','failed','cancelled')),
 attempts INTEGER NOT NULL DEFAULT 0,next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 sent_at TIMESTAMPTZ,last_error TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,inquiry_id) REFERENCES customer_service_inquiries(tenant_id,id),UNIQUE(tenant_id,dedupe_key)
);
CREATE TABLE inquiry_notification_attempts (
 id BIGSERIAL PRIMARY KEY,notification_id UUID NOT NULL REFERENCES inquiry_follow_up_notifications(id),
 status TEXT NOT NULL CHECK(status IN ('sent','failed','cancelled','retry_requested')), created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 actor_user_id UUID REFERENCES users(id)
);
CREATE INDEX inquiry_follow_up_due ON customer_service_inquiries(due_at) WHERE status NOT IN ('closed','qualified');
CREATE INDEX inquiry_notifications_ready ON inquiry_follow_up_notifications(next_attempt_at) WHERE status='pending';
