import { SignalDetail } from "./signal-detail";

export default async function SignalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return <SignalDetail signalId={(await params).id} />;
}
