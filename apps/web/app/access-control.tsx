"use client";

import NextLink from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ComponentProps, type ReactNode } from "react";
import { loadAuthContext, readToken, type AuthContext } from "./intelligence/api";

const AccessContext = createContext<AuthContext | null>(null);

const resources: Record<string, string> = {
  "/qc": "qc_review", "/projects": "project", "/work-orders": "work_order", "/production": "production_record",
  "/billable": "billable_item", "/settlements": "settlement", "/invoices": "invoice", "/cash/receipts": "cash_receipt",
  "/payment-applications": "payment_application", "/collections": "collection_case", "/collection-actions": "collection_action",
  "/contractor-payables": "contractor_payable", "/payroll": "payroll_run", "/payments": "payment_batch", "/payment-items": "payment_item",
  "/bank-reconciliation/accounts": "bank_account", "/bank-reconciliation/transactions": "bank_transaction", "/reconciliation-matches": "reconciliation_match",
  "/accounting-exports": "accounting_export_batch", "/accounting-export-items": "accounting_export_item",
  "/intelligence/signals": "signal", "/intelligence/organizations": "organization", "/intelligence/contacts": "contact",
  "/intelligence/relationship-maps": "relationship_map", "/intelligence/account-onboarding": "account_onboarding",
  "/opportunities/candidates": "opportunity_candidate", "/opportunities/coverage": "coverage_plan", "/opportunities": "opportunity",
};
const pages: Record<string, string[]> = {
  "/project-handoffs": ["project_handoff.read"],
  "/customer-qc": ["daily_production.completeness_read"],
  "/passport": ["partner_payment.confirm"],
  "/": ["dashboard.executive.read"], "/command-center": ["executive_command.read"], "/executive": ["dashboard.executive.read"],
  "/growth": ["dashboard.growth.read"], "/operations": ["dashboard.operations.read"],
  "/finance": ["dashboard.finance.read"],
  "/cash": ["cash_receipt.read"], "/bank-reconciliation": ["bank_transaction.read"],
  "/partner-network": ["partner_inquiry.read", "partner_onboarding.review"], "/partner-performance": ["partner_performance.read"],
  "/opportunities/capacity-matching": ["opportunity_coverage.read"], "/opportunities/pipeline": ["opportunity.read"],
  "/field-setup": ["syncfield_map.create"], "/internal-workforce": ["crew.read"],
  "/accepted-production-financials": ["billing.read"], "/production-dashboard": ["production_dashboard.read"],
  "/payment-retainage-adjustments": ["partner_payment.execute", "retainage.release", "financial_adjustment.create"], "/constraints-center": ["dashboard.constraints.read"],
  "/recommendations-center": ["dashboard.recommendations.read"], "/kpis-center": ["dashboard.kpis.read"], "/workflows-center": ["dashboard.workflows.read"],
  "/intelligence": ["signal.read", "organization.read"],
};
function publicRoute(path: string) { return path === "/login" || path === "/activate-employee" || path.startsWith("/partner/invite/"); }
export function routeAllowed(path: string, context: AuthContext | null): boolean {
  const route = path.split(/[?#]/)[0];
  if (publicRoute(route)) return true;
  if (!context) return false;
  if (route === "/training") return context.permissions.length > 0;
  // Field/company routes enforce assignment and persona boundaries in their own shell and APIs.
  if (route === "/syncfield/design-prep") return context.permissions.includes("syncfield_map.work_zone.manage");
  if (route.startsWith("/syncfield/") || route === "/partner" || route.startsWith("/partner/")) return context.permissions.includes("partner_context.read");
  if (route === "/internal-workforce" && !context.roles.some(role => ["system_admin", "executive", "operations_manager"].includes(role))) return false;
  let required = pages[route];
  if (!required) {
    const resource = Object.keys(resources).sort((a,b) => b.length-a.length).find(prefix => route === prefix || route.startsWith(`${prefix}/`));
    if (resource) required = [`${resources[resource]}.${route.endsWith("/new") ? "create" : route.endsWith("/edit") ? "update" : "read"}`];
  }
  return Boolean(required?.some(permission => context.permissions.includes(permission)));
}

export function useCapability(permission: string) { return useContext(AccessContext)?.permissions.includes(permission) ?? false; }
export function Capability({ permission, children }: { permission: string; children: ReactNode }) { return useCapability(permission) ? <>{children}</> : null; }
export function PermissionLink(props: ComponentProps<typeof NextLink> & { allowed?: boolean }) {
  const context = useContext(AccessContext);
  if (props.allowed === false) return null;
  const href = typeof props.href === "string" ? props.href : props.href.pathname ?? "";
  if (href.startsWith("/") && !routeAllowed(href, context)) return null;
  if (props["aria-disabled"] === true || props["aria-disabled"] === "true") return <span className={props.className} aria-disabled="true">{props.children}</span>;
  const { allowed, ...linkProps } = props;
  return <NextLink {...linkProps} />;
}

export function AccessProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const revalidate = () => { if (navigator.onLine) setRevision(value => value + 1); };
    const visibility = () => { if (document.visibilityState === "visible") revalidate(); };
    const storage = (event: StorageEvent) => { if (event.key === "syncos.apiToken" || event.key === null) setRevision(value => value + 1); };
    window.addEventListener("storage", storage);
    window.addEventListener("focus", revalidate);
    document.addEventListener("visibilitychange", visibility);
    return () => { window.removeEventListener("storage", storage); window.removeEventListener("focus", revalidate); document.removeEventListener("visibilitychange", visibility); };
  }, []);
  const [state, setState] = useState<{ path: string; context: AuthContext | null; error: string } | null>(null);
  useEffect(() => {
    let alive = true;
    if (publicRoute(pathname)) return;

    const token = readToken();
    if (!token) { setState({ path: pathname, context: null, error: "Sign in to continue." }); return; }
    loadAuthContext(token).then(context => { if (alive) setState({ path: pathname, context, error: "" }); })
      .catch(() => { if (alive) setState({ path: pathname, context: null, error: "We could not verify your access. Sign in again or retry." }); });
    return () => { alive = false; };
  }, [pathname, revision]);
  if (publicRoute(pathname)) return <AccessContext.Provider value={null}>{children}</AccessContext.Provider>;
  if (!state || state.path !== pathname) return <main className="shell"><p role="status">Checking your access…</p></main>;
  if (!routeAllowed(pathname, state.context)) return <AccessContext.Provider value={state.context}><main className="shell"><h1>Access unavailable</h1><p role="alert">{state.error || "Your account is not approved for this page."}</p><button type="button" onClick={() => setRevision(value => value + 1)}>Retry access check</button>{state.context && Object.keys(pages).filter(path => path !== pathname && routeAllowed(path, state.context)).slice(0, 3).map(path => <NextLink key={path} href={path}>{path === "/" ? "Daily priorities" : path.slice(1).replaceAll("-", " ")}</NextLink>)}<NextLink href="/login">Sign in with another account</NextLink></main></AccessContext.Provider>;
  return <AccessContext.Provider key={JSON.stringify([state.context?.user_id, state.context?.tenant_id, [...(state.context?.permissions ?? [])].sort(), state.context?.role_names])} value={state.context}>{children}</AccessContext.Provider>;
}
