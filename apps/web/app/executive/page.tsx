import { CommandHero, CommandShell, InsightStrip, OperatorLink, PriorityDecisionCard, WorkQueue } from "../dashboard-components";
import { formatValue, getDashboardData, valueAt } from "../dashboard-data";

export default async function ExecutivePage() {
  const data = await getDashboardData("executive");
  const throughput = valueAt(data, "telecomWorkThroughput.currentValue");
  const qualifiedValue = valueAt(data, "opportunityPipeline.qualifiedValue");
  const awardedValue = valueAt(data, "opportunityPipeline.awardedValue");
  const openConstraints = valueAt(data, "constraintSummary.openConstraints");
  const blockedValue = valueAt(data, "constraintSummary.blockedValue");
  const openAr = valueAt(data, "cashHealth.openAr");
  const overdueAr = valueAt(data, "cashHealth.overdueAr");
  const openTasks = valueAt(data, "workflowSummary.openTasks");
  const overdueTasks = valueAt(data, "workflowSummary.overdueTasks");
  const escalatedTasks = valueAt(data, "workflowSummary.escalatedTasks");
  const submittedProduction = valueAt(data, "productionHealth.submittedProduction");
  const approvedProduction = valueAt(data, "productionHealth.approvedProduction");

  return (
    <CommandShell title="Executive Command Center" purpose="Business health, blockers, cash exposure, throughput, and decisions.">
      <CommandHero
        eyebrow="Executive view"
        title="What is stopping telecom work from becoming cash?"
        description="This view summarizes cross-domain health and turns it into decisions: remove blockers, protect cash, review production throughput, and open the queue that needs action."
        actions={
          <>
            <OperatorLink href="/constraints-center" variant="primary">Review Blockers</OperatorLink>
            <OperatorLink href="/finance">View Cash Exposure</OperatorLink>
            <OperatorLink href="/operations">Inspect Operations</OperatorLink>
          </>
        }
      >
        <InsightStrip
          items={[
            { label: "Throughput", value: formatValue(throughput), helper: "Latest telecom work throughput KPI." },
            { label: "Qualified pipeline", value: formatValue(qualifiedValue), helper: "Future work that can become operations demand." },
            { label: "Awarded value", value: formatValue(awardedValue), helper: "Won work that needs execution discipline." },
            { label: "Open AR", value: formatValue(openAr), helper: "Cash not yet collected." },
          ]}
        />
      </CommandHero>

      <div className="priority-decision-grid" aria-label="Executive priorities">
        <PriorityDecisionCard title="Blocked work" value={formatValue(openConstraints)} helper="Open constraints require owner, capacity, compliance, or finance decisions." href="/constraints-center" action="Open constraints" tone={Number(openConstraints) > 0 ? "warning" : "success"} />
        <PriorityDecisionCard title="Cash exposure" value={formatValue(overdueAr)} helper="Overdue receivables need billing, cash, or collections attention." href="/finance" action="Open finance" tone={Number(overdueAr) > 0 ? "danger" : "success"} />
        <PriorityDecisionCard title="Approval pressure" value={formatValue(submittedProduction)} helper="Submitted production cannot create billing momentum until reviewed." href="/production" action="Open production" />
        <PriorityDecisionCard title="Workflow risk" value={formatValue(overdueTasks)} helper="Overdue tasks can hide execution and handoff failures." href="/workflows-center" action="Open workflows" tone={Number(overdueTasks) > 0 ? "warning" : "success"} />
      </div>

      <div className="command-layout">
        <WorkQueue
          title="Decision queues"
          description="Open these queues when the metric is non-zero or trending against plan."
          rows={[
            { label: "Blocked constraints", value: formatValue(openConstraints), href: "/constraints-center", helper: `${formatValue(blockedValue)} blocked items reported.`, tone: Number(openConstraints) > 0 ? "warning" : "success" },
            { label: "Overdue workflow tasks", value: formatValue(overdueTasks), href: "/workflows-center", helper: `${formatValue(escalatedTasks)} escalated tasks need attention.`, tone: Number(overdueTasks) > 0 ? "danger" : "success" },
            { label: "Open workflow tasks", value: formatValue(openTasks), href: "/workflows-center", helper: "Active work items across operating workflows." },
          ]}
        />
        <WorkQueue
          title="Throughput and cash"
          description="Use these signals to decide whether work is moving through the operating system."
          rows={[
            { label: "Submitted production", value: formatValue(submittedProduction), href: "/production", helper: "Field work waiting for review." },
            { label: "Approved production", value: formatValue(approvedProduction), href: "/billable", helper: "Approved work that can feed billing controls." },
            { label: "Open receivables", value: formatValue(openAr), href: "/finance", helper: "Cash still outstanding." },
            { label: "Overdue receivables", value: formatValue(overdueAr), href: "/collections", helper: "Cash risk that may need collections action.", tone: Number(overdueAr) > 0 ? "danger" : "success" },
          ]}
        />
      </div>
    </CommandShell>
  );
}
