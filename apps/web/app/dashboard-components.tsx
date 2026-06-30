import Link from "next/link";
import type { ReactNode } from "react";
import { formatValue, type DashboardData, valueAt } from "./dashboard-data";

const navItems = [
  ["/", "Command Center", "Daily Priorities", "Today's work and blockers"],
  ["/intelligence/signals", "Growth", "Intelligence", "Find and qualify work"],
  ["/work-orders", "Operations", "Projects", "Plan and execute work"],
  ["/billable", "Finance", "Accounting", "Bill, collect, pay, reconcile"],
];

export function CommandShell({ title, purpose, children }: { title: string; purpose: string; children: ReactNode }) {
  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand">SyncOS</div>
          <div className="brand-subtitle">Telecom operations command center</div>
        </div>
        <nav className="nav" aria-label="Workspace navigation">
          {navItems.map(([href, label, scope, description]) => (
            <Link href={href} key={href} title={description}>
              <span>{label}</span>
              <small>{scope}</small>
            </Link>
          ))}
          <span className="nav-disabled" title="Admin workspace is planned but not implemented yet">Admin</span>
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
