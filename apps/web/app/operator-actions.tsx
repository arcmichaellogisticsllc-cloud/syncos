import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ActionVariant = "primary" | "secondary" | "danger" | "ghost" | "utility";

export function ActionButton({
  label,
  variant = "secondary",
  disabled,
  disabledReason,
  permissionHint,
  consequence,
  loading,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  variant?: ActionVariant;
  disabledReason?: string;
  permissionHint?: string;
  consequence?: string;
  loading?: boolean;
}) {
  const reason = disabledReason || permissionHint;
  const describedBy = reason ? `${buttonId(label)}-disabled-reason` : props["aria-describedby"];
  return (
    <span className="action-button-wrap">
      <button
        {...props}
        aria-describedby={describedBy}
        className={["action-button", `action-button-${variant}`, className].filter(Boolean).join(" ")}
        disabled={disabled || Boolean(reason) || loading}
        title={reason || consequence || props.title}
        type={props.type ?? "button"}
      >
        {loading ? "Submitting..." : children ?? label}
      </button>
      {reason ? <DisabledReason id={describedBy}>{reason}</DisabledReason> : null}
    </span>
  );
}

export function ActionBar({ primary, secondary, utility, danger }: { primary?: ReactNode; secondary?: ReactNode; utility?: ReactNode; danger?: ReactNode }) {
  return (
    <div className="action-bar">
      {primary ? <div className="action-bar-group action-bar-primary">{primary}</div> : null}
      {secondary ? <div className="action-bar-group action-bar-secondary">{secondary}</div> : null}
      {utility ? <div className="action-bar-group action-bar-utility">{utility}</div> : null}
      {danger ? <div className="action-bar-group action-bar-danger" aria-label="Danger actions">{danger}</div> : null}
    </div>
  );
}

export function DisabledReason({ id, children }: { id?: string; children: ReactNode }) {
  return <span id={id} className="disabled-reason">{children}</span>;
}

export function BoundaryNotice({ title = "Boundary", children }: { title?: string; children: ReactNode }) {
  return (
    <div className="boundary-notice">
      <strong>{title}</strong>
      <span>{children}</span>
    </div>
  );
}

export function StatusBadge({ status, tone = "neutral" }: { status: ReactNode; tone?: "neutral" | "success" | "warning" | "danger" }) {
  return <span className={`status-badge status-badge-${tone}`}>{status}</span>;
}

export function SuccessBanner({ children }: { children: ReactNode }) {
  return <div className="success-banner" role="status">{children}</div>;
}

export function ErrorBanner({ children }: { children: ReactNode }) {
  return <div className="error-banner" role="alert">{children}</div>;
}

export function ModalActions({
  submitLabel,
  cancelLabel = "Cancel",
  submitting,
  danger,
  onCancel,
}: {
  submitLabel: string;
  cancelLabel?: string;
  submitting?: boolean;
  danger?: boolean;
  onCancel: () => void;
}) {
  return (
    <div className="form-actions modal-actions">
      <button type="button" disabled={submitting} onClick={onCancel}>{cancelLabel}</button>
      <button className={danger ? "danger-button" : "primary-button"} disabled={submitting} type="submit">{submitting ? "Submitting..." : submitLabel}</button>
    </div>
  );
}

function buttonId(label: string) {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
