import { BadRequestException, Body, Controller, ForbiddenException, Get, Inject, NotFoundException, Param, Patch, Post, Req } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import { findTenantRecordById, insertTenantRecord, listTenantRecords, updateTenantRecord } from "@syncos/database";
import { executeWriteAction, type WriteActionResult } from "@syncos/shared";
import { DATABASE_POOL } from "../modules/database.module";
import { RequirePermission } from "../security/require-permission.decorator";
import type { AuthenticatedRequest } from "./intelligence.types";
import { optionalScore, pick, requireAllowed, requireString } from "./intelligence.types";

const opportunityStatuses = new Set([
  "qualified",
  "pursuit_approved",
  "pursuing",
  "bid_proposal",
  "negotiation",
  "awarded",
  "lost",
  "deferred",
  "archived",
]);
const capacityRequirementStatuses = new Set(["active", "archived"]);
const authorityRoles = new Set(["Executive", "Growth Director"]);

@Controller()
export class OpportunitiesController {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  @Get("opportunities")
  @RequirePermission("opportunity.read")
  async list(@Req() request: AuthenticatedRequest) {
    return this.withClient((client) => listTenantRecords(client, "opportunities", request.auth.tenantId, { searchColumns: ["title", "status", "work_type"] }));
  }

  @Get("opportunities/:id")
  @RequirePermission("opportunity.read")
  async findOne(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    const opportunity = await this.withClient((client) => findTenantRecordById(client, "opportunities", request.auth.tenantId, id));
    if (!opportunity) throw new NotFoundException("opportunity not found");
    return opportunity;
  }

  @Post("opportunities")
  @RequirePermission("opportunity.create")
  async create(@Req() request: AuthenticatedRequest, @Body() body: Record<string, unknown>) {
    try {
      const title = requireString(body.title, "opportunity title is required");
      this.validateScores(body);
      return await this.write(request, "opportunity.create", "opportunity.created", "opportunity", async (client) => {
        if (body.candidate_id) {
          const candidate = await this.requireCandidate(client, request.auth.tenantId, body.candidate_id);
          if (candidate.status !== "qualified_candidate") throw new BadRequestException("candidate must be qualified_candidate");
          body.organization_id ??= candidate.organization_id;
          body.territory_id ??= candidate.territory_id;
          body.work_type ??= candidate.work_type;
          body.evidence_summary ??= candidate.evidence_summary;
          body.owner_user_id ??= candidate.owner_user_id;
        } else {
          await this.requireAuthority(client, request.auth.tenantId, request.auth.userId);
        }
        await this.validateOpportunityEntry(client, request.auth.tenantId, body);
        const opportunity = await insertTenantRecord(client, "opportunities", request.auth.tenantId, {
          candidate_id: body.candidate_id,
          organization_id: body.organization_id,
          territory_id: body.territory_id,
          owner_user_id: body.owner_user_id,
          title,
          work_type: body.work_type,
          evidence_summary: body.evidence_summary,
          scope_summary: body.scope_summary,
          next_action: body.next_action,
          estimated_value: body.estimated_value,
          signal_strength_score: optionalScore(body.signal_strength_score, "signal_strength_score"),
          relationship_access_score: optionalScore(body.relationship_access_score, "relationship_access_score"),
          capacity_fit_score: optionalScore(body.capacity_fit_score, "capacity_fit_score"),
          margin_potential_score: optionalScore(body.margin_potential_score, "margin_potential_score"),
          strategic_fit_score: optionalScore(body.strategic_fit_score, "strategic_fit_score"),
          payment_risk_score: optionalScore(body.payment_risk_score, "payment_risk_score"),
          status: "qualified",
          stage: "qualified",
        });
        return { entityType: "opportunity", entityId: opportunity.id, afterState: opportunity };
      });
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof ForbiddenException || error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Patch("opportunities/:id")
  @RequirePermission("opportunity.update")
  async update(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      const values = pick(body, [
        "title",
        "work_type",
        "evidence_summary",
        "scope_summary",
        "next_action",
        "estimated_value",
        "award_evidence",
        "customer_confirmation",
        "loss_reason",
        "deferral_reason",
        "review_date",
      ]);
      if (body.status !== undefined) throw new BadRequestException("status changes must use lifecycle action routes");
      for (const field of this.scoreFields()) {
        if (body[field] !== undefined) values[field] = optionalScore(body[field], field);
      }
      return await this.write(request, "opportunity.update", "opportunity.updated", "opportunity", async (client) => {
        const before = await this.requireOpportunity(client, request.auth.tenantId, id);
        if (body.organization_id) {
          await this.requireOrganization(client, request.auth.tenantId, body.organization_id);
          values.organization_id = body.organization_id;
        }
        if (body.territory_id) {
          await this.requireTerritory(client, request.auth.tenantId, body.territory_id);
          values.territory_id = body.territory_id;
        }
        if (body.owner_user_id) {
          await this.requireTenantUser(client, request.auth.tenantId, body.owner_user_id);
          values.owner_user_id = body.owner_user_id;
        }
        const after = await updateTenantRecord(client, "opportunities", request.auth.tenantId, id, values);
        if (!after) throw new NotFoundException("opportunity not found");
        return { entityType: "opportunity", entityId: id, beforeState: before, afterState: after };
      });
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post("opportunities/:id/pursuit-approve")
  @RequirePermission("opportunity.pursuit_approve")
  async pursuitApprove(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.write(request, "opportunity.pursuit_approve", "opportunity.pursuit_approved", "opportunity", async (client) => {
      await this.requireAuthority(client, request.auth.tenantId, request.auth.userId);
      const before = await this.requireOpportunity(client, request.auth.tenantId, id);
      if (before.status !== "qualified") throw new BadRequestException("opportunity must be qualified");
      if (Number(before.pursuit_score ?? 0) < 70) throw new BadRequestException("pursuit_score must be at least 70");
      if (!(await this.relationshipPathExists(client, request.auth.tenantId, before))) throw new BadRequestException("relationship path is required");
      if (Number(before.capacity_fit_score ?? 0) <= 0) throw new BadRequestException("capacity path must be possible");
      if (Number(before.margin_potential_score ?? 0) <= 0) throw new BadRequestException("economic fit must be positive");
      const after = await updateTenantRecord(client, "opportunities", request.auth.tenantId, id, { status: "pursuit_approved", stage: "pursuit_approved" });
      if (!after) throw new NotFoundException("opportunity not found");
      return { entityType: "opportunity", entityId: id, beforeState: before, afterState: after };
    });
  }

  @Post("opportunities/:id/pursue")
  @RequirePermission("opportunity.pursue")
  async pursue(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.write(request, "opportunity.pursue", "opportunity.pursuing", "opportunity", async (client) => {
      const before = await this.requireOpportunity(client, request.auth.tenantId, id);
      if (before.status !== "pursuit_approved") throw new BadRequestException("opportunity must be pursuit_approved");
      const owner = body.owner_user_id ?? before.owner_user_id;
      const nextAction = body.next_action ?? before.next_action;
      if (!owner) throw new BadRequestException("owner is required");
      await this.requireTenantUser(client, request.auth.tenantId, owner);
      requireString(nextAction, "next_action is required");
      const after = await updateTenantRecord(client, "opportunities", request.auth.tenantId, id, {
        status: "pursuing",
        stage: "pursuing",
        owner_user_id: owner,
        next_action: nextAction,
      });
      if (!after) throw new NotFoundException("opportunity not found");
      return { entityType: "opportunity", entityId: id, beforeState: before, afterState: after };
    });
  }

  @Post("opportunities/:id/proposal")
  @RequirePermission("opportunity.proposal")
  async proposal(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.write(request, "opportunity.proposal", "opportunity.proposal", "opportunity", async (client) => {
      const before = await this.requireOpportunity(client, request.auth.tenantId, id);
      if (before.status !== "pursuing") throw new BadRequestException("opportunity must be pursuing");
      const scope = body.scope_summary ?? before.scope_summary;
      const estimatedValue = body.estimated_value ?? before.estimated_value;
      requireString(scope, "scope_summary is required");
      if (estimatedValue === undefined || estimatedValue === null || Number(estimatedValue) <= 0) throw new BadRequestException("estimated_value is required");
      if (!(await this.capacityRequirementExists(client, request.auth.tenantId, id))) throw new BadRequestException("capacity requirement is required");
      const after = await updateTenantRecord(client, "opportunities", request.auth.tenantId, id, {
        status: "bid_proposal",
        stage: "bid_proposal",
        scope_summary: scope,
        estimated_value: estimatedValue,
        proposal_submitted_at: new Date(),
      });
      if (!after) throw new NotFoundException("opportunity not found");
      return { entityType: "opportunity", entityId: id, beforeState: before, afterState: after };
    });
  }

  @Post("opportunities/:id/negotiation")
  @RequirePermission("opportunity.negotiation")
  async negotiation(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.write(request, "opportunity.negotiation", "opportunity.negotiation", "opportunity", async (client) => {
      const before = await this.requireOpportunity(client, request.auth.tenantId, id);
      if (before.status !== "bid_proposal") throw new BadRequestException("opportunity must be bid_proposal");
      if (!before.proposal_submitted_at) throw new BadRequestException("proposal must be submitted");
      const after = await updateTenantRecord(client, "opportunities", request.auth.tenantId, id, { status: "negotiation", stage: "negotiation" });
      if (!after) throw new NotFoundException("opportunity not found");
      return { entityType: "opportunity", entityId: id, beforeState: before, afterState: after };
    });
  }

  @Post("opportunities/:id/award")
  @RequirePermission("opportunity.award")
  async award(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.write(request, "opportunity.award", "opportunity.awarded", "opportunity", async (client) => {
      await this.requireAuthority(client, request.auth.tenantId, request.auth.userId);
      const before = await this.requireOpportunity(client, request.auth.tenantId, id);
      if (before.status !== "negotiation") throw new BadRequestException("opportunity must be negotiation");
      const awardEvidence = body.award_evidence ?? before.award_evidence;
      const customerConfirmation = body.customer_confirmation ?? before.customer_confirmation;
      requireString(awardEvidence, "award_evidence is required");
      requireString(customerConfirmation, "customer_confirmation is required");
      const after = await updateTenantRecord(client, "opportunities", request.auth.tenantId, id, {
        status: "awarded",
        stage: "awarded",
        award_evidence: awardEvidence,
        customer_confirmation: customerConfirmation,
      });
      if (!after) throw new NotFoundException("opportunity not found");
      return { entityType: "opportunity", entityId: id, beforeState: before, afterState: after };
    });
  }

  @Post("opportunities/:id/lost")
  @RequirePermission("opportunity.lost")
  async lost(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      const reason = requireString(body.loss_reason, "loss_reason is required");
      return await this.statusWithFields(request, id, "opportunity.lost", "opportunity.lost", "lost", { loss_reason: reason });
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post("opportunities/:id/defer")
  @RequirePermission("opportunity.defer")
  async defer(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      const reason = requireString(body.deferral_reason, "deferral_reason is required");
      const reviewDate = requireString(body.review_date, "review_date is required");
      return await this.statusWithFields(request, id, "opportunity.defer", "opportunity.deferred", "deferred", {
        deferral_reason: reason,
        review_date: reviewDate,
      });
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post("opportunities/:id/archive")
  @RequirePermission("opportunity.archive")
  async archive(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.write(request, "opportunity.archive", "opportunity.archived", "opportunity", async (client) => {
      const before = await this.requireOpportunity(client, request.auth.tenantId, id);
      const after = await updateTenantRecord(client, "opportunities", request.auth.tenantId, id, { status: "archived", stage: "archived", deleted_at: new Date() });
      if (!after) throw new NotFoundException("opportunity not found");
      return { entityType: "opportunity", entityId: id, beforeState: before, afterState: after };
    });
  }

  @Post("opportunities/:id/score")
  @RequirePermission("opportunity.score")
  async score(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.write(request, "opportunity.score", "opportunity.scored", "opportunity", async (client) => {
      const before = await this.requireOpportunity(client, request.auth.tenantId, id);
      const summary = this.calculateScore(before);
      const after = await updateTenantRecord(client, "opportunities", request.auth.tenantId, id, {
        pursuit_score: summary.pursuit_score,
        recommendation: summary.recommendation,
      });
      if (!after) throw new NotFoundException("opportunity not found");
      return { entityType: "opportunity", entityId: id, beforeState: before, afterState: { ...after, score_summary: summary } };
    });
  }

  @Get("opportunities/:id/score-summary")
  @RequirePermission("opportunity.read")
  async scoreSummary(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      const opportunity = await this.requireOpportunity(client, request.auth.tenantId, id);
      return this.calculateScore(opportunity);
    });
  }

  @Get("opportunities/:id/capacity-requirements")
  @RequirePermission("capacity_requirement.read")
  async listCapacityRequirements(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      await this.requireOpportunity(client, request.auth.tenantId, id);
      const result = await client.query(
        "SELECT * FROM opportunity_capacity_requirements WHERE tenant_id = $1 AND opportunity_id = $2 AND deleted_at IS NULL ORDER BY created_at DESC",
        [request.auth.tenantId, id],
      );
      return result.rows;
    });
  }

  @Post("opportunities/:id/capacity-requirements")
  @RequirePermission("capacity_requirement.create")
  async createCapacityRequirement(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      const capacityType = requireString(body.capacity_type, "capacity_type is required");
      const quantity = this.requirePositiveNumber(body.quantity, "quantity");
      const unit = requireString(body.unit, "unit is required");
      const status = body.status === undefined ? "active" : requireAllowed(body.status, capacityRequirementStatuses, "capacity requirement status");
      return await this.write(request, "capacity_requirement.create", "capacity_requirement.created", "capacity_requirement", async (client) => {
        await this.requireOpportunity(client, request.auth.tenantId, id);
        if (body.territory_id) await this.requireTerritory(client, request.auth.tenantId, body.territory_id);
        const requirement = await insertTenantRecord(client, "opportunity_capacity_requirements", request.auth.tenantId, {
          opportunity_id: id,
          capacity_type: capacityType,
          quantity,
          unit,
          territory_id: body.territory_id,
          start_date: body.start_date,
          end_date: body.end_date,
          status,
        });
        return { entityType: "capacity_requirement", entityId: requirement.id, afterState: requirement };
      });
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Patch("opportunity-capacity-requirements/:id")
  @RequirePermission("capacity_requirement.update")
  async updateCapacityRequirement(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      const values = pick(body, ["capacity_type", "unit", "start_date", "end_date"]);
      if (body.quantity !== undefined) values.quantity = this.requirePositiveNumber(body.quantity, "quantity");
      if (body.status !== undefined) values.status = requireAllowed(body.status, capacityRequirementStatuses, "capacity requirement status");
      return await this.write(request, "capacity_requirement.update", "capacity_requirement.updated", "capacity_requirement", async (client) => {
        const before = await this.requireCapacityRequirement(client, request.auth.tenantId, id);
        if (body.opportunity_id) {
          if (typeof body.opportunity_id !== "string") throw new Error("opportunity_id must be a string");
          await this.requireOpportunity(client, request.auth.tenantId, body.opportunity_id);
          values.opportunity_id = body.opportunity_id;
        }
        if (body.territory_id) {
          await this.requireTerritory(client, request.auth.tenantId, body.territory_id);
          values.territory_id = body.territory_id;
        }
        const after = await updateTenantRecord(client, "opportunity_capacity_requirements", request.auth.tenantId, id, values);
        if (!after) throw new NotFoundException("capacity requirement not found");
        return { entityType: "capacity_requirement", entityId: id, beforeState: before, afterState: after };
      });
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post("opportunity-capacity-requirements/:id/archive")
  @RequirePermission("capacity_requirement.archive")
  async archiveCapacityRequirement(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.write(request, "capacity_requirement.archive", "capacity_requirement.archived", "capacity_requirement", async (client) => {
      const before = await this.requireCapacityRequirement(client, request.auth.tenantId, id);
      const after = await updateTenantRecord(client, "opportunity_capacity_requirements", request.auth.tenantId, id, { status: "archived", deleted_at: new Date() });
      if (!after) throw new NotFoundException("capacity requirement not found");
      return { entityType: "capacity_requirement", entityId: id, beforeState: before, afterState: after };
    });
  }

  private async statusWithFields(request: AuthenticatedRequest, id: string, action: string, eventType: string, status: string, values: Record<string, unknown>) {
    return this.write(request, action, eventType, "opportunity", async (client) => {
      const before = await this.requireOpportunity(client, request.auth.tenantId, id);
      const after = await updateTenantRecord(client, "opportunities", request.auth.tenantId, id, { ...values, status, stage: status });
      if (!after) throw new NotFoundException("opportunity not found");
      return { entityType: "opportunity", entityId: id, beforeState: before, afterState: after };
    });
  }

  private calculateScore(opportunity: Record<string, unknown>) {
    const signalStrength = Number(opportunity.signal_strength_score ?? 0);
    const relationshipAccess = Number(opportunity.relationship_access_score ?? 0);
    const capacityFit = Number(opportunity.capacity_fit_score ?? 0);
    const marginPotential = Number(opportunity.margin_potential_score ?? 0);
    const strategicFit = Number(opportunity.strategic_fit_score ?? 0);
    const paymentRisk = Number(opportunity.payment_risk_score ?? 50);
    const raw =
      signalStrength * 0.2 +
      relationshipAccess * 0.2 +
      capacityFit * 0.2 +
      marginPotential * 0.15 +
      strategicFit * 0.15 +
      (100 - paymentRisk) * 0.1;
    const pursuitScore = Math.max(0, Math.min(100, Number(raw.toFixed(4))));
    return {
      signal_strength_score: signalStrength,
      relationship_access_score: relationshipAccess,
      capacity_fit_score: capacityFit,
      margin_potential_score: marginPotential,
      strategic_fit_score: strategicFit,
      payment_risk_score: paymentRisk,
      pursuit_score: pursuitScore,
      recommendation: this.recommendation(pursuitScore),
    };
  }

  private recommendation(score: number) {
    if (score < 40) return "Avoid";
    if (score < 70) return "Monitor";
    if (score < 85) return "Pursue";
    return "Priority Pursuit";
  }

  private async validateOpportunityEntry(client: PoolClient, tenantId: string, body: Record<string, unknown>) {
    await this.requireOrganization(client, tenantId, body.organization_id);
    await this.requireTerritory(client, tenantId, body.territory_id);
    await this.requireTenantUser(client, tenantId, body.owner_user_id);
    requireString(body.work_type, "work_type is required");
    requireString(body.evidence_summary, "evidence_summary is required");
  }

  private validateScores(body: Record<string, unknown>) {
    for (const field of this.scoreFields()) optionalScore(body[field], field);
  }

  private scoreFields() {
    return [
      "signal_strength_score",
      "relationship_access_score",
      "capacity_fit_score",
      "margin_potential_score",
      "strategic_fit_score",
      "payment_risk_score",
    ];
  }

  private requirePositiveNumber(value: unknown, field: string) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${field} must be positive`);
    return parsed;
  }

  private async requireOpportunity(client: PoolClient, tenantId: string, id: string) {
    const opportunity = await findTenantRecordById(client, "opportunities", tenantId, id);
    if (!opportunity) throw new NotFoundException("opportunity not found");
    return opportunity;
  }

  private async requireCapacityRequirement(client: PoolClient, tenantId: string, id: string) {
    const requirement = await findTenantRecordById(client, "opportunity_capacity_requirements", tenantId, id);
    if (!requirement) throw new NotFoundException("capacity requirement not found");
    return requirement;
  }

  private async requireCandidate(client: PoolClient, tenantId: string, id: unknown) {
    if (typeof id !== "string" || !id) throw new Error("candidate_id is required");
    const candidate = await findTenantRecordById(client, "opportunity_candidates", tenantId, id);
    if (!candidate) throw new NotFoundException("candidate not found in tenant");
    return candidate;
  }

  private async requireOrganization(client: PoolClient, tenantId: string, id: unknown) {
    if (typeof id !== "string" || !id) throw new Error("organization_id is required");
    const organization = await findTenantRecordById(client, "organizations", tenantId, id);
    if (!organization) throw new NotFoundException("organization not found in tenant");
    return organization;
  }

  private async requireTerritory(client: PoolClient, tenantId: string, id: unknown) {
    if (typeof id !== "string" || !id) throw new Error("territory_id is required");
    const territory = await findTenantRecordById(client, "territories", tenantId, id);
    if (!territory) throw new NotFoundException("territory not found in tenant");
    return territory;
  }

  private async requireTenantUser(client: PoolClient, tenantId: string, userId: unknown) {
    if (typeof userId !== "string" || !userId) throw new Error("owner_user_id is required");
    const result = await client.query(
      "SELECT 1 FROM tenant_users tu JOIN users u ON u.id = tu.user_id WHERE tu.tenant_id = $1 AND tu.user_id = $2 AND tu.status = 'active' AND u.status = 'active' AND tu.deleted_at IS NULL AND u.deleted_at IS NULL",
      [tenantId, userId],
    );
    if (!result.rows[0]) throw new NotFoundException("owner user not found in tenant");
  }

  private async requireAuthority(client: PoolClient, tenantId: string, userId: string) {
    const result = await client.query<{ name: string }>(
      `
      SELECT r.name
      FROM tenant_users tu
      JOIN user_roles ur ON ur.tenant_user_id = tu.id
      JOIN roles r ON r.id = ur.role_id
      WHERE tu.tenant_id = $1
        AND tu.user_id = $2
        AND tu.status = 'active'
        AND r.name = ANY($3::text[])
        AND r.deleted_at IS NULL
      LIMIT 1
      `,
      [tenantId, userId, Array.from(authorityRoles)],
    );
    if (!result.rows[0]) throw new ForbiddenException("Executive or Growth Director authority is required");
  }

  private async relationshipPathExists(client: PoolClient, tenantId: string, opportunity: Record<string, unknown>) {
    const result = await client.query(
      `
      SELECT 1
      FROM relationship_paths rp
      JOIN relationship_maps rm ON rm.id = rp.relationship_map_id
      WHERE rp.tenant_id = $1
        AND rm.tenant_id = $1
        AND rp.deleted_at IS NULL
        AND rm.deleted_at IS NULL
        AND rp.status <> 'archived'
        AND rm.status <> 'archived'
        AND (
          rm.target_organization_id = $2
          OR (rm.target_object_type = 'opportunity_candidate' AND rm.target_object_id = $3)
        )
      LIMIT 1
      `,
      [tenantId, opportunity.organization_id, opportunity.candidate_id],
    );
    return Boolean(result.rows[0]);
  }

  private async capacityRequirementExists(client: PoolClient, tenantId: string, opportunityId: string) {
    const result = await client.query(
      "SELECT 1 FROM opportunity_capacity_requirements WHERE tenant_id = $1 AND opportunity_id = $2 AND status = 'active' AND deleted_at IS NULL LIMIT 1",
      [tenantId, opportunityId],
    );
    return Boolean(result.rows[0]);
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
        systemActions: [{ actionType: `${eventType}.processed`, payload: { action } }],
        write,
      });
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
