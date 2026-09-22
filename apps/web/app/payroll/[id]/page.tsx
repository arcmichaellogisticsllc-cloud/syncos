import { PayrollRunDetail } from "../payroll-workspace";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <PayrollRunDetail payrollRunId={(await params).id} />;
}
