ALTER TABLE production_export_artifacts ADD COLUMN source_query JSONB;
-- Old export provenance cannot be reconstructed reliably; retain files as historical exports.
CREATE TABLE administrative_production_corrections (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id UUID NOT NULL REFERENCES tenants(id),production_record_id UUID NOT NULL REFERENCES production_records(id),
 prior_quantity NUMERIC NOT NULL,corrected_quantity NUMERIC NOT NULL CHECK(corrected_quantity>=0),
 correction_note TEXT NOT NULL,recorded_by UUID NOT NULL REFERENCES users(id),recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER administrative_correction_immutable BEFORE UPDATE OR DELETE ON administrative_production_corrections FOR EACH ROW EXECUTE FUNCTION protect_commercial_terms_revision();
