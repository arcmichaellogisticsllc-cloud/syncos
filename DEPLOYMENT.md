# SyncOS Deployment

## Local Deployment

1. Install dependencies with `npm ci`.
2. Start PostgreSQL.
3. Set `DATABASE_URL`, `AUTH_JWT_SECRET`, and `NODE_ENV=development`.
4. Run `npm run db:verify`.
5. Run `npm run build -w @syncos/api`.
6. Start API with `npm run start -w @syncos/api`.

## Staging Deployment

1. Provision PostgreSQL and Redis.
2. Set staging secrets and URLs.
3. Run `npm ci`.
4. Run typecheck, builds, tests, and migration verification.
5. Start API.
6. Start worker.
7. Verify `GET /health/startup`.

## Production Deployment

1. Confirm a database backup exists.
2. Deploy the approved release artifact.
3. Set production environment variables.
4. Run migrations and seed verification.
5. Start API.
6. Start worker.
7. Verify `GET /health/startup`.
8. Run security smoke against production-safe test tenant only when authorized.

## Database Setup

- PostgreSQL 15+ recommended.
- Run `DATABASE_URL=<db> npm run db:verify` from an empty database or migration-compatible existing database.
- Migration files must apply in lexical order.

## Worker Setup

- Configure `REDIS_URL`.
- Build with `npm run build -w @syncos/worker`.
- Start with `node apps/worker/dist/index.js` or the platform equivalent.

## Environment Variables

- `DATABASE_URL`: required.
- `AUTH_JWT_SECRET`: required, minimum 16 characters.
- `NODE_ENV`: `development`, `test`, or `production`.
- `API_BASE_URL` or `PUBLIC_API_URL`: required in production.
- `REDIS_URL`: required in production.
- `PORT`: optional API port.

## Startup Sequence

1. Database available.
2. Redis available for production.
3. Run migration verification.
4. Start API.
5. Check `/health/startup`.
6. Start worker.
