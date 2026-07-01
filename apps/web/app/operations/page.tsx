import { BoardColumn, CommandHero, CommandShell, InsightStrip, OperatorLink, PriorityDecisionCard, WorkQueue } from "../dashboard-components";
import { formatValue, getDashboardData, valueAt } from "../dashboard-data";

export default async function OperationsPage() {
  const data = await getDashboardData("operations");
  const coverage = valueAt(data, "capacityCoverageRatio.currentValue");
  const activatedProviders = valueAt(data, "activatedProviders");
  const productionVolume = valueAt(data, "productionVolume");
  const stopWorkCount = valueAt(data, "stopWorkCount");
  const correctionRate = valueAt(data, "correctionRate.currentValue");
  const approvalRate = valueAt(data, "qcScore.approvalRate.currentValue");
  const rejectionRate = valueAt(data, "qcScore.rejectionRate");
  const crewCounts = normalizeRows(valueAt(data, "crewCounts", []));
  const capacityGaps = normalizeRows(valueAt(data, "capacityGaps", []));

  return (
    <CommandShell title="Operations Board" purpose="Capacity, work execution, production blockers, and quality signals for telecom operations.">
      <CommandHero
        eyebrow="Operations workspace"
        title="Can we execute the work safely and keep it moving?"
        description="The Operations Board connects capacity, work orders, field production, stop-work signals, and QC outcomes so managers can decide what to unblock first."
        actions={
          <>
            <OperatorLink href="/work-orders" variant="primary">Open Work Orders</OperatorLink>
            <OperatorLink href="/production">Review Production</OperatorLink>
            <OperatorLink href="/qc">Open QC Queue</OperatorLink>
          </>
        }
      >
        <InsightStrip
          items={[
            { label: "Capacity coverage", value: formatValue(coverage), helper: "Latest capacity coverage KPI." },
            { label: "Activated providers", value: formatValue(activatedProviders), helper: "Providers available for execution." },
            { label: "Production volume", value: formatValue(productionVolume), helper: "Submitted production quantity." },
            { label: "Stop-work items", value: formatValue(stopWorkCount), helper: "Active stop-work risk." },
          ]}
        />
      </CommandHero>

      <div className="priority-decision-grid" aria-label="Operations priorities">
        <PriorityDecisionCard title="Capacity ready?" value={formatValue(coverage)} helper="Coverage below target means work may stall before production starts." href="/work-orders" action="Check work orders" tone={Number(coverage) > 0 ? "neutral" : "warning"} />
        <PriorityDecisionCard title="Capacity gaps" value={capacityGaps.length} helper="Recent gap analyses that may block field execution." href="/operations" action="Review gap summary" tone={capacityGaps.length > 0 ? "warning" : "success"} />
        <PriorityDecisionCard title="Stop-work risk" value={formatValue(stopWorkCount)} helper="Active stop-work records need immediate operational decisioning." href="/production" action="Open production" tone={Number(stopWorkCount) > 0 ? "danger" : "success"} />
        <PriorityDecisionCard title="Quality pressure" value={formatValue(correctionRate)} helper="Correction rate shows rework risk before billing readiness." href="/qc" action="Open QC" tone={Number(correctionRate) > 0 ? "warning" : "success"} />
      </div>

      <div className="operations-board">
        <BoardColumn
          title="Plan work"
          purpose="Confirm capacity and route work before execution risk grows."
          rows={[
            { label: "Projects", value: "Open", href: "/projects", helper: "Project context and handoff readiness." },
            { label: "Work orders", value: "Open", href: "/work-orders", helper: "Executable work packages." },
            { label: "Activated providers", value: formatValue(activatedProviders), href: "/work-orders", helper: "Available capacity supply." },
          ]}
        />
        <BoardColumn
          title="Execute work"
          purpose="Watch field production and stop-work signals."
          rows={[
            { label: "Production board", value: formatValue(productionVolume), href: "/production", helper: "Submitted production volume." },
            { label: "Stop-work active", value: formatValue(stopWorkCount), href: "/production", helper: "Records needing field/ops decision." },
            { label: "Capacity coverage", value: formatValue(coverage), href: "/operations", helper: "KPI signal for execution readiness." },
          ]}
        />
        <BoardColumn
          title="Approve work"
          purpose="Move reviewed work toward billing without losing quality context."
          rows={[
            { label: "QC queue", value: formatValue(approvalRate), href: "/qc", helper: "Approval rate for production review." },
            { label: "Correction pressure", value: formatValue(correctionRate), href: "/qc", helper: "Rework signal." },
            { label: "Rejection rate", value: formatValue(rejectionRate), href: "/qc", helper: "Quality failure signal." },
          ]}
        />
      </div>

      <div className="command-layout">
        <WorkQueue
          title="Capacity and crew signals"
          description="Use these before assigning new work or accepting more production demand."
          rows={[
            ...crewCounts.map((row) => ({ label: row.label, value: row.value, href: "/work-orders", helper: "Crew capacity category." })),
            ...capacityGaps.map((row) => ({ label: row.label, value: row.value, href: "/operations", helper: row.helper ?? "Capacity gap analysis." })),
          ]}
          empty="No crew counts or capacity gaps are currently available."
        />
        <WorkQueue
          title="Execution control"
          description="Open these queues when execution, production, or quality signals need a decision."
          rows={[
            { label: "Work orders ready for coordination", value: "Open", href: "/work-orders", helper: "Assign work, monitor status, and inspect blockers." },
            { label: "Production needing review", value: formatValue(productionVolume), href: "/production", helper: "Move submitted field work through review." },
            { label: "QC review and corrections", value: formatValue(correctionRate), href: "/qc", helper: "Resolve correction and approval pressure." },
          ]}
        />
      </div>
    </CommandShell>
  );
}

function normalizeRows(rows: unknown) {
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, 6).map((row, index) => {
    const record = row as Record<string, unknown>;
    return {
      label: String(record.label ?? record.crew_type ?? record.analysis_name ?? record.status ?? `Item ${index + 1}`),
      value: formatValue(record.value ?? record.count ?? record.currentValue ?? ""),
      helper: record.gap_summary_json ? "Latest capacity gap analysis." : undefined,
    };
  });
}
