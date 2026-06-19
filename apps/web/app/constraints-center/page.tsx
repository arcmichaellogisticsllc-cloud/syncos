import { CommandShell, CountList, ObjectTable, Panel } from "../dashboard-components";
import { getDashboardData, valueAt } from "../dashboard-data";

export default async function ConstraintsCenterPage() {
  const data = await getDashboardData("constraints");
  return (
    <CommandShell title="Constraint Command Center" purpose="Active constraints by type, severity, owner, due date, and impact.">
      <div className="grid">
        <Panel title="By Type">
          <CountList rows={valueAt(data, "byType", [])} />
        </Panel>
        <Panel title="By Severity">
          <CountList rows={valueAt(data, "bySeverity", [])} />
        </Panel>
        <Panel title="By Owner">
          <CountList rows={valueAt(data, "byOwner", [])} />
        </Panel>
        <Panel title="By Due Date">
          <CountList rows={valueAt(data, "byDueDate", [])} />
        </Panel>
        <Panel title="By Value Impact">
          <CountList rows={valueAt(data, "byValueImpact", [])} />
        </Panel>
        <Panel title="Active Constraints">
          <ObjectTable rows={valueAt(data, "activeConstraints", [])} columns={["title", "constraint_type", "severity", "status", "due_date"]} />
        </Panel>
      </div>
    </CommandShell>
  );
}
