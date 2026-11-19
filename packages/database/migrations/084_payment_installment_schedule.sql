ALTER TABLE contractor_payable_eligibility_snapshots ADD COLUMN installments JSONB NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(installments)='array');
