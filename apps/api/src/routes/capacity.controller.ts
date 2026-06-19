import { BadRequestException, Body, Controller, ForbiddenException, Get, Inject, NotFoundException, Param, Patch, Post, Req } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import { findTenantRecordById, insertTenantRecord, listTenantRecords, updateTenantRecord } from "@syncos/database";
import { executeWriteAction, type WriteActionResult } from "@syncos/shared";
import { DATABASE_POOL } from "../modules/database.module";
import { RequirePermission } from "../security/require-permission.decorator";
import type { AuthenticatedRequest } from "./intelligence.types";
import { pick, requireAllowed, requireString } from "./intelligence.types";

const providerTypes = new Set(["subcontractor", "crew_provider", "equipment_provider", "staffing_partner", "vendor"]);
const providerStatuses = new Set(["prospect", "qualified", "verification_pending", "verified", "contract_pending", "contracted", "activated", "suspended", "archived"]);
const crewTypes = new Set(["bore", "trench", "aerial", "splicing", "drop", "restoration", "inspection", "project_management"]);
const activeArchivedStatuses = new Set(["active", "inactive", "archived"]);
const documentTypes = new Set(["insurance", "w9", "msa", "rate_schedule", "safety_document", "certification", "equipment_list", "crew_list", "reference"]);
const documentStatuses = new Set(["submitted", "approved", "rejected", "expired", "archived"]);
const complianceStatuses = new Set(["compliant", "approved", "pending_review", "submitted", "missing", "rejected", "expired", "archived"]);
const insuranceStatuses = new Set(["active", "approved", "expires_within_30_days", "submitted", "pending_review", "missing", "rejected", "expired", "archived"]);
const activationAuthorityRoles = new Set(["Operations Manager", "Compliance Manager"]);
const suspendAuthorityRoles = new Set(["Operations Manager", "Compliance Manager", "Executive"]);
const complianceAuthorityRoles = new Set(["Compliance Manager"]);

const requiredDocumentsByProviderType: Record<string, string[]> = {
  subcontractor: ["insurance", "w9", "msa", "rate_schedule", "safety_document", "crew_list"],
  crew_provider: ["insurance", "w9", "msa", "rate_schedule", "safety_document", "crew_list"],
  equipment_provider: ["insurance", "w9", "msa", "rate_schedule", "equipment_list"],
  staffing_partner: ["insurance", "w9", "msa", "rate_schedule", "safety_document"],
  vendor: ["insurance", "w9", "msa", "rate_schedule"],
};

@Controller()
export class CapacityController {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  @Get("capacity-providers")
  @RequirePermission("capacity_provider.read")
  async listProviders(@Req() request: AuthenticatedRequest) {
    return this.withClient((client) => listTenantRecords(client, "capacity_providers", request.auth.tenantId, { searchColumns: ["name", "provider_type", "status"] }));
  }

  @Get("capacity-providers/:id")
  @RequirePermission("capacity_provider.read")
  async getProvider(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    const provider = await this.withClient((client) => this.requireProvider(client, request.auth.tenantId, id));
    return provider;
  }

  @Post("capacity-providers")
  @RequirePermission("capacity_provider.create")
  async createProvider(@Req() request: AuthenticatedRequest, @Body() body: Record<string, unknown>) {
    try {
      const name = requireString(body.name, "provider name is required");
      const providerType = requireAllowed(body.provider_type, providerTypes, "provider_type");
      return await this.write(request, "capacity_provider.create", "capacity_provider.created", "capacity_provider", async (client) => {
        await this.requireOrganization(client, request.auth.tenantId, body.organization_id);
        if (body.primary_contact_id) await this.requireContact(client, request.auth.tenantId, body.primary_contact_id, body.organization_id);
        const provider = await insertTenantRecord(client, "capacity_providers", request.auth.tenantId, {
          organization_id: body.organization_id,
          primary_contact_id: body.primary_contact_id,
          name,
          provider_type: providerType,
          status: "prospect",
          verification_status: "prospect",
        });
        return { entityType: "capacity_provider", entityId: provider.id, afterState: provider };
      });
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Patch("capacity-providers/:id")
  @RequirePermission("capacity_provider.update")
  async updateProvider(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      if (body.status !== undefined || body.verification_status !== undefined || body.contract_status !== undefined) {
        throw new BadRequestException("status changes must use lifecycle action routes");
      }
      const values = pick(body, ["name", "suspended_reason"]);
      if (body.provider_type !== undefined) values.provider_type = requireAllowed(body.provider_type, providerTypes, "provider_type");
      return await this.write(request, "capacity_provider.update", "capacity_provider.updated", "capacity_provider", async (client) => {
        const before = await this.requireProvider(client, request.auth.tenantId, id);
        if (body.organization_id) {
          await this.requireOrganization(client, request.auth.tenantId, body.organization_id);
          values.organization_id = body.organization_id;
        }
        if (body.primary_contact_id) {
          await this.requireContact(client, request.auth.tenantId, body.primary_contact_id, values.organization_id ?? before.organization_id);
          values.primary_contact_id = body.primary_contact_id;
        }
        const after = await updateTenantRecord(client, "capacity_providers", request.auth.tenantId, id, values);
        if (!after) throw new NotFoundException("capacity provider not found");
        return { entityType: "capacity_provider", entityId: id, beforeState: before, afterState: after };
      }, body.reason);
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post("capacity-providers/:id/qualify")
  @RequirePermission("capacity_provider.qualify")
  async qualifyProvider(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.write(request, "capacity_provider.qualify", "capacity_provider.qualified", "capacity_provider", async (client) => {
      const before = await this.requireProvider(client, request.auth.tenantId, id);
      await this.requireOrganization(client, request.auth.tenantId, before.organization_id);
      requireString(before.provider_type, "provider_type is required");
      if (!before.primary_contact_id) throw new BadRequestException("primary_contact_id is required");
      await this.requireContact(client, request.auth.tenantId, before.primary_contact_id, before.organization_id);
      const after = await updateTenantRecord(client, "capacity_providers", request.auth.tenantId, id, {
        status: "qualified",
        verification_status: "qualified",
      });
      if (!after) throw new NotFoundException("capacity provider not found");
      return { entityType: "capacity_provider", entityId: id, beforeState: before, afterState: after };
    });
  }

  @Post("capacity-providers/:id/verify")
  @RequirePermission("capacity_provider.verify")
  async verifyProvider(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.write(request, "capacity_provider.verify", "capacity_provider.verified", "capacity_provider", async (client) => {
      const before = await this.requireProvider(client, request.auth.tenantId, id);
      await this.requireApprovedRequiredDocuments(client, request.auth.tenantId, before);
      const after = await updateTenantRecord(client, "capacity_providers", request.auth.tenantId, id, {
        status: "verified",
        verification_status: "verified",
      });
      if (!after) throw new NotFoundException("capacity provider not found");
      return { entityType: "capacity_provider", entityId: id, beforeState: before, afterState: after };
    });
  }

  @Post("capacity-providers/:id/contract")
  @RequirePermission("capacity_provider.contract")
  async contractProvider(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.write(request, "capacity_provider.contract", "capacity_provider.contracted", "capacity_provider", async (client) => {
      const before = await this.requireProvider(client, request.auth.tenantId, id);
      if (before.verification_status !== "verified" || before.status !== "verified") throw new BadRequestException("verification must be complete");
      const after = await updateTenantRecord(client, "capacity_providers", request.auth.tenantId, id, {
        status: "contracted",
        contract_status: "contracted",
      });
      if (!after) throw new NotFoundException("capacity provider not found");
      return { entityType: "capacity_provider", entityId: id, beforeState: before, afterState: after };
    });
  }

  @Post("capacity-providers/:id/activate")
  @RequirePermission("capacity_provider.activate")
  async activateProvider(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.write(request, "capacity_provider.activate", "capacity_provider.activated", "capacity_provider", async (client) => {
      await this.requireRoleAuthority(client, request.auth.tenantId, request.auth.userId, activationAuthorityRoles, "Operations Manager or Compliance Manager authority is required");
      const before = await this.requireProvider(client, request.auth.tenantId, id);
      if (before.status !== "contracted" || before.contract_status !== "contracted") throw new BadRequestException("provider must be contracted");
      await this.requireApprovedRequiredDocuments(client, request.auth.tenantId, before);
      const record = await this.latestCapacityRecord(client, request.auth.tenantId, id);
      if (!record) throw new BadRequestException("capacity record is required");
      if (!["compliant", "approved"].includes(String(record.compliance_status))) throw new BadRequestException("capacity record compliance must be compliant or approved");
      if (!["active", "approved"].includes(String(record.insurance_status))) throw new BadRequestException("capacity record insurance must be active or approved");
      const after = await updateTenantRecord(client, "capacity_providers", request.auth.tenantId, id, { status: "activated" });
      if (!after) throw new NotFoundException("capacity provider not found");
      return { entityType: "capacity_provider", entityId: id, beforeState: before, afterState: after };
    });
  }

  @Post("capacity-providers/:id/suspend")
  @RequirePermission("capacity_provider.suspend")
  async suspendProvider(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      const reason = requireString(body.reason ?? body.suspended_reason, "suspension reason is required");
      return await this.write(request, "capacity_provider.suspend", "capacity_provider.suspended", "capacity_provider", async (client) => {
        await this.requireRoleAuthority(client, request.auth.tenantId, request.auth.userId, suspendAuthorityRoles, "Operations Manager, Compliance Manager, or Executive authority is required");
        const before = await this.requireProvider(client, request.auth.tenantId, id);
        const after = await updateTenantRecord(client, "capacity_providers", request.auth.tenantId, id, {
          status: "suspended",
          verification_status: "suspended",
          suspended_reason: reason,
        });
        if (!after) throw new NotFoundException("capacity provider not found");
        return { entityType: "capacity_provider", entityId: id, beforeState: before, afterState: after };
      }, reason);
    } catch (error) {
      if (error instanceof ForbiddenException || error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post("capacity-providers/:id/archive")
  @RequirePermission("capacity_provider.archive")
  async archiveProvider(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.write(request, "capacity_provider.archive", "capacity_provider.archived", "capacity_provider", async (client) => {
      const before = await this.requireProvider(client, request.auth.tenantId, id);
      const after = await updateTenantRecord(client, "capacity_providers", request.auth.tenantId, id, {
        status: "archived",
        verification_status: "archived",
        deleted_at: new Date(),
      });
      if (!after) throw new NotFoundException("capacity provider not found");
      return { entityType: "capacity_provider", entityId: id, beforeState: before, afterState: after };
    });
  }

  @Get("crews")
  @RequirePermission("crew.read")
  async listCrews(@Req() request: AuthenticatedRequest) {
    return this.withClient((client) => listTenantRecords(client, "crews", request.auth.tenantId, { searchColumns: ["name", "crew_type", "status"] }));
  }

  @Get("crews/:id")
  @RequirePermission("crew.read")
  async getCrew(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient((client) => this.requireRecord(client, "crews", request.auth.tenantId, id, "crew not found"));
  }

  @Post("crews")
  @RequirePermission("crew.create")
  async createCrew(@Req() request: AuthenticatedRequest, @Body() body: Record<string, unknown>) {
    try {
      const name = requireString(body.name, "crew name is required");
      const crewType = requireAllowed(body.crew_type, crewTypes, "crew_type");
      return await this.write(request, "crew.create", "crew.created", "crew", async (client) => {
        await this.requireProvider(client, request.auth.tenantId, body.capacity_provider_id);
        const crew = await insertTenantRecord(client, "crews", request.auth.tenantId, {
          capacity_provider_id: body.capacity_provider_id,
          name,
          crew_type: crewType,
          status: "active",
        });
        return { entityType: "crew", entityId: crew.id, afterState: crew };
      });
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Patch("crews/:id")
  @RequirePermission("crew.update")
  async updateCrew(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.updateSimpleRecord(request, "crews", id, "crew", "crew.update", "crew.updated", body, ["name"], async (client, values) => {
      if (body.crew_type !== undefined) values.crew_type = requireAllowed(body.crew_type, crewTypes, "crew_type");
      if (body.status !== undefined) values.status = requireAllowed(body.status, activeArchivedStatuses, "crew status");
      if (body.capacity_provider_id) {
        await this.requireProvider(client, request.auth.tenantId, body.capacity_provider_id);
        values.capacity_provider_id = body.capacity_provider_id;
      }
    });
  }

  @Post("crews/:id/archive")
  @RequirePermission("crew.archive")
  async archiveCrew(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.archiveSimpleRecord(request, "crews", id, "crew", "crew.archive", "crew.archived");
  }

  @Get("workers")
  @RequirePermission("worker.read")
  async listWorkers(@Req() request: AuthenticatedRequest) {
    return this.withClient((client) => listTenantRecords(client, "workers", request.auth.tenantId, { searchColumns: ["first_name", "last_name", "status"] }));
  }

  @Get("workers/:id")
  @RequirePermission("worker.read")
  async getWorker(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient((client) => this.requireRecord(client, "workers", request.auth.tenantId, id, "worker not found"));
  }

  @Post("workers")
  @RequirePermission("worker.create")
  async createWorker(@Req() request: AuthenticatedRequest, @Body() body: Record<string, unknown>) {
    try {
      const firstName = requireString(body.first_name, "first_name is required");
      const lastName = requireString(body.last_name, "last_name is required");
      return await this.write(request, "worker.create", "worker.created", "worker", async (client) => {
        await this.requireProvider(client, request.auth.tenantId, body.capacity_provider_id);
        if (body.crew_id) await this.requireCrewForProvider(client, request.auth.tenantId, body.crew_id, body.capacity_provider_id);
        const worker = await insertTenantRecord(client, "workers", request.auth.tenantId, {
          capacity_provider_id: body.capacity_provider_id,
          crew_id: body.crew_id,
          first_name: firstName,
          last_name: lastName,
          status: "active",
        });
        return { entityType: "worker", entityId: worker.id, afterState: worker };
      });
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Patch("workers/:id")
  @RequirePermission("worker.update")
  async updateWorker(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.updateSimpleRecord(request, "workers", id, "worker", "worker.update", "worker.updated", body, ["first_name", "last_name"], async (client, values, before) => {
      if (body.status !== undefined) values.status = requireAllowed(body.status, activeArchivedStatuses, "worker status");
      if (body.capacity_provider_id) {
        await this.requireProvider(client, request.auth.tenantId, body.capacity_provider_id);
        values.capacity_provider_id = body.capacity_provider_id;
      }
      if (body.crew_id) {
        await this.requireCrewForProvider(client, request.auth.tenantId, body.crew_id, values.capacity_provider_id ?? before.capacity_provider_id);
        values.crew_id = body.crew_id;
      }
    });
  }

  @Post("workers/:id/archive")
  @RequirePermission("worker.archive")
  async archiveWorker(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.archiveSimpleRecord(request, "workers", id, "worker", "worker.archive", "worker.archived");
  }

  @Get("equipment")
  @RequirePermission("equipment.read")
  async listEquipment(@Req() request: AuthenticatedRequest) {
    return this.withClient((client) => listTenantRecords(client, "equipment", request.auth.tenantId, { searchColumns: ["name", "equipment_type", "status"] }));
  }

  @Get("equipment/:id")
  @RequirePermission("equipment.read")
  async getEquipment(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient((client) => this.requireRecord(client, "equipment", request.auth.tenantId, id, "equipment not found"));
  }

  @Post("equipment")
  @RequirePermission("equipment.create")
  async createEquipment(@Req() request: AuthenticatedRequest, @Body() body: Record<string, unknown>) {
    try {
      const name = requireString(body.name, "equipment name is required");
      const equipmentType = requireString(body.equipment_type, "equipment_type is required");
      return await this.write(request, "equipment.create", "equipment.created", "equipment", async (client) => {
        await this.requireProvider(client, request.auth.tenantId, body.capacity_provider_id);
        if (body.crew_id) await this.requireCrewForProvider(client, request.auth.tenantId, body.crew_id, body.capacity_provider_id);
        const equipment = await insertTenantRecord(client, "equipment", request.auth.tenantId, {
          capacity_provider_id: body.capacity_provider_id,
          crew_id: body.crew_id,
          name,
          equipment_type: equipmentType,
          status: "active",
        });
        return { entityType: "equipment", entityId: equipment.id, afterState: equipment };
      });
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Patch("equipment/:id")
  @RequirePermission("equipment.update")
  async updateEquipment(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.updateSimpleRecord(request, "equipment", id, "equipment", "equipment.update", "equipment.updated", body, ["name", "equipment_type"], async (client, values, before) => {
      if (body.status !== undefined) values.status = requireAllowed(body.status, activeArchivedStatuses, "equipment status");
      if (body.capacity_provider_id) {
        await this.requireProvider(client, request.auth.tenantId, body.capacity_provider_id);
        values.capacity_provider_id = body.capacity_provider_id;
      }
      if (body.crew_id) {
        await this.requireCrewForProvider(client, request.auth.tenantId, body.crew_id, values.capacity_provider_id ?? before.capacity_provider_id);
        values.crew_id = body.crew_id;
      }
    });
  }

  @Post("equipment/:id/archive")
  @RequirePermission("equipment.archive")
  async archiveEquipment(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.archiveSimpleRecord(request, "equipment", id, "equipment", "equipment.archive", "equipment.archived");
  }

  @Get("compliance-documents")
  @RequirePermission("compliance_document.read")
  async listDocuments(@Req() request: AuthenticatedRequest) {
    return this.withClient((client) => listTenantRecords(client, "compliance_documents", request.auth.tenantId, { searchColumns: ["document_type", "status"] }));
  }

  @Get("compliance-documents/:id")
  @RequirePermission("compliance_document.read")
  async getDocument(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient((client) => this.requireRecord(client, "compliance_documents", request.auth.tenantId, id, "compliance document not found"));
  }

  @Post("compliance-documents")
  @RequirePermission("compliance_document.create")
  async createDocument(@Req() request: AuthenticatedRequest, @Body() body: Record<string, unknown>) {
    try {
      const documentType = requireAllowed(body.document_type, documentTypes, "document_type");
      const status = body.status === undefined ? "submitted" : requireAllowed(body.status, documentStatuses, "document status");
      return await this.write(request, "compliance_document.create", "compliance_document.created", "compliance_document", async (client) => {
        await this.requireProvider(client, request.auth.tenantId, body.capacity_provider_id);
        const document = await insertTenantRecord(client, "compliance_documents", request.auth.tenantId, {
          capacity_provider_id: body.capacity_provider_id,
          document_type: documentType,
          status,
          expires_at: body.expires_at,
          metadata: this.objectOrEmpty(body.metadata),
        });
        return { entityType: "compliance_document", entityId: document.id, afterState: document };
      });
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Patch("compliance-documents/:id")
  @RequirePermission("compliance_document.update")
  async updateDocument(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      const values = pick(body, ["expires_at"]);
      if (body.document_type !== undefined) values.document_type = requireAllowed(body.document_type, documentTypes, "document_type");
      if (body.status !== undefined) values.status = requireAllowed(body.status, documentStatuses, "document status");
      if (body.metadata !== undefined) values.metadata = this.objectOrEmpty(body.metadata);
      return await this.write(request, "compliance_document.update", "compliance_document.updated", "compliance_document", async (client) => {
        const before = await this.requireRecord(client, "compliance_documents", request.auth.tenantId, id, "compliance document not found");
        if (body.capacity_provider_id) {
          await this.requireProvider(client, request.auth.tenantId, body.capacity_provider_id);
          values.capacity_provider_id = body.capacity_provider_id;
        }
        const after = await updateTenantRecord(client, "compliance_documents", request.auth.tenantId, id, values);
        if (!after) throw new NotFoundException("compliance document not found");
        return { entityType: "compliance_document", entityId: id, beforeState: before, afterState: after };
      }, body.reason);
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post("compliance-documents/:id/verify")
  @RequirePermission("compliance_document.verify")
  async verifyDocument(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.write(request, "compliance_document.verify", "compliance_document.verified", "compliance_document", async (client) => {
      await this.requireRoleAuthority(client, request.auth.tenantId, request.auth.userId, complianceAuthorityRoles, "Compliance Manager authority is required");
      const before = await this.requireRecord(client, "compliance_documents", request.auth.tenantId, id, "compliance document not found");
      const after = await updateTenantRecord(client, "compliance_documents", request.auth.tenantId, id, {
        status: "approved",
        verified_by: request.auth.userId,
        verified_at: new Date(),
      });
      if (!after) throw new NotFoundException("compliance document not found");
      return { entityType: "compliance_document", entityId: id, beforeState: before, afterState: after };
    });
  }

  @Post("compliance-documents/:id/archive")
  @RequirePermission("compliance_document.archive")
  async archiveDocument(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.archiveSimpleRecord(request, "compliance_documents", id, "compliance_document", "compliance_document.archive", "compliance_document.archived");
  }

  @Get("capacity-records")
  @RequirePermission("capacity_record.read")
  async listCapacityRecords(@Req() request: AuthenticatedRequest) {
    return this.withClient((client) => listTenantRecords(client, "capacity_records", request.auth.tenantId, { searchColumns: ["capacity_type", "unit", "compliance_status", "insurance_status"] }));
  }

  @Get("capacity-records/:id")
  @RequirePermission("capacity_record.read")
  async getCapacityRecord(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient((client) => this.requireRecord(client, "capacity_records", request.auth.tenantId, id, "capacity record not found"));
  }

  @Post("capacity-records")
  @RequirePermission("capacity_record.create")
  async createCapacityRecord(@Req() request: AuthenticatedRequest, @Body() body: Record<string, unknown>) {
    try {
      const capacityType = requireString(body.capacity_type, "capacity_type is required");
      const quantity = this.requirePositiveNumber(body.quantity, "quantity");
      const unit = requireString(body.unit, "unit is required");
      return await this.write(request, "capacity_record.create", "capacity_record.created", "capacity_record", async (client) => {
        await this.requireProvider(client, request.auth.tenantId, body.capacity_provider_id);
        if (body.territory_id) await this.requireTerritory(client, request.auth.tenantId, body.territory_id);
        const record = await insertTenantRecord(client, "capacity_records", request.auth.tenantId, {
          capacity_provider_id: body.capacity_provider_id,
          capacity_type: capacityType,
          territory_id: body.territory_id,
          availability_start: body.availability_start,
          availability_end: body.availability_end,
          production_rate: body.production_rate,
          production_unit: body.production_unit,
          compliance_status: body.compliance_status === undefined ? "missing" : requireAllowed(body.compliance_status, complianceStatuses, "compliance_status"),
          insurance_status: body.insurance_status === undefined ? "missing" : requireAllowed(body.insurance_status, insuranceStatuses, "insurance_status"),
          current_utilization: body.current_utilization,
          quantity,
          unit,
          effective_date: body.effective_date,
          evidence: this.objectOrEmpty(body.evidence),
        });
        return { entityType: "capacity_record", entityId: record.id, afterState: record };
      });
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Patch("capacity-records/:id")
  @RequirePermission("capacity_record.update")
  async updateCapacityRecord(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      const values = pick(body, ["capacity_type", "availability_start", "availability_end", "production_rate", "production_unit", "unit", "effective_date", "current_utilization"]);
      if (body.quantity !== undefined) values.quantity = this.requirePositiveNumber(body.quantity, "quantity");
      if (body.compliance_status !== undefined) values.compliance_status = requireAllowed(body.compliance_status, complianceStatuses, "compliance_status");
      if (body.insurance_status !== undefined) values.insurance_status = requireAllowed(body.insurance_status, insuranceStatuses, "insurance_status");
      if (body.evidence !== undefined) values.evidence = this.objectOrEmpty(body.evidence);
      return await this.write(request, "capacity_record.update", "capacity_record.updated", "capacity_record", async (client) => {
        const before = await this.requireRecord(client, "capacity_records", request.auth.tenantId, id, "capacity record not found");
        if (body.capacity_provider_id) {
          await this.requireProvider(client, request.auth.tenantId, body.capacity_provider_id);
          values.capacity_provider_id = body.capacity_provider_id;
        }
        if (body.territory_id) {
          await this.requireTerritory(client, request.auth.tenantId, body.territory_id);
          values.territory_id = body.territory_id;
        }
        const after = await updateTenantRecord(client, "capacity_records", request.auth.tenantId, id, values);
        if (!after) throw new NotFoundException("capacity record not found");
        return { entityType: "capacity_record", entityId: id, beforeState: before, afterState: after };
      }, body.reason);
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post("capacity-records/:id/score")
  @RequirePermission("capacity_record.score")
  async scoreCapacityRecord(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.write(request, "capacity_record.score", "capacity_record.scored", "capacity_record", async (client) => {
      const before = await this.requireRecord(client, "capacity_records", request.auth.tenantId, id, "capacity record not found");
      const provider = await this.requireProvider(client, request.auth.tenantId, before.capacity_provider_id);
      const summary = await this.calculateReadiness(client, request.auth.tenantId, before, provider);
      const after = await updateTenantRecord(client, "capacity_records", request.auth.tenantId, id, { readiness_score: summary.readiness_score });
      if (!after) throw new NotFoundException("capacity record not found");
      return { entityType: "capacity_record", entityId: id, beforeState: before, afterState: { ...after, readiness_summary: summary } };
    });
  }

  @Post("capacity-records/:id/archive")
  @RequirePermission("capacity_record.archive")
  async archiveCapacityRecord(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.archiveSimpleRecord(request, "capacity_records", id, "capacity_record", "capacity_record.archive", "capacity_record.archived");
  }

  @Post("capacity-gap-analysis")
  @RequirePermission("capacity_gap_analysis.create")
  async createGapAnalysis(@Req() request: AuthenticatedRequest, @Body() body: Record<string, unknown>) {
    return this.write(request, "capacity_gap_analysis.create", "capacity_gap_analysis.created", "capacity_gap_analysis", async (client) => {
      let opportunityId: string | undefined;
      let territoryId: string | undefined;
      let required = this.parseRequiredCapacity(body.required_capacity);
      if (body.opportunity_id) {
        if (typeof body.opportunity_id !== "string") throw new BadRequestException("opportunity_id must be a string");
        opportunityId = body.opportunity_id;
        const opportunity = await this.requireRecord(client, "opportunities", request.auth.tenantId, opportunityId, "opportunity not found");
        territoryId = typeof opportunity.territory_id === "string" ? opportunity.territory_id : undefined;
        required = await this.requiredFromOpportunity(client, request.auth.tenantId, opportunityId);
      }
      if (body.territory_id) {
        if (typeof body.territory_id !== "string") throw new BadRequestException("territory_id must be a string");
        await this.requireTerritory(client, request.auth.tenantId, body.territory_id);
        territoryId = body.territory_id;
      }
      if (!required.length) throw new BadRequestException("required capacity input is required");
      const available = await this.availableCapacity(client, request.auth.tenantId, required);
      const gaps = required.map((row) => {
        const availableQuantity = available
          .filter((item) => item.capacity_type === row.capacity_type && this.sameTerritory(item.territory_id, row.territory_id))
          .reduce((sum, item) => sum + Number(item.quantity ?? 0), 0);
        const requiredQuantity = Number(row.quantity);
        return {
          capacity_type: row.capacity_type,
          required_quantity: requiredQuantity,
          available_quantity: availableQuantity,
          gap_quantity: Math.max(0, requiredQuantity - availableQuantity),
          territory_id: row.territory_id ?? null,
        };
      });
      const analysis = await insertTenantRecord(client, "capacity_gap_analyses", request.auth.tenantId, {
        opportunity_id: opportunityId,
        territory_id: territoryId,
        analysis_name: body.analysis_name,
        required_capacity_json: JSON.stringify(required),
        available_capacity_json: JSON.stringify(available),
        gap_summary_json: JSON.stringify(gaps),
        created_by: request.auth.userId,
        status: "created",
      });
      return { entityType: "capacity_gap_analysis", entityId: analysis.id, afterState: analysis };
    });
  }

  @Get("capacity-gap-analysis/:id")
  @RequirePermission("capacity_gap_analysis.read")
  async getGapAnalysis(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      const result = await client.query("SELECT * FROM capacity_gap_analyses WHERE tenant_id = $1 AND id = $2 AND status <> 'archived' LIMIT 1", [
        request.auth.tenantId,
        id,
      ]);
      if (!result.rows[0]) throw new NotFoundException("capacity gap analysis not found");
      return result.rows[0];
    });
  }

  private async updateSimpleRecord(
    request: AuthenticatedRequest,
    table: string,
    id: string,
    entityType: string,
    action: string,
    eventType: string,
    body: Record<string, unknown>,
    fields: string[],
    extend?: (client: PoolClient, values: Record<string, unknown>, before: Record<string, unknown>) => Promise<void>,
  ) {
    try {
      const values = pick(body, fields);
      return await this.write(request, action, eventType, entityType, async (client) => {
        const before = await this.requireRecord(client, table, request.auth.tenantId, id, `${entityType} not found`);
        if (extend) await extend(client, values, before);
        const after = await updateTenantRecord(client, table, request.auth.tenantId, id, values);
        if (!after) throw new NotFoundException(`${entityType} not found`);
        return { entityType, entityId: id, beforeState: before, afterState: after };
      }, body.reason);
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  private async archiveSimpleRecord(request: AuthenticatedRequest, table: string, id: string, entityType: string, action: string, eventType: string) {
    return this.write(request, action, eventType, entityType, async (client) => {
      const before = await this.requireRecord(client, table, request.auth.tenantId, id, `${entityType} not found`);
      const values = table === "capacity_gap_analyses" ? { status: "archived", archived_at: new Date() } : { status: "archived", deleted_at: new Date() };
      const after = await updateTenantRecord(client, table, request.auth.tenantId, id, values);
      if (!after) throw new NotFoundException(`${entityType} not found`);
      return { entityType, entityId: id, beforeState: before, afterState: after };
    });
  }

  private async requireRecord(client: PoolClient, table: string, tenantId: string, id: string, message: string) {
    const record = await findTenantRecordById(client, table, tenantId, id);
    if (!record) throw new NotFoundException(message);
    return record;
  }

  private async requireProvider(client: PoolClient, tenantId: string, id: unknown) {
    if (typeof id !== "string" || !id) throw new Error("capacity_provider_id is required");
    return this.requireRecord(client, "capacity_providers", tenantId, id, "capacity provider not found");
  }

  private async requireOrganization(client: PoolClient, tenantId: string, id: unknown) {
    if (typeof id !== "string" || !id) throw new Error("organization_id is required");
    return this.requireRecord(client, "organizations", tenantId, id, "organization not found");
  }

  private async requireTerritory(client: PoolClient, tenantId: string, id: unknown) {
    if (typeof id !== "string" || !id) throw new Error("territory_id is required");
    return this.requireRecord(client, "territories", tenantId, id, "territory not found");
  }

  private async requireContact(client: PoolClient, tenantId: string, id: unknown, organizationId: unknown) {
    if (typeof id !== "string" || !id) throw new Error("contact id is required");
    const contact = await this.requireRecord(client, "contacts", tenantId, id, "contact not found");
    if (organizationId && contact.organization_id !== organizationId) throw new Error("contact must belong to organization");
    return contact;
  }

  private async requireCrewForProvider(client: PoolClient, tenantId: string, crewId: unknown, providerId: unknown) {
    if (typeof crewId !== "string" || !crewId) throw new Error("crew_id must be a string");
    const crew = await this.requireRecord(client, "crews", tenantId, crewId, "crew not found");
    if (providerId && crew.capacity_provider_id !== providerId) throw new Error("crew must belong to capacity provider");
    return crew;
  }

  private async requireRoleAuthority(client: PoolClient, tenantId: string, userId: string, roles: Set<string>, message: string) {
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
      [tenantId, userId, Array.from(roles)],
    );
    if (!result.rows[0]) throw new ForbiddenException(message);
  }

  private async requireApprovedRequiredDocuments(client: PoolClient, tenantId: string, provider: Record<string, unknown>) {
    const required = this.requiredDocuments(provider.provider_type);
    const documents = await this.providerDocuments(client, tenantId, String(provider.id));
    const missing = required.filter((type) => !documents.some((document) => document.document_type === type && document.status === "approved"));
    if (missing.length) throw new BadRequestException(`approved required documents missing: ${missing.join(", ")}`);
    const expired = documents.filter((document) => required.includes(document.document_type) && document.status === "expired");
    if (expired.length) throw new BadRequestException("required document is expired");
  }

  private requiredDocuments(providerType: unknown) {
    const type = String(providerType);
    const required = requiredDocumentsByProviderType[type];
    if (!required) throw new BadRequestException("provider_type is invalid");
    return required;
  }

  private async providerDocuments(client: PoolClient, tenantId: string, providerId: string) {
    const result = await client.query("SELECT * FROM compliance_documents WHERE tenant_id = $1 AND capacity_provider_id = $2 AND deleted_at IS NULL", [tenantId, providerId]);
    return result.rows;
  }

  private async latestCapacityRecord(client: PoolClient, tenantId: string, providerId: string) {
    const result = await client.query(
      "SELECT * FROM capacity_records WHERE tenant_id = $1 AND capacity_provider_id = $2 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1",
      [tenantId, providerId],
    );
    return result.rows[0] ?? null;
  }

  private async calculateReadiness(client: PoolClient, tenantId: string, record: Record<string, unknown>, provider: Record<string, unknown>) {
    const compliance = this.complianceScore(record.compliance_status);
    const insurance = this.insuranceScore(record.insurance_status);
    const documents = await this.documentCompletenessScore(client, tenantId, provider);
    const verification = this.verificationScore(provider.verification_status);
    const availability = this.availabilityScore(record);
    const raw = compliance * 0.3 + insurance * 0.25 + documents * 0.2 + verification * 0.15 + availability * 0.1;
    const readinessScore = Math.max(0, Math.min(100, Number(raw.toFixed(4))));
    return { compliance, insurance, documents, verification, availability, readiness_score: readinessScore };
  }

  private complianceScore(status: unknown) {
    if (["compliant", "approved"].includes(String(status))) return 100;
    if (["pending_review", "submitted"].includes(String(status))) return 60;
    return 0;
  }

  private insuranceScore(status: unknown) {
    if (["active", "approved"].includes(String(status))) return 100;
    if (status === "expires_within_30_days") return 70;
    if (["submitted", "pending_review"].includes(String(status))) return 50;
    return 0;
  }

  private async documentCompletenessScore(client: PoolClient, tenantId: string, provider: Record<string, unknown>) {
    const required = this.requiredDocuments(provider.provider_type);
    const documents = await this.providerDocuments(client, tenantId, String(provider.id));
    const existing = required.filter((type) => documents.some((document) => document.document_type === type));
    const approved = required.filter((type) => documents.some((document) => document.document_type === type && document.status === "approved"));
    if (approved.length === required.length) return 100;
    if (existing.length === required.length) return 75;
    const ratio = existing.length / required.length;
    if (ratio >= 0.75) return 50;
    if (ratio >= 0.5) return 25;
    return 0;
  }

  private verificationScore(status: unknown) {
    if (status === "verified") return 100;
    if (status === "verification_pending") return 50;
    if (status === "qualified") return 30;
    if (status === "prospect") return 10;
    return 0;
  }

  private availabilityScore(record: Record<string, unknown>) {
    const hasStart = Boolean(record.availability_start);
    const hasEnd = Boolean(record.availability_end);
    const hasTerritory = Boolean(record.territory_id);
    const hasRate = Boolean(record.production_rate);
    const hasUnit = Boolean(record.production_unit);
    if (hasStart && hasEnd && hasTerritory && hasRate && hasUnit) return 100;
    if (hasStart && hasTerritory && !hasEnd) return 70;
    if (hasTerritory && hasRate && (!hasStart || !hasEnd)) return 50;
    if (hasTerritory) return 25;
    return 0;
  }

  private parseRequiredCapacity(input: unknown) {
    if (input === undefined) return [];
    if (!Array.isArray(input)) throw new BadRequestException("required_capacity must be an array");
    return input.map((row) => {
      if (!row || typeof row !== "object") throw new BadRequestException("required capacity rows must be objects");
      const item = row as Record<string, unknown>;
      return {
        capacity_type: requireString(item.capacity_type, "capacity_type is required"),
        quantity: this.requirePositiveNumber(item.quantity, "quantity"),
        territory_id: typeof item.territory_id === "string" ? item.territory_id : null,
      };
    });
  }

  private async requiredFromOpportunity(client: PoolClient, tenantId: string, opportunityId: string) {
    const result = await client.query(
      "SELECT capacity_type, quantity, territory_id FROM opportunity_capacity_requirements WHERE tenant_id = $1 AND opportunity_id = $2 AND status = 'active' AND deleted_at IS NULL",
      [tenantId, opportunityId],
    );
    return result.rows.map((row) => ({ capacity_type: row.capacity_type, quantity: Number(row.quantity), territory_id: row.territory_id ?? null }));
  }

  private async availableCapacity(client: PoolClient, tenantId: string, required: Array<{ capacity_type: string; territory_id: string | null }>) {
    const result = await client.query(
      `
      SELECT capacity_type, territory_id, sum(quantity)::float AS quantity
      FROM capacity_records
      WHERE tenant_id = $1
        AND deleted_at IS NULL
        AND compliance_status IN ('compliant', 'approved')
        AND insurance_status IN ('active', 'approved')
      GROUP BY capacity_type, territory_id
      `,
      [tenantId],
    );
    return result.rows.filter((row) => required.some((item) => item.capacity_type === row.capacity_type && this.sameTerritory(item.territory_id, row.territory_id)));
  }

  private sameTerritory(left: unknown, right: unknown) {
    return (left ?? null) === (right ?? null);
  }

  private requirePositiveNumber(value: unknown, field: string) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${field} must be positive`);
    return parsed;
  }

  private objectOrEmpty(value: unknown) {
    if (value === undefined || value === null) return {};
    if (typeof value !== "object" || Array.isArray(value)) throw new Error("metadata/evidence must be an object");
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
