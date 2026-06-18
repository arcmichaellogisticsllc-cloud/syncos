export type PermissionKey =
  | "signal.create"
  | "signal.verify"
  | "organization.create"
  | "organization.qualify"
  | "contact.verify"
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
  | "admin.manage_users"
  | "admin.manage_roles"
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
