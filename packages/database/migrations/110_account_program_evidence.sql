-- Additive account program policies. Legacy summaries and records are preserved.
ALTER TABLE account_onboarding_profiles ADD CONSTRAINT account_onboarding_tenant_id_unique UNIQUE(tenant_id,id);
CREATE TABLE account_programs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
 profile_id uuid NOT NULL, name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 160),
 created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,profile_id) REFERENCES account_onboarding_profiles(tenant_id,id),
 UNIQUE(tenant_id,id), UNIQUE(profile_id,name)
);
CREATE TABLE account_program_originals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, program_id uuid NOT NULL,
 file_name text NOT NULL, mime_type text NOT NULL, checksum text NOT NULL, content bytea NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,program_id) REFERENCES account_programs(tenant_id,id),
 CHECK(octet_length(content) BETWEEN 1 AND 10485760), UNIQUE(tenant_id,id), UNIQUE(program_id,checksum)
);
CREATE TABLE account_program_policies (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, program_id uuid NOT NULL,
 revision integer NOT NULL CHECK(revision>0), source_original_id uuid NOT NULL,
 effective_from date NOT NULL, effective_until date, requirements jsonb NOT NULL CHECK(jsonb_typeof(requirements)='array'),
 reason text NOT NULL, approved_by uuid NOT NULL REFERENCES users(id), approved_at timestamptz NOT NULL DEFAULT now(),
 CHECK(effective_until IS NULL OR effective_until>=effective_from),
 FOREIGN KEY(tenant_id,program_id) REFERENCES account_programs(tenant_id,id),
 FOREIGN KEY(tenant_id,source_original_id) REFERENCES account_program_originals(tenant_id,id),
 UNIQUE(tenant_id,id), UNIQUE(program_id,revision)
);
CREATE TABLE account_program_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, policy_id uuid NOT NULL,
 requirement_key text NOT NULL, original_id uuid NOT NULL, decision text NOT NULL CHECK(decision IN ('submitted','approved','rejected')),
 expires_on date, reason text NOT NULL, reviewed_by uuid NOT NULL REFERENCES users(id), reviewed_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,policy_id) REFERENCES account_program_policies(tenant_id,id),
 FOREIGN KEY(tenant_id,original_id) REFERENCES account_program_originals(tenant_id,id)
);
CREATE INDEX account_program_profile ON account_programs(tenant_id,profile_id);
CREATE INDEX account_program_review_history ON account_program_reviews(tenant_id,policy_id,requirement_key,reviewed_at,id);
CREATE TRIGGER account_program_policy_immutable BEFORE UPDATE OR DELETE ON account_program_policies FOR EACH ROW EXECUTE FUNCTION protect_commercial_terms_revision();
CREATE TRIGGER account_program_review_immutable BEFORE UPDATE OR DELETE ON account_program_reviews FOR EACH ROW EXECUTE FUNCTION protect_commercial_terms_revision();
CREATE TRIGGER account_program_original_immutable BEFORE UPDATE OR DELETE ON account_program_originals FOR EACH ROW EXECUTE FUNCTION protect_commercial_terms_revision();
