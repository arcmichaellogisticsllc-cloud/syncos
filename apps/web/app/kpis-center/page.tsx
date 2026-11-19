"use client";
import { useDashboardData, DashboardStatus } from "../dashboard-loader";
import { CommandShell, ObjectTable, Panel } from "../dashboard-components";
import { valueAt } from "../dashboard-data";

export default function KpisCenterPage() {
  const dashboard = useDashboardData("kpis");
  const data = dashboard.data;
  if (!data) return <DashboardStatus title="KPI Center" state={dashboard} />;
  return (
    <CommandShell title="KPI Center" purpose="KPI definitions, history, alerts, and trends.">
      <div className="grid">
        <Panel title="KPI List">
          <ObjectTable rows={valueAt(data, "kpiList", [])} columns={["kpi_name", "kpi_category", "calculation_frequency", "owner_role", "status"]} />
        </Panel>
        <Panel title="KPI Alerts">
          <ObjectTable rows={valueAt(data, "kpiAlerts", [])} columns={["severity", "message", "status"]} />
        </Panel>
        <Panel title="KPI Trends">
          <ObjectTable rows={valueAt(data, "kpiTrends", [])} columns={["kpi_name", "history"]} />
        </Panel>
      </div>
    </CommandShell>
  );
}
