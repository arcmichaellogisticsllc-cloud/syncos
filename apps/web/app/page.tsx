import { CommandHero, CommandShell, InsightStrip, OperatorLink, PriorityDecisionCard, WorkQueue } from "./dashboard-components";
import { formatValue, getDashboardData, valueAt } from "./dashboard-data";

export default async function Home() {
  const executive = await getDashboardData("executive");
  const operations = await getDashboardData("operations");

  const openConstraints = valueAt(executive, "constraintSummary.openConstraints");
  const overdueTasks = valueAt(executive, "workflowSummary.overdueTasks");
  const openAr = valueAt(executive, "cashHealth.openAr");
  const submittedProduction = valueAt(executive, "productionHealth.submittedProduction");
  const approvedProduction = valueAt(executive, "productionHealth.approvedProduction");
  const stopWorkCount = valueAt(operations, "stopWorkCount");

  return (
    <CommandShell title="Command Center" purpose="Today's work, blockers, approvals, cash exposure, and decisions across SyncOS.">
      <CommandHero
        eyebrow="Daily operating view"
        title="Start with what needs attention now."
        description="The Command Center is the operator landing page. It does not expose raw database objects first; it points each user toward blocked work, ready work, approvals, cash risk, and the next workspace to open."
        actions={
          <>
            <OperatorLink href="/constraints-center" variant="primary">Review Blockers</OperatorLink>
            <OperatorLink href="/operations">Open Operations Board</OperatorLink>
            <OperatorLink href="/finance">View Cash Risk</OperatorLink>
          </>
        }
      >
        <InsightStrip
          items={[
            { label: "Blocked work", value: formatValue(openConstraints), helper: "Open constraints that need owner decisions." },
            { label: "Overdue tasks", value: formatValue(overdueTasks), helper: "Workflow tasks past due." },
            { label: "Open AR", value: formatValue(openAr), helper: "Cash still exposed in receivables." },
            { label: "Stop work", value: formatValue(stopWorkCount), helper: "Production records with active stop-work state." },
          ]}
        />
      </CommandHero>

      <div className="priority-decision-grid" aria-label="Command Center priorities">
        <PriorityDecisionCard title="Review blockers" value={formatValue(openConstraints)} helper="Constraints are the fastest path to unblock work already in the system." href="/constraints-center" action="Open blocker queue" tone={Number(openConstraints) > 0 ? "warning" : "success"} />
        <PriorityDecisionCard title="Clear approvals" value={formatValue(submittedProduction)} helper="Submitted production must move through review before it can become billable." href="/production" action="Open production queue" />
        <PriorityDecisionCard title="Protect cash" value={formatValue(openAr)} helper="Open receivables and overdue cash exposure need finance attention." href="/finance" action="Open finance view" tone={Number(openAr) > 0 ? "warning" : "success"} />
        <PriorityDecisionCard title="Watch throughput" value={`${formatValue(approvedProduction)} approved`} helper="Approved work is the bridge from operations into billing." href="/operations" action="Open operations board" />
      </div>

      <div className="command-layout">
        <WorkQueue
          title="Today's work"
          description="Start with these queues before browsing records."
          rows={[
            { label: "Blocked workflows", value: formatValue(openConstraints), href: "/constraints-center", helper: "Resolve owner, capacity, compliance, or cash blockers.", tone: Number(openConstraints) > 0 ? "warning" : "success" },
            { label: "Production needing review", value: formatValue(submittedProduction), href: "/production", helper: "Move submitted field work toward approval." },
            { label: "Overdue workflow tasks", value: formatValue(overdueTasks), href: "/workflows-center", helper: "Escalated or aging work that needs intervention.", tone: Number(overdueTasks) > 0 ? "danger" : "success" },
            { label: "Open receivables", value: formatValue(openAr), href: "/finance", helper: "Cash risk that may need billing, cash, or collections follow-up." },
          ]}
        />
        <WorkQueue
          title="Decisions to make"
          description="These decisions move work forward or reduce financial risk."
          rows={[
            { label: "Can operations execute today's work?", value: formatValue(valueAt(operations, "capacityCoverageRatio.currentValue")), href: "/operations", helper: "Check capacity coverage, gaps, and stop-work signals." },
            { label: "Is approved production ready for billing?", value: formatValue(approvedProduction), href: "/billable", helper: "Approved production should progress toward billing controls." },
            { label: "Which recommendations need action?", value: formatValue(valueAt(executive, "workflowSummary.openWorkflowInstances")), href: "/recommendations-center", helper: "Review recommendations and open workflow instances." },
          ]}
        />
      </div>
    </CommandShell>
  );
}
