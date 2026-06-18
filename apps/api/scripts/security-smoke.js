const crypto = require("node:crypto");
const { Client } = require("pg");

const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:3000";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  const secret = process.env.AUTH_JWT_SECRET;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }
  if (!secret) {
    throw new Error("AUTH_JWT_SECRET is required");
  }

  const client = new Client({ connectionString });
  await client.connect();
  const seeded = await client.query(`
    SELECT u.id AS user_id, t.id AS tenant_id
    FROM users u
    JOIN tenant_users tu ON tu.user_id = u.id
    JOIN tenants t ON t.id = tu.tenant_id
    WHERE u.email = 'admin@jackson-telcom.local'
      AND t.slug = 'jackson-telcom'
    LIMIT 1
  `);
  if (!seeded.rows[0]) {
    throw new Error("Seeded Jackson Telcom admin user was not found");
  }

  const { user_id: userId, tenant_id: tenantId } = seeded.rows[0];
  const token = createToken({ sub: userId, tenant_id: tenantId, exp: Math.floor(Date.now() / 1000) + 300 }, secret);

  await expectStatus("unauthenticated request blocked", "POST", "/test-objects", undefined, 401);
  await expectStatus("invalid token blocked", "POST", "/test-objects", "Bearer invalid.token.value", 401);
  await expectStatus("missing permission metadata blocked", "POST", "/security-test/missing-permission", `Bearer ${token}`, 405);

  await client.query("UPDATE users SET status = 'disabled' WHERE id = $1", [userId]);
  await expectStatus("disabled user blocked", "POST", "/test-objects", `Bearer ${token}`, 401);
  await client.query("UPDATE users SET status = 'active' WHERE id = $1", [userId]);

  const outsideTenant = await client.query("INSERT INTO tenants (name, slug) VALUES ('Smoke Other Tenant', 'smoke-other-tenant') RETURNING id");
  const outsideToken = createToken({ sub: userId, tenant_id: outsideTenant.rows[0].id, exp: Math.floor(Date.now() / 1000) + 300 }, secret);
  await expectStatus("user outside tenant blocked", "POST", "/test-objects", `Bearer ${outsideToken}`, 401);

  await expectStatus("cross-tenant body access blocked", "POST", "/test-objects", `Bearer ${token}`, 403, {
    tenantId: outsideTenant.rows[0].id,
  });

  const before = await counts(client);
  const created = await expectStatus("authorized write accepted", "POST", "/test-objects", `Bearer ${token}`, 201, {
    name: "security smoke object",
  });
  const after = await counts(client);
  if (after.events !== before.events + 1) {
    throw new Error("write did not create event");
  }
  if (after.auditLogs !== before.auditLogs + 1) {
    throw new Error("write did not create audit log");
  }
  const crossTenantLookup = await client.query(
    "SELECT 1 FROM test_objects WHERE tenant_id = $1 AND id = $2",
    [outsideTenant.rows[0].id, created.id],
  );
  if (crossTenantLookup.rowCount !== 0) {
    throw new Error("tenant-scoped lookup allowed cross-tenant object access by ID");
  }

  await client.end();
  console.log("security smoke passed");
}

async function counts(client) {
  const result = await client.query(`
    SELECT
      (SELECT count(*)::int FROM events) AS events,
      (SELECT count(*)::int FROM audit_logs) AS audit_logs
  `);
  return result.rows[0];
}

async function expectStatus(name, method, path, authorization, expected, body) {
  const headers = { "content-type": "application/json" };
  if (authorization) {
    headers.authorization = authorization;
  }
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : JSON.stringify({ name }),
  });
  if (response.status !== expected) {
    const text = await response.text();
    throw new Error(`${name}: expected ${expected}, got ${response.status}: ${text}`);
  }
  const text = await response.text();
  return text ? JSON.parse(text) : undefined;
}

function createToken(claims, secret) {
  const header = encode({ alg: "HS256", typ: "JWT" });
  const payload = encode({ ...claims, iat: Math.floor(Date.now() / 1000) });
  const signature = crypto.createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
