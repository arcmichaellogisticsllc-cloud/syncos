export type PermissionKey =
  | "territory.read"
  | "territory.create"
  | "territory.update"
  | "territory.archive"
  | "organization.read"
  | "signal.create"
  | "signal.verify"
  | "organization.create"
  | "organization.update"
  | "organization.qualify"
  | "organization.archive"
  | "contact.read"
  | "contact.create"
  | "contact.update"
  | "contact.verify"
  | "contact.archive"
  | "relationship.manage"
  | "candidate.convert"
  | "opportunity.approve"
  | "capacity.qualify"
  | "capacity.verify"
  | "capacity.activate"
  | "capacity.deploy"
  | "production.submit"
  | "production.qc_review"
  | "production.approve"
  | "production.mark_billable"
  | "settlement.create"
  | "settlement.submit"
  | "invoice.create"
  | "payment.record"
  | "constraint.assign"
  | "constraint.close"
  | "recommendation.approve"
  | "stop_work.issue"
  | "signal.read"
  | "signal.update"
  | "signal.categorize"
  | "signal.score"
  | "signal.archive"
  | "signal_evidence.read"
  | "signal_evidence.create"
  | "signal_evidence.update"
  | "signal_evidence.archive"
  | "search.read"
  | "relationship_map.read"
  | "relationship_map.create"
  | "relationship_map.update"
  | "relationship_map.archive"
  | "relationship_map.status"
  | "relationship_path.read"
  | "relationship_path.create"
  | "relationship_path.update"
  | "relationship_path.archive"
  | "relationship_path.rank"
  | "opportunity_candidate.read"
  | "opportunity_candidate.create"
  | "opportunity_candidate.update"
  | "opportunity_candidate.monitor"
  | "opportunity_candidate.investigate"
  | "opportunity_candidate.qualify"
  | "opportunity_candidate.reject"
  | "opportunity_candidate.archive"
  | "opportunity_candidate.score"
  | "candidate_signal.read"
  | "candidate_signal.create"
  | "candidate_signal.update"
  | "candidate_signal.archive"
  | "opportunity.read"
  | "opportunity.create"
  | "opportunity.update"
  | "opportunity.pursuit_approve"
  | "opportunity.pursue"
  | "opportunity.proposal"
  | "opportunity.negotiation"
  | "opportunity.award"
  | "opportunity.lost"
  | "opportunity.defer"
  | "opportunity.archive"
  | "opportunity.score"
  | "capacity_requirement.read"
  | "capacity_requirement.create"
  | "capacity_requirement.update"
  | "capacity_requirement.archive"
  | "admin.manage_users"
  | "admin.manage_roles"
  | "system.test_object.read"
  | "system.test_object.write";

export type PermissionCheck = {
  tenantId: string;
  userId: string;
  permission: PermissionKey;
  entityType?: string;
  entityId?: string;
};

export type PermissionDecision = {
  allowed: boolean;
  reason?: string;
};

export function deny(reason: string): PermissionDecision {
  return { allowed: false, reason };
}

export function allow(): PermissionDecision {
  return { allowed: true };
}
