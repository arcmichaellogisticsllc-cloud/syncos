# 002 Territories, Organizations

## Purpose

Model the geographic and organizational surface area where work, relationships, and opportunities happen.

## Tables

- `territories`: named geographic coverage areas.
- `territory_hierarchy`: parent-child territory relationships.
- `organizations`: companies, agencies, carriers, contractors, customers, and partners.
- `organization_locations`: offices, yards, job sites, and service addresses.
- `organization_territories`: coverage relationship between organizations and territories.
- `organization_identifiers`: tax IDs, license IDs, registration IDs, and external system IDs.

## Key Relationships

- `territories.tenant_id` references `tenants.id`.
- `territory_hierarchy.parent_territory_id` references `territories.id`.
- `territory_hierarchy.child_territory_id` references `territories.id`.
- `organizations.tenant_id` references `tenants.id`.
- `organization_locations.organization_id` references `organizations.id`.
- `organization_territories.organization_id` references `organizations.id`.
- `organization_territories.territory_id` references `territories.id`.

## Notes

- Support organization types with a constrained enum or lookup table.
- Store normalized address fields plus optional latitude and longitude.
