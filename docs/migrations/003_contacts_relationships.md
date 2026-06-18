# 003 Contacts, Relationships

## Purpose

Capture people, their organizational context, and relationship edges between people and organizations.

## Tables

- `contacts`: people known to the tenant.
- `contact_methods`: emails, phone numbers, and social profiles.
- `contact_organizations`: contact roles within organizations.
- `relationships`: direct known relationship edges.
- `relationship_notes`: tenant-authored context about relationship history.
- `relationship_tags`: searchable labels for relationship classification.

## Key Relationships

- `contacts.tenant_id` references `tenants.id`.
- `contact_methods.contact_id` references `contacts.id`.
- `contact_organizations.contact_id` references `contacts.id`.
- `contact_organizations.organization_id` references `organizations.id`.
- `relationships.source_contact_id` references `contacts.id`.
- `relationships.target_contact_id` references `contacts.id`.
- `relationships.source_organization_id` references `organizations.id`.
- `relationships.target_organization_id` references `organizations.id`.

## Notes

- A relationship may connect contact-to-contact, contact-to-organization, or organization-to-organization.
- Add confidence and relationship strength fields for later scoring.
