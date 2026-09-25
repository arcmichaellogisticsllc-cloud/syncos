import { PermissionLink } from "../access-control";
import { QcReviewQueue } from "./qc-workspace";

export default function QcPage() {
  return <><nav className="workspace-panel"><PermissionLink href="/customer-qc">Daily report customer QC and reinspection</PermissionLink></nav><QcReviewQueue /></>;
}
