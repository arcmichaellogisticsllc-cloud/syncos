import { CommandShell, MetricList, ObjectTable, Panel } from "../dashboard-components";
import { getDashboardData, valueAt } from "../dashboard-data";

export default async function WorkflowsCenterPage() {
  const data = await getDashboardData("workflows");
  return (
    <CommandShell title="Workflow Operations View" purpose="Workflow instances, open work, overdue work, and escalations.">
      <div className="grid">
        <Panel title="Summary">
          <MetricList data={data} metrics={[["Open instances", "summary.openWorkflowInstances"], ["Open tasks", "summary.openTasks"], ["Overdue tasks", "summary.overdueTasks"], ["Escalated tasks", "summary.escalatedTasks"]]} />
        </Panel>
        <Panel title="Open Workflow Instances">
          <ObjectTable rows={valueAt(data, "openWorkflowInstances", [])} columns={["source_object_type", "status", "due_at", "created_at"]} />
        </Panel>
        <Panel title="Completed Workflow Instances">
          <ObjectTable rows={valueAt(data, "completedWorkflowInstances", [])} columns={["source_object_type", "status", "due_at", "created_at"]} />
        </Panel>
        <Panel title="Open Tasks">
          <ObjectTable rows={valueAt(data, "openTasks", [])} columns={["task_name", "assigned_role", "status", "due_at"]} />
        </Panel>
        <Panel title="Overdue Tasks">
          <ObjectTable rows={valueAt(data, "overdueTasks", [])} columns={["task_name", "assigned_role", "status", "due_at"]} />
        </Panel>
        <Panel title="Escalated Tasks">
          <ObjectTable rows={valueAt(data, "escalatedTasks", [])} columns={["task_name", "assigned_role", "status", "due_at"]} />
        </Panel>
      </div>
    </CommandShell>
  );
}
