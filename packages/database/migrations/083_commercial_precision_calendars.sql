-- Preserve existing approvals and amounts. New revisions explicitly approve new rules.
ALTER TABLE commercial_terms_revisions
 ADD COLUMN payment_day_basis TEXT NOT NULL DEFAULT 'calendar_days' CHECK(payment_day_basis IN ('calendar_days','business_days')),
 ADD COLUMN holidays JSONB NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(holidays)='array'),
 ADD COLUMN holiday_calendar_through DATE,
 ADD COLUMN funding_basis TEXT NOT NULL DEFAULT 'gross_customer_amount' CHECK(funding_basis IN ('gross_customer_amount','net_customer_invoice')),
 ADD CHECK(payment_day_basis<>'business_days' OR holiday_calendar_through IS NOT NULL);
ALTER TABLE rate_codes ALTER COLUMN amount TYPE NUMERIC(18,4), ALTER COLUMN customer_rate TYPE NUMERIC(18,4), ALTER COLUMN contractor_rate TYPE NUMERIC(18,4);
ALTER TABLE billable_items ALTER COLUMN unit_rate TYPE NUMERIC(18,4);
ALTER TABLE settlement_items ALTER COLUMN unit_rate TYPE NUMERIC(18,4), ALTER COLUMN contractor_rate TYPE NUMERIC(18,4);
ALTER TABLE contractor_payable_items ALTER COLUMN contractor_rate TYPE NUMERIC(18,4);
ALTER TABLE invoice_items ALTER COLUMN unit_rate TYPE NUMERIC(18,4);
ALTER TABLE accepted_production_financial_sources ALTER COLUMN customer_rate TYPE NUMERIC(18,4), ALTER COLUMN partner_rate TYPE NUMERIC(18,4);
