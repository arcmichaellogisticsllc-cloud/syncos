-- Preserve signed history. A revision supersedes the current daily JSA without
-- rewriting the completed record or its historical report references.
ALTER TABLE daily_jsas ADD COLUMN current BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE daily_jsas ADD COLUMN prior_jsa_id UUID;
ALTER TABLE daily_jsas ADD COLUMN revision_reason TEXT;
ALTER TABLE daily_jsas ADD CONSTRAINT daily_jsas_prior_tenant_fk
 FOREIGN KEY (tenant_id, prior_jsa_id) REFERENCES daily_jsas(tenant_id,id);
DROP INDEX daily_jsas_current_day_uidx;
CREATE UNIQUE INDEX daily_jsas_current_day_uidx ON daily_jsas(tenant_id,work_order_version_id,crew_id,work_date)
 WHERE deleted_at IS NULL AND status <> 'void' AND current=true;
ALTER TABLE daily_jsa_participants ADD COLUMN attendance_recorded_by UUID REFERENCES users(id);
ALTER TABLE daily_jsa_participants ADD COLUMN attendance_recorded_at TIMESTAMPTZ;
-- Legacy acknowledged values remain untouched and must not be represented as
-- independently signed by a worker. New completions never bulk-acknowledge.
