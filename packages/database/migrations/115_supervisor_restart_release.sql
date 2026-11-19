-- Open shutdowns require an explicit internal-supervisor release after existing
-- safety clearances. Historical released records retain their original facts.
ALTER TABLE work_safety_approvals DROP CONSTRAINT work_safety_approvals_approval_kind_check;
ALTER TABLE work_safety_approvals ADD CONSTRAINT work_safety_approvals_approval_kind_check
  CHECK (approval_kind IN ('construction_supervisor','utility_owner','safety','operations','supervisor_release'));

UPDATE work_safety_controls
SET required_approvals = array_append(array_remove(required_approvals, 'supervisor_release'), 'supervisor_release')
WHERE control_type = 'stop' AND status IN ('pending','active');

-- Also protect imported controls and older application writers. Never let a
-- classification change omit or reorder the final supervisor release.
CREATE FUNCTION require_supervisor_restart_release() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.control_type = 'stop' AND NEW.status IN ('pending','active') THEN
    NEW.required_approvals := array_append(array_remove(NEW.required_approvals, 'supervisor_release'), 'supervisor_release');
  END IF;
  IF NEW.control_type = 'stop' AND NEW.status = 'released'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'released') THEN
    IF NOT ('supervisor_release' = ANY(NEW.required_approvals)) OR NOT EXISTS (
      SELECT 1 FROM work_safety_approvals a
      WHERE a.tenant_id = NEW.tenant_id AND a.control_id = NEW.id
        AND a.approval_kind = 'supervisor_release'
    ) THEN
      RAISE EXCEPTION 'Internal supervisor release is required before resuming work';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER work_safety_supervisor_restart
BEFORE INSERT OR UPDATE ON work_safety_controls
FOR EACH ROW EXECUTE FUNCTION require_supervisor_restart_release();
