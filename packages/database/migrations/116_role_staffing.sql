CREATE TABLE staffing_plans (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES tenants(id),
 work_order_id UUID NOT NULL, work_order_version_id UUID NOT NULL, crew_id UUID NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>0), phase TEXT NOT NULL, requirements JSONB NOT NULL,
 plan_reference TEXT NOT NULL, pause_instructions TEXT NOT NULL,
 proposed_by UUID NOT NULL REFERENCES users(id), proposed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 approved_by UUID REFERENCES users(id), approved_at TIMESTAMPTZ, review_reference TEXT,
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,work_order_version_id,crew_id,revision),
 FOREIGN KEY(tenant_id,work_order_id) REFERENCES work_orders(tenant_id,id),
 FOREIGN KEY(tenant_id,work_order_version_id) REFERENCES partner_work_order_versions(tenant_id,id),
 FOREIGN KEY(tenant_id,crew_id) REFERENCES crews(tenant_id,id)
);
CREATE TABLE staffing_eligibilities (
 tenant_id UUID NOT NULL, plan_id UUID NOT NULL, worker_id UUID NOT NULL, role_code TEXT NOT NULL,
 valid_until TIMESTAMPTZ NOT NULL, evidence_reference TEXT NOT NULL, revoked BOOLEAN NOT NULL DEFAULT false,
 credential_snapshots JSONB NOT NULL DEFAULT '[]'::jsonb,
 verified_by UUID NOT NULL REFERENCES users(id), verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,plan_id,worker_id,role_code),
 FOREIGN KEY(tenant_id,plan_id) REFERENCES staffing_plans(tenant_id,id),
 FOREIGN KEY(tenant_id,worker_id) REFERENCES workers(tenant_id,id)
);
CREATE TABLE staffing_checks (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, plan_id UUID NOT NULL,
 work_order_id UUID NOT NULL, crew_id UUID NOT NULL, daily_jsa_id UUID NOT NULL,
 client_mutation_id UUID NOT NULL, request JSONB NOT NULL, coverage JSONB NOT NULL, findings TEXT[] NOT NULL,
 checked_by UUID NOT NULL REFERENCES users(id), checked_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 shift_ends_at TIMESTAMPTZ NOT NULL, reason TEXT NOT NULL, unsafe_reason TEXT,
 ended_at TIMESTAMPTZ, ended_by UUID REFERENCES users(id), end_reason TEXT,
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,client_mutation_id),
 FOREIGN KEY(tenant_id,plan_id) REFERENCES staffing_plans(tenant_id,id),
 FOREIGN KEY(tenant_id,work_order_id) REFERENCES work_orders(tenant_id,id),
 FOREIGN KEY(tenant_id,crew_id) REFERENCES crews(tenant_id,id),
 FOREIGN KEY(tenant_id,daily_jsa_id) REFERENCES daily_jsas(tenant_id,id)
);
CREATE INDEX staffing_checks_scope ON staffing_checks(tenant_id,work_order_id,crew_id,checked_at DESC,id DESC);
-- Serialized per tenant; expired claims are removed before a new check. Current
-- claims include protective roles even when production coverage is insufficient.
CREATE TABLE staffing_claims (
 tenant_id UUID NOT NULL, worker_id UUID NOT NULL, check_id UUID NOT NULL, crew_id UUID NOT NULL,
 ends_at TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(tenant_id,worker_id),
 FOREIGN KEY(tenant_id,worker_id) REFERENCES workers(tenant_id,id),
 FOREIGN KEY(tenant_id,check_id) REFERENCES staffing_checks(tenant_id,id),
 FOREIGN KEY(tenant_id,crew_id) REFERENCES crews(tenant_id,id)
);
CREATE TABLE staffing_cases (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, work_order_id UUID NOT NULL, crew_id UUID NOT NULL,
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','awaiting_release','released')),
 findings TEXT[] NOT NULL, latest_check_id UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 recheck_after TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 acknowledged_by UUID REFERENCES users(id), acknowledged_at TIMESTAMPTZ, contact_note TEXT,
 released_by UUID REFERENCES users(id), released_at TIMESTAMPTZ, release_reference TEXT,
 UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,work_order_id) REFERENCES work_orders(tenant_id,id),
 FOREIGN KEY(tenant_id,crew_id) REFERENCES crews(tenant_id,id),
 FOREIGN KEY(tenant_id,latest_check_id) REFERENCES staffing_checks(tenant_id,id)
);
CREATE UNIQUE INDEX staffing_case_open ON staffing_cases(tenant_id,work_order_id,crew_id) WHERE status<>'released';
CREATE TABLE staffing_case_events (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, case_id UUID NOT NULL,
 actor_user_id UUID REFERENCES users(id), event_type TEXT NOT NULL, details JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,case_id) REFERENCES staffing_cases(tenant_id,id)
);
CREATE TABLE staffing_notices (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, case_id UUID NOT NULL,
 target TEXT NOT NULL CHECK(target IN ('supervisor','backup_supervisor','business_owner')),
 due_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,case_id,target), FOREIGN KEY(tenant_id,case_id) REFERENCES staffing_cases(tenant_id,id)
);
