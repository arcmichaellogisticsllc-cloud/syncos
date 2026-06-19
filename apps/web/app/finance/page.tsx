import { CommandShell, CountList, MetricList, ObjectTable, Panel } from "../dashboard-components";
import { getDashboardData, valueAt } from "../dashboard-data";

export default async function FinancePage() {
  const data = await getDashboardData("finance");
  return (
    <CommandShell title="Finance Command Center" purpose="How quickly are we turning work into cash?">
      <div className="grid">
        <Panel title="Conversion Rates">
          <MetricList data={data} metrics={[["Settlement conversion", "settlementConversionRate.currentValue"], ["Cash conversion", "cashConversionRate.currentValue"]]} />
        </Panel>
        <Panel title="AR Aging">
          <CountList rows={valueAt(data, "arAging", [])} />
        </Panel>
        <Panel title="Invoice Counts">
          <CountList rows={valueAt(data, "invoiceCounts", [])} />
        </Panel>
        <Panel title="Payment Counts">
          <CountList rows={valueAt(data, "paymentCounts", [])} />
        </Panel>
        <Panel title="Customer Payment Intelligence">
          <ObjectTable rows={valueAt(data, "customerPaymentIntelligence", [])} columns={["average_days_to_pay", "payment_count", "short_pay_count", "last_payment_at"]} />
        </Panel>
      </div>
    </CommandShell>
  );
}
