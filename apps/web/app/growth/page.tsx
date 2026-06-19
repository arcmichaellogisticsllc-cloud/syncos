import { CommandShell, CountList, MetricList, Panel } from "../dashboard-components";
import { getDashboardData, valueAt } from "../dashboard-data";

export default async function GrowthPage() {
  const data = await getDashboardData("growth");
  return (
    <CommandShell title="Growth Command Center" purpose="Where is future work coming from?">
      <div className="grid">
        <Panel title="Signal Volume">
          <MetricList data={data} metrics={[["Signals", "signalVolume"], ["Signal conversion", "signalConversionRate.currentValue"], ["Candidate conversion", "candidateConversionRate.currentValue"]]} />
        </Panel>
        <Panel title="Relationship Access Score">
          <MetricList data={data} metrics={[["Average score", "relationshipAccessScore"], ["Strategic opportunity ratio", "strategicOpportunityRatio"]]} />
        </Panel>
        <Panel title="Opportunity Candidate Pipeline">
          <CountList rows={valueAt(data, "opportunityCandidatePipeline", [])} />
        </Panel>
        <Panel title="Qualified Opportunity Value">
          <MetricList data={data} metrics={[["Value", "qualifiedOpportunityValue.currentValue"]]} />
        </Panel>
        <Panel title="Relationship Activity">
          <CountList rows={valueAt(data, "relationshipActivity", [])} />
        </Panel>
      </div>
    </CommandShell>
  );
}
