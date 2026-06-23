import { PayrollRunEdit } from "../../payroll-workspace";

export default function Page({ params }: { params: { id: string } }) {
  return <PayrollRunEdit payrollRunId={params.id} />;
}
