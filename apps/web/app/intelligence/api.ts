"use client";

export type SyncRecord = Record<string, unknown>;

const tokenKey = "syncos.apiToken";
const permissionKey = "syncos.permissions";

export const defaultSignalPermissions = [
  "signal.read",
  "signal.create",
  "signal.update",
  "signal.categorize",
  "signal.score",
  "signal.verify",
  "signal.archive",
  "signal.assign_owner",
  "signal.timeline.read",
  "signal.audit.read",
  "signal_evidence.read",
  "signal_evidence.create",
  "signal_evidence.update",
  "signal_evidence.archive",
  "signal_entity.create",
  "signal_entity.archive",
  "opportunity_candidate.read",
  "opportunity_candidate.create",
  "candidate_signal.create",
  "candidate_signal.read",
];

export const defaultOrganizationPermissions = [
  ...defaultSignalPermissions,
  "organization.read",
  "organization.create",
  "organization.update",
  "organization.qualify",
  "organization.archive",
  "organization.assign_owner",
  "organization.timeline.read",
  "organization.audit.read",
  "contact.read",
  "contact.create",
  "contact.verify",
  "opportunity.read",
  "capacity_provider.read",
  "capacity_provider.create",
  "project.read",
  "settlement.read",
  "invoice.read",
  "payment.read",
  "constraint.read",
  "constraint.create",
  "recommendation.read",
  "learning_score.read",
];

export const defaultContactPermissions = [
  ...defaultOrganizationPermissions,
  "contact.update",
  "contact.archive",
  "contact.assign_owner",
  "contact.mark_invalid",
  "contact.mark_relationship_active",
  "contact.timeline.read",
  "contact.audit.read",
  "constraint.create",
  "recommendation.read",
];

export const defaultRelationshipPermissions = [
  ...defaultContactPermissions,
  "relationship_map.read",
  "relationship_map.create",
  "relationship_map.update",
  "relationship_map.archive",
  "relationship_map.status",
  "relationship_map.assign_owner",
  "relationship_map.timeline.read",
  "relationship_map.audit.read",
  "relationship_path.read",
  "relationship_path.create",
  "relationship_path.update",
  "relationship_path.rank",
  "relationship_path.archive",
  "workflow_task.read",
];

export const defaultOpportunityPermissions = [
  ...defaultRelationshipPermissions,
  "opportunity_candidate.read",
  "opportunity_candidate.create",
  "opportunity_candidate.update",
  "opportunity_candidate.monitor",
  "opportunity_candidate.investigate",
  "opportunity_candidate.qualify",
  "opportunity_candidate.reject",
  "opportunity_candidate.archive",
  "opportunity_candidate.score",
  "opportunity_candidate.assign_owner",
  "opportunity_candidate.link_relationship_map",
  "opportunity_candidate.timeline.read",
  "opportunity_candidate.audit.read",
  "candidate_signal.read",
  "candidate_signal.create",
  "candidate_signal.update",
  "candidate_signal.archive",
  "opportunity.read",
  "opportunity.create",
  "opportunity.update",
  "opportunity.pursuit_approve",
  "opportunity.pursue",
  "opportunity.proposal",
  "opportunity.negotiation",
  "opportunity.award",
  "opportunity.lost",
  "opportunity.defer",
  "opportunity.archive",
  "opportunity.score",
  "opportunity.assign_owner",
  "opportunity.link_relationship_map",
  "opportunity.submit_review",
  "opportunity.timeline.read",
  "opportunity.audit.read",
  "capacity_requirement.read",
  "capacity_requirement.create",
  "capacity_requirement.update",
  "capacity_requirement.archive",
  "capacity_provider.read",
  "crew.read",
  "equipment.read",
  "compliance_document.read",
  "coverage_plan.read",
  "coverage_plan.create",
  "coverage_plan.update",
  "coverage_plan.recalculate",
  "coverage_plan.approve_handoff",
  "coverage_plan.archive",
  "coverage_plan.audit.read",
  "coverage_requirement.read",
  "coverage_requirement.create",
  "coverage_requirement.update",
  "coverage_requirement.archive",
  "coverage_source.read",
  "coverage_source.create",
  "coverage_source.update",
  "coverage_source.archive",
  "coverage_gap.read",
  "coverage_gap.create",
  "coverage_gap.update",
  "coverage_gap.resolve",
  "coverage_gap.override",
  "coverage_gap.archive",
  "project_handoff.read",
  "project_handoff.create",
  "project_handoff.update",
  "project_handoff.recalculate",
  "project_handoff.submit_review",
  "project_handoff.approve",
  "project_handoff.reject",
  "project_handoff.create_project",
  "project_handoff.archive",
  "project_handoff.timeline.read",
  "project_handoff.audit.read",
  "project_handoff_checklist.read",
  "project_handoff_checklist.create",
  "project_handoff_checklist.update",
  "project_handoff_checklist.complete",
  "project_handoff_checklist.override",
  "project_handoff_checklist.archive",
  "project_handoff_risk.read",
  "project_handoff_risk.create",
  "project_handoff_risk.update",
  "project_handoff_risk.resolve",
  "project_handoff_risk.override",
  "project_handoff_risk.archive",
  "project_handoff_approval.read",
];

export function readToken() {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(tokenKey) ?? "";
}

export function saveToken(token: string) {
  window.localStorage.setItem(tokenKey, token.trim());
}

export function readPermissions() {
  if (typeof window === "undefined") return [];
  const stored = window.localStorage.getItem(permissionKey);
  if (!stored) return defaultSignalPermissions;
  return stored
    .split(",")
    .map((permission) => permission.trim())
    .filter(Boolean);
}

export function savePermissions(permissions: string[]) {
  window.localStorage.setItem(permissionKey, permissions.join(","));
}

export function hasPermission(permissions: string[], permission: string) {
  return permissions.includes(permission);
}

export async function syncosFetch<T>(path: string, options: { method?: string; body?: unknown; token?: string } = {}): Promise<T> {
  const token = options.token ?? readToken();
  const response = await fetch(`/api/syncos/${path.replace(/^\//, "")}`, {
    method: options.method ?? "GET",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: "no-store",
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(readableError(response.status, data));
  }
  return data as T;
}

function readableError(status: number, data: unknown) {
  const message = typeof data === "object" && data && "message" in data ? String((data as { message?: unknown }).message) : "";
  if (status === 401) return "Sign in with a valid SyncOS token to continue.";
  if (status === 403) return "You do not have permission to perform this action.";
  if (message.includes("evidence")) return "This signal cannot be verified until evidence is attached.";
  if (message.includes("tenant")) return "This related record does not belong to your organization.";
  if (message) return message;
  return `Request failed with status ${status}.`;
}

export function textValue(value: unknown, fallback = "Not captured") {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}

export function numberValue(value: unknown, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

export function dateValue(value: unknown) {
  if (!value) return "Not captured";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString();
}
