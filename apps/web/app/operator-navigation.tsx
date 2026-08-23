"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { clearAuthContext, hasPermission, loadAuthContext, readPermissions, readToken, sessionEmailFromToken } from "./intelligence/api";

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
    label: "Demand",
    href: "/growth",
    scope: "Customer demand",
    description: "Signals, opportunity candidates, and active pursuit pipeline",
    permissions: ["signal.read", "opportunity_candidate.read", "opportunity.read"],
    items: [
      { label: "Demand Overview", href: "/growth", workspace: "Demand", description: "Demand and opportunity summary.", permission: "signal.read" },
      { label: "Signal Feed", href: "/intelligence/signals", workspace: "Demand", description: "Review market intelligence and signal queues.", permission: "signal.read" },
      { label: "Opportunity Candidates", href: "/opportunities/candidates", workspace: "Demand", description: "Qualified signals before active pursuit.", permission: "opportunity_candidate.read" },
      { label: "Opportunities", href: "/opportunities/pipeline", workspace: "Demand", description: "Active pursuit pipeline.", permission: "opportunity.read" },
    ],
  },
  {
    label: "Partner Network",
    href: "/partner-network",
    scope: "Capacity supply",
    description: "Partner inquiries, onboarding review, organizations, and performance",
    permissions: ["partner_inquiry.read", "partner_onboarding.review", "organization.read", "partner_performance.read"],
    items: [
      { label: "Partner Network", href: "/partner-network", workspace: "Partner Network", description: "Internal inquiry, invitation, and onboarding controls.", permission: "partner_inquiry.read" },
      { label: "Organizations", href: "/intelligence/organizations", workspace: "Partner Network", description: "Companies, agencies, primes, and utilities.", permission: "organization.read" },
      { label: "Contacts", href: "/intelligence/contacts", workspace: "Partner Network", description: "Human access points and relationships.", permission: "contact.read" },
      { label: "Relationship Maps", href: "/intelligence/relationship-maps", workspace: "Partner Network", description: "Paths to decision makers and influencers.", permission: "relationship_map.read" },
      { label: "Partner Performance", href: "/partner-performance", workspace: "Partner Network", description: "Partner performance, risk, and capacity intelligence.", permission: "partner_performance.read" },
    ],
  },
  {
    label: "Capacity Matching",
    href: "/opportunities/capacity-matching",
    scope: "Requirements to crews",
    description: "Match current demand to verified and potential capacity",
    permissions: ["opportunity_capacity_match.read", "opportunity_coverage.read", "partner_capacity_intelligence.read"],
    items: [
      { label: "Opportunity Matching", href: "/opportunities/capacity-matching", workspace: "Capacity Matching", description: "Coverage, gaps, shortlist, and decisions.", permission: "opportunity_capacity_match.read" },
      { label: "Coverage Plans", href: "/opportunities/coverage", workspace: "Capacity Matching", description: "Coverage planning context.", permission: "opportunity_coverage.read" },
      { label: "Capacity Intelligence", href: "/partner-performance", workspace: "Capacity Matching", description: "Partner capacity and confidence context.", permission: "partner_capacity_intelligence.read" },
    ],
  },
  {
    label: "Execution",
    href: "/operations",
    scope: "Work control",
    description: "Projects, Work Orders, field production, and production dashboards",
    permissions: ["project.read", "work_order.read", "production.read", "production_record.read"],
    items: [
      { label: "Operations Board", href: "/operations", workspace: "Execution", description: "Capacity, work, production, and blocker summary.", permission: "project.read" },
      { label: "Projects", href: "/projects", workspace: "Execution", description: "Operational project context.", permission: "project.read" },
      { label: "Work Orders", href: "/work-orders", workspace: "Execution", description: "Executable work packages.", permission: "work_order.read" },
      { label: "Production", href: "/production", workspace: "Execution", description: "Submitted field production.", permission: "production.read" },
      { label: "Production Dashboard", href: "/production-dashboard", workspace: "Execution", description: "Production exports and dashboard.", permission: "production_dashboard.read" },
    ],
  },
  {
    label: "QC",
    href: "/qc",
    scope: "Acceptance",
    description: "Administrative completeness, Customer QC, corrections, and reinspection",
    permissions: ["qc_review.read", "qc.review", "production_record.read"],
    items: [
      { label: "QC Queue", href: "/qc", workspace: "QC", description: "Administrative review, Customer QC, corrections, and reinspection.", permission: "qc_review.read" },
      { label: "Production Review", href: "/production", workspace: "QC", description: "Production records awaiting review.", permission: "production_record.read" },
    ],
  },
  {
    label: "Finance",
    href: "/finance",
    scope: "Cash control",
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
      { label: "Payment Applications", href: "/payment-applications", workspace: "Finance", description: "Applied customer cash lineage.", permission: "payment_application.read" },
      { label: "Collections", href: "/collections", workspace: "Finance", description: "Overdue invoice follow-up.", permission: "collection_case.read" },
      { label: "Contractor Payables", href: "/contractor-payables", workspace: "Finance", description: "Contractor payable readiness.", permission: "contractor_payable.read" },
      { label: "Payroll", href: "/payroll", workspace: "Finance", description: "Internal payroll readiness.", permission: "payroll_run.read" },
      { label: "Payments", href: "/payments", workspace: "Finance", description: "Internal payment execution status.", permission: "payment_batch.read" },
      { label: "Bank Reconciliation", href: "/bank-reconciliation", workspace: "Finance", description: "Match bank truth to SyncOS records.", permission: "bank_transaction.read" },
      { label: "Accounting Exports", href: "/accounting-exports", workspace: "Finance", description: "Internal accounting handoff status.", permission: "accounting_export_batch.read" },
    ],
  },
  {
    label: "Command Center",
    href: "/command-center",
    scope: "Priorities",
    description: "Executive throughput, blockers, actions, and KPI freshness",
    permissions: ["executive_command.read", "dashboard.executive.read", "constraint.read", "recommendation.read", "kpi.read"],
    items: [
      { label: "Command Center", href: "/command-center", workspace: "Command Center", description: "Executive throughput, blockers, and daily actions.", permission: "executive_command.read" },
      { label: "Executive Dashboard", href: "/executive", workspace: "Command Center", description: "Business health, blockers, cash, and throughput.", permission: "dashboard.executive.read" },
      { label: "Daily Priorities", href: "/", workspace: "Command Center", description: "Today's cross-workspace operating view.", permission: "dashboard.executive.read" },
      { label: "Blockers", href: "/constraints-center", workspace: "Command Center", description: "Constraints requiring attention.", permission: "constraint.read" },
      { label: "Recommendations", href: "/recommendations-center", workspace: "Command Center", description: "Recommended operator actions.", permission: "recommendation.read" },
      { label: "KPIs", href: "/kpis-center", workspace: "Command Center", description: "KPI definitions, snapshots, and alerts.", permission: "kpi.read" },
    ],
  },
];

export function OperatorNavigation() {
  const { permissions, error, visibleWorkspaces, activeWorkspace } = useOperatorNavigationState();

  if (permissions === null) {
    return <div className="nav-safe-state" role="status">Loading workspaces...</div>;
  }

  if (!visibleWorkspaces.length) {
    return <div className="nav-safe-state" role="status">{error || "No permitted workspaces."}</div>;
  }

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
    </div>
  );
}

export function OperatorSubnavigation() {
  const pathname = usePathname();
  const { permissions, visibleWorkspaces, activeWorkspace } = useOperatorNavigationState();
  const subnavItems = activeWorkspace.items.filter((item) => canSeeItem(item, permissions));

  if (permissions === null || !visibleWorkspaces.length || subnavItems.length <= 1) return null;

  return (
    <nav className="workspace-subnav" aria-label={`${activeWorkspace.label} workspace navigation`}>
      <div className="workspace-subnav-label">
        <span>{activeWorkspace.label}</span>
        <small>{activeWorkspace.description}</small>
      </div>
      <div className="workspace-subnav-links">
        {subnavItems.map((item) => item.status === "planned" ? (
          <span className="workspace-subnav-disabled" key={item.label} title={item.description}>{item.label}</span>
        ) : (
          <Link href={item.href} key={item.label} title={item.description} aria-current={isActiveRoute(pathname ?? "/", item.href) ? "page" : undefined}>{item.label}</Link>
        ))}
      </div>
    </nav>
  );
}

function useOperatorNavigationState() {
  const pathname = usePathname();
  const [permissions, setPermissions] = useState<string[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const cached = readPermissions();
    if (cached.length) setPermissions(cached);
    const token = readToken();
    if (!token) {
      setPermissions([]);
      setError("Sign in to view workspaces.");
      return;
    }
    loadAuthContext(token)
      .then((context) => {
        setPermissions(context.permissions ?? []);
        setError("");
      })
      .catch(() => {
        setPermissions([]);
        setError("Workspace navigation is unavailable.");
      });
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
  return { permissions, error, visibleWorkspaces, activeWorkspace };
}

export function OperatorAccountControl() {
  const [session, setSession] = useState<{ email: string; label: string } | null>(null);

  useEffect(() => {
    const token = readToken();
    if (!token) {
      setSession(null);
      return;
    }
    loadAuthContext(token)
      .then((context) => {
        const roleLabel = context.partner_context?.persona === "partner_foreman"
          ? "Foreman"
          : context.partner_context?.persona === "partner_admin"
            ? "Partner Admin"
            : context.role_names?.[0] ?? context.roles?.[0] ?? "SyncOS User";
        setSession({ email: sessionEmailFromToken(token) || "Signed in", label: roleLabel });
      })
      .catch(() => setSession(null));
  }, []);

  function signOut() {
    clearAuthContext();
    window.location.assign("/login");
  }

  if (!session) {
    return (
      <Link className="account-login-link" href="/login">
        Sign In
      </Link>
    );
  }

  return (
    <div className="account-control" aria-label="Account controls">
      <div className="account-identity">
        <span>{session.label}</span>
        <strong>{session.email}</strong>
      </div>
      <button className="logout-button" type="button" onClick={signOut}>
        Log Out
      </button>
    </div>
  );
}

function canSeeWorkspace(workspace: WorkspaceDefinition, permissions: string[] | null) {
  if (workspace.status === "planned") return true;
  if (!permissions?.length) return false;
  return workspace.permissions.some((permission) => hasPermission(permissions, permission));
}

function canSeeItem(item: WorkspaceNavItem, permissions: string[] | null) {
  if (item.status === "planned") return true;
  if (!item.permission) return true;
  if (!permissions?.length) return false;
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
