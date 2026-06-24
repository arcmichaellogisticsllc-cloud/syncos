# Accounting Export Physical Test

Backend foundation physical validation should confirm:

- create accounting export batch
- verify batch number is tenant-unique
- add invoice export item
- add cash receipt export item
- add payment application export item
- add contractor payable export item
- add payroll export item
- add payment execution export item
- add bank reconciliation export item
- confirm duplicate source is blocked unless override
- confirm mapping status is calculated
- confirm missing mapping blocks generate unless override
- generate export as status-only
- confirm no file download is produced
- submit review
- start review
- approve
- mark submitted as manual/status-only
- mark accepted as manual/status-only
- mark failed
- cancel
- archive
- update item and recalculate totals
- archive item and exclude from totals
- view list/detail/items
- view timeline
- view audit as authorized user
- confirm audit blocked for unauthorized user
- search accounting export batch/item
- confirm no QuickBooks, Sage, NetSuite, ERP API, GL entry, journal, tax filing, W2, 1099, payment, bank transaction, accounting close, file download, or source mutation is created

Automated smoke command:

`npm run accounting-export:smoke`
