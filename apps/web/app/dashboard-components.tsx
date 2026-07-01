import type { ReactNode } from "react";
import { formatValue, type DashboardData, valueAt } from "./dashboard-data";
import { OperatorNavigation } from "./operator-navigation";

export function CommandShell({ title, purpose, children }: { title: string; purpose: string; children: ReactNode }) {
  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand">SyncOS</div>
          <div className="brand-subtitle">Telecom operations command center</div>
        </div>
        <OperatorNavigation />
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

export function CommandHero({
  eyebrow,
  title,
  description,
  actions,
  children,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="command-hero">
      <div>
        {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {actions ? <div className="command-hero-actions">{actions}</div> : null}
      {children}
    </section>
  );
}

export function OperatorLink({ href, children, variant = "secondary" }: { href: string; children: ReactNode; variant?: "primary" | "secondary" | "danger" }) {
  return (
    <a className={`operator-link operator-link-${variant}`} href={href}>
      {children}
    </a>
  );
}

export function PriorityDecisionCard({
  title,
  value,
  helper,
  href,
  action,
  tone = "neutral",
}: {
  title: string;
  value: ReactNode;
  helper: ReactNode;
  href?: string;
  action?: string;
  tone?: "neutral" | "success" | "warning" | "danger";
}) {
  const content = (
    <>
      <span>{title}</span>
      <strong>{value}</strong>
      <small>{helper}</small>
      {action ? <em>{action}</em> : null}
    </>
  );
  if (href) {
    return (
      <a className={`priority-decision-card priority-decision-card-${tone}`} href={href}>
        {content}
      </a>
    );
  }
  return <div className={`priority-decision-card priority-decision-card-${tone}`}>{content}</div>;
}

export function WorkQueue({
  title,
  description,
  rows,
  empty,
}: {
  title: string;
  description: string;
  rows: Array<{ label: string; value: ReactNode; href?: string; helper?: ReactNode; tone?: "neutral" | "success" | "warning" | "danger" }>;
  empty?: string;
}) {
  return (
    <section className="panel work-queue">
      <div>
        <h2>{title}</h2>
        <p className="muted">{description}</p>
      </div>
      {rows.length ? (
        <div className="work-queue-list">
          {rows.map((row) => {
            const rowContent = (
              <>
                <span>
                  <strong>{row.label}</strong>
                  {row.helper ? <small>{row.helper}</small> : null}
                </span>
                <b className={`queue-value queue-value-${row.tone ?? "neutral"}`}>{row.value}</b>
              </>
            );
            return row.href ? (
              <a className="work-queue-row" href={row.href} key={`${row.label}-${row.href}`}>
                {rowContent}
              </a>
            ) : (
              <div className="work-queue-row" key={row.label}>
                {rowContent}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="empty-state">{empty ?? "No priority work in this queue."}</div>
      )}
    </section>
  );
}

export function BoardColumn({
  title,
  purpose,
  rows,
}: {
  title: string;
  purpose: string;
  rows: Array<{ label: string; value: ReactNode; href?: string; helper?: ReactNode }>;
}) {
  return (
    <section className="panel board-column">
      <div>
        <h2>{title}</h2>
        <p className="muted">{purpose}</p>
      </div>
      <div className="board-column-list">
        {rows.length ? rows.map((row) => (
          <a className="board-column-row" href={row.href ?? "#"} key={`${row.label}-${row.href ?? "static"}`} aria-disabled={row.href ? undefined : "true"}>
            <span>
              <strong>{row.label}</strong>
              {row.helper ? <small>{row.helper}</small> : null}
            </span>
            <b>{row.value}</b>
          </a>
        )) : <div className="empty-state">No records need attention.</div>}
      </div>
    </section>
  );
}

export function InsightStrip({ items }: { items: Array<{ label: string; value: ReactNode; helper: ReactNode }> }) {
  return (
    <div className="insight-strip">
      {items.map((item) => (
        <div className="insight-item" key={item.label}>
          <span>{item.label}</span>
          <strong>{item.value}</strong>
          <small>{item.helper}</small>
        </div>
      ))}
    </div>
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
