-- Preserve the field production unit on customer billables. Existing operational
-- units remain valid; LF/EA/HR are the canonical SyncField production-code units.
ALTER TABLE billable_items DROP CONSTRAINT billable_items_unit_check;
ALTER TABLE billable_items ADD CONSTRAINT billable_items_unit_check CHECK (unit IN (
 'feet','miles','drops','addresses','passings','splice_cases','nodes','poles','permits',
 'inspections','restoration_items','days','crews','workers','equipment_units','each',
 'hours','LF','EA','HR'
));
