const crypto = require("node:crypto");
const { Client } = require("pg");

const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:3100";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  const secret = process.env.AUTH_JWT_SECRET;
  if (!connectionString) throw new Error("DATABASE_URL is required");
  if (!secret) throw new Error("AUTH_JWT_SECRET is required");

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
  if (!seeded.rows[0]) throw new Error("Seeded Jackson Telcom admin user was not found");
  const { user_id: userId, tenant_id: tenantId } = seeded.rows[0];
  const token = createToken({ sub: userId, tenant_id: tenantId, exp: Math.floor(Date.now() / 1000) + 300 }, secret);
  const marker = `S13${Date.now()}`;
  const limited = await createLimitedUser(client, tenantId, marker);
  const limitedToken = createToken({ sub: limited.userId, tenant_id: tenantId, exp: Math.floor(Date.now() / 1000) + 300 }, secret);
  const outside = await createOutsideLearningScore(client, marker);

  await expectStatus("unauthorized learning score create blocked", "POST", "/learning-scores", undefined, 401, {});
  await expectStatus("missing learning permission blocked", "GET", "/learning-scores", `Bearer ${limitedToken}`, 403);
  await expectStatus("cross-tenant learning score blocked", "GET", `/learning-scores/${outside.scoreId}`, `Bearer ${token}`, 404);

  const targetId = randomUuid();
  const createScoreBefore = await counts(client);
  const score = await expectStatus("learning score create", "POST", "/learning-scores", `Bearer ${token}`, 201, {
    score_type: "signal_effectiveness",
    object_type: "signal",
    object_id: targetId,
    score_value: 50,
    confidence: 70,
  });
  if (Number(score.score_value) !== 50) throw new Error("learning score create returned wrong score");
  await expectDelta(client, createScoreBefore, "learning_score.created", 1, "learning score created event");
  await expectDelta(client, createScoreBefore, "score_history.created", 1, "learning score create history event");
  await expectAuditSystemDelta(client, createScoreBefore, 2, "learning score create audit/system actions");

  const positiveBefore = await counts(client);
  const positiveEvent = await expectStatus("positive learning event", "POST", "/learning-events", `Bearer ${token}`, 201, {
    learning_type: "signal",
    source_object_type: "signal",
    source_object_id: targetId,
    outcome_object_type: "opportunity",
    outcome_object_id: randomUuid(),
    positive: true,
    score_delta: 10,
  });
  await expectDelta(client, positiveBefore, "learning_event.created", 1, "positive learning event created");
  await expectDelta(client, positiveBefore, "learning_score.updated", 1, "positive learning updated score");
  await expectDelta(client, positiveBefore, "score_history.created", 1, "positive learning history");
  await expectAuditSystemDelta(client, positiveBefore, 3, "positive learning audit/system actions");
  const afterPositive = await expectStatus("positive score read", "GET", `/learning-scores/${score.id}`, `Bearer ${token}`, 200);
  if (Number(afterPositive.score_value) !== 60) throw new Error(`positive learning did not increase score to 60: ${afterPositive.score_value}`);

  const negativeBefore = await counts(client);
  await expectStatus("negative learning event", "POST", "/learning-events", `Bearer ${token}`, 201, {
    learning_type: "signal",
    source_object_type: "signal",
    source_object_id: targetId,
    outcome_object_type: "opportunity",
    outcome_object_id: randomUuid(),
    positive: false,
    score_delta: 5,
  });
  await expectDelta(client, negativeBefore, "learning_event.created", 1, "negative learning event created");
  await expectDelta(client, negativeBefore, "learning_score.updated", 1, "negative learning updated score");
  const afterNegative = await expectStatus("negative score read", "GET", `/learning-scores/${score.id}`, `Bearer ${token}`, 200);
  if (Number(afterNegative.score_value) !== 55) throw new Error(`negative learning did not decrease score to 55: ${afterNegative.score_value}`);

  const highScore = await createScore(token, "relationship_effectiveness", "relationship_map", randomUuid(), 95);
  await createEvent(token, "relationship", "relationship_map", highScore.object_id, true, 20);
  const clampedHigh = await expectStatus("high clamp score read", "GET", `/learning-scores/${highScore.id}`, `Bearer ${token}`, 200);
  if (Number(clampedHigh.score_value) !== 100) throw new Error("score was not clamped at 100");

  const lowScore = await createScore(token, "capacity_reliability", "capacity_provider", randomUuid(), 5);
  await createEvent(token, "capacity", "capacity_provider", lowScore.object_id, false, 20);
  const clampedLow = await expectStatus("low clamp score read", "GET", `/learning-scores/${lowScore.id}`, `Bearer ${token}`, 200);
  if (Number(clampedLow.score_value) !== 0) throw new Error("score was not clamped at 0");

  const history = await expectStatus("score history list", "GET", `/learning-scores/${score.id}/history`, `Bearer ${token}`, 200);
  if (history.length < 3) throw new Error("score history was not preserved");
  await expectStatus("score history by id", "GET", `/score-history/${history[0].id}`, `Bearer ${token}`, 200);

  const recalcBefore = await counts(client);
  const recalculated = await expectStatus("manual recalculation", "POST", `/learning-scores/${score.id}/recalculate`, `Bearer ${token}`, 201, {});
  if (Number(recalculated.score_value) !== 55) throw new Error(`manual recalculation did not rebuild deterministic score: ${recalculated.score_value}`);
  await expectDelta(client, recalcBefore, "learning_score.recalculated", 1, "manual recalculation event");
  await expectDelta(client, recalcBefore, "score_history.created", 1, "manual recalculation history");

  const bulk = await expectStatus("bulk recalculation", "POST", "/learning/recalculate", `Bearer ${token}`, 201, {});
  if (!bulk.some((row) => row.id === score.id)) throw new Error("bulk recalculation did not include learning score");
  const typedBulk = await expectStatus("score type recalculation", "POST", "/learning/recalculate/signal_effectiveness", `Bearer ${token}`, 201, {});
  if (!typedBulk.every((row) => row.score_type === "signal_effectiveness")) throw new Error("score_type recalculation returned wrong score type");

  await createSourceSupportEvent(token, "recommendation outcome learning", "recommendation", "recommendation", "recommendation_outcome");
  await createSourceSupportEvent(token, "payment learning", "customer", "invoice", "payment");
  await createSourceSupportEvent(token, "constraint verification learning", "organization", "constraint", "constraint");
  await createSourceSupportEvent(token, "workflow completion learning", "relationship", "workflow_instance", "workflow_instance");

  const searchResults = await expectStatus("tenant-scoped learning score search", "GET", `/search?q=${encodeURIComponent("signal_effectiveness")}`, `Bearer ${token}`, 200);
  if (!searchResults.some((row) => row.object_type === "learning_score" && row.id === score.id)) throw new Error("search missing learning score");
  if (searchResults.some((row) => row.id === outside.scoreId)) throw new Error("search returned cross-tenant learning score");
  if (searchResults.some((row) => row.object_type === "score_history")) throw new Error("search returned score history");

  const forbidden = await client.query(`
    SELECT
      to_regclass('public.ai_models') AS ai_models,
      to_regclass('public.forecasts') AS forecasts,
      to_regclass('public.autonomous_recommendations') AS autonomous_recommendations,
      to_regclass('public.vector_embeddings') AS vector_embeddings
  `);
  if (forbidden.rows[0].ai_models) throw new Error("AI models table was created");
  if (forbidden.rows[0].forecasts) throw new Error("forecasting table was created");
  if (forbidden.rows[0].autonomous_recommendations) throw new Error("autonomous recommendation table was created");
  if (forbidden.rows[0].vector_embeddings) throw new Error("vector database table was created");

  await client.end();
  console.log("sprint13 smoke passed");
}

async function createLimitedUser(client, tenantId, marker) {
  const user = await client.query(
    "INSERT INTO users (email, display_name, password_hash) VALUES ($1, $2, 'test') RETURNING id",
    [`sprint13-limited-${marker}@example.local`, `Sprint 13 Limited ${marker}`],
  );
  await client.query("INSERT INTO tenant_users (tenant_id, user_id, status) VALUES ($1, $2, 'active')", [tenantId, user.rows[0].id]);
  return { userId: user.rows[0].id };
}

async function createOutsideLearningScore(client, marker) {
  const tenant = await client.query("INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id", ["Sprint 13 Outside", `sprint13-outside-${Date.now()}`]);
  const score = await client.query(
    "INSERT INTO learning_scores (tenant_id, object_type, object_id, entity_type, entity_id, score_type, score_value, confidence, score) VALUES ($1, 'signal', gen_random_uuid(), 'signal', gen_random_uuid(), 'signal_effectiveness', 88, 80, 88) RETURNING id",
    [tenant.rows[0].id],
  );
  return { tenantId: tenant.rows[0].id, scoreId: score.rows[0].id, marker };
}

async function createScore(token, scoreType, objectType, objectId, scoreValue) {
  return expectStatus(`create ${scoreType}`, "POST", "/learning-scores", `Bearer ${token}`, 201, {
    score_type: scoreType,
    object_type: objectType,
    object_id: objectId,
    score_value: scoreValue,
    confidence: 60,
  });
}

async function createEvent(token, learningType, sourceObjectType, sourceObjectId, positive, scoreDelta) {
  return expectStatus(`create ${learningType} event`, "POST", "/learning-events", `Bearer ${token}`, 201, {
    learning_type: learningType,
    source_object_type: sourceObjectType,
    source_object_id: sourceObjectId,
    outcome_object_type: "outcome",
    outcome_object_id: randomUuid(),
    positive,
    score_delta: scoreDelta,
  });
}

async function createSourceSupportEvent(token, label, learningType, sourceObjectType, outcomeObjectType) {
  await expectStatus(label, "POST", "/learning-events", `Bearer ${token}`, 201, {
    learning_type: learningType,
    source_object_type: sourceObjectType,
    source_object_id: randomUuid(),
    outcome_object_type: outcomeObjectType,
    outcome_object_id: randomUuid(),
    positive: true,
    score_delta: 1,
  });
}

async function counts(client) {
  const result = await client.query(`
    SELECT
      (SELECT count(*)::int FROM events) AS events,
      (SELECT count(*)::int FROM event_payloads) AS event_payloads,
      (SELECT count(*)::int FROM audit_logs) AS audit_logs,
      (SELECT count(*)::int FROM system_actions) AS system_actions
  `);
  const eventTypes = await client.query("SELECT event_type, count(*)::int AS count FROM events GROUP BY event_type");
  return {
    ...result.rows[0],
    eventTypes: Object.fromEntries(eventTypes.rows.map((row) => [row.event_type, Number(row.count)])),
  };
}

async function expectDelta(client, before, eventType, expected, label) {
  const after = await counts(client);
  const actual = Number(after.eventTypes[eventType] ?? 0) - Number(before.eventTypes[eventType] ?? 0);
  if (actual !== expected) throw new Error(`${label}: expected ${expected} ${eventType}, got ${actual}`);
}

async function expectAuditSystemDelta(client, before, expected, label) {
  const after = await counts(client);
  if (Number(after.audit_logs) - Number(before.audit_logs) !== expected) throw new Error(`${label}: audit delta mismatch`);
  if (Number(after.system_actions) - Number(before.system_actions) !== expected) throw new Error(`${label}: system action delta mismatch`);
  if (Number(after.event_payloads) - Number(before.event_payloads) !== expected) throw new Error(`${label}: event payload delta mismatch`);
}

async function expectStatus(label, method, path, authorization, expectedStatus, body) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method,
    headers: {
      ...(authorization ? { authorization } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (response.status !== expectedStatus) {
    const text = await response.text();
    throw new Error(`${label}: expected ${expectedStatus}, got ${response.status}: ${text}`);
  }
  const text = await response.text();
  return text ? JSON.parse(text) : undefined;
}

function createToken(payload, secret) {
  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = base64Url(JSON.stringify(header));
  const encodedPayload = base64Url(JSON.stringify(payload));
  const signature = crypto.createHmac("sha256", secret).update(`${encodedHeader}.${encodedPayload}`).digest("base64url");
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function randomUuid() {
  return crypto.randomUUID();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
