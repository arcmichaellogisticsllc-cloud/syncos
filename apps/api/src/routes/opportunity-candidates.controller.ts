import { BadRequestException, Body, Controller, Get, Inject, NotFoundException, Param, Patch, Post, Req } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import { findTenantRecordById, insertTenantRecord, listTenantRecords, updateTenantRecord } from "@syncos/database";
import { executeWriteAction, type WriteActionResult } from "@syncos/shared";
import { DATABASE_POOL } from "../modules/database.module";
import { RequirePermission } from "../security/require-permission.decorator";
import type { AuthenticatedRequest } from "./intelligence.types";
import { optionalScore, pick, requireAllowed, requireString } from "./intelligence.types";

const opportunityCandidateStatuses = new Set(["created", "monitoring", "investigating", "qualified_candidate", "rejected", "archived"]);
const candidateSignalStatuses = new Set(["active", "archived"]);

@Controller()
export class OpportunityCandidatesController {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  @Get("opportunity-candidates")
  @RequirePermission("opportunity_candidate.read")
  async list(@Req() request: AuthenticatedRequest) {
    return this.withClient((client) => listTenantRecords(client, "opportunity_candidates", request.auth.tenantId, { searchColumns: ["title", "name", "status", "work_type"] }));
  }

  @Get("opportunity-candidates/:id")
  @RequirePermission("opportunity_candidate.read")
  async findOne(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    const candidate = await this.withClient((client) => findTenantRecordById(client, "opportunity_candidates", request.auth.tenantId, id));
    if (!candidate) throw new NotFoundException("opportunity candidate not found");
    return candidate;
  }

  @Post("opportunity-candidates")
  @RequirePermission("opportunity_candidate.create")
  async create(@Req() request: AuthenticatedRequest, @Body() body: Record<string, unknown>) {
    try {
      const title = requireString(body.name ?? body.title, "candidate name is required");
      this.validateScores(body);
      return await this.write(request, "opportunity_candidate.create", "opportunity_candidate.created", "opportunity_candidate", async (client) => {
        await this.requireOrganization(client, request.auth.tenantId, body.organization_id);
        await this.requireTerritory(client, request.auth.tenantId, body.territory_id);
        const candidate = await insertTenantRecord(client, "opportunity_candidates", request.auth.tenantId, {
          organization_id: body.organization_id,
          territory_id: body.territory_id,
          title,
          name: title,
          work_type: body.work_type,
          unknown_work_type_reason: body.unknown_work_type_reason,
          evidence_summary: body.evidence_summary,
          confidence_score: optionalScore(body.confidence_score, "confidence_score"),
          relationship_access_score: optionalScore(body.relationship_access_score, "relationship_access_score"),
          capacity_fit_score: optionalScore(body.capacity_fit_score, "capacity_fit_score"),
          strategic_fit_score: optionalScore(body.strategic_fit_score, "strategic_fit_score"),
          risk_score: optionalScore(body.risk_score, "risk_score"),
          status: "created",
        });
        return { entityType: "opportunity_candidate", entityId: candidate.id, afterState: candidate };
      });
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Patch("opportunity-candidates/:id")
  @RequirePermission("opportunity_candidate.update")
  async update(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      const values = pick(body, ["title", "name", "work_type", "unknown_work_type_reason", "owner_user_id", "evidence_summary", "rejection_reason"]);
      if (body.status !== undefined) values.status = requireAllowed(body.status, opportunityCandidateStatuses, "opportunity candidate status");
      for (const field of ["confidence_score", "relationship_access_score", "capacity_fit_score", "strategic_fit_score", "risk_score"]) {
        if (body[field] !== undefined) values[field] = optionalScore(body[field], field);
      }
      return await this.write(request, "opportunity_candidate.update", "opportunity_candidate.updated", "opportunity_candidate", async (client) => {
        if (body.organization_id) {
          await this.requireOrganization(client, request.auth.tenantId, body.organization_id);
          values.organization_id = body.organization_id;
        }
        if (body.territory_id) {
          await this.requireTerritory(client, request.auth.tenantId, body.territory_id);
          values.territory_id = body.territory_id;
        }
        const before = await findTenantRecordById(client, "opportunity_candidates", request.auth.tenantId, id);
        if (!before) throw new NotFoundException("opportunity candidate not found");
        const after = await updateTenantRecord(client, "opportunity_candidates", request.auth.tenantId, id, values);
        if (!after) throw new NotFoundException("opportunity candidate not found");
        return { entityType: "opportunity_candidate", entityId: id, beforeState: before, afterState: after };
      });
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post("opportunity-candidates/:id/monitor")
  @RequirePermission("opportunity_candidate.monitor")
  async monitor(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.statusAction(request, id, "opportunity_candidate.monitor", "opportunity_candidate.monitoring_started", "monitoring");
  }

  @Post("opportunity-candidates/:id/investigate")
  @RequirePermission("opportunity_candidate.investigate")
  async investigate(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.write(request, "opportunity_candidate.investigate", "opportunity_candidate.investigation_started", "opportunity_candidate", async (client) => {
      const before = await findTenantRecordById(client, "opportunity_candidates", request.auth.tenantId, id);
      if (!before) throw new NotFoundException("opportunity candidate not found");
      const owner = body.owner_user_id ?? before.owner_user_id ?? request.auth.userId;
      const after = await updateTenantRecord(client, "opportunity_candidates", request.auth.tenantId, id, { status: "investigating", owner_user_id: owner });
      if (!after) throw new NotFoundException("opportunity candidate not found");
      return { entityType: "opportunity_candidate", entityId: id, beforeState: before, afterState: after };
    });
  }

  @Post("opportunity-candidates/:id/qualify")
  @RequirePermission("opportunity_candidate.qualify")
  async qualify(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.write(request, "opportunity_candidate.qualify", "opportunity_candidate.qualified", "opportunity_candidate", async (client) => {
      const before = await findTenantRecordById(client, "opportunity_candidates", request.auth.tenantId, id);
      if (!before) throw new NotFoundException("opportunity candidate not found");
      if ((before.confidence_score ?? 0) < 60) throw new BadRequestException("confidence_score must be at least 60");
      await this.requireOrganization(client, request.auth.tenantId, before.organization_id);
      const activeSignals = await this.activeCandidateSignals(client, request.auth.tenantId, id);
      if (!before.evidence_summary && activeSignals.length === 0) throw new BadRequestException("evidence summary or active candidate signal is required");
      if (!before.work_type && !before.unknown_work_type_reason) throw new BadRequestException("work_type or unknown_work_type_reason is required");
      const after = await updateTenantRecord(client, "opportunity_candidates", request.auth.tenantId, id, { status: "qualified_candidate" });
      if (!after) throw new NotFoundException("opportunity candidate not found");
      return { entityType: "opportunity_candidate", entityId: id, beforeState: before, afterState: after };
    });
  }

  @Post("opportunity-candidates/:id/reject")
  @RequirePermission("opportunity_candidate.reject")
  async reject(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      const reason = requireString(body.rejection_reason, "rejection_reason is required");
      return await this.write(request, "opportunity_candidate.reject", "opportunity_candidate.rejected", "opportunity_candidate", async (client) => {
        const before = await findTenantRecordById(client, "opportunity_candidates", request.auth.tenantId, id);
        if (!before) throw new NotFoundException("opportunity candidate not found");
        const after = await updateTenantRecord(client, "opportunity_candidates", request.auth.tenantId, id, { status: "rejected", rejection_reason: reason });
        if (!after) throw new NotFoundException("opportunity candidate not found");
        return { entityType: "opportunity_candidate", entityId: id, beforeState: before, afterState: after };
      });
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post("opportunity-candidates/:id/archive")
  @RequirePermission("opportunity_candidate.archive")
  async archive(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.write(request, "opportunity_candidate.archive", "opportunity_candidate.archived", "opportunity_candidate", async (client) => {
      const before = await findTenantRecordById(client, "opportunity_candidates", request.auth.tenantId, id);
      if (!before) throw new NotFoundException("opportunity candidate not found");
      const after = await updateTenantRecord(client, "opportunity_candidates", request.auth.tenantId, id, { status: "archived", deleted_at: new Date() });
      if (!after) throw new NotFoundException("opportunity candidate not found");
      return { entityType: "opportunity_candidate", entityId: id, beforeState: before, afterState: after };
    });
  }

  @Get("opportunity-candidates/:id/signals")
  @RequirePermission("candidate_signal.read")
  async listSignals(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      await this.requireCandidate(client, request.auth.tenantId, id);
      const result = await client.query("SELECT * FROM candidate_signals WHERE tenant_id = $1 AND candidate_id = $2 AND deleted_at IS NULL ORDER BY created_at DESC", [request.auth.tenantId, id]);
      return result.rows;
    });
  }

  @Post("opportunity-candidates/:id/signals")
  @RequirePermission("candidate_signal.create")
  async addSignal(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      const contribution = optionalScore(body.contribution_score, "contribution_score") ?? 0;
      return await this.write(request, "candidate_signal.create", "candidate_signal.created", "candidate_signal", async (client) => {
        await this.requireCandidate(client, request.auth.tenantId, id);
        const signal = await this.requireSignal(client, request.auth.tenantId, body.signal_id);
        if (signal.status === "archived") throw new BadRequestException("archived signal cannot be linked to candidate");
        const candidateSignal = await insertTenantRecord(client, "candidate_signals", request.auth.tenantId, {
          candidate_id: id,
          signal_id: body.signal_id,
          contribution_score: contribution,
          status: "active",
        });
        return { entityType: "candidate_signal", entityId: candidateSignal.id, afterState: candidateSignal };
      });
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Patch("candidate-signals/:id")
  @RequirePermission("candidate_signal.update")
  async updateSignal(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      const values = pick(body, []);
      if (body.status !== undefined) values.status = requireAllowed(body.status, candidateSignalStatuses, "candidate signal status");
      if (body.contribution_score !== undefined) values.contribution_score = optionalScore(body.contribution_score, "contribution_score");
      return await this.write(request, "candidate_signal.update", "candidate_signal.updated", "candidate_signal", async (client) => {
        const before = await findTenantRecordById(client, "candidate_signals", request.auth.tenantId, id);
        if (!before) throw new NotFoundException("candidate signal not found");
        const after = await updateTenantRecord(client, "candidate_signals", request.auth.tenantId, id, values);
        if (!after) throw new NotFoundException("candidate signal not found");
        return { entityType: "candidate_signal", entityId: id, beforeState: before, afterState: after };
      });
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post("candidate-signals/:id/archive")
  @RequirePermission("candidate_signal.archive")
  async archiveSignal(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.write(request, "candidate_signal.archive", "candidate_signal.archived", "candidate_signal", async (client) => {
      const before = await findTenantRecordById(client, "candidate_signals", request.auth.tenantId, id);
      if (!before) throw new NotFoundException("candidate signal not found");
      const after = await updateTenantRecord(client, "candidate_signals", request.auth.tenantId, id, { status: "archived", deleted_at: new Date() });
      if (!after) throw new NotFoundException("candidate signal not found");
      return { entityType: "candidate_signal", entityId: id, beforeState: before, afterState: after };
    });
  }

  @Post("opportunity-candidates/:id/score")
  @RequirePermission("opportunity_candidate.score")
  async score(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.write(request, "opportunity_candidate.score", "opportunity_candidate.scored", "opportunity_candidate", async (client) => {
      const before = await findTenantRecordById(client, "opportunity_candidates", request.auth.tenantId, id);
      if (!before) throw new NotFoundException("opportunity candidate not found");
      const summary = await this.calculateScore(client, request.auth.tenantId, id, before);
      const after = await updateTenantRecord(client, "opportunity_candidates", request.auth.tenantId, id, {
        score: summary.candidate_score,
        confidence_score: Math.round(summary.candidate_score),
      });
      if (!after) throw new NotFoundException("opportunity candidate not found");
      return { entityType: "opportunity_candidate", entityId: id, beforeState: before, afterState: { ...after, score_summary: summary } };
    });
  }

  @Get("opportunity-candidates/:id/score-summary")
  @RequirePermission("opportunity_candidate.read")
  async scoreSummary(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      const candidate = await findTenantRecordById(client, "opportunity_candidates", request.auth.tenantId, id);
      if (!candidate) throw new NotFoundException("opportunity candidate not found");
      return this.calculateScore(client, request.auth.tenantId, id, candidate);
    });
  }

  private async statusAction(request: AuthenticatedRequest, id: string, action: string, eventType: string, status: string) {
    return this.write(request, action, eventType, "opportunity_candidate", async (client) => {
      const before = await findTenantRecordById(client, "opportunity_candidates", request.auth.tenantId, id);
      if (!before) throw new NotFoundException("opportunity candidate not found");
      const after = await updateTenantRecord(client, "opportunity_candidates", request.auth.tenantId, id, { status });
      if (!after) throw new NotFoundException("opportunity candidate not found");
      return { entityType: "opportunity_candidate", entityId: id, beforeState: before, afterState: after };
    });
  }

  private async calculateScore(client: PoolClient, tenantId: string, candidateId: string, candidate: Record<string, unknown>) {
    const signals = await this.activeCandidateSignals(client, tenantId, candidateId);
    const signalAvg = signals.length
      ? signals.reduce((sum, row) => sum + Number(row.contribution_score ?? 0), 0) / signals.length
      : 0;
    const relationshipAccessScore = Number(candidate.relationship_access_score ?? 0);
    const strategicFitScore = Number(candidate.strategic_fit_score ?? 50);
    const capacityFitScore = Number(candidate.capacity_fit_score ?? 50);
    const riskScore = Number(candidate.risk_score ?? 50);
    const raw =
      signalAvg * 0.4 +
      relationshipAccessScore * 0.2 +
      strategicFitScore * 0.15 +
      capacityFitScore * 0.15 +
      (100 - riskScore) * 0.1;
    const candidateScore = Math.max(0, Math.min(100, Number(raw.toFixed(4))));
    return {
      signal_avg: Number(signalAvg.toFixed(4)),
      relationship_access_score: relationshipAccessScore,
      strategic_fit_score: strategicFitScore,
      capacity_fit_score: capacityFitScore,
      risk_score: riskScore,
      candidate_score: candidateScore,
    };
  }

  private validateScores(body: Record<string, unknown>) {
    for (const field of ["confidence_score", "relationship_access_score", "capacity_fit_score", "strategic_fit_score", "risk_score"]) {
      optionalScore(body[field], field);
    }
  }

  private async requireCandidate(client: PoolClient, tenantId: string, id: string) {
    const candidate = await findTenantRecordById(client, "opportunity_candidates", tenantId, id);
    if (!candidate) throw new NotFoundException("opportunity candidate not found");
    return candidate;
  }

  private async requireOrganization(client: PoolClient, tenantId: string, id: unknown) {
    if (typeof id !== "string" || !id) throw new Error("organization_id is required");
    const organization = await findTenantRecordById(client, "organizations", tenantId, id);
    if (!organization) throw new NotFoundException("organization not found in tenant");
  }

  private async requireTerritory(client: PoolClient, tenantId: string, id: unknown) {
    if (typeof id !== "string" || !id) throw new Error("territory_id is required");
    const territory = await findTenantRecordById(client, "territories", tenantId, id);
    if (!territory) throw new NotFoundException("territory not found in tenant");
  }

  private async requireSignal(client: PoolClient, tenantId: string, id: unknown) {
    if (typeof id !== "string" || !id) throw new Error("signal_id is required");
    const signal = await findTenantRecordById(client, "signals", tenantId, id);
    if (!signal) throw new NotFoundException("signal not found in tenant");
    return signal;
  }

  private async activeCandidateSignals(client: PoolClient, tenantId: string, candidateId: string) {
    const result = await client.query<{ contribution_score: number }>(
      "SELECT contribution_score FROM candidate_signals WHERE tenant_id = $1 AND candidate_id = $2 AND status = 'active' AND deleted_at IS NULL",
      [tenantId, candidateId],
    );
    return result.rows;
  }

  private async write<T>(request: AuthenticatedRequest, action: string, eventType: string, aggregateType: string, write: (client: PoolClient) => Promise<WriteActionResult<T>>) {
    const client = await this.pool.connect();
    try {
      return await executeWriteAction(client, { tenantId: request.auth.tenantId, actorUserId: request.auth.userId, action, aggregateType, eventType, write });
    } finally {
      client.release();
    }
  }

  private async withClient<T>(callback: (client: PoolClient) => Promise<T>) {
    const client = await this.pool.connect();
    try {
      return await callback(client);
    } finally {
      client.release();
    }
  }
}
