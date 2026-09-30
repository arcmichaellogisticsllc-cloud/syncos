ALTER TABLE customer_qc_decisions
 ADD COLUMN accepted_quantity_review_id UUID,
 ADD COLUMN accepted_quantity_fingerprint TEXT,
 ADD FOREIGN KEY(tenant_id,accepted_quantity_review_id) REFERENCES production_quantity_reviews(tenant_id,id);
-- Historical acceptance remains intact. Do not fabricate a reviewed source for old decisions.
