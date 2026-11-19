CREATE TABLE password_login_limits(key_hash text PRIMARY KEY,window_start timestamptz NOT NULL DEFAULT now(),attempts integer NOT NULL CHECK(attempts>0));
CREATE INDEX password_login_limits_expiry ON password_login_limits(window_start);
