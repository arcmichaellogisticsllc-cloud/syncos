ALTER TABLE production_records
  ADD COLUMN IF NOT EXISTS tick_start_x_ratio NUMERIC(8,6),
  ADD COLUMN IF NOT EXISTS tick_start_y_ratio NUMERIC(8,6),
  ADD COLUMN IF NOT EXISTS tick_end_x_ratio NUMERIC(8,6),
  ADD COLUMN IF NOT EXISTS tick_end_y_ratio NUMERIC(8,6),
  ADD COLUMN IF NOT EXISTS tick_start_label TEXT,
  ADD COLUMN IF NOT EXISTS tick_end_label TEXT,
  ADD COLUMN IF NOT EXISTS reel_cable_id TEXT,
  ADD COLUMN IF NOT EXISTS fiber_type TEXT,
  ADD COLUMN IF NOT EXISTS sequence_start NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS sequence_end NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS sequence_direction TEXT,
  ADD COLUMN IF NOT EXISTS sequence_calculated_footage NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS sequence_reported_variance NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS sequence_variance_status TEXT,
  ADD COLUMN IF NOT EXISTS sequence_variance_explanation TEXT;

ALTER TABLE production_records DROP CONSTRAINT IF EXISTS production_records_tick_ratios_check;
ALTER TABLE production_records ADD CONSTRAINT production_records_tick_ratios_check CHECK (
  (tick_start_x_ratio IS NULL OR (tick_start_x_ratio >= 0 AND tick_start_x_ratio <= 1))
  AND (tick_start_y_ratio IS NULL OR (tick_start_y_ratio >= 0 AND tick_start_y_ratio <= 1))
  AND (tick_end_x_ratio IS NULL OR (tick_end_x_ratio >= 0 AND tick_end_x_ratio <= 1))
  AND (tick_end_y_ratio IS NULL OR (tick_end_y_ratio >= 0 AND tick_end_y_ratio <= 1))
);

ALTER TABLE production_records DROP CONSTRAINT IF EXISTS production_records_sequence_direction_check;
ALTER TABLE production_records ADD CONSTRAINT production_records_sequence_direction_check CHECK (
  sequence_direction IS NULL OR sequence_direction IN ('increasing', 'decreasing', 'same')
);

ALTER TABLE production_records DROP CONSTRAINT IF EXISTS production_records_sequence_variance_status_check;
ALTER TABLE production_records ADD CONSTRAINT production_records_sequence_variance_status_check CHECK (
  sequence_variance_status IS NULL OR sequence_variance_status IN ('not_applicable', 'within_tolerance', 'review_required')
);

ALTER TABLE map_annotations DROP CONSTRAINT IF EXISTS map_annotations_annotation_type_check;
ALTER TABLE map_annotations ADD CONSTRAINT map_annotations_annotation_type_check CHECK (
  annotation_type IN ('asset_point', 'route_line', 'status_mark', 'tick_span')
);

CREATE INDEX IF NOT EXISTS production_records_field_traceability_idx
  ON production_records(tenant_id, work_order_version_id, reel_cable_id, sequence_variance_status)
  WHERE daily_production_report_id IS NOT NULL AND deleted_at IS NULL;
