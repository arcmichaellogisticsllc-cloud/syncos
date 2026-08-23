import { CommandHero, CommandShell, CountList, InsightStrip, MetricList, ObjectTable, OperatorLink, Panel, WorkQueue } from "../dashboard-components";
import { formatValue, getDashboardData, valueAt } from "../dashboard-data";

export default async function FinancePage() {
  const data = await getDashboardData("finance");
  const settlementConversion = valueAt(data, "settlementConversionRate.currentValue");
  const cashConversion = valueAt(data, "cashConversionRate.currentValue");
  const arAging = valueAt(data, "arAging", []);
  const invoiceCounts = valueAt(data, "invoiceCounts", []);
  const paymentCounts = valueAt(data, "paymentCounts", []);
  return (
    <CommandShell title="Finance Command Center" purpose="How quickly are we turning work into cash?">
      <CommandHero
        eyebrow="Finance workspace"
        title="Control billing, cash, payables, and payment readiness."
        description="Finance should start with work that changes cash position or payment exposure, then drill into the underlying records."
        actions={
          <>
            <OperatorLink href="/billable" variant="primary">Review Billables</OperatorLink>
            <OperatorLink href="/invoices">Open Invoices</OperatorLink>
            <OperatorLink href="/cash">Record Cash</OperatorLink>
          </>
        }
      >
        <InsightStrip
          items={[
            { label: "Settlement conversion", value: formatValue(settlementConversion), helper: "Accepted production moving into Partner settlement." },
            { label: "Cash conversion", value: formatValue(cashConversion), helper: "Invoices converting into collected cash." },
            { label: "AR aging buckets", value: rowCount(arAging), helper: "Open receivables that may need follow-up." },
            { label: "Payment states", value: rowCount(paymentCounts), helper: "Payment batches grouped by status." },
          ]}
        />
      </CommandHero>

      <div className="command-layout">
        <WorkQueue
          title="Cash control"
          description="Start here when customer money or receivables need action."
          rows={[
            { label: "Billables ready for review", value: "Open", href: "/billable", helper: "Accepted production ready to become customer billing." },
            { label: "Invoices", value: rowCount(invoiceCounts), href: "/invoices", helper: "Customer demand-for-payment status." },
            { label: "Cash receipts", value: "Open", href: "/cash", helper: "Record and apply customer cash." },
            { label: "Collections", value: rowCount(arAging), href: "/collections", helper: "Overdue or aging receivables." },
          ]}
        />
        <WorkQueue
          title="Partner payment control"
          description="Keep customer revenue and Partner payable decisions separate."
          rows={[
            { label: "Settlements", value: formatValue(settlementConversion), href: "/settlements", helper: "Partner settlement status and lineage." },
            { label: "Contractor payables", value: "Open", href: "/contractor-payables", helper: "Payable readiness after settlement and cash rules." },
            { label: "Payments", value: rowCount(paymentCounts), href: "/payments", helper: "Internal payment execution status." },
            { label: "Accounting exports", value: "Open", href: "/accounting-exports", helper: "External accounting handoff status only." },
          ]}
        />
      </div>

      <div className="grid">
        <Panel title="Conversion Rates">
          <MetricList data={data} metrics={[["Settlement conversion", "settlementConversionRate.currentValue"], ["Cash conversion", "cashConversionRate.currentValue"]]} />
        </Panel>
        <Panel title="AR Aging">
          <CountList rows={arAging} />
        </Panel>
        <Panel title="Invoice Counts">
          <CountList rows={invoiceCounts} />
        </Panel>
        <Panel title="Payment Counts">
          <CountList rows={paymentCounts} />
        </Panel>
        <Panel title="Customer Payment Intelligence">
          <ObjectTable rows={valueAt(data, "customerPaymentIntelligence", [])} columns={["average_days_to_pay", "payment_count", "short_pay_count", "last_payment_at"]} />
        </Panel>
      </div>
    </CommandShell>
  );
}

function rowCount(rows: unknown) {
  return Array.isArray(rows) ? rows.length : 0;
}
