import { BadRequestException, Body, Controller, Get, Inject, NotFoundException, Param, Patch, Post, Req } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import { findTenantRecordById, insertTenantRecord, listTenantRecords, updateTenantRecord } from "@syncos/database";
import { executeWriteAction, type WriteActionResult } from "@syncos/shared";
import { DATABASE_POOL } from "../modules/database.module";
import { RequirePermission } from "../security/require-permission.decorator";
import type { AuthenticatedRequest } from "./intelligence.types";
import { pick } from "./intelligence.types";

const learningTypes = new Set(["signal", "relationship", "organization", "capacity", "customer", "recommendation"]);
const scoreTypes = new Set([
  "signal_effectiveness",
  "relationship_effectiveness",
  "organization_influence",
  "capacity_reliability",
  "customer_payment_behavior",
  "recommendation_quality",
]);
const scoreTypeByLearningType: Record<string, string> = {
  signal: "signal_effectiveness",
  relationship: "relationship_effectiveness",
  organization: "organization_influence",
  capacity: "capacity_reliability",
  customer: "customer_payment_behavior",
  recommendation: "recommendation_quality",
};

@Controller()
export class LearningController {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  @Get("learning-events")
  @RequirePermission("learning_event.read")
  async listLearningEvents(@Req() request: AuthenticatedRequest) {
    return this.withClient((client) => listTenantRecords(client, "learning_events", request.auth.tenantId, { searchColumns: ["event_type", "learning_type", "source_object_type", "status"] }));
  }

  @Get("learning-events/:id")
  @RequirePermission("learning_event.read")
  async getLearningEvent(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient((client) => this.requireRecord(client, "learning_events", request.auth.tenantId, id, "learning event not found"));
  }

  @Post("learning-events")
  @RequirePermission("learning_event.create")
  async createLearningEvent(@Req() request: AuthenticatedRequest, @Body() body: Record<string, unknown>) {
    const learningType = this.requireAllowed(body.learning_type, learningTypes, "learning_type");
    const sourceObjectType = this.requireString(body.source_object_type, "source_object_type is required");
    const sourceObjectId = this.requireString(body.source_object_id, "source_object_id is required");
    const positive = this.requireBoolean(body.positive, "positive is required");
    const scoreDelta = this.requireNumber(body.score_delta, "score_delta");
    if (scoreDelta < 0) throw new BadRequestException("score_delta must be >= 0");

    return this.write(request, "learning_event.create", "learning_event.created", "learning_event", async (client) => {
      const learningEvent = await insertTenantRecord(client, "learning_events", request.auth.tenantId, {
        event_type: `${learningType}.learning`,
        learning_type: learningType,
        source_event_id: body.source_event_id ?? null,
        source_object_type: sourceObjectType,
        source_object_id: sourceObjectId,
        outcome_object_type: body.outcome_object_type ?? null,
        outcome_object_id: body.outcome_object_id ?? null,
        positive,
        score_delta: scoreDelta,
        entity_type: sourceObjectType,
        entity_id: sourceObjectId,
        payload: body.payload ?? {},
      });
      const additionalEvents = await this.applyLearningEvent(client, request.auth.tenantId, learningEvent, body.reason);
      return { entityType: "learning_event", entityId: learningEvent.id, afterState: learningEvent, additionalEvents };
    });
  }

  @Patch("learning-events/:id")
  @RequirePermission("learning_event.update")
  async updateLearningEvent(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    if (body.learning_type !== undefined) this.requireAllowed(body.learning_type, learningTypes, "learning_type");
    const values = pick(body, ["outcome_object_type", "outcome_object_id", "payload", "status"]);
    return this.writeUpdate(request, "learning_events", id, "learning_event", "learning_event.update", "learning_event.updated", values, body.reason);
  }

  @Post("learning-events/:id/archive")
  @RequirePermission("learning_event.archive")
  async archiveLearningEvent(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.archive(request, "learning_events", id, "learning_event", "learning_event.archive", "learning_event.archived");
  }

  @Get("learning-scores")
  @RequirePermission("learning_score.read")
  async listLearningScores(@Req() request: AuthenticatedRequest) {
    return this.withClient((client) => listTenantRecords(client, "learning_scores", request.auth.tenantId, { searchColumns: ["score_type", "object_type", "entity_type", "status"] }));
  }

  @Get("learning-scores/:id")
  @RequirePermission("learning_score.read")
  async getLearningScore(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient((client) => this.requireRecord(client, "learning_scores", request.auth.tenantId, id, "learning score not found"));
  }

  @Post("learning-scores")
  @RequirePermission("learning_score.create")
  async createLearningScore(@Req() request: AuthenticatedRequest, @Body() body: Record<string, unknown>) {
    const scoreType = this.requireAllowed(body.score_type, scoreTypes, "score_type");
    const objectType = this.requireString(body.object_type, "object_type is required");
    const objectId = this.requireString(body.object_id, "object_id is required");
    const scoreValue = this.clamp(this.requireNumber(body.score_value, "score_value"));
    const confidence = this.clamp(this.requireNumber(body.confidence, "confidence"));
    return this.write(request, "learning_score.create", "learning_score.created", "learning_score", async (client) => {
      const score = await insertTenantRecord(client, "learning_scores", request.auth.tenantId, {
        score_type: scoreType,
        object_type: objectType,
        object_id: objectId,
        entity_type: objectType,
        entity_id: objectId,
        score_value: scoreValue,
        confidence,
        score: scoreValue,
      });
      const history = await this.createScoreHistory(client, request.auth.tenantId, score, null, scoreValue, "learning score created", null);
      return {
        entityType: "learning_score",
        entityId: score.id,
        afterState: score,
        additionalEvents: [this.additionalEvent("score_history.create", "score_history", history.id, "score_history.created", history)],
      };
    });
  }

  @Patch("learning-scores/:id")
  @RequirePermission("learning_score.update")
  async updateLearningScore(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    if (body.score_type !== undefined) this.requireAllowed(body.score_type, scoreTypes, "score_type");
    return this.write(request, "learning_score.update", "learning_score.updated", "learning_score", async (client) => {
      const before = await this.requireRecord(client, "learning_scores", request.auth.tenantId, id, "learning score not found");
      const values = pick(body, ["status"]);
      if (body.score_value !== undefined) {
        values.score_value = this.clamp(this.requireNumber(body.score_value, "score_value"));
        values.score = values.score_value;
      }
      if (body.confidence !== undefined) values.confidence = this.clamp(this.requireNumber(body.confidence, "confidence"));
      const after = await updateTenantRecord(client, "learning_scores", request.auth.tenantId, id, values);
      if (!after) throw new NotFoundException("learning score not found");
      const additionalEvents = [];
      if (values.score_value !== undefined && Number(before.score_value ?? before.score) !== Number(values.score_value)) {
        const history = await this.createScoreHistory(client, request.auth.tenantId, after, Number(before.score_value ?? before.score), Number(values.score_value), String(body.reason ?? "learning score updated"), null);
        additionalEvents.push(this.additionalEvent("score_history.create", "score_history", history.id, "score_history.created", history));
      }
      return { entityType: "learning_score", entityId: id, beforeState: before, afterState: after, additionalEvents };
    });
  }

  @Post("learning-scores/:id/recalculate")
  @RequirePermission("learning_score.recalculate")
  async recalculateLearningScore(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.recalculateOne(request, id);
  }

  @Post("learning-scores/:id/archive")
  @RequirePermission("learning_score.archive")
  async archiveLearningScore(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.archive(request, "learning_scores", id, "learning_score", "learning_score.archive", "learning_score.archived");
  }

  @Get("learning-scores/:id/history")
  @RequirePermission("score_history.read")
  async learningScoreHistory(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      await this.requireRecord(client, "learning_scores", request.auth.tenantId, id, "learning score not found");
      const result = await client.query(
        "SELECT * FROM score_history WHERE tenant_id = $1 AND learning_score_id = $2 AND deleted_at IS NULL ORDER BY created_at DESC",
        [request.auth.tenantId, id],
      );
      return result.rows;
    });
  }

  @Get("score-history/:id")
  @RequirePermission("score_history.read")
  async getScoreHistory(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient((client) => this.requireRecord(client, "score_history", request.auth.tenantId, id, "score history not found"));
  }

  @Post("learning/recalculate")
  @RequirePermission("learning_score.recalculate")
  async recalculateAll(@Req() request: AuthenticatedRequest) {
    const scores = await this.withClient((client) => listTenantRecords(client, "learning_scores", request.auth.tenantId, { limit: 500 }));
    const results = [];
    for (const score of scores.filter((row) => row.status !== "archived")) {
      results.push(await this.recalculateOne(request, score.id));
    }
    return results;
  }

  @Post("learning/recalculate/:scoreType")
  @RequirePermission("learning_score.recalculate")
  async recalculateByScoreType(@Req() request: AuthenticatedRequest, @Param("scoreType") scoreType: string) {
    this.requireAllowed(scoreType, scoreTypes, "score_type");
    const scores = await this.withClient(async (client) => {
      const result = await client.query("SELECT * FROM learning_scores WHERE tenant_id = $1 AND score_type = $2 AND status <> 'archived' AND deleted_at IS NULL ORDER BY created_at DESC", [request.auth.tenantId, scoreType]);
      return result.rows;
    });
    const results = [];
    for (const score of scores) {
      results.push(await this.recalculateOne(request, score.id));
    }
    return results;
  }

  private async applyLearningEvent(client: PoolClient, tenantId: string, event: Record<string, unknown>, reason: unknown) {
    const scoreType = scoreTypeByLearningType[String(event.learning_type)];
    const result = await client.query(
      `
      SELECT *
      FROM learning_scores
      WHERE tenant_id = $1
        AND score_type = $2
        AND entity_type = $3
        AND entity_id = $4
        AND status <> 'archived'
        AND deleted_at IS NULL
      LIMIT 1
      `,
      [tenantId, scoreType, event.source_object_type, event.source_object_id],
    );
    if (!result.rows[0]) return [];
    const before = result.rows[0];
    const previousScore = Number(before.score_value ?? before.score);
    const delta = Number(event.score_delta ?? 0);
    const newScore = this.clamp(Boolean(event.positive) ? previousScore + delta : previousScore - delta);
    const updated = await updateTenantRecord(client, "learning_scores", tenantId, before.id, { score_value: newScore, score: newScore });
    if (!updated) return [];
    const history = await this.createScoreHistory(client, tenantId, updated, previousScore, newScore, String(reason ?? "learning event applied"), String(event.source_event_id ?? event.id));
    return [
      this.additionalEvent("learning_score.update", "learning_score", updated.id, "learning_score.updated", updated, before),
      this.additionalEvent("score_history.create", "score_history", history.id, "score_history.created", history),
    ];
  }

  private async recalculateOne(request: AuthenticatedRequest, id: string) {
    return this.write(request, "learning_score.recalculate", "learning_score.recalculated", "learning_score", async (client) => {
      const before = await this.requireRecord(client, "learning_scores", request.auth.tenantId, id, "learning score not found");
      const events = await client.query(
        `
        SELECT *
        FROM learning_events
        WHERE tenant_id = $1
          AND learning_type = $2
          AND source_object_type = $3
          AND source_object_id = $4
          AND status <> 'archived'
          AND deleted_at IS NULL
        ORDER BY created_at ASC
        `,
        [request.auth.tenantId, this.learningTypeForScoreType(String(before.score_type)), before.entity_type, before.entity_id],
      );
      let rebuilt = 50;
      for (const event of events.rows) {
        const delta = Number(event.score_delta ?? 0);
        rebuilt = this.clamp(event.positive ? rebuilt + delta : rebuilt - delta);
      }
      const after = await updateTenantRecord(client, "learning_scores", request.auth.tenantId, id, { score_value: rebuilt, score: rebuilt });
      if (!after) throw new NotFoundException("learning score not found");
      const history = await this.createScoreHistory(client, request.auth.tenantId, after, Number(before.score_value ?? before.score), rebuilt, "learning score recalculated", null);
      return {
        entityType: "learning_score",
        entityId: id,
        beforeState: before,
        afterState: after,
        additionalEvents: [this.additionalEvent("score_history.create", "score_history", history.id, "score_history.created", history)],
      };
    });
  }

  private async createScoreHistory(client: PoolClient, tenantId: string, score: Record<string, unknown>, previousScore: number | null, newScore: number, reason: string, sourceEventId: string | null) {
    return insertTenantRecord(client, "score_history", tenantId, {
      learning_score_id: score.id,
      entity_type: score.entity_type,
      entity_id: score.entity_id,
      score_type: score.score_type,
      previous_score: previousScore,
      new_score: newScore,
      reason,
      source_event_id: sourceEventId,
    });
  }

  private async write<T>(request: AuthenticatedRequest, action: string, eventType: string, aggregateType: string, write: (client: PoolClient) => Promise<WriteActionResult<T>>) {
    const client = await this.pool.connect();
    try {
      return await executeWriteAction(client, {
        tenantId: request.auth.tenantId,
        actorUserId: request.auth.userId,
        action,
        aggregateType,
        eventType,
        write,
        systemActions: [{ actionType: `${eventType}.processed` }],
      });
    } finally {
      client.release();
    }
  }

  private async writeUpdate(request: AuthenticatedRequest, table: string, id: string, entityType: string, action: string, eventType: string, values: Record<string, unknown>, reason: unknown) {
    return this.write(request, action, eventType, entityType, async (client) => {
      const before = await this.requireRecord(client, table, request.auth.tenantId, id, `${entityType} not found`);
      const after = await updateTenantRecord(client, table, request.auth.tenantId, id, values);
      if (!after) throw new NotFoundException(`${entityType} not found`);
      return { entityType, entityId: id, beforeState: before, afterState: { ...after, reason: reason ? String(reason) : undefined } };
    });
  }

  private async archive(request: AuthenticatedRequest, table: string, id: string, entityType: string, action: string, eventType: string) {
    return this.write(request, action, eventType, entityType, async (client) => {
      const before = await this.requireRecord(client, table, request.auth.tenantId, id, `${entityType} not found`);
      const after = await updateTenantRecord(client, table, request.auth.tenantId, id, { status: "archived", deleted_at: new Date() });
      if (!after) throw new NotFoundException(`${entityType} not found`);
      return { entityType, entityId: id, beforeState: before, afterState: after };
    });
  }

  private additionalEvent(action: string, entityType: string, entityId: string, eventType: string, afterState: Record<string, unknown>, beforeState?: Record<string, unknown>) {
    return {
      action,
      aggregateType: entityType,
      entityType,
      entityId,
      eventType,
      beforeState,
      afterState,
      systemActions: [{ actionType: `${eventType}.processed`, payload: { action } }],
    };
  }

  private learningTypeForScoreType(scoreType: string) {
    const entry = Object.entries(scoreTypeByLearningType).find(([, value]) => value === scoreType);
    if (!entry) throw new BadRequestException("unsupported score_type");
    return entry[0];
  }

  private async requireRecord(client: PoolClient, table: string, tenantId: string, id: string, message: string) {
    const record = await findTenantRecordById(client, table, tenantId, id);
    if (!record) throw new NotFoundException(message);
    return record;
  }

  private requireString(value: unknown, message: string) {
    if (typeof value !== "string" || value.trim().length === 0) throw new BadRequestException(message);
    return value.trim();
  }

  private requireBoolean(value: unknown, message: string) {
    if (typeof value !== "boolean") throw new BadRequestException(message);
    return value;
  }

  private requireNumber(value: unknown, field: string) {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new BadRequestException(`${field} must be a number`);
    return number;
  }

  private requireAllowed(value: unknown, allowed: Set<string>, field: string) {
    const text = this.requireString(value, `${field} is required`);
    if (!allowed.has(text)) throw new BadRequestException(`${field} is not approved`);
    return text;
  }

  private clamp(value: number) {
    return Math.max(0, Math.min(100, Number(value.toFixed(4))));
  }

  private async withClient<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      return await callback(client);
    } finally {
      client.release();
    }
  }
}
