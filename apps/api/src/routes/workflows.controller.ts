import { BadRequestException, Body, Controller, ForbiddenException, Get, Inject, NotFoundException, Param, Patch, Post, Query, Req } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import { findTenantRecordById, insertTenantRecord, listTenantRecords, updateTenantRecord } from "@syncos/database";
import { executeWriteAction, type WriteActionResult } from "@syncos/shared";
import { DATABASE_POOL } from "../modules/database.module";
import { RequirePermission } from "../security/require-permission.decorator";
import type { AuthenticatedRequest } from "./intelligence.types";
import { pick, positiveInteger } from "./intelligence.types";

const workflowCategories = new Set(["intelligence", "opportunity", "relationship", "capacity", "execution", "settlement", "cash", "constraint", "recommendation", "governance"]);
const objectTables: Record<string, string> = {
  constraint: "constraints",
  recommendation: "recommendations",
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
  opportunity_candidate: "opportunity_candidates",
  capacity_record: "capacity_records",
  compliance_document: "compliance_documents",
  crew: "crews",
  worker: "workers",
  equipment: "equipment",
  contract: "contracts",
  rate_schedule: "rate_schedules",
  rate_code: "rate_codes",
  ar_record: "ar_records",
};
const managerRoles = ["Operations Manager", "Project Manager", "Compliance Manager", "Safety Manager", "QC Manager", "Billing Manager", "Finance Manager"];

@Controller()
export class WorkflowsController {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  @Get("workflow-definitions")
  @RequirePermission("workflow_definition.read")
  async listDefinitions(@Req() request: AuthenticatedRequest) {
    return this.withClient((client) => listTenantRecords(client, "workflow_definitions", request.auth.tenantId, { searchColumns: ["name", "workflow_name", "workflow_category", "status"] }));
  }

  @Get("workflow-definitions/:id")
  @RequirePermission("workflow_definition.read")
  async getDefinition(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient((client) => this.requireRecord(client, "workflow_definitions", request.auth.tenantId, id, "workflow definition not found"));
  }

  @Post("workflow-definitions")
  @RequirePermission("workflow_definition.create")
  async createDefinition(@Req() request: AuthenticatedRequest, @Body() body: Record<string, unknown>) {
    const workflowName = this.requireString(body.workflow_name, "workflow_name is required");
    const category = this.requireAllowed(body.workflow_category, workflowCategories, "workflow_category");
    const slaHours = positiveInteger(body.sla_hours, "sla_hours");
    return this.write(request, "workflow_definition.create", "workflow_definition.created", "workflow_definition", async (client) => {
      const definition = await insertTenantRecord(client, "workflow_definitions", request.auth.tenantId, {
        name: workflowName,
        workflow_name: workflowName,
        workflow_category: category,
        trigger_event_type: this.requireString(body.trigger_event_type, "trigger_event_type is required"),
        start_status: this.requireString(body.start_status, "start_status is required"),
        end_status: this.requireString(body.end_status, "end_status is required"),
        sla_hours: slaHours,
        status: this.requireString(body.status, "status is required"),
      });
      return { entityType: "workflow_definition", entityId: definition.id, afterState: definition };
    });
  }

  @Patch("workflow-definitions/:id")
  @RequirePermission("workflow_definition.update")
  async updateDefinition(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    const values = pick(body, ["trigger_event_type", "start_status", "end_status", "status"]);
    if (body.workflow_name !== undefined) {
      values.workflow_name = this.requireString(body.workflow_name, "workflow_name is required");
      values.name = values.workflow_name;
    }
    if (body.workflow_category !== undefined) values.workflow_category = this.requireAllowed(body.workflow_category, workflowCategories, "workflow_category");
    if (body.sla_hours !== undefined) values.sla_hours = positiveInteger(body.sla_hours, "sla_hours");
    return this.writeUpdate(request, "workflow_definitions", id, "workflow_definition", "workflow_definition.update", "workflow_definition.updated", values, body.reason);
  }

  @Post("workflow-definitions/:id/archive")
  @RequirePermission("workflow_definition.archive")
  async archiveDefinition(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.archiveRecord(request, "workflow_definitions", id, "workflow_definition", "workflow_definition.archive", "workflow_definition.archived");
  }

  @Get("workflow-definitions/:id/steps")
  @RequirePermission("workflow_step.read")
  async listSteps(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      await this.requireRecord(client, "workflow_definitions", request.auth.tenantId, id, "workflow definition not found");
      const result = await client.query(
        "SELECT * FROM workflow_steps WHERE tenant_id = $1 AND workflow_definition_id = $2 AND deleted_at IS NULL ORDER BY step_order ASC",
        [request.auth.tenantId, id],
      );
      return result.rows;
    });
  }

  @Post("workflow-definitions/:id/steps")
  @RequirePermission("workflow_step.create")
  async createStep(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    const stepOrder = positiveInteger(body.step_order, "step_order");
    const stepName = this.requireString(body.step_name, "step_name is required");
    const ownerRole = this.requireString(body.owner_role, "owner_role is required");
    const requiredAction = this.requireString(body.required_action, "required_action is required");
    const slaHours = positiveInteger(body.sla_hours, "sla_hours");
    return this.write(request, "workflow_step.create", "workflow_step.created", "workflow_step", async (client) => {
      await this.requireRecord(client, "workflow_definitions", request.auth.tenantId, id, "workflow definition not found");
      const existing = await client.query(
        "SELECT 1 FROM workflow_steps WHERE tenant_id = $1 AND workflow_definition_id = $2 AND step_order = $3 AND deleted_at IS NULL LIMIT 1",
        [request.auth.tenantId, id, stepOrder],
      );
      if (existing.rows[0]) throw new BadRequestException("duplicate step_order");
      const step = await insertTenantRecord(client, "workflow_steps", request.auth.tenantId, {
        workflow_definition_id: id,
        step_key: `step_${stepOrder}`,
        step_type: requiredAction,
        step_order: stepOrder,
        step_name: stepName,
        owner_role: ownerRole,
        required_action: requiredAction,
        sla_hours: slaHours,
        approval_required: Boolean(body.approval_required),
        sort_order: stepOrder,
        config: {},
        status: "active",
      });
      return { entityType: "workflow_step", entityId: step.id, afterState: step };
    });
  }

  @Patch("workflow-steps/:id")
  @RequirePermission("workflow_step.update")
  async updateStep(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    const values = pick(body, ["step_name", "owner_role", "required_action", "approval_required", "status"]);
    if (body.step_order !== undefined) {
      values.step_order = positiveInteger(body.step_order, "step_order");
      values.sort_order = values.step_order;
    }
    if (body.sla_hours !== undefined) values.sla_hours = positiveInteger(body.sla_hours, "sla_hours");
    return this.write(request, "workflow_step.update", "workflow_step.updated", "workflow_step", async (client) => {
      const before = await this.requireRecord(client, "workflow_steps", request.auth.tenantId, id, "workflow step not found");
      if (values.step_order !== undefined && Number(values.step_order) !== Number(before.step_order)) {
        const existing = await client.query(
          "SELECT 1 FROM workflow_steps WHERE tenant_id = $1 AND workflow_definition_id = $2 AND step_order = $3 AND id <> $4 AND deleted_at IS NULL LIMIT 1",
          [request.auth.tenantId, before.workflow_definition_id, values.step_order, id],
        );
        if (existing.rows[0]) throw new BadRequestException("duplicate step_order");
      }
      const after = await updateTenantRecord(client, "workflow_steps", request.auth.tenantId, id, values);
      if (!after) throw new NotFoundException("workflow step not found");
      return { entityType: "workflow_step", entityId: id, beforeState: before, afterState: after };
    }, body.reason);
  }

  @Post("workflow-steps/:id/archive")
  @RequirePermission("workflow_step.archive")
  async archiveStep(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.archiveRecord(request, "workflow_steps", id, "workflow_step", "workflow_step.archive", "workflow_step.archived");
  }

  @Get("workflow-instances")
  @RequirePermission("workflow_instance.read")
  async listInstances(@Req() request: AuthenticatedRequest) {
    return this.withClient((client) => listTenantRecords(client, "workflow_instances", request.auth.tenantId, { searchColumns: ["source_object_type", "status"] }));
  }

  @Get("workflow-instances/:id")
  @RequirePermission("workflow_instance.read")
  async getInstance(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient((client) => this.requireRecord(client, "workflow_instances", request.auth.tenantId, id, "workflow instance not found"));
  }

  @Post("workflow-instances")
  @RequirePermission("workflow_instance.create")
  async createInstance(@Req() request: AuthenticatedRequest, @Body() body: Record<string, unknown>) {
    const definitionId = this.requiredId(body.workflow_definition_id, "workflow_definition_id");
    const sourceObjectType = this.requireString(body.source_object_type, "source_object_type is required");
    const sourceObjectId = this.requiredId(body.source_object_id, "source_object_id");
    return this.write(request, "workflow_instance.create", "workflow_instance.created", "workflow_instance", async (client) => {
      await this.requireRecord(client, "workflow_definitions", request.auth.tenantId, definitionId, "workflow definition not found");
      await this.validateSourceObject(client, request.auth.tenantId, sourceObjectType, sourceObjectId);
      const instance = await insertTenantRecord(client, "workflow_instances", request.auth.tenantId, {
        workflow_definition_id: definitionId,
        entity_type: sourceObjectType,
        entity_id: sourceObjectId,
        source_object_type: sourceObjectType,
        source_object_id: sourceObjectId,
        owner_user_id: body.owner_user_id ?? request.auth.userId,
        status: "created",
      });
      return { entityType: "workflow_instance", entityId: instance.id, afterState: instance };
    });
  }

  @Patch("workflow-instances/:id")
  @RequirePermission("workflow_instance.update")
  async updateInstance(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    const values = pick(body, ["owner_user_id"]);
    if (body.status !== undefined) throw new BadRequestException("status changes must use lifecycle action routes");
    return this.writeUpdate(request, "workflow_instances", id, "workflow_instance", "workflow_instance.update", "workflow_instance.updated", values, body.reason);
  }

  @Post("workflow-instances/:id/start")
  @RequirePermission("workflow_instance.start")
  async startInstance(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.write(request, "workflow_instance.start", "workflow_instance.started", "workflow_instance", async (client) => {
      const before = await this.requireRecord(client, "workflow_instances", request.auth.tenantId, id, "workflow instance not found");
      if (!["created", "started"].includes(String(before.status))) throw new BadRequestException("workflow instance must be created");
      const definition = await this.requireRecord(client, "workflow_definitions", request.auth.tenantId, before.workflow_definition_id, "workflow definition not found");
      const firstStep = await this.firstStep(client, request.auth.tenantId, before.workflow_definition_id);
      const dueAt = this.hoursFromNow(Number(definition.sla_hours));
      const after = await updateTenantRecord(client, "workflow_instances", request.auth.tenantId, id, { status: "in_progress", started_at: new Date(), due_at: dueAt });
      if (!after) throw new NotFoundException("workflow instance not found");
      const task = await this.createTaskFromStep(client, request.auth.tenantId, id, firstStep);
      return {
        entityType: "workflow_instance",
        entityId: id,
        beforeState: before,
        afterState: after,
        additionalEvents: [this.additionalEvent(request, "workflow_task.create", "workflow_task", task.id, "workflow_task.created", task)],
      };
    });
  }

  @Post("workflow-instances/:id/complete")
  @RequirePermission("workflow_instance.complete")
  async completeInstance(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.write(request, "workflow_instance.complete", "workflow_instance.completed", "workflow_instance", async (client) => {
      const before = await this.requireRecord(client, "workflow_instances", request.auth.tenantId, id, "workflow instance not found");
      if (before.status !== "in_progress") throw new BadRequestException("workflow instance must be in_progress");
      const openTasks = await client.query(
        "SELECT 1 FROM workflow_tasks WHERE tenant_id = $1 AND workflow_instance_id = $2 AND status NOT IN ('completed', 'cancelled', 'archived') AND deleted_at IS NULL LIMIT 1",
        [request.auth.tenantId, id],
      );
      if (openTasks.rows[0]) throw new BadRequestException("all required tasks must be completed");
      const after = await updateTenantRecord(client, "workflow_instances", request.auth.tenantId, id, { status: "completed", completed_at: new Date() });
      if (!after) throw new NotFoundException("workflow instance not found");
      return { entityType: "workflow_instance", entityId: id, beforeState: before, afterState: after };
    });
  }

  @Post("workflow-instances/:id/cancel")
  @RequirePermission("workflow_instance.cancel")
  async cancelInstance(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    const reason = this.requireString(body.reason, "cancel reason is required");
    return this.write(request, "workflow_instance.cancel", "workflow_instance.cancelled", "workflow_instance", async (client) => {
      const before = await this.requireRecord(client, "workflow_instances", request.auth.tenantId, id, "workflow instance not found");
      if (before.owner_user_id !== request.auth.userId) await this.requireAnyRole(client, request.auth.tenantId, request.auth.userId, [...managerRoles, "Executive", "System Admin"], "workflow cancel authority is required");
      const after = await updateTenantRecord(client, "workflow_instances", request.auth.tenantId, id, { status: "cancelled", cancelled_at: new Date(), cancel_reason: reason });
      if (!after) throw new NotFoundException("workflow instance not found");
      return { entityType: "workflow_instance", entityId: id, beforeState: before, afterState: after };
    }, reason);
  }

  @Post("workflow-instances/:id/archive")
  @RequirePermission("workflow_instance.archive")
  async archiveInstance(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.archiveRecord(request, "workflow_instances", id, "workflow_instance", "workflow_instance.archive", "workflow_instance.archived");
  }

  @Get("workflow-tasks")
  @RequirePermission("workflow_task.read")
  async listTasks(@Req() request: AuthenticatedRequest, @Query("status") status?: string, @Query("overdue") overdue?: string) {
    return this.withClient(async (client) => {
      const params: unknown[] = [request.auth.tenantId];
      const filters = ["tenant_id = $1", "deleted_at IS NULL"];
      if (status) {
        params.push(status);
        filters.push(`status = $${params.length}`);
      }
      if (overdue === "true") filters.push("due_at < now() AND status NOT IN ('completed', 'cancelled', 'archived')");
      const result = await client.query(`SELECT * FROM workflow_tasks WHERE ${filters.join(" AND ")} ORDER BY due_at ASC NULLS LAST, created_at DESC LIMIT 100`, params);
      return result.rows;
    });
  }

  @Get("workflow-tasks/:id")
  @RequirePermission("workflow_task.read")
  async getTask(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient((client) => this.requireRecord(client, "workflow_tasks", request.auth.tenantId, id, "workflow task not found"));
  }

  @Patch("workflow-tasks/:id")
  @RequirePermission("workflow_task.update")
  async updateTask(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    const values = pick(body, ["task_name", "title", "assigned_to", "assigned_role", "due_at"]);
    if (body.status !== undefined) throw new BadRequestException("status changes must use lifecycle action routes");
    return this.writeUpdate(request, "workflow_tasks", id, "workflow_task", "workflow_task.update", "workflow_task.updated", values, body.reason);
  }

  @Post("workflow-tasks/:id/complete")
  @RequirePermission("workflow_task.complete")
  async completeTask(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.write(request, "workflow_task.complete", "workflow_task.completed", "workflow_task", async (client) => {
      const before = await this.requireRecord(client, "workflow_tasks", request.auth.tenantId, id, "workflow task not found");
      if (!["open", "in_progress"].includes(String(before.status))) throw new BadRequestException("workflow task must be open or in_progress");
      const after = await updateTenantRecord(client, "workflow_tasks", request.auth.tenantId, id, { status: "completed", completed_at: new Date(), completion_note: body.completion_note });
      if (!after) throw new NotFoundException("workflow task not found");
      const nextStep = await this.nextStep(client, request.auth.tenantId, before.workflow_instance_id, before.step_id);
      const additionalEvents = [];
      if (nextStep) {
        const nextTask = await this.createTaskFromStep(client, request.auth.tenantId, before.workflow_instance_id, nextStep);
        additionalEvents.push(this.additionalEvent(request, "workflow_task.create", "workflow_task", nextTask.id, "workflow_task.created", nextTask));
      }
      return { entityType: "workflow_task", entityId: id, beforeState: before, afterState: after, additionalEvents };
    }, body.completion_note);
  }

  @Post("workflow-tasks/:id/reassign")
  @RequirePermission("workflow_task.reassign")
  async reassignTask(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    const reason = this.requireString(body.reason, "reason is required");
    if (!body.assigned_to && !body.assigned_role) throw new BadRequestException("new assigned_to or assigned_role is required");
    return this.write(request, "workflow_task.reassign", "workflow_task.reassigned", "workflow_task", async (client) => {
      const before = await this.requireRecord(client, "workflow_tasks", request.auth.tenantId, id, "workflow task not found");
      await this.requireTaskAuthority(client, request, before);
      if (body.assigned_to) await this.requireTenantUser(client, request.auth.tenantId, this.requiredId(body.assigned_to, "assigned_to"));
      const after = await updateTenantRecord(client, "workflow_tasks", request.auth.tenantId, id, {
        assigned_to: body.assigned_to,
        assigned_user_id: body.assigned_to,
        assigned_role: body.assigned_role,
        reassignment_reason: reason,
        reassigned_at: new Date(),
        status: "reassigned",
      });
      if (!after) throw new NotFoundException("workflow task not found");
      return { entityType: "workflow_task", entityId: id, beforeState: before, afterState: after };
    }, reason);
  }

  @Post("workflow-tasks/:id/escalate")
  @RequirePermission("workflow_task.escalate")
  async escalateTask(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    const reason = this.requireString(body.reason, "reason is required");
    return this.write(request, "workflow_task.escalate", "workflow_task.escalated", "workflow_task", async (client) => {
      const before = await this.requireRecord(client, "workflow_tasks", request.auth.tenantId, id, "workflow task not found");
      await this.requireTaskAuthority(client, request, before);
      const after = await updateTenantRecord(client, "workflow_tasks", request.auth.tenantId, id, { status: "escalated", escalation_reason: reason, escalated_at: new Date() });
      if (!after) throw new NotFoundException("workflow task not found");
      const escalation = await insertTenantRecord(client, "workflow_escalations", request.auth.tenantId, {
        workflow_task_id: id,
        workflow_instance_id: before.workflow_instance_id,
        escalated_by: request.auth.userId,
        escalated_to_role: body.escalated_to_role,
        reason,
      });
      return {
        entityType: "workflow_task",
        entityId: id,
        beforeState: before,
        afterState: after,
        additionalEvents: [this.additionalEvent(request, "workflow_escalation.create", "workflow_escalation", escalation.id, "workflow_escalation.created", escalation)],
      };
    }, reason);
  }

  @Post("workflow-tasks/:id/archive")
  @RequirePermission("workflow_task.archive")
  async archiveTask(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.archiveRecord(request, "workflow_tasks", id, "workflow_task", "workflow_task.archive", "workflow_task.archived");
  }

  private async createTaskFromStep(client: PoolClient, tenantId: string, instanceId: string, step: Record<string, unknown>) {
    return insertTenantRecord(client, "workflow_tasks", tenantId, {
      workflow_instance_id: instanceId,
      step_id: step.id,
      assigned_role: step.owner_role,
      title: step.step_name,
      task_name: step.step_name,
      due_at: this.hoursFromNow(Number(step.sla_hours)),
      status: "open",
    });
  }

  private async firstStep(client: PoolClient, tenantId: string, definitionId: string) {
    const result = await client.query(
      "SELECT * FROM workflow_steps WHERE tenant_id = $1 AND workflow_definition_id = $2 AND status <> 'archived' AND deleted_at IS NULL ORDER BY step_order ASC LIMIT 1",
      [tenantId, definitionId],
    );
    if (!result.rows[0]) throw new BadRequestException("workflow definition has no steps");
    return result.rows[0];
  }

  private async nextStep(client: PoolClient, tenantId: string, instanceId: string, currentStepId: string) {
    const current = await this.requireRecord(client, "workflow_steps", tenantId, currentStepId, "workflow step not found");
    const instance = await this.requireRecord(client, "workflow_instances", tenantId, instanceId, "workflow instance not found");
    const result = await client.query(
      `
      SELECT *
      FROM workflow_steps
      WHERE tenant_id = $1
        AND workflow_definition_id = $2
        AND step_order > $3
        AND status <> 'archived'
        AND deleted_at IS NULL
      ORDER BY step_order ASC
      LIMIT 1
      `,
      [tenantId, instance.workflow_definition_id, current.step_order],
    );
    return result.rows[0] ?? null;
  }

  private async requireTaskAuthority(client: PoolClient, request: AuthenticatedRequest, task: Record<string, unknown>) {
    const instance = await this.requireRecord(client, "workflow_instances", request.auth.tenantId, String(task.workflow_instance_id), "workflow instance not found");
    if (task.assigned_to === request.auth.userId || instance.owner_user_id === request.auth.userId) return;
    await this.requireAnyRole(client, request.auth.tenantId, request.auth.userId, ["System Admin"], "workflow task authority is required");
  }

  private async writeUpdate(request: AuthenticatedRequest, table: string, id: string, entityType: string, action: string, eventType: string, values: Record<string, unknown>, reason?: unknown) {
    return this.write(request, action, eventType, entityType, async (client) => {
      const before = await this.requireRecord(client, table, request.auth.tenantId, id, `${entityType} not found`);
      const after = await updateTenantRecord(client, table, request.auth.tenantId, id, values);
      if (!after) throw new NotFoundException(`${entityType} not found`);
      return { entityType, entityId: id, beforeState: before, afterState: after };
    }, reason);
  }

  private async archiveRecord(request: AuthenticatedRequest, table: string, id: string, entityType: string, action: string, eventType: string) {
    return this.write(request, action, eventType, entityType, async (client) => {
      const before = await this.requireRecord(client, table, request.auth.tenantId, id, `${entityType} not found`);
      const after = await updateTenantRecord(client, table, request.auth.tenantId, id, { status: "archived", deleted_at: new Date() });
      if (!after) throw new NotFoundException(`${entityType} not found`);
      return { entityType, entityId: id, beforeState: before, afterState: after };
    });
  }

  private additionalEvent(request: AuthenticatedRequest, action: string, aggregateType: string, entityId: string, eventType: string, afterState: Record<string, unknown>) {
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

  private async validateSourceObject(client: PoolClient, tenantId: string, objectType: string, objectId: string) {
    const table = objectTables[objectType];
    if (!table) return;
    await this.requireRecord(client, table, tenantId, objectId, "source object not found");
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

  private hoursFromNow(hours: number) {
    return new Date(Date.now() + hours * 60 * 60 * 1000);
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
