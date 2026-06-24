import Link from "next/link";
import type { ReactNode } from "react";
import { formatValue, type DashboardData, valueAt } from "./dashboard-data";

const navItems = [
  ["/intelligence/signals", "Intelligence"],
  ["/opportunities/candidates", "Opportunity"],
  ["/projects", "Projects"],
  ["/work-orders", "Work Orders"],
  ["/production", "Production"],
  ["/qc", "QC"],
  ["/billable", "Billable"],
  ["/settlements", "Settlements"],
  ["/invoices", "Invoices"],
  ["/cash", "Cash Application"],
  ["/collections", "Collections"],
  ["/contractor-payables", "Contractor Payables"],
  ["/payroll", "Payroll"],
  ["/payments", "Payments"],
  ["/bank-reconciliation", "Bank Reconciliation"],
  ["/executive", "Executive"],
  ["/growth", "Growth"],
  ["/operations", "Operations"],
  ["/finance", "Finance"],
  ["/constraints-center", "Constraints"],
  ["/recommendations-center", "Recommendations"],
  ["/workflows-center", "Workflows"],
  ["/kpis-center", "KPIs"],
];

export function CommandShell({ title, purpose, children }: { title: string; purpose: string; children: ReactNode }) {
  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">SyncOS</div>
        <nav className="nav">
          {navItems.map(([href, label]) => (
            <Link href={href} key={href}>
              {label}
            </Link>
          ))}
        </nav>
      </header>
      <section className="content">
        <div className="page-header">
          <h1>{title}</h1>
          <p>{purpose}</p>
        </div>
        {children}
      </section>
    </main>
  );
}

export function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="panel">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export function MetricList({ data, metrics }: { data: DashboardData | null; metrics: Array<[string, string]> }) {
  return (
    <div className="metric-list">
      {metrics.map(([label, path]) => (
        <div className="metric-row" key={path}>
          <span className="label">{label}</span>
          <span className="value">{formatValue(valueAt(data, path))}</span>
        </div>
      ))}
    </div>
  );
}

export function CountList({ rows }: { rows: unknown }) {
  const values = Array.isArray(rows) ? rows : [];
  if (values.length === 0) return <div className="empty">No records</div>;
  return (
    <div className="table-list">
      {values.slice(0, 8).map((row, index) => {
        const record = row as Record<string, unknown>;
        return (
          <div className="metric-row" key={`${record.label ?? record.status ?? index}`}>
            <span className="label">{String(record.label ?? record.status ?? record.title ?? record.kpi_name ?? "Item")}</span>
            <span className="value">{formatValue(record.value ?? record.count ?? record.status ?? record.currentValue ?? "")}</span>
          </div>
        );
      })}
    </div>
  );
}

export function ObjectTable({ rows, columns }: { rows: unknown; columns: string[] }) {
  const values = Array.isArray(rows) ? rows : [];
  if (values.length === 0) return <div className="empty">No records</div>;
  return (
    <table>
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column}>{column.replace(/_/g, " ")}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {values.slice(0, 10).map((row, index) => {
          const record = row as Record<string, unknown>;
          return (
            <tr key={String(record.id ?? index)}>
              {columns.map((column) => (
                <td key={column}>{formatValue(record[column])}</td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
