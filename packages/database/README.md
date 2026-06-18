# Database Package

The database package owns schema migrations and database-facing contracts.

## Migration Order

Run migrations with:

```bash
npm run db:migrate
```

Seed core Sprint 0 data with:

```bash
npm run db:seed
```

The migration system applies every SQL file in `migrations/` in lexical order and records completed files in `schema_migrations`.

No application screens should be built before these backend foundations exist.
