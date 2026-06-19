import { CommandShell, CountList, ObjectTable, Panel } from "../dashboard-components";
import { getDashboardData, valueAt } from "../dashboard-data";

export default async function RecommendationsCenterPage() {
  const data = await getDashboardData("recommendations");
  return (
    <CommandShell title="Recommendation Inbox" purpose="Recommendations requiring action, approval, deferral, completion, or measurement.">
      <div className="grid">
        <Panel title="Summary">
          <CountList rows={valueAt(data, "summary", [])} />
        </Panel>
        <Panel title="Pending Review">
          <ObjectTable rows={valueAt(data, "pendingReview", [])} columns={["title", "recommendation_type", "risk_level", "status"]} />
        </Panel>
        <Panel title="Approved">
          <ObjectTable rows={valueAt(data, "approved", [])} columns={["title", "recommendation_type", "risk_level", "status"]} />
        </Panel>
        <Panel title="Deferred">
          <ObjectTable rows={valueAt(data, "deferred", [])} columns={["title", "recommendation_type", "risk_level", "status"]} />
        </Panel>
        <Panel title="Completed">
          <ObjectTable rows={valueAt(data, "completed", [])} columns={["title", "recommendation_type", "risk_level", "status"]} />
        </Panel>
        <Panel title="Measured">
          <ObjectTable rows={valueAt(data, "measured", [])} columns={["title", "recommendation_type", "risk_level", "status"]} />
        </Panel>
      </div>
    </CommandShell>
  );
}
