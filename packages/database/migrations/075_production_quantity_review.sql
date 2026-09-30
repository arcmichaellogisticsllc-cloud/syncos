CREATE TABLE production_work_item_registry (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id UUID NOT NULL REFERENCES tenants(id),
 work_order_id UUID NOT NULL REFERENCES work_orders(id),canonical_reference TEXT NOT NULL,
 production_record_id UUID NOT NULL REFERENCES production_records(id),
 UNIQUE(tenant_id,work_order_id,canonical_reference),UNIQUE(tenant_id,production_record_id)
);
CREATE TABLE production_quantity_reviews (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id UUID NOT NULL REFERENCES tenants(id),
 production_record_id UUID NOT NULL REFERENCES production_records(id),
 disposition TEXT NOT NULL CHECK(disposition IN ('primary_work','additional_work','included_subset','summary')),
 canonical_reference TEXT,related_record_ids UUID[] NOT NULL DEFAULT '{}',
 source_fingerprint TEXT NOT NULL,source_reference TEXT NOT NULL,review_notes TEXT NOT NULL,
 reviewed_by UUID NOT NULL REFERENCES users(id),reviewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 client_mutation_id UUID NOT NULL,UNIQUE(tenant_id,id),UNIQUE(tenant_id,reviewed_by,client_mutation_id)
);
ALTER TABLE production_records ADD COLUMN quantity_review_id UUID;
ALTER TABLE production_records ADD FOREIGN KEY(tenant_id,quantity_review_id) REFERENCES production_quantity_reviews(tenant_id,id);
