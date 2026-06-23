import { PayrollRunDetail } from "../payroll-workspace";

export default function Page({ params }: { params: { id: string } }) {
  return <PayrollRunDetail payrollRunId={params.id} />;
}
