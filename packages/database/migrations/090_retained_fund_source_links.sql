-- Ordinary earned payables remain unique per accepted source. Retained releases
-- refer explicitly to the original item instead of earning the work a second time.
DROP INDEX contractor_payable_items_p12_source_uidx;
CREATE UNIQUE INDEX contractor_payable_items_p12_source_uidx ON contractor_payable_items(tenant_id,accepted_production_source_id) WHERE accepted_production_source_id IS NOT NULL AND deleted_at IS NULL AND status NOT IN ('voided','archived') AND source_retainage_item_id IS NULL;
CREATE UNIQUE INDEX retained_item_per_release_uidx ON contractor_payable_items(tenant_id,contractor_payable_id,source_retainage_item_id) WHERE source_retainage_item_id IS NOT NULL;
CREATE FUNCTION validate_retained_item_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.source_retainage_item_id IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM contractor_payable_items i JOIN contractor_payables p ON p.tenant_id=NEW.tenant_id AND p.id=NEW.contractor_payable_id WHERE i.tenant_id=NEW.tenant_id AND i.id=NEW.source_retainage_item_id AND i.source_retainage_item_id IS NULL AND i.accepted_production_source_id=NEW.accepted_production_source_id AND i.settlement_item_id=NEW.settlement_item_id AND p.payable_type='retainage_release' AND i.deleted_at IS NULL) THEN
   RAISE EXCEPTION 'Retained item requires its original accepted-work payable source';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER retained_item_source BEFORE INSERT OR UPDATE OF source_retainage_item_id,accepted_production_source_id,settlement_item_id,contractor_payable_id ON contractor_payable_items FOR EACH ROW EXECUTE FUNCTION validate_retained_item_source();
