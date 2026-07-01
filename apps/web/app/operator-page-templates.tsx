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
      <summary>{label}</summary>
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
