import { CommandShell, CountList, MetricList, Panel } from "../dashboard-components";
import { getDashboardData, valueAt } from "../dashboard-data";

export default async function ExecutivePage() {
  const data = await getDashboardData("executive");
  return (
    <CommandShell title="Executive Command Center" purpose="What is preventing more telecom work from becoming cash?">
      <div className="grid">
        <Panel title="Telecom Work Throughput">
          <MetricList data={data} metrics={[["Current value", "telecomWorkThroughput.currentValue"], ["Trend", "telecomWorkThroughput.trend"], ["Last calculation", "telecomWorkThroughput.lastCalculationDate"]]} />
        </Panel>
        <Panel title="Opportunity Pipeline">
          <MetricList data={data} metrics={[["Qualified value", "opportunityPipeline.qualifiedValue"], ["Pursuing value", "opportunityPipeline.pursuingValue"], ["Awarded value", "opportunityPipeline.awardedValue"], ["Deferred value", "opportunityPipeline.deferredValue"]]} />
        </Panel>
        <Panel title="Capacity Health">
          <MetricList data={data} metrics={[["Capacity coverage", "capacityHealth.capacityCoverageRatio.currentValue"], ["Activated capacity", "capacityHealth.activatedCapacity"]]} />
          <CountList rows={valueAt(data, "capacityHealth.capacityGaps", [])} />
        </Panel>
        <Panel title="Production Health">
          <MetricList data={data} metrics={[["Submitted production", "productionHealth.submittedProduction"], ["Approved production", "productionHealth.approvedProduction"], ["Correction rate", "productionHealth.correctionRate.currentValue"], ["Approval rate", "productionHealth.productionApprovalRate.currentValue"]]} />
        </Panel>
        <Panel title="Settlement Health">
          <CountList rows={valueAt(data, "settlementHealth", [])} />
        </Panel>
        <Panel title="Cash Health">
          <MetricList data={data} metrics={[["Open AR", "cashHealth.openAr"], ["Overdue AR", "cashHealth.overdueAr"], ["Cash conversion", "cashHealth.cashConversionRate.currentValue"], ["Average days to pay", "cashHealth.averageDaysToPay"]]} />
        </Panel>
        <Panel title="Constraint Summary">
          <MetricList data={data} metrics={[["Open constraints", "constraintSummary.openConstraints"], ["Blocked value", "constraintSummary.blockedValue"]]} />
          <CountList rows={valueAt(data, "constraintSummary.constraintsByType", [])} />
        </Panel>
        <Panel title="Recommendation Summary">
          <CountList rows={valueAt(data, "recommendationSummary", [])} />
        </Panel>
        <Panel title="Workflow Summary">
          <MetricList data={data} metrics={[["Open tasks", "workflowSummary.openTasks"], ["Overdue tasks", "workflowSummary.overdueTasks"], ["Escalated tasks", "workflowSummary.escalatedTasks"], ["Open instances", "workflowSummary.openWorkflowInstances"]]} />
        </Panel>
      </div>
    </CommandShell>
  );
}
