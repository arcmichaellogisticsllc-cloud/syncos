-- RC1.1 production hardening: tenant-safe composite FK coverage for high-risk references.
-- These constraints are additive and keep the existing migration chain stable.

CREATE UNIQUE INDEX territories_tenant_id_id_uidx ON territories(tenant_id, id);
CREATE UNIQUE INDEX organizations_tenant_id_id_uidx ON organizations(tenant_id, id);
CREATE UNIQUE INDEX contacts_tenant_id_id_uidx ON contacts(tenant_id, id);
CREATE UNIQUE INDEX signals_tenant_id_id_uidx ON signals(tenant_id, id);
CREATE UNIQUE INDEX relationship_maps_tenant_id_id_uidx ON relationship_maps(tenant_id, id);
CREATE UNIQUE INDEX opportunity_candidates_tenant_id_id_uidx ON opportunity_candidates(tenant_id, id);
CREATE UNIQUE INDEX opportunities_tenant_id_id_uidx ON opportunities(tenant_id, id);
CREATE UNIQUE INDEX capacity_providers_tenant_id_id_uidx ON capacity_providers(tenant_id, id);
CREATE UNIQUE INDEX crews_tenant_id_id_uidx ON crews(tenant_id, id);
CREATE UNIQUE INDEX capacity_records_tenant_id_id_uidx ON capacity_records(tenant_id, id);
CREATE UNIQUE INDEX compliance_documents_tenant_id_id_uidx ON compliance_documents(tenant_id, id);
CREATE UNIQUE INDEX projects_tenant_id_id_uidx ON projects(tenant_id, id);
CREATE UNIQUE INDEX work_orders_tenant_id_id_uidx ON work_orders(tenant_id, id);
CREATE UNIQUE INDEX production_records_tenant_id_id_uidx ON production_records(tenant_id, id);
CREATE UNIQUE INDEX contracts_tenant_id_id_uidx ON contracts(tenant_id, id);
CREATE UNIQUE INDEX rate_schedules_tenant_id_id_uidx ON rate_schedules(tenant_id, id);
CREATE UNIQUE INDEX rate_codes_tenant_id_id_uidx ON rate_codes(tenant_id, id);
CREATE UNIQUE INDEX settlements_tenant_id_id_uidx ON settlements(tenant_id, id);
CREATE UNIQUE INDEX settlement_items_tenant_id_id_uidx ON settlement_items(tenant_id, id);
CREATE UNIQUE INDEX invoices_tenant_id_id_uidx ON invoices(tenant_id, id);
CREATE UNIQUE INDEX payments_tenant_id_id_uidx ON payments(tenant_id, id);
CREATE UNIQUE INDEX ar_records_tenant_id_id_uidx ON ar_records(tenant_id, id);
CREATE UNIQUE INDEX constraints_tenant_id_id_uidx ON constraints(tenant_id, id);
CREATE UNIQUE INDEX recommendations_tenant_id_id_uidx ON recommendations(tenant_id, id);
CREATE UNIQUE INDEX workflow_definitions_tenant_id_id_uidx ON workflow_definitions(tenant_id, id);
CREATE UNIQUE INDEX workflow_steps_tenant_id_id_uidx ON workflow_steps(tenant_id, id);
CREATE UNIQUE INDEX workflow_instances_tenant_id_id_uidx ON workflow_instances(tenant_id, id);
CREATE UNIQUE INDEX workflow_tasks_tenant_id_id_uidx ON workflow_tasks(tenant_id, id);

ALTER TABLE organizations ADD CONSTRAINT organizations_tenant_territory_fk
  FOREIGN KEY (tenant_id, territory_id) REFERENCES territories(tenant_id, id) NOT VALID;

ALTER TABLE organization_relationships ADD CONSTRAINT organization_relationships_tenant_source_fk
  FOREIGN KEY (tenant_id, source_organization_id) REFERENCES organizations(tenant_id, id) NOT VALID;
ALTER TABLE organization_relationships ADD CONSTRAINT organization_relationships_tenant_target_fk
  FOREIGN KEY (tenant_id, target_organization_id) REFERENCES organizations(tenant_id, id) NOT VALID;

ALTER TABLE contacts ADD CONSTRAINT contacts_tenant_organization_fk
  FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations(tenant_id, id) NOT VALID;

ALTER TABLE contact_relationships ADD CONSTRAINT contact_relationships_tenant_source_fk
  FOREIGN KEY (tenant_id, source_contact_id) REFERENCES contacts(tenant_id, id) NOT VALID;
ALTER TABLE contact_relationships ADD CONSTRAINT contact_relationships_tenant_target_fk
  FOREIGN KEY (tenant_id, target_contact_id) REFERENCES contacts(tenant_id, id) NOT VALID;

ALTER TABLE signal_entities ADD CONSTRAINT signal_entities_tenant_signal_fk
  FOREIGN KEY (tenant_id, signal_id) REFERENCES signals(tenant_id, id) NOT VALID;
ALTER TABLE signal_evidence ADD CONSTRAINT signal_evidence_tenant_signal_fk
  FOREIGN KEY (tenant_id, signal_id) REFERENCES signals(tenant_id, id) NOT VALID;

ALTER TABLE relationship_maps ADD CONSTRAINT relationship_maps_tenant_target_org_fk
  FOREIGN KEY (tenant_id, target_organization_id) REFERENCES organizations(tenant_id, id) NOT VALID;
ALTER TABLE relationship_maps ADD CONSTRAINT relationship_maps_tenant_target_contact_fk
  FOREIGN KEY (tenant_id, target_contact_id) REFERENCES contacts(tenant_id, id) NOT VALID;

ALTER TABLE relationship_paths ADD CONSTRAINT relationship_paths_tenant_map_fk
  FOREIGN KEY (tenant_id, relationship_map_id) REFERENCES relationship_maps(tenant_id, id) NOT VALID;
ALTER TABLE relationship_paths ADD CONSTRAINT relationship_paths_tenant_from_contact_fk
  FOREIGN KEY (tenant_id, from_contact_id) REFERENCES contacts(tenant_id, id) NOT VALID;
ALTER TABLE relationship_paths ADD CONSTRAINT relationship_paths_tenant_to_contact_fk
  FOREIGN KEY (tenant_id, to_contact_id) REFERENCES contacts(tenant_id, id) NOT VALID;

ALTER TABLE opportunity_candidates ADD CONSTRAINT opportunity_candidates_tenant_organization_fk
  FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations(tenant_id, id) NOT VALID;
ALTER TABLE opportunity_candidates ADD CONSTRAINT opportunity_candidates_tenant_territory_fk
  FOREIGN KEY (tenant_id, territory_id) REFERENCES territories(tenant_id, id) NOT VALID;

ALTER TABLE candidate_signals ADD CONSTRAINT candidate_signals_tenant_candidate_fk
  FOREIGN KEY (tenant_id, candidate_id) REFERENCES opportunity_candidates(tenant_id, id) NOT VALID;
ALTER TABLE candidate_signals ADD CONSTRAINT candidate_signals_tenant_signal_fk
  FOREIGN KEY (tenant_id, signal_id) REFERENCES signals(tenant_id, id) NOT VALID;

ALTER TABLE opportunities ADD CONSTRAINT opportunities_tenant_candidate_fk
  FOREIGN KEY (tenant_id, candidate_id) REFERENCES opportunity_candidates(tenant_id, id) NOT VALID;
ALTER TABLE opportunities ADD CONSTRAINT opportunities_tenant_organization_fk
  FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations(tenant_id, id) NOT VALID;
ALTER TABLE opportunities ADD CONSTRAINT opportunities_tenant_territory_fk
  FOREIGN KEY (tenant_id, territory_id) REFERENCES territories(tenant_id, id) NOT VALID;

ALTER TABLE opportunity_capacity_requirements ADD CONSTRAINT opportunity_capacity_requirements_tenant_opportunity_fk
  FOREIGN KEY (tenant_id, opportunity_id) REFERENCES opportunities(tenant_id, id) NOT VALID;
ALTER TABLE opportunity_capacity_requirements ADD CONSTRAINT opportunity_capacity_requirements_tenant_territory_fk
  FOREIGN KEY (tenant_id, territory_id) REFERENCES territories(tenant_id, id) NOT VALID;

ALTER TABLE capacity_providers ADD CONSTRAINT capacity_providers_tenant_organization_fk
  FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations(tenant_id, id) NOT VALID;
ALTER TABLE capacity_providers ADD CONSTRAINT capacity_providers_tenant_primary_contact_fk
  FOREIGN KEY (tenant_id, primary_contact_id) REFERENCES contacts(tenant_id, id) NOT VALID;

ALTER TABLE crews ADD CONSTRAINT crews_tenant_capacity_provider_fk
  FOREIGN KEY (tenant_id, capacity_provider_id) REFERENCES capacity_providers(tenant_id, id) NOT VALID;

ALTER TABLE workers ADD CONSTRAINT workers_tenant_capacity_provider_fk
  FOREIGN KEY (tenant_id, capacity_provider_id) REFERENCES capacity_providers(tenant_id, id) NOT VALID;
ALTER TABLE workers ADD CONSTRAINT workers_tenant_crew_fk
  FOREIGN KEY (tenant_id, crew_id) REFERENCES crews(tenant_id, id) NOT VALID;

ALTER TABLE equipment ADD CONSTRAINT equipment_tenant_capacity_provider_fk
  FOREIGN KEY (tenant_id, capacity_provider_id) REFERENCES capacity_providers(tenant_id, id) NOT VALID;
ALTER TABLE equipment ADD CONSTRAINT equipment_tenant_crew_fk
  FOREIGN KEY (tenant_id, crew_id) REFERENCES crews(tenant_id, id) NOT VALID;

ALTER TABLE capacity_records ADD CONSTRAINT capacity_records_tenant_capacity_provider_fk
  FOREIGN KEY (tenant_id, capacity_provider_id) REFERENCES capacity_providers(tenant_id, id) NOT VALID;
ALTER TABLE capacity_records ADD CONSTRAINT capacity_records_tenant_territory_fk
  FOREIGN KEY (tenant_id, territory_id) REFERENCES territories(tenant_id, id) NOT VALID;

ALTER TABLE compliance_documents ADD CONSTRAINT compliance_documents_tenant_capacity_provider_fk
  FOREIGN KEY (tenant_id, capacity_provider_id) REFERENCES capacity_providers(tenant_id, id) NOT VALID;

ALTER TABLE capacity_gap_analyses ADD CONSTRAINT capacity_gap_analyses_tenant_opportunity_fk
  FOREIGN KEY (tenant_id, opportunity_id) REFERENCES opportunities(tenant_id, id) NOT VALID;
ALTER TABLE capacity_gap_analyses ADD CONSTRAINT capacity_gap_analyses_tenant_territory_fk
  FOREIGN KEY (tenant_id, territory_id) REFERENCES territories(tenant_id, id) NOT VALID;

ALTER TABLE projects ADD CONSTRAINT projects_tenant_opportunity_fk
  FOREIGN KEY (tenant_id, opportunity_id) REFERENCES opportunities(tenant_id, id) NOT VALID;
ALTER TABLE projects ADD CONSTRAINT projects_tenant_customer_organization_fk
  FOREIGN KEY (tenant_id, customer_organization_id) REFERENCES organizations(tenant_id, id) NOT VALID;

ALTER TABLE work_orders ADD CONSTRAINT work_orders_tenant_project_fk
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) NOT VALID;
ALTER TABLE work_orders ADD CONSTRAINT work_orders_tenant_capacity_provider_fk
  FOREIGN KEY (tenant_id, assigned_capacity_provider_id) REFERENCES capacity_providers(tenant_id, id) NOT VALID;
ALTER TABLE work_orders ADD CONSTRAINT work_orders_tenant_crew_fk
  FOREIGN KEY (tenant_id, assigned_crew_id) REFERENCES crews(tenant_id, id) NOT VALID;

ALTER TABLE production_records ADD CONSTRAINT production_records_tenant_project_fk
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) NOT VALID;
ALTER TABLE production_records ADD CONSTRAINT production_records_tenant_work_order_fk
  FOREIGN KEY (tenant_id, work_order_id) REFERENCES work_orders(tenant_id, id) NOT VALID;
ALTER TABLE production_records ADD CONSTRAINT production_records_tenant_capacity_provider_fk
  FOREIGN KEY (tenant_id, capacity_provider_id) REFERENCES capacity_providers(tenant_id, id) NOT VALID;
ALTER TABLE production_records ADD CONSTRAINT production_records_tenant_crew_fk
  FOREIGN KEY (tenant_id, crew_id) REFERENCES crews(tenant_id, id) NOT VALID;
ALTER TABLE production_records ADD CONSTRAINT production_records_tenant_foreman_contact_fk
  FOREIGN KEY (tenant_id, foreman_contact_id) REFERENCES contacts(tenant_id, id) NOT VALID;
ALTER TABLE production_records ADD CONSTRAINT production_records_tenant_rate_code_fk
  FOREIGN KEY (tenant_id, rate_code_id) REFERENCES rate_codes(tenant_id, id) NOT VALID;

ALTER TABLE production_evidence ADD CONSTRAINT production_evidence_tenant_production_record_fk
  FOREIGN KEY (tenant_id, production_record_id) REFERENCES production_records(tenant_id, id) NOT VALID;

ALTER TABLE contracts ADD CONSTRAINT contracts_tenant_organization_fk
  FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations(tenant_id, id) NOT VALID;
ALTER TABLE contracts ADD CONSTRAINT contracts_tenant_opportunity_fk
  FOREIGN KEY (tenant_id, opportunity_id) REFERENCES opportunities(tenant_id, id) NOT VALID;

ALTER TABLE rate_schedules ADD CONSTRAINT rate_schedules_tenant_contract_fk
  FOREIGN KEY (tenant_id, contract_id) REFERENCES contracts(tenant_id, id) NOT VALID;
ALTER TABLE rate_schedules ADD CONSTRAINT rate_schedules_tenant_organization_fk
  FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations(tenant_id, id) NOT VALID;

ALTER TABLE rate_codes ADD CONSTRAINT rate_codes_tenant_rate_schedule_fk
  FOREIGN KEY (tenant_id, rate_schedule_id) REFERENCES rate_schedules(tenant_id, id) NOT VALID;

ALTER TABLE settlements ADD CONSTRAINT settlements_tenant_contract_fk
  FOREIGN KEY (tenant_id, contract_id) REFERENCES contracts(tenant_id, id) NOT VALID;
ALTER TABLE settlements ADD CONSTRAINT settlements_tenant_customer_organization_fk
  FOREIGN KEY (tenant_id, customer_organization_id) REFERENCES organizations(tenant_id, id) NOT VALID;
ALTER TABLE settlements ADD CONSTRAINT settlements_tenant_capacity_provider_fk
  FOREIGN KEY (tenant_id, capacity_provider_id) REFERENCES capacity_providers(tenant_id, id) NOT VALID;

ALTER TABLE settlement_items ADD CONSTRAINT settlement_items_tenant_settlement_fk
  FOREIGN KEY (tenant_id, settlement_id) REFERENCES settlements(tenant_id, id) NOT VALID;
ALTER TABLE settlement_items ADD CONSTRAINT settlement_items_tenant_production_record_fk
  FOREIGN KEY (tenant_id, production_record_id) REFERENCES production_records(tenant_id, id) NOT VALID;
ALTER TABLE settlement_items ADD CONSTRAINT settlement_items_tenant_rate_code_fk
  FOREIGN KEY (tenant_id, rate_code_id) REFERENCES rate_codes(tenant_id, id) NOT VALID;

ALTER TABLE invoices ADD CONSTRAINT invoices_tenant_organization_fk
  FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations(tenant_id, id) NOT VALID;
ALTER TABLE invoices ADD CONSTRAINT invoices_tenant_settlement_fk
  FOREIGN KEY (tenant_id, settlement_id) REFERENCES settlements(tenant_id, id) NOT VALID;

ALTER TABLE payments ADD CONSTRAINT payments_tenant_invoice_fk
  FOREIGN KEY (tenant_id, invoice_id) REFERENCES invoices(tenant_id, id) NOT VALID;
ALTER TABLE payments ADD CONSTRAINT payments_tenant_settlement_fk
  FOREIGN KEY (tenant_id, settlement_id) REFERENCES settlements(tenant_id, id) NOT VALID;

ALTER TABLE ar_records ADD CONSTRAINT ar_records_tenant_invoice_fk
  FOREIGN KEY (tenant_id, invoice_id) REFERENCES invoices(tenant_id, id) NOT VALID;
ALTER TABLE ar_records ADD CONSTRAINT ar_records_tenant_customer_organization_fk
  FOREIGN KEY (tenant_id, customer_organization_id) REFERENCES organizations(tenant_id, id) NOT VALID;

ALTER TABLE customer_payment_stats ADD CONSTRAINT customer_payment_stats_tenant_customer_organization_fk
  FOREIGN KEY (tenant_id, customer_organization_id) REFERENCES organizations(tenant_id, id) NOT VALID;

ALTER TABLE recommendations ADD CONSTRAINT recommendations_tenant_constraint_fk
  FOREIGN KEY (tenant_id, constraint_id) REFERENCES constraints(tenant_id, id) NOT VALID;

ALTER TABLE recommendation_evidence ADD CONSTRAINT recommendation_evidence_tenant_recommendation_fk
  FOREIGN KEY (tenant_id, recommendation_id) REFERENCES recommendations(tenant_id, id) NOT VALID;

ALTER TABLE recommendation_outcomes ADD CONSTRAINT recommendation_outcomes_tenant_recommendation_fk
  FOREIGN KEY (tenant_id, recommendation_id) REFERENCES recommendations(tenant_id, id) NOT VALID;

ALTER TABLE workflow_steps ADD CONSTRAINT workflow_steps_tenant_definition_fk
  FOREIGN KEY (tenant_id, workflow_definition_id) REFERENCES workflow_definitions(tenant_id, id) NOT VALID;

ALTER TABLE workflow_instances ADD CONSTRAINT workflow_instances_tenant_definition_fk
  FOREIGN KEY (tenant_id, workflow_definition_id) REFERENCES workflow_definitions(tenant_id, id) NOT VALID;

ALTER TABLE workflow_tasks ADD CONSTRAINT workflow_tasks_tenant_instance_fk
  FOREIGN KEY (tenant_id, workflow_instance_id) REFERENCES workflow_instances(tenant_id, id) NOT VALID;
ALTER TABLE workflow_tasks ADD CONSTRAINT workflow_tasks_tenant_step_fk
  FOREIGN KEY (tenant_id, step_id) REFERENCES workflow_steps(tenant_id, id) NOT VALID;

ALTER TABLE workflow_escalations ADD CONSTRAINT workflow_escalations_tenant_task_fk
  FOREIGN KEY (tenant_id, workflow_task_id) REFERENCES workflow_tasks(tenant_id, id) NOT VALID;
ALTER TABLE workflow_escalations ADD CONSTRAINT workflow_escalations_tenant_instance_fk
  FOREIGN KEY (tenant_id, workflow_instance_id) REFERENCES workflow_instances(tenant_id, id) NOT VALID;
