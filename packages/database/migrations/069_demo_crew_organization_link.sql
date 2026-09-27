-- Repair only the original synthetic crew whose seed omitted organization_id.
-- Infer ownership from its existing provider, and never replace a non-null owner.
-- No records, memberships, credentials, approvals or permissions are reset.
UPDATE crews c
SET organization_id = cp.organization_id
FROM capacity_providers cp, tenants t
WHERE c.id = '823b9068-cb2d-5556-a1c4-9a0d788d2614'
  AND c.tenant_id = '8b4ceb5b-5614-5b83-bfc4-16c793832202'
  AND t.id = c.tenant_id AND t.slug = 'arc-syncos-demo'
  AND cp.id = c.capacity_provider_id AND cp.tenant_id = c.tenant_id
  AND cp.id = '0d64b6e6-7fa7-5317-8bf2-17e3b505d116'
  AND cp.organization_id = 'a289a7f6-2459-5402-867f-809d8981a6b8'
  AND c.organization_id IS NULL
  AND c.deleted_at IS NULL AND cp.deleted_at IS NULL;
