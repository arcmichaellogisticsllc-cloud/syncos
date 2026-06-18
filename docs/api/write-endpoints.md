# Write Endpoints

All mutating API endpoints must follow the platform write endpoint contract:

1. Check permission.
2. Validate lifecycle rule.
3. Write object change.
4. Create event.
5. Create audit log.
6. Trigger system actions.

See [Write Endpoint Contract](../architecture/write-endpoint-contract.md) for transaction and failure rules.

## Applies To

- `POST` create endpoints.
- `PATCH` and `PUT` update endpoints.
- `DELETE` and archive endpoints.
- Status transition endpoints.
- Assignment endpoints.
- Approval and rejection endpoints.
- Import and generated-action endpoints.

## Endpoint Design Requirement

Each write endpoint specification must name:

- Required permission key.
- Lifecycle rule or transition being enforced.
- Domain object being changed.
- Event type emitted.
- Audit action recorded.
- System actions triggered after commit.
