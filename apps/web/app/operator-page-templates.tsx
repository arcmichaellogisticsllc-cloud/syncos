import type { ReactNode } from "react";
import { ActionBar, BoundaryNotice, StatusBadge } from "./operator-actions";

export type PriorityCardConfig = {
  label: string;
  value: ReactNode;
  helper?: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
};

export type QueueTabConfig = {
  label: string;
  value?: string;
  disabled?: boolean;
};

export function QueuePageTemplate({
  title,
  purpose,
  contextLabel,
  priorityCards,
  primaryAction,
  secondaryActions,
  activeTab,
  tabs,
  onTabChange,
  filterDrawer,
  records,
  contextPanel,
}: {
  title: string;
  purpose: ReactNode;
  contextLabel?: ReactNode;
  priorityCards?: PriorityCardConfig[];
  primaryAction?: ReactNode;
  secondaryActions?: ReactNode;
  activeTab?: string;
  tabs?: QueueTabConfig[];
  onTabChange?: (value: string) => void;
  filterDrawer?: ReactNode;
  records: ReactNode;
  contextPanel?: ReactNode;
}) {
  return (
    <div className="queue-page">
      <section className="panel workspace-panel queue-header">
        <div>
          {contextLabel ? <span className="badge">{contextLabel}</span> : null}
          <h2>{title}</h2>
          <p className="muted">{purpose}</p>
        </div>
        {(primaryAction || secondaryActions) ? <ActionBar primary={primaryAction} secondary={secondaryActions} /> : null}
      </section>
      {priorityCards?.length ? (
        <div className="summary-grid priority-grid" aria-label={`${title} priorities`}>
          {priorityCards.map((card) => <PriorityCard key={card.label} {...card} />)}
        </div>
      ) : null}
      {(tabs?.length || filterDrawer) ? (
        <section className="panel workspace-panel">
          {tabs?.length ? <QueueTabs tabs={tabs} activeTab={activeTab ?? tabs[0]?.label ?? ""} onTabChange={onTabChange} /> : null}
          {filterDrawer}
        </section>
      ) : null}
      <div className={contextPanel ? "queue-content-grid" : undefined}>
        <RecordsPanel>{records}</RecordsPanel>
        {contextPanel}
      </div>
    </div>
  );
}

export function PriorityCard({ label, value, helper, onClick, disabled }: PriorityCardConfig) {
  return (
    <button className="summary-card priority-card" disabled={disabled} type="button" onClick={onClick}>
      <span>{label}</span>
      <strong>{value}</strong>
      {helper ? <small>{helper}</small> : null}
    </button>
  );
}

export function QueueTabs({ tabs, activeTab, onTabChange }: { tabs: QueueTabConfig[]; activeTab: string; onTabChange?: (value: string) => void }) {
  return (
    <div className="queue-tabs" role="tablist" aria-label="Queue tabs">
      {tabs.map((tab) => {
        const value = tab.value ?? tab.label;
        return (
          <button key={value} type="button" role="tab" aria-selected={activeTab === value || activeTab === tab.label} className={activeTab === value || activeTab === tab.label ? "active" : undefined} disabled={tab.disabled} onClick={() => onTabChange?.(value)}>
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

export function FilterDrawer({ children, label = "Filters" }: { children: ReactNode; label?: string }) {
  return (
    <details className="filter-drawer">
      <summary aria-label={`${label} drawer`}>{label}</summary>
      {children}
    </details>
  );
}

export function RecordsPanel({ children, title, count }: { children: ReactNode; title?: string; count?: ReactNode }) {
  return (
    <section className="panel workspace-panel records-panel">
      {(title || count) ? (
        <div className="section-toolbar">
          {title ? <h2>{title}</h2> : <span />}
          {count ? <span className="badge">{count}</span> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="empty-state">{children}</div>;
}

export function LoadingState({ children = "Loading..." }: { children?: ReactNode }) {
  return <div className="loading-state">{children}</div>;
}

export function ErrorState({ children }: { children: ReactNode }) {
  return <div className="error-banner" role="alert">{children}</div>;
}

export function DetailPageTemplate({
  header,
  actions,
  keyFacts,
  stateExplanation,
  relatedRecords,
  timeline,
  audit,
  boundaryNotice,
}: {
  header: ReactNode;
  actions?: ReactNode;
  keyFacts?: ReactNode;
  stateExplanation?: ReactNode;
  relatedRecords?: ReactNode;
  timeline?: ReactNode;
  audit?: ReactNode;
  boundaryNotice?: ReactNode;
}) {
  return (
    <div className="detail-page">
      {header}
      {actions}
      {boundaryNotice}
      <div className="detail-grid">
        {keyFacts}
        {stateExplanation}
        {relatedRecords}
        {timeline}
        {audit}
      </div>
    </div>
  );
}

export function DetailNextActionCard({
  title = "Next Action",
  status,
  nextActionLabel,
  disabled,
  disabledReason,
  boundaryText,
  helperText,
  personaHint,
  variant = "default",
}: {
  title?: string;
  status?: ReactNode;
  nextActionLabel: ReactNode;
  disabled?: boolean;
  disabledReason?: ReactNode;
  boundaryText?: ReactNode;
  helperText?: ReactNode;
  personaHint?: ReactNode;
  variant?: "default" | "finance" | "danger";
}) {
  return (
    <section className={`detail-next-action-card detail-next-action-card-${variant}`} aria-label="Next Action">
      <div>
        <span className="eyebrow">{title}</span>
        <h2>{nextActionLabel}</h2>
        {status ? <p className="muted">Current state: {status}</p> : null}
        {helperText ? <p>{helperText}</p> : null}
      </div>
      {disabled && disabledReason ? <DisabledActionReason>{disabledReason}</DisabledActionReason> : null}
      {personaHint ? <p className="muted">{personaHint}</p> : null}
      {boundaryText ? <BoundaryNotice title="Action boundary">{boundaryText}</BoundaryNotice> : null}
    </section>
  );
}

export function ReadOnlyBanner({ children }: { children?: ReactNode }) {
  return (
    <div className="read-only-banner" role="status">
      {children ?? "You are viewing this record in read-only mode. You can inspect status, related records, and audit history, but lifecycle actions are unavailable."}
    </div>
  );
}

export function RecordStateSummary({
  status,
  meaning,
  next,
  blockers,
}: {
  status: ReactNode;
  meaning: ReactNode;
  next: ReactNode;
  blockers?: ReactNode;
}) {
  return (
    <section className="record-state-summary panel workspace-panel">
      <h2>State Explanation</h2>
      <dl className="detail-list">
        <dt>Status</dt><dd>{status}</dd>
        <dt>What this means</dt><dd>{meaning}</dd>
        <dt>What happens next</dt><dd>{next}</dd>
        {blockers ? <><dt>Blocking progress</dt><dd>{blockers}</dd></> : null}
      </dl>
    </section>
  );
}

export function DetailBoundaryNotice({ children, title = "Detail boundary" }: { children: ReactNode; title?: string }) {
  return <BoundaryNotice title={title}>{children}</BoundaryNotice>;
}

export function RelatedRecordPanel({ title = "Related Records", children }: { title?: string; children: ReactNode }) {
  return <TemplatePanel title={title}>{children}</TemplatePanel>;
}

export function DangerZone({ children, description }: { children: ReactNode; description?: ReactNode }) {
  return (
    <section className="danger-zone" aria-label="Danger zone">
      <h2>Danger Zone</h2>
      {description ? <p>{description}</p> : null}
      <div className="danger-zone-actions">{children}</div>
    </section>
  );
}

export function DisabledActionReason({ children }: { children: ReactNode }) {
  return <div className="disabled-action-reason">{children}</div>;
}

export function FormPurposeHeader({
  title,
  purpose,
  afterSave,
}: {
  title: ReactNode;
  purpose: ReactNode;
  afterSave?: ReactNode;
}) {
  return (
    <section className="form-purpose-header">
      <div>
        <span className="eyebrow">Operator form</span>
        <h2>{title}</h2>
        <p>{purpose}</p>
      </div>
      {afterSave ? <p className="muted">After save: {afterSave}</p> : null}
    </section>
  );
}

export function FormSection({ title, children, description }: { title: string; children: ReactNode; description?: ReactNode }) {
  return (
    <section className="form-section">
      <h3>{title}</h3>
      {description ? <p className="muted">{description}</p> : null}
      {children}
    </section>
  );
}

export function RequiredFieldNote({ children = "Required fields are marked and must be completed before this record can be saved." }: { children?: ReactNode }) {
  return <p className="required-field-note">{children}</p>;
}

export function FormBoundaryNotice({ children }: { children: ReactNode }) {
  return <BoundaryNotice title="Form boundary">{children}</BoundaryNotice>;
}

export function RecordHeader({ title, identifier, status, owner, context }: { title: ReactNode; identifier?: ReactNode; status?: ReactNode; owner?: ReactNode; context?: ReactNode }) {
  return (
    <section className="panel record-header">
      <div>
        <h2>{title}</h2>
        {identifier ? <p className="muted">{identifier}</p> : null}
        {context ? <p className="muted">{context}</p> : null}
      </div>
      <div className="badge-row">
        {status ? <StatusBadge status={status} /> : null}
        {owner ? <span className="badge">{owner}</span> : null}
      </div>
    </section>
  );
}

export function KeyFactsPanel({ title = "Key facts", children }: { title?: string; children: ReactNode }) {
  return <TemplatePanel title={title}>{children}</TemplatePanel>;
}

export function StateExplanation({ children }: { children: ReactNode }) {
  return <TemplatePanel title="State explanation">{children}</TemplatePanel>;
}

export function RelatedRecordsPanel({ children }: { children: ReactNode }) {
  return <TemplatePanel title="Related records">{children}</TemplatePanel>;
}

export function TimelinePanel({ children }: { children: ReactNode }) {
  return <TemplatePanel title="Timeline">{children}</TemplatePanel>;
}

export function AuditPanel({ children }: { children: ReactNode }) {
  return <TemplatePanel title="Audit">{children}</TemplatePanel>;
}

export function FinancialControlTemplate({
  title,
  summary,
  boundary,
  approvals,
  sourceContext,
  actions,
  auditTimeline,
}: {
  title: string;
  summary: ReactNode;
  boundary: ReactNode;
  approvals?: ReactNode;
  sourceContext?: ReactNode;
  actions?: ReactNode;
  auditTimeline?: ReactNode;
}) {
  return (
    <div className="financial-control-page">
      <section className="panel workspace-panel">
        <h2>{title}</h2>
        {summary}
        <BoundaryNotice>{boundary}</BoundaryNotice>
        {actions}
      </section>
      <div className="detail-grid">
        {approvals}
        {sourceContext}
        {auditTimeline}
      </div>
    </div>
  );
}

export function ReviewQueueTemplate({
  header,
  summary,
  reviews,
  evidencePanel,
  boundary,
}: {
  header: ReactNode;
  summary?: ReactNode;
  reviews: ReactNode;
  evidencePanel?: ReactNode;
  boundary?: ReactNode;
}) {
  return (
    <div className="review-queue-page">
      <section className="panel workspace-panel review-queue-header">
        {header}
        {summary}
        {boundary ? <BoundaryNotice>{boundary}</BoundaryNotice> : null}
      </section>
      <div className={evidencePanel ? "queue-content-grid" : undefined}>
        <RecordsPanel>{reviews}</RecordsPanel>
        {evidencePanel}
      </div>
    </div>
  );
}

function TemplatePanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="panel workspace-panel">
      <h2>{title}</h2>
      {children}
    </section>
  );
}
