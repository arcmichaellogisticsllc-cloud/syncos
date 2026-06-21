import { BadRequestException, Body, Controller, ForbiddenException, Get, Inject, NotFoundException, Param, Patch, Post, Req } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import { findTenantRecordById, insertTenantRecord, listTenantRecords, updateTenantRecord } from "@syncos/database";
import { executeWriteAction, type WriteActionResult } from "@syncos/shared";
import { DATABASE_POOL } from "../modules/database.module";
import { RequirePermission } from "../security/require-permission.decorator";
import type { AuthenticatedRequest } from "./intelligence.types";
import { pick } from "./intelligence.types";

const constraintTypes = new Set(["information", "relationship", "capacity", "compliance", "execution", "qc", "safety", "billing", "cash", "decision", "data_trust"]);
const openConstraintStatuses = ["detected", "open", "assigned", "in_progress", "blocked", "resolved"];
const severities = new Set(["low", "medium", "high", "critical"]);
const approvalBehaviors = new Set(["warning", "override_required", "hard_block"]);
const recommendationTypes = new Set([
  "pursue",
  "monitor",
  "avoid",
  "recruit",
  "activate",
  "deploy",
  "stop_work",
  "approve_production",
  "invoice",
  "escalate_collections",
  "strengthen_relationship",
  "investigate_data",
  "resolve_constraint",
]);
const verifierRolesByType: Record<string, string[]> = {
  information: ["Executive", "Regional Director", "Operations Manager", "Compliance Manager", "Safety Manager", "QC Manager", "Billing Manager", "Finance Manager", "System Admin", "Growth Director"],
  relationship: ["Executive", "Regional Director", "Operations Manager", "Compliance Manager", "Safety Manager", "QC Manager", "Billing Manager", "Finance Manager", "System Admin", "Growth Director"],
  capacity: ["Executive", "Regional Director", "Operations Manager", "Compliance Manager", "Safety Manager", "QC Manager", "Billing Manager", "Finance Manager", "System Admin"],
  compliance: ["Executive", "Regional Director", "Operations Manager", "Compliance Manager", "Safety Manager", "QC Manager", "Billing Manager", "Finance Manager", "System Admin"],
  execution: ["Executive", "Regional Director", "Operations Manager", "Compliance Manager", "Safety Manager", "QC Manager", "Billing Manager", "Finance Manager", "System Admin", "Project Manager"],
  qc: ["Executive", "Regional Director", "Operations Manager", "Compliance Manager", "Safety Manager", "QC Manager", "Billing Manager", "Finance Manager", "System Admin", "Project Manager"],
  safety: ["Executive", "Regional Director", "Operations Manager", "Compliance Manager", "Safety Manager", "QC Manager", "Billing Manager", "Finance Manager", "System Admin"],
  billing: ["Executive", "Regional Director", "Operations Manager", "Compliance Manager", "Safety Manager", "QC Manager", "Billing Manager", "Finance Manager", "System Admin"],
  cash: ["Executive", "Regional Director", "Operations Manager", "Compliance Manager", "Safety Manager", "QC Manager", "Billing Manager", "Finance Manager", "System Admin"],
  decision: ["Executive", "Regional Director", "Operations Manager", "Compliance Manager", "Safety Manager", "QC Manager", "Billing Manager", "Finance Manager", "System Admin", "Growth Director"],
  data_trust: ["Executive", "Regional Director", "Operations Manager", "Compliance Manager", "Safety Manager", "QC Manager", "Billing Manager", "Finance Manager", "System Admin", "Growth Director"],
};

const approvalRolesByRecommendationType: Record<string, string[]> = {
  pursue: ["Executive", "Growth Director", "Regional Director"],
  monitor: ["Growth Director", "Regional Director", "Executive"],
  avoid: ["Growth Director", "Regional Director", "Executive"],
  recruit: ["Recruiter", "Operations Manager", "Regional Director", "Executive"],
  activate: ["Operations Manager", "Compliance Manager", "Regional Director", "Executive"],
  deploy: ["Operations Manager", "Project Manager", "Regional Director", "Executive"],
  stop_work: ["Safety Manager", "QC Manager", "Executive"],
  approve_production: ["QC Manager", "Project Manager", "Operations Manager"],
  invoice: ["Billing Manager", "Finance Manager", "Executive"],
  escalate_collections: ["Finance Manager", "Billing Manager", "Executive"],
  strengthen_relationship: ["Growth Director", "Regional Director", "Executive"],
  investigate_data: ["Growth Director", "Regional Director", "Project Manager", "Recruiter", "Operations Manager", "Compliance Manager", "QC Manager", "Billing Manager", "Finance Manager", "Executive"],
  resolve_constraint: ["Executive", "System Admin", "Operations Manager", "Compliance Manager", "Safety Manager", "QC Manager", "Billing Manager", "Finance Manager", "Project Manager"],
};

const objectTables: Record<string, string> = {
  opportunity_capacity_requirement: "opportunity_capacity_requirements",
  capacity_provider: "capacity_providers",
  production_record: "production_records",
  invoice: "invoices",
  opportunity: "opportunities",
  organization: "organizations",
  contact: "contacts",
  signal: "signals",
  project: "projects",
  work_order: "work_orders",
  settlement: "settlements",
  payment: "payments",
  territory: "territories",
  relationship_map: "relationship_maps",
  relationship_path: "relationship_paths",
  opportunity_candidate: "opportunity_candidates",
  candidate_signal: "candidate_signals",
  capacity_record: "capacity_records",
  compliance_document: "compliance_documents",
  crew: "crews",
  worker: "workers",
  equipment: "equipment",
  contract: "contracts",
  rate_schedule: "rate_schedules",
  rate_code: "rate_codes",
  settlement_item: "settlement_items",
  ar_record: "ar_records",
  constraint: "constraints",
  recommendation: "recommendations",
};

@Controller()
export class ConstraintsController {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  @Post("constraints/detect")
  @RequirePermission("constraint.detect")
  async detect(@Req() request: AuthenticatedRequest, @Body() body: Record<string, unknown>) {
    const requested = Array.isArray(body.detection_types) ? body.detection_types.map(String) : [];
    const detectionTypes = requested.length ? requested : ["capacity", "compliance", "qc", "cash"];
    for (const type of detectionTypes) {
      if (!["capacity", "compliance", "qc", "cash"].includes(type)) throw new BadRequestException("unsupported detection type");
    }
    const candidates = await this.withClient(async (client) => {
      const all: Array<Record<string, unknown>> = [];
      if (detectionTypes.includes("capacity")) all.push(...await this.capacityCandidates(client, request.auth.tenantId, body));
      if (detectionTypes.includes("compliance")) all.push(...await this.complianceCandidates(client, request.auth.tenantId, body));
      if (detectionTypes.includes("qc")) all.push(...await this.qcCandidates(client, request.auth.tenantId, body));
      if (detectionTypes.includes("cash")) all.push(...await this.cashCandidates(client, request.auth.tenantId, body));
      return all;
    });

    const detected = [];
    const skipped = [];
    for (const candidate of candidates) {
      const duplicate = await this.withClient((client) => this.findDuplicateConstraint(client, request.auth.tenantId, String(candidate.constraint_type), String(candidate.affected_object_type), String(candidate.affected_object_id)));
      if (duplicate) {
        skipped.push({ ...candidate, existing_constraint_id: duplicate.id });
        continue;
      }
      detected.push(await this.createConstraintRecord(request, candidate, "constraint.created"));
    }
    return { detected_constraints: detected, skipped_duplicates: skipped };
  }

  @Get("constraints")
  @RequirePermission("constraint.read")
  async listConstraints(@Req() request: AuthenticatedRequest) {
    return this.withClient((client) => listTenantRecords(client, "constraints", request.auth.tenantId, { searchColumns: ["title", "constraint_type", "status", "severity"] }));
  }

  @Get("constraints/:id")
  @RequirePermission("constraint.read")
  async getConstraint(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient((client) => this.requireRecord(client, "constraints", request.auth.tenantId, id, "constraint not found"));
  }

  @Post("constraints")
  @RequirePermission("constraint.create")
  async createConstraint(@Req() request: AuthenticatedRequest, @Body() body: Record<string, unknown>) {
    const constraintType = this.requireAllowed(body.constraint_type, constraintTypes, "constraint_type");
    const affectedObjectType = this.requireString(body.affected_object_type, "affected_object_type is required");
    const affectedObjectId = this.requiredId(body.affected_object_id, "affected_object_id");
    const title = this.requireString(body.title, "constraint title is required");
    const severity = this.requireAllowed(body.severity, severities, "severity");
    return this.createConstraintRecord(request, {
      constraint_type: constraintType,
      affected_object_type: affectedObjectType,
      affected_object_id: affectedObjectId,
      title,
      description: body.description,
      severity,
      hard_stop: booleanValue(body.hard_stop, false),
      override_allowed: body.override_allowed === undefined ? true : booleanValue(body.override_allowed, true),
      approval_behavior: approvalBehavior(body.approval_behavior, severity, booleanValue(body.hard_stop, false)),
      status: "open",
    }, "constraint.created");
  }

  @Patch("constraints/:id")
  @RequirePermission("constraint.update")
  async updateConstraint(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    const values = pick(body, ["title", "description", "due_date"]);
    if (body.status !== undefined) throw new BadRequestException("status changes must use lifecycle action routes");
    if (body.constraint_type !== undefined) values.constraint_type = this.requireAllowed(body.constraint_type, constraintTypes, "constraint_type");
    if (body.severity !== undefined) values.severity = this.requireAllowed(body.severity, severities, "severity");
    if (body.hard_stop !== undefined) values.hard_stop = booleanValue(body.hard_stop, false);
    if (body.override_allowed !== undefined) values.override_allowed = booleanValue(body.override_allowed, true);
    if (body.approval_behavior !== undefined) values.approval_behavior = this.requireAllowed(body.approval_behavior, approvalBehaviors, "approval_behavior");
    return this.write(request, "constraint.update", "constraint.updated", "constraint", async (client) => {
      const before = await this.requireRecord(client, "constraints", request.auth.tenantId, id, "constraint not found");
      if (values.approval_behavior === undefined && (values.severity !== undefined || values.hard_stop !== undefined)) {
        values.approval_behavior = approvalBehavior(undefined, String(values.severity ?? before.severity), Boolean(values.hard_stop ?? before.hard_stop));
      }
      const after = await updateTenantRecord(client, "constraints", request.auth.tenantId, id, values);
      if (!after) throw new NotFoundException("constraint not found");
      return { entityType: "constraint", entityId: id, beforeState: before, afterState: after };
    }, body.reason);
  }

  @Post("constraints/:id/assign")
  @RequirePermission("constraint.assign")
  async assignConstraint(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    const ownerId = this.requiredId(body.owner_id, "owner_id");
    const dueDate = this.requireString(body.due_date, "due_date is required");
    return this.write(request, "constraint.assign", "constraint.assigned", "constraint", async (client) => {
      await this.requireTenantUser(client, request.auth.tenantId, ownerId);
      const before = await this.requireRecord(client, "constraints", request.auth.tenantId, id, "constraint not found");
      const after = await updateTenantRecord(client, "constraints", request.auth.tenantId, id, { owner_id: ownerId, due_date: dueDate, status: "assigned" });
      if (!after) throw new NotFoundException("constraint not found");
      return { entityType: "constraint", entityId: id, beforeState: before, afterState: after };
    });
  }

  @Post("constraints/:id/escalate")
  @RequirePermission("constraint.escalate")
  async escalateConstraint(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.statusUpdate(request, id, "constraint.escalate", "constraint.escalated", "blocked", { escalated_at: new Date() });
  }

  @Post("constraints/:id/resolve")
  @RequirePermission("constraint.resolve")
  async resolveConstraint(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    const summary = this.requireString(body.resolution_summary, "resolution_summary is required");
    return this.write(request, "constraint.resolve", "constraint.resolved", "constraint", async (client) => {
      const before = await this.requireRecord(client, "constraints", request.auth.tenantId, id, "constraint not found");
      if (before.owner_id !== request.auth.userId) throw new ForbiddenException("assigned owner is required");
      const after = await updateTenantRecord(client, "constraints", request.auth.tenantId, id, { status: "resolved", resolution_summary: summary, resolved_at: new Date() });
      if (!after) throw new NotFoundException("constraint not found");
      return { entityType: "constraint", entityId: id, beforeState: before, afterState: after };
    }, summary);
  }

  @Post("constraints/:id/verify")
  @RequirePermission("constraint.verify")
  async verifyConstraint(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    const summary = this.requireString(body.verification_summary, "verification_summary is required");
    return this.write(request, "constraint.verify", "constraint.verified", "constraint", async (client) => {
      const before = await this.requireRecord(client, "constraints", request.auth.tenantId, id, "constraint not found");
      await this.requireConstraintVerifier(client, request.auth.tenantId, request.auth.userId, String(before.constraint_type));
      const after = await updateTenantRecord(client, "constraints", request.auth.tenantId, id, { status: "verified", verification_summary: summary, verified_at: new Date() });
      if (!after) throw new NotFoundException("constraint not found");
      return { entityType: "constraint", entityId: id, beforeState: before, afterState: after };
    }, summary);
  }

  @Post("constraints/:id/close")
  @RequirePermission("constraint.close")
  async closeConstraint(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.write(request, "constraint.close", "constraint.closed", "constraint", async (client) => {
      const before = await this.requireRecord(client, "constraints", request.auth.tenantId, id, "constraint not found");
      if (before.status !== "verified") throw new BadRequestException("constraint must be verified");
      const after = await updateTenantRecord(client, "constraints", request.auth.tenantId, id, { status: "closed", closed_at: new Date() });
      if (!after) throw new NotFoundException("constraint not found");
      return { entityType: "constraint", entityId: id, beforeState: before, afterState: after };
    });
  }

  @Post("constraints/:id/archive")
  @RequirePermission("constraint.archive")
  async archiveConstraint(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.archiveRecord(request, "constraints", id, "constraint", "constraint.archive", "constraint.archived");
  }

  @Get("recommendations")
  @RequirePermission("recommendation.read")
  async listRecommendations(@Req() request: AuthenticatedRequest) {
    return this.withClient((client) => listTenantRecords(client, "recommendations", request.auth.tenantId, { searchColumns: ["title", "recommendation_type", "status", "risk_level"] }));
  }

  @Get("recommendations/:id")
  @RequirePermission("recommendation.read")
  async getRecommendation(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient((client) => this.requireRecord(client, "recommendations", request.auth.tenantId, id, "recommendation not found"));
  }

  @Post("recommendations")
  @RequirePermission("recommendation.create")
  async createRecommendation(@Req() request: AuthenticatedRequest, @Body() body: Record<string, unknown>) {
    const recommendationType = this.requireAllowed(body.recommendation_type, recommendationTypes, "recommendation_type");
    const title = this.requireString(body.title, "recommendation title is required");
    const evidenceSummary = this.requireString(body.evidence_summary, "evidence_summary is required");
    if (body.confidence_score === undefined || body.confidence_score === null || body.confidence_score === "") throw new BadRequestException("confidence_score is required");
    if (!body.constraint_id && (!body.related_object_type || !body.related_object_id)) throw new BadRequestException("constraint_id or related object is required");
    return this.write(request, "recommendation.create", "recommendation.created", "recommendation", async (client) => {
      if (body.constraint_id) await this.requireRecord(client, "constraints", request.auth.tenantId, this.requiredId(body.constraint_id, "constraint_id"), "constraint not found");
      if (body.related_object_type && body.related_object_id) {
        await this.validateAffectedObject(client, request.auth.tenantId, String(body.related_object_type), this.requiredId(body.related_object_id, "related_object_id"));
      }
      const recommendation = await insertTenantRecord(client, "recommendations", request.auth.tenantId, {
        constraint_id: body.constraint_id,
        related_object_type: body.related_object_type,
        related_object_id: body.related_object_id,
        recommendation_type: recommendationType,
        title,
        evidence_summary: evidenceSummary,
        confidence_score: this.optionalScore(body.confidence_score, "confidence_score"),
        confidence: this.optionalScore(body.confidence_score, "confidence_score"),
        risk_level: this.requireString(body.risk_level, "risk_level is required"),
        expected_impact: this.requireString(body.expected_impact, "expected_impact is required"),
        status: "generated",
      });
      return { entityType: "recommendation", entityId: recommendation.id, afterState: recommendation };
    });
  }

  @Patch("recommendations/:id")
  @RequirePermission("recommendation.update")
  async updateRecommendation(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    const values = pick(body, ["title", "evidence_summary", "risk_level", "expected_impact"]);
    if (body.status !== undefined) throw new BadRequestException("status changes must use lifecycle action routes");
    if (body.recommendation_type !== undefined) values.recommendation_type = this.requireAllowed(body.recommendation_type, recommendationTypes, "recommendation_type");
    if (body.confidence_score !== undefined) {
      values.confidence_score = this.optionalScore(body.confidence_score, "confidence_score");
      values.confidence = values.confidence_score;
    }
    return this.write(request, "recommendation.update", "recommendation.updated", "recommendation", async (client) => {
      const before = await this.requireRecord(client, "recommendations", request.auth.tenantId, id, "recommendation not found");
      const after = await updateTenantRecord(client, "recommendations", request.auth.tenantId, id, values);
      if (!after) throw new NotFoundException("recommendation not found");
      return { entityType: "recommendation", entityId: id, beforeState: before, afterState: after };
    }, body.reason);
  }

  @Post("recommendations/:id/approve")
  @RequirePermission("recommendation.approve")
  async approveRecommendation(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.write(request, "recommendation.approve", "recommendation.approved", "recommendation", async (client) => {
      const before = await this.requireRecord(client, "recommendations", request.auth.tenantId, id, "recommendation not found");
      await this.requireRecommendationApprover(client, request.auth.tenantId, request.auth.userId, String(before.recommendation_type));
      const after = await updateTenantRecord(client, "recommendations", request.auth.tenantId, id, { status: "approved", approved_at: new Date() });
      if (!after) throw new NotFoundException("recommendation not found");
      return { entityType: "recommendation", entityId: id, beforeState: before, afterState: after };
    });
  }

  @Post("recommendations/:id/reject")
  @RequirePermission("recommendation.reject")
  async rejectRecommendation(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    const reason = this.requireString(body.rejection_reason, "rejection_reason is required");
    return this.recommendationStatus(request, id, "recommendation.reject", "recommendation.rejected", "rejected", { rejection_reason: reason }, reason);
  }

  @Post("recommendations/:id/defer")
  @RequirePermission("recommendation.defer")
  async deferRecommendation(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    const reason = this.requireString(body.defer_reason, "defer_reason is required");
    const reviewDate = this.requireString(body.review_date, "review_date is required");
    return this.recommendationStatus(request, id, "recommendation.defer", "recommendation.deferred", "deferred", { defer_reason: reason, review_date: reviewDate }, reason);
  }

  @Post("recommendations/:id/convert-to-workflow")
  @RequirePermission("recommendation.convert_workflow")
  async convertRecommendation(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    const workflowDefinitionId = this.requiredId(body.workflow_definition_id, "workflow_definition_id");
    return this.write(request, "recommendation.convert_workflow", "recommendation.converted_to_workflow", "recommendation", async (client) => {
      const before = await this.requireRecord(client, "recommendations", request.auth.tenantId, id, "recommendation not found");
      if (before.status !== "approved") throw new BadRequestException("recommendation must be approved");
      await this.requireRecommendationApprover(client, request.auth.tenantId, request.auth.userId, String(before.recommendation_type));
      const definition = await this.requireRecord(client, "workflow_definitions", request.auth.tenantId, workflowDefinitionId, "workflow definition not found");
      if (definition.status !== "active") throw new BadRequestException("workflow definition must be active");
      const firstStep = await this.firstWorkflowStep(client, request.auth.tenantId, workflowDefinitionId);
      const instance = await insertTenantRecord(client, "workflow_instances", request.auth.tenantId, {
        workflow_definition_id: workflowDefinitionId,
        entity_type: "recommendation",
        entity_id: id,
        source_object_type: "recommendation",
        source_object_id: id,
        owner_user_id: request.auth.userId,
        status: "in_progress",
        started_at: new Date(),
        due_at: this.hoursFromNow(Number(definition.sla_hours)),
      });
      const task = await insertTenantRecord(client, "workflow_tasks", request.auth.tenantId, {
        workflow_instance_id: instance.id,
        step_id: firstStep.id,
        assigned_role: firstStep.owner_role,
        title: firstStep.step_name,
        task_name: firstStep.step_name,
        due_at: this.hoursFromNow(Number(firstStep.sla_hours)),
        status: "open",
      });
      const after = await updateTenantRecord(client, "recommendations", request.auth.tenantId, id, { status: "converted_to_workflow" });
      if (!after) throw new NotFoundException("recommendation not found");
      return {
        entityType: "recommendation",
        entityId: id,
        beforeState: before,
        afterState: after,
        additionalEvents: [
          this.additionalEvent("workflow_instance.create", "workflow_instance", instance.id, "workflow_instance.created", instance),
          this.additionalEvent("workflow_instance.start", "workflow_instance", instance.id, "workflow_instance.started", instance),
          this.additionalEvent("workflow_task.create", "workflow_task", task.id, "workflow_task.created", task),
        ],
      };
    });
  }

  @Post("recommendations/:id/complete")
  @RequirePermission("recommendation.complete")
  async completeRecommendation(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.recommendationStatus(request, id, "recommendation.complete", "recommendation.completed", "completed", {});
  }

  @Post("recommendations/:id/measure")
  @RequirePermission("recommendation.measure")
  async measureRecommendation(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.write(request, "recommendation.measure", "recommendation.measured", "recommendation", async (client) => {
      const before = await this.requireRecord(client, "recommendations", request.auth.tenantId, id, "recommendation not found");
      if (before.status !== "completed") throw new BadRequestException("recommendation must be completed");
      const after = await updateTenantRecord(client, "recommendations", request.auth.tenantId, id, { status: "measured" });
      if (!after) throw new NotFoundException("recommendation not found");
      return { entityType: "recommendation", entityId: id, beforeState: before, afterState: after };
    });
  }

  @Post("recommendations/:id/archive")
  @RequirePermission("recommendation.archive")
  async archiveRecommendation(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.archiveRecord(request, "recommendations", id, "recommendation", "recommendation.archive", "recommendation.archived");
  }

  @Get("recommendations/:id/outcomes")
  @RequirePermission("recommendation.read")
  async listOutcomes(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      await this.requireRecord(client, "recommendations", request.auth.tenantId, id, "recommendation not found");
      const result = await client.query("SELECT * FROM recommendation_outcomes WHERE tenant_id = $1 AND recommendation_id = $2 AND deleted_at IS NULL ORDER BY created_at DESC", [request.auth.tenantId, id]);
      return result.rows;
    });
  }

  @Post("recommendations/:id/outcomes")
  @RequirePermission("recommendation.update")
  async createOutcome(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.write(request, "recommendation_outcome.create", "recommendation_outcome.created", "recommendation_outcome", async (client) => {
      await this.requireRecord(client, "recommendations", request.auth.tenantId, id, "recommendation not found");
      const outcome = await insertTenantRecord(client, "recommendation_outcomes", request.auth.tenantId, {
        recommendation_id: id,
        expected_impact: body.expected_impact,
        actual_impact: body.actual_impact,
        success: body.success,
        measured_at: body.measured_at,
        notes: body.notes,
        outcome: String(body.actual_impact ?? body.notes ?? "measured"),
        metadata: this.objectOrEmpty(body.metadata),
      });
      return { entityType: "recommendation_outcome", entityId: outcome.id, afterState: outcome };
    });
  }

  @Patch("recommendation-outcomes/:id")
  @RequirePermission("recommendation.update")
  async updateOutcome(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    const values = pick(body, ["expected_impact", "actual_impact", "success", "measured_at", "notes", "outcome"]);
    if (body.metadata !== undefined) values.metadata = this.objectOrEmpty(body.metadata);
    return this.write(request, "recommendation_outcome.update", "recommendation_outcome.updated", "recommendation_outcome", async (client) => {
      const before = await this.requireRecord(client, "recommendation_outcomes", request.auth.tenantId, id, "recommendation outcome not found");
      const after = await updateTenantRecord(client, "recommendation_outcomes", request.auth.tenantId, id, values);
      if (!after) throw new NotFoundException("recommendation outcome not found");
      return { entityType: "recommendation_outcome", entityId: id, beforeState: before, afterState: after };
    }, body.reason);
  }

  private async createConstraintRecord(request: AuthenticatedRequest, values: Record<string, unknown>, eventType: string) {
    return this.write(request, "constraint.create", eventType, "constraint", async (client) => {
      await this.validateAffectedObject(client, request.auth.tenantId, String(values.affected_object_type), String(values.affected_object_id));
      const constraint = await insertTenantRecord(client, "constraints", request.auth.tenantId, values);
      return { entityType: "constraint", entityId: constraint.id, afterState: constraint };
    });
  }

  private async statusUpdate(request: AuthenticatedRequest, id: string, action: string, eventType: string, status: string, fields: Record<string, unknown>) {
    return this.write(request, action, eventType, "constraint", async (client) => {
      const before = await this.requireRecord(client, "constraints", request.auth.tenantId, id, "constraint not found");
      const after = await updateTenantRecord(client, "constraints", request.auth.tenantId, id, { ...fields, status });
      if (!after) throw new NotFoundException("constraint not found");
      return { entityType: "constraint", entityId: id, beforeState: before, afterState: after };
    });
  }

  private async recommendationStatus(request: AuthenticatedRequest, id: string, action: string, eventType: string, status: string, fields: Record<string, unknown>, reason?: string) {
    return this.write(request, action, eventType, "recommendation", async (client) => {
      const before = await this.requireRecord(client, "recommendations", request.auth.tenantId, id, "recommendation not found");
      const after = await updateTenantRecord(client, "recommendations", request.auth.tenantId, id, { ...fields, status });
      if (!after) throw new NotFoundException("recommendation not found");
      return { entityType: "recommendation", entityId: id, beforeState: before, afterState: after };
    }, reason);
  }

  private async firstWorkflowStep(client: PoolClient, tenantId: string, workflowDefinitionId: string) {
    const result = await client.query(
      "SELECT * FROM workflow_steps WHERE tenant_id = $1 AND workflow_definition_id = $2 AND status <> 'archived' AND deleted_at IS NULL ORDER BY step_order ASC LIMIT 1",
      [tenantId, workflowDefinitionId],
    );
    if (!result.rows[0]) throw new BadRequestException("workflow definition has no steps");
    return result.rows[0];
  }

  private additionalEvent(action: string, aggregateType: string, entityId: string, eventType: string, afterState: Record<string, unknown>) {
    return {
      action,
      aggregateType,
      entityType: aggregateType,
      entityId,
      eventType,
      afterState,
      systemActions: [{ actionType: `${eventType}.processed`, payload: { action } }],
      audit: { metadata: {} },
    };
  }

  private async archiveRecord(request: AuthenticatedRequest, table: string, id: string, entityType: string, action: string, eventType: string) {
    return this.write(request, action, eventType, entityType, async (client) => {
      const before = await this.requireRecord(client, table, request.auth.tenantId, id, `${entityType} not found`);
      const after = await updateTenantRecord(client, table, request.auth.tenantId, id, { status: "archived", deleted_at: new Date() });
      if (!after) throw new NotFoundException(`${entityType} not found`);
      return { entityType, entityId: id, beforeState: before, afterState: after };
    });
  }

  private async capacityCandidates(client: PoolClient, tenantId: string, scope: Record<string, unknown>) {
    const params: unknown[] = [tenantId];
    const filters = ["ocr.tenant_id = $1", "ocr.deleted_at IS NULL", "ocr.status <> 'archived'"];
    if (scope.opportunity_id) {
      params.push(scope.opportunity_id);
      filters.push(`ocr.opportunity_id = $${params.length}`);
    }
    if (scope.territory_id) {
      params.push(scope.territory_id);
      filters.push(`ocr.territory_id = $${params.length}`);
    }
    const result = await client.query(
      `
      SELECT ocr.*, coalesce(sum(cr.quantity), 0)::numeric AS available_quantity
      FROM opportunity_capacity_requirements ocr
      LEFT JOIN capacity_records cr
        ON cr.tenant_id = ocr.tenant_id
       AND cr.capacity_type = ocr.capacity_type
       AND (ocr.territory_id IS NULL OR cr.territory_id = ocr.territory_id)
       AND cr.deleted_at IS NULL
      WHERE ${filters.join(" AND ")}
      GROUP BY ocr.id
      HAVING ocr.quantity > coalesce(sum(cr.quantity), 0)
      `,
      params,
    );
    return result.rows.map((row) => ({
      constraint_type: "capacity",
      affected_object_type: "opportunity_capacity_requirement",
      affected_object_id: row.id,
      title: `Capacity gap: ${row.capacity_type}`,
      description: `Required ${row.quantity}; available ${row.available_quantity}`,
      severity: "high",
      status: "detected",
    }));
  }

  private async complianceCandidates(client: PoolClient, tenantId: string, scope: Record<string, unknown>) {
    const params: unknown[] = [tenantId];
    const filters = ["cd.tenant_id = $1", "cd.deleted_at IS NULL", "cd.status = 'expired'"];
    if (scope.capacity_provider_id) {
      params.push(scope.capacity_provider_id);
      filters.push(`cd.capacity_provider_id = $${params.length}`);
    }
    const result = await client.query(
      `
      SELECT DISTINCT cp.id, cp.name
      FROM compliance_documents cd
      JOIN capacity_providers cp ON cp.id = cd.capacity_provider_id
      WHERE ${filters.join(" AND ")}
      `,
      params,
    );
    return result.rows.map((row) => ({
      constraint_type: "compliance",
      affected_object_type: "capacity_provider",
      affected_object_id: row.id,
      title: `Expired compliance document: ${row.name}`,
      severity: "high",
      status: "detected",
    }));
  }

  private async qcCandidates(client: PoolClient, tenantId: string, scope: Record<string, unknown>) {
    const params: unknown[] = [tenantId];
    const filters = ["tenant_id = $1", "deleted_at IS NULL", "status = 'correction_required'", "correction_required_at < now() - interval '7 days'"];
    if (scope.production_record_id) {
      params.push(scope.production_record_id);
      filters.push(`id = $${params.length}`);
    }
    const result = await client.query(`SELECT * FROM production_records WHERE ${filters.join(" AND ")}`, params);
    return result.rows.map((row) => ({
      constraint_type: "qc",
      affected_object_type: "production_record",
      affected_object_id: row.id,
      title: "Correction required beyond threshold",
      severity: "medium",
      status: "detected",
    }));
  }

  private async cashCandidates(client: PoolClient, tenantId: string, scope: Record<string, unknown>) {
    const params: unknown[] = [tenantId];
    const filters = ["tenant_id = $1", "deleted_at IS NULL", "status = 'overdue'"];
    if (scope.invoice_id) {
      params.push(scope.invoice_id);
      filters.push(`id = $${params.length}`);
    }
    const result = await client.query(`SELECT * FROM invoices WHERE ${filters.join(" AND ")}`, params);
    return result.rows.map((row) => ({
      constraint_type: "cash",
      affected_object_type: "invoice",
      affected_object_id: row.id,
      title: `Overdue invoice: ${row.invoice_number}`,
      severity: "high",
      status: "detected",
    }));
  }

  private async findDuplicateConstraint(client: PoolClient, tenantId: string, constraintType: string, affectedObjectType: string, affectedObjectId: string) {
    const result = await client.query(
      `
      SELECT *
      FROM constraints
      WHERE tenant_id = $1
        AND constraint_type = $2
        AND affected_object_type = $3
        AND affected_object_id = $4
        AND status = ANY($5::text[])
        AND deleted_at IS NULL
      LIMIT 1
      `,
      [tenantId, constraintType, affectedObjectType, affectedObjectId, openConstraintStatuses],
    );
    return result.rows[0] ?? null;
  }

  private async validateAffectedObject(client: PoolClient, tenantId: string, objectType: string, objectId: string) {
    const table = objectTables[objectType];
    if (!table) return;
    await this.requireRecord(client, table, tenantId, objectId, "affected object not found");
  }

  private async requireRecord(client: PoolClient, table: string, tenantId: string, id: string, message: string) {
    const record = await findTenantRecordById(client, table, tenantId, id);
    if (!record) throw new NotFoundException(message);
    return record;
  }

  private async requireTenantUser(client: PoolClient, tenantId: string, userId: string) {
    const result = await client.query(
      `
      SELECT 1
      FROM tenant_users tu
      JOIN users u ON u.id = tu.user_id
      WHERE tu.tenant_id = $1
        AND tu.user_id = $2
        AND tu.status = 'active'
        AND u.status = 'active'
        AND tu.deleted_at IS NULL
        AND u.deleted_at IS NULL
      LIMIT 1
      `,
      [tenantId, userId],
    );
    if (!result.rows[0]) throw new NotFoundException("user not found in tenant");
  }

  private async requireConstraintVerifier(client: PoolClient, tenantId: string, userId: string, constraintType: string) {
    await this.requireAnyRole(client, tenantId, userId, verifierRolesByType[constraintType] ?? [], "constraint verifier authority is required");
  }

  private async requireRecommendationApprover(client: PoolClient, tenantId: string, userId: string, recommendationType: string) {
    await this.requireAnyRole(client, tenantId, userId, approvalRolesByRecommendationType[recommendationType] ?? [], "recommendation approval authority is required");
  }

  private async requireAnyRole(client: PoolClient, tenantId: string, userId: string, roles: string[], message: string) {
    const result = await client.query(
      `
      SELECT 1
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
      [tenantId, userId, roles],
    );
    if (!result.rows[0]) throw new ForbiddenException(message);
  }

  private requiredId(value: unknown, field: string) {
    if (typeof value !== "string" || !value) throw new BadRequestException(`${field} is required`);
    return value;
  }

  private requireString(value: unknown, message: string) {
    if (typeof value !== "string" || !value.trim()) throw new BadRequestException(message);
    return value.trim();
  }

  private requireAllowed(value: unknown, allowed: Set<string>, field: string) {
    const text = this.requireString(value, `${field} is required`);
    if (!allowed.has(text)) throw new BadRequestException(`${field} is invalid`);
    return text;
  }

  private optionalScore(value: unknown, field: string): number | undefined {
    if (value === undefined || value === null || value === "") return undefined;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100) throw new BadRequestException(`${field} must be between 0 and 100`);
    return parsed;
  }

  private hoursFromNow(hours: number) {
    return new Date(Date.now() + hours * 60 * 60 * 1000);
  }

  private objectOrEmpty(value: unknown) {
    if (value === undefined || value === null) return {};
    if (typeof value !== "object" || Array.isArray(value)) throw new BadRequestException("metadata must be an object");
    return value;
  }

  private async write<T>(
    request: AuthenticatedRequest,
    action: string,
    eventType: string,
    aggregateType: string,
    write: (client: PoolClient) => Promise<WriteActionResult<T>>,
    reason?: unknown,
  ) {
    const client = await this.pool.connect();
    try {
      return await executeWriteAction(client, {
        tenantId: request.auth.tenantId,
        actorUserId: request.auth.userId,
        action,
        aggregateType,
        eventType,
        audit: { metadata: typeof reason === "string" && reason.trim() ? { reason: reason.trim() } : {} },
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

function booleanValue(value: unknown, fallback: boolean) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value === "true";
  return Boolean(value);
}

function approvalBehavior(value: unknown, severity: string, hardStop: boolean) {
  if (value !== undefined) {
    if (!approvalBehaviors.has(String(value))) throw new BadRequestException("approval_behavior is invalid");
    return String(value);
  }
  if (hardStop) return "hard_block";
  if (severity === "critical" || severity === "high") return "override_required";
  return "warning";
}
