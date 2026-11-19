CREATE TABLE material_discrepancies (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id UUID NOT NULL,organization_id UUID NOT NULL,assignment_id UUID NOT NULL,
 lot_id UUID NOT NULL,location_id UUID NOT NULL,reported_count NUMERIC(18,4) NOT NULL CHECK(reported_count>=0),recorded_balance NUMERIC(18,4) NOT NULL,
 reference TEXT NOT NULL,description TEXT NOT NULL,request_key UUID NOT NULL,reported_by UUID NOT NULL REFERENCES users(id),created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')),resolution_note TEXT,resolved_by UUID REFERENCES users(id),resolved_at TIMESTAMPTZ,adjustment_id UUID,
 UNIQUE(tenant_id,request_key),
 FOREIGN KEY(tenant_id,organization_id) REFERENCES organizations(tenant_id,id),
 FOREIGN KEY(tenant_id,assignment_id) REFERENCES syncfield_map_assignments(tenant_id,id),
 FOREIGN KEY(tenant_id,lot_id) REFERENCES material_lots(tenant_id,id),
 FOREIGN KEY(tenant_id,location_id) REFERENCES material_locations(tenant_id,id),
 FOREIGN KEY(adjustment_id) REFERENCES material_movements(id)
);
CREATE INDEX material_discrepancy_queue ON material_discrepancies(tenant_id,created_at DESC,id DESC);
INSERT INTO permissions(key,name) VALUES('partner_inventory.report','Report company material discrepancies') ON CONFLICT(key) DO NOTHING;
INSERT INTO role_permissions(tenant_id,role_id,permission_id) SELECT r.tenant_id,r.id,p.id FROM roles r CROSS JOIN permissions p WHERE r.system_key='partner_admin' AND r.deleted_at IS NULL AND p.key='partner_inventory.report' ON CONFLICT DO NOTHING;
