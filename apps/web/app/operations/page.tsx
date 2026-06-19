import { CommandShell, CountList, MetricList, Panel } from "../dashboard-components";
import { getDashboardData, valueAt } from "../dashboard-data";

export default async function OperationsPage() {
  const data = await getDashboardData("operations");
  return (
    <CommandShell title="Operations Command Center" purpose="Can we cover and execute the work?">
      <div className="grid">
        <Panel title="Capacity Coverage Ratio">
          <MetricList data={data} metrics={[["Coverage", "capacityCoverageRatio.currentValue"], ["Activated providers", "activatedProviders"]]} />
        </Panel>
        <Panel title="Crew Counts">
          <CountList rows={valueAt(data, "crewCounts", [])} />
        </Panel>
        <Panel title="Capacity Gaps">
          <CountList rows={valueAt(data, "capacityGaps", [])} />
        </Panel>
        <Panel title="Production Volume">
          <MetricList data={data} metrics={[["Volume", "productionVolume"], ["Stop work count", "stopWorkCount"]]} />
        </Panel>
        <Panel title="Production Quality">
          <MetricList data={data} metrics={[["Correction rate", "correctionRate.currentValue"], ["Approval rate", "qcScore.approvalRate.currentValue"], ["QC correction rate", "qcScore.correctionRate.currentValue"], ["Rejection rate", "qcScore.rejectionRate"]]} />
        </Panel>
      </div>
    </CommandShell>
  );
}
