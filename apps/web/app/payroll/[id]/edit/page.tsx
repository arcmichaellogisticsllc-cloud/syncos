import { PayrollRunEdit } from "../../payroll-workspace";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <PayrollRunEdit payrollRunId={(await params).id} />;
}
