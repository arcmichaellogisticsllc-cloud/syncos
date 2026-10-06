-- Administrative identity changes and sign-in events are append-only evidence.
CREATE TRIGGER identity_audit_immutable BEFORE UPDATE OR DELETE ON identity_audit FOR EACH ROW EXECUTE FUNCTION protect_commercial_terms_revision();
