# 007 Capacity Providers, Crews, Workers, Equipment

## Purpose

Track provider capacity, crews, individual workers, and equipment availability.

## Tables

- `capacity_providers`: organizations or internal groups that provide labor or assets.
- `crews`: named crews under a provider.
- `workers`: individual labor resources.
- `crew_workers`: worker assignments to crews.
- `equipment`: vehicles, machines, and specialized assets.
- `equipment_assignments`: equipment assignments to providers, crews, projects, or work orders.
- `capacity_availability`: time-windowed availability for providers, crews, workers, and equipment.

## Key Relationships

- `capacity_providers.organization_id` references `organizations.id`.
- `crews.provider_id` references `capacity_providers.id`.
- `workers.provider_id` references `capacity_providers.id`.
- `crew_workers.crew_id` references `crews.id`.
- `crew_workers.worker_id` references `workers.id`.
- `equipment.provider_id` references `capacity_providers.id`.

## Notes

- Availability records should include date range, status, source, and capacity units.
- Equipment should include ownership, status, class, and external identifier fields.
