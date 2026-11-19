-- Restore documented browser-demo duties after legacy production.* names drifted
-- from production_record.* API permissions. This is additive and never reseeds
-- records, credentials or user assignments. Only the named demo tenant/roles
-- are reconciled; real pilot roles require their own reviewed permission matrix.
-- Sources: docs/product/e2e-persona-permission-matrix.md (Ops, Field, QC Reviewer),
-- docs/product/operator-uat-plan.md (Operations dashboard / QC inspection).
WITH grants(role_key, permission_key) AS (VALUES
  ('e2e_ops_manager', 'production_record.read'),
  ('e2e_ops_manager', 'production_record.create'),
  ('e2e_ops_manager', 'production_record.update'),
  ('e2e_ops_manager', 'production_record.submit'),
  ('e2e_ops_manager', 'production.timeline.read'),
  ('e2e_ops_manager', 'dashboard.operations.read'),
  ('e2e_ops_manager', 'qc_review.read'),
  ('e2e_field_supervisor', 'production_record.read'),
  ('e2e_field_supervisor', 'production_record.create'),
  ('e2e_field_supervisor', 'production_record.update'),
  ('e2e_field_supervisor', 'production_record.submit'),
  ('e2e_qc_reviewer', 'production_record.read'),
  ('e2e_billing_manager', 'billing.read'),
  ('e2e_billing_manager', 'billing.create_billable'),
  ('e2e_billing_manager', 'billing.create_invoice')
)
INSERT INTO role_permissions (tenant_id, role_id, permission_id)
SELECT r.tenant_id, r.id, p.id
FROM grants g
JOIN roles r ON r.system_key = g.role_key AND r.deleted_at IS NULL
JOIN tenants t ON t.id = r.tenant_id AND t.slug = 'arc-syncos-demo'
JOIN permissions p ON p.key = g.permission_key
ON CONFLICT (role_id, permission_id) DO NOTHING;
