-- Transaction timestamps cannot safely identify notifications arriving during a lease.
ALTER TABLE passport_refresh_jobs ADD COLUMN hint_version BIGINT NOT NULL DEFAULT 1 CHECK(hint_version>0);
ALTER TABLE passport_refresh_jobs ADD COLUMN leased_hint_version BIGINT;
-- An upgrade conservatively retries any previously leased work.
UPDATE passport_refresh_jobs SET leased_hint_version=0 WHERE status='leased';
