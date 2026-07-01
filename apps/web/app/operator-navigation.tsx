"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { hasPermission, readPermissions } from "./intelligence/api";

export type WorkspaceStatus = "active" | "available" | "planned";

export type WorkspaceNavItem = {
  label: string;
  href: string;
  workspace: string;
  description: string;
  permission?: string;
  status?: WorkspaceStatus;
};

export type WorkspaceDefinition = {
  label: string;
  href: string;
  scope: string;
  description: string;
  permissions: string[];
  status?: WorkspaceStatus;
  items: WorkspaceNavItem[];
};

export const workspaces: WorkspaceDefinition[] = [
  {
    label: "Command Center",
    href: "/",
    scope: "Daily Priorities",
    description: "Today's work, blockers, decisions, and recommendations",
    permissions: ["dashboard.executive.read", "signal.read", "project.read", "invoice.read"],
    items: [
      { label: "Executive Dashboard", href: "/executive", workspace: "Command Center", description: "Business health, blockers, cash, and throughput.", permission: "dashboard.executive.read" },
      { label: "Daily Priorities", href: "/", workspace: "Command Center", description: "Today's cross-workspace operating view." },
      { label: "Blockers", href: "/constraints-center", workspace: "Command Center", description: "Constraints requiring attention.", permission: "constraint.read" },
      { label: "Recommendations", href: "/recommendations-center", workspace: "Command Center", description: "Recommended operator actions.", permission: "recommendation.read" },
      { label: "KPIs", href: "/kpis-center", workspace: "Command Center", description: "KPI definitions, snapshots, and alerts.", permission: "kpi.read" },
    ],
  },
  {
    label: "Growth",
    href: "/intelligence/signals",
    scope: "Intelligence",
    description: "Find and qualify future telecom work",
    permissions: ["signal.read", "organization.read", "contact.read", "relationship_map.read", "opportunity_candidate.read", "opportunity.read"],
    items: [
      { label: "Signal Feed", href: "/intelligence/signals", workspace: "Growth", description: "Review market intelligence and signal queues.", permission: "signal.read" },
      { label: "Organizations", href: "/intelligence/organizations", workspace: "Growth", description: "Companies, agencies, primes, and utilities.", permission: "organization.read" },
      { label: "Contacts", href: "/intelligence/contacts", workspace: "Growth", description: "Human access points and relationships.", permission: "contact.read" },
      { label: "Relationship Maps", href: "/intelligence/relationship-maps", workspace: "Growth", description: "Paths to decision makers and influencers.", permission: "relationship_map.read" },
      { label: "Opportunity Candidates", href: "/opportunities/candidates", workspace: "Growth", description: "Qualified signals before active pursuit.", permission: "opportunity_candidate.read" },
      { label: "Opportunities", href: "/opportunities/pipeline", workspace: "Growth", description: "Active pursuit pipeline.", permission: "opportunity.read" },
    ],
  },
  {
    label: "Operations",
    href: "/work-orders",
    scope: "Projects",
    description: "Plan, execute, and approve operational work",
    permissions: ["project.read", "work_order.read", "production.read", "production_record.read", "qc_review.read"],
    items: [
      { label: "Projects", href: "/projects", workspace: "Operations", description: "Operational project context.", permission: "project.read" },
      { label: "Work Orders", href: "/work-orders", workspace: "Operations", description: "Executable work packages.", permission: "work_order.read" },
      { label: "Production", href: "/production", workspace: "Operations", description: "Submitted field production.", permission: "production.read" },
      { label: "QC", href: "/qc", workspace: "Operations", description: "Quality review and correction queues.", permission: "qc_review.read" },
    ],
  },
  {
    label: "Finance",
    href: "/billable",
    scope: "Accounting",
    description: "Bill, collect, pay, reconcile, and prepare handoff",
    permissions: [
      "billable_item.read",
      "settlement.read",
      "invoice.read",
      "cash_receipt.read",
      "payment_application.read",
      "collection_case.read",
      "contractor_payable.read",
      "payroll_run.read",
      "payment_batch.read",
      "bank_transaction.read",
      "accounting_export_batch.read",
    ],
    items: [
      { label: "Billable", href: "/billable", workspace: "Finance", description: "Approved work ready for billing review.", permission: "billable_item.read" },
      { label: "Settlements", href: "/settlements", workspace: "Finance", description: "Settlement workbench.", permission: "settlement.read" },
      { label: "Invoices", href: "/invoices", workspace: "Finance", description: "Customer demand-for-payment state.", permission: "invoice.read" },
      { label: "Cash", href: "/cash", workspace: "Finance", description: "Cash receipts and payment applications.", permission: "cash_receipt.read" },
      { label: "Collections", href: "/collections", workspace: "Finance", description: "Overdue invoice follow-up.", permission: "collection_case.read" },
      { label: "Contractor Payables", href: "/contractor-payables", workspace: "Finance", description: "Contractor payable readiness.", permission: "contractor_payable.read" },
      { label: "Payroll", href: "/payroll", workspace: "Finance", description: "Internal payroll readiness.", permission: "payroll_run.read" },
      { label: "Payments", href: "/payments", workspace: "Finance", description: "Internal payment execution status.", permission: "payment_batch.read" },
      { label: "Bank Reconciliation", href: "/bank-reconciliation", workspace: "Finance", description: "Match bank truth to SyncOS records.", permission: "bank_transaction.read" },
      { label: "Accounting Exports", href: "/accounting-exports", workspace: "Finance", description: "Internal accounting handoff status.", permission: "accounting_export_batch.read" },
    ],
  },
  {
    label: "Admin",
    href: "#admin-planned",
    scope: "Planned",
    description: "Admin workspace is planned but not implemented yet",
    permissions: ["admin.manage_users", "role.read", "permission.read", "audit.read"],
    status: "planned",
    items: [
      { label: "Users", href: "#admin-users-planned", workspace: "Admin", description: "Planned user management.", permission: "admin.manage_users", status: "planned" },
      { label: "Roles", href: "#admin-roles-planned", workspace: "Admin", description: "Planned role management.", permission: "role.read", status: "planned" },
      { label: "Permissions", href: "#admin-permissions-planned", workspace: "Admin", description: "Planned permission management.", permission: "permission.read", status: "planned" },
      { label: "Settings", href: "#admin-settings-planned", workspace: "Admin", description: "Planned tenant settings.", status: "planned" },
      { label: "Audit", href: "#admin-audit-planned", workspace: "Admin", description: "Planned admin audit view.", permission: "audit.read", status: "planned" },
    ],
  },
];

export function OperatorNavigation() {
  const pathname = usePathname();
  const [permissions, setPermissions] = useState<string[]>([]);

  useEffect(() => {
    setPermissions(readPermissions());
  }, []);

  const visibleWorkspaces = useMemo(() => workspaces.filter((workspace) => canSeeWorkspace(workspace, permissions)), [permissions]);
  const activeWorkspace = useMemo(() => {
    const matched = visibleWorkspaces
      .filter((workspace) => workspace.status !== "planned")
      .map((workspace) => ({
        workspace,
        score: workspaceMatchScore(workspace, pathname ?? "/"),
      }))
      .filter((match) => match.score >= 0)
      .sort((left, right) => right.score - left.score)[0]?.workspace;
    return matched ?? visibleWorkspaces.find((workspace) => workspace.status !== "planned") ?? visibleWorkspaces[0] ?? workspaces[0];
  }, [pathname, visibleWorkspaces]);
  const subnavItems = activeWorkspace.items.filter((item) => canSeeItem(item, permissions));

  return (
    <div className="operator-navigation">
      <nav className="nav workspace-nav-primary" aria-label="Workspace navigation">
        {visibleWorkspaces.map((workspace) => workspace.status === "planned" ? (
          <span className="nav-disabled" key={workspace.label} title={workspace.description}>
            <span>{workspace.label}</span>
            <small>{workspace.scope}</small>
          </span>
        ) : (
          <Link href={workspace.href} key={workspace.label} title={workspace.description} aria-current={workspace.label === activeWorkspace.label ? "page" : undefined}>
            <span>{workspace.label}</span>
            <small>{workspace.scope}</small>
          </Link>
        ))}
      </nav>
      {subnavItems.length > 0 ? (
        <nav className="workspace-subnav" aria-label={`${activeWorkspace.label} workspace navigation`}>
          {subnavItems.map((item) => item.status === "planned" ? (
            <span className="workspace-subnav-disabled" key={item.label} title={item.description}>{item.label}</span>
          ) : (
            <Link href={item.href} key={item.label} title={item.description} aria-current={isActiveRoute(pathname ?? "/", item.href) ? "page" : undefined}>{item.label}</Link>
          ))}
        </nav>
      ) : null}
    </div>
  );
}

function canSeeWorkspace(workspace: WorkspaceDefinition, permissions: string[]) {
  if (workspace.status === "planned") return true;
  if (!permissions.length) return true;
  return workspace.permissions.some((permission) => hasPermission(permissions, permission));
}

function canSeeItem(item: WorkspaceNavItem, permissions: string[]) {
  if (item.status === "planned") return true;
  if (!item.permission || !permissions.length) return true;
  return hasPermission(permissions, item.permission);
}

function workspaceMatchScore(workspace: WorkspaceDefinition, pathname: string) {
  if (workspace.href === "/" && pathname === "/") return 100;
  const itemScores = workspace.items.map((item) => routeMatchScore(pathname, item.href));
  const workspaceScore = routeMatchScore(pathname, workspace.href);
  return Math.max(workspaceScore, ...itemScores);
}

function routeMatchScore(pathname: string, href: string) {
  if (!href || href.startsWith("#")) return -1;
  if (href === "/") return pathname === "/" ? 100 : -1;
  if (pathname === href) return href.length + 100;
  return pathname.startsWith(`${href}/`) ? href.length : -1;
}

function isActiveRoute(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return routeMatchScore(pathname, href) >= 0;
}
