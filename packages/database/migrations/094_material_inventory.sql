CREATE TABLE material_lots (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id UUID NOT NULL REFERENCES tenants(id),
 label TEXT NOT NULL,serial_number TEXT NOT NULL,unit TEXT NOT NULL CHECK(unit IN ('feet','each')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),UNIQUE(tenant_id,id),UNIQUE(tenant_id,serial_number)
);
CREATE TABLE material_locations (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id UUID NOT NULL REFERENCES tenants(id),
 label TEXT NOT NULL,crew_id UUID,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),UNIQUE(tenant_id,id),
 FOREIGN KEY(crew_id) REFERENCES crews(id)
);
CREATE TABLE material_movements (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id UUID NOT NULL REFERENCES tenants(id),lot_id UUID NOT NULL,
 from_location_id UUID,to_location_id UUID,kind TEXT NOT NULL CHECK(kind IN ('receipt','transfer','installed','scrap','offcut','adjustment')),
 quantity NUMERIC(18,4) NOT NULL CHECK(quantity<>0),reference TEXT NOT NULL,reason TEXT NOT NULL,
 work_order_id UUID REFERENCES work_orders(id),actor_user_id UUID NOT NULL REFERENCES users(id),request_key UUID NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),UNIQUE(tenant_id,request_key),
 FOREIGN KEY(tenant_id,lot_id) REFERENCES material_lots(tenant_id,id),
 FOREIGN KEY(tenant_id,from_location_id) REFERENCES material_locations(tenant_id,id),
 FOREIGN KEY(tenant_id,to_location_id) REFERENCES material_locations(tenant_id,id),
 CHECK(from_location_id IS NOT NULL OR to_location_id IS NOT NULL),
 CHECK(from_location_id IS NULL OR to_location_id IS NULL OR from_location_id<>to_location_id),
 CHECK(kind='adjustment' OR quantity>0)
);
CREATE FUNCTION protect_material_movement() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Inventory movements are immutable; record an approved adjustment'; END $$;
CREATE TRIGGER immutable_movement BEFORE UPDATE OR DELETE ON material_movements FOR EACH ROW EXECUTE FUNCTION protect_material_movement();
INSERT INTO permissions(key,name) VALUES ('inventory.read','Read material inventory'),('inventory.manage','Receive and move material'),('inventory.adjust','Approve material count adjustments') ON CONFLICT(key) DO NOTHING;
INSERT INTO role_permissions(tenant_id,role_id,permission_id) SELECT r.tenant_id,r.id,p.id FROM roles r CROSS JOIN permissions p WHERE r.system_key='system_admin' AND r.deleted_at IS NULL AND p.key IN ('inventory.read','inventory.manage','inventory.adjust') ON CONFLICT DO NOTHING;
