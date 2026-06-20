import { SignalDetail } from "./signal-detail";

export default function SignalDetailPage({ params }: { params: { id: string } }) {
  return <SignalDetail signalId={params.id} />;
}
