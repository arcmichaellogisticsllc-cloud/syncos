import Link from "next/link";
import type { ReactNode } from "react";
import { CommandShell } from "../dashboard-components";

const intelligenceNav = [
  ["/intelligence/signals", "Signal Feed", "active"],
  ["/intelligence/organizations", "Organizations", "active"],
  ["/intelligence/contacts", "Contacts", "coming"],
  ["/intelligence/relationship-maps", "Relationship Maps", "coming"],
];

export function IntelligenceShell({ title, purpose, children }: { title: string; purpose: string; children: ReactNode }) {
  return (
    <CommandShell title={title} purpose={purpose}>
      <div className="workspace-layout">
        <aside className="workspace-nav">
          <div className="workspace-nav-title">Intelligence</div>
          {intelligenceNav.map(([href, label, state]) =>
            state === "active" ? (
              <Link href={href} key={href}>
                {label}
              </Link>
            ) : (
              <div className="nav-placeholder" key={href}>
                <span>{label}</span>
                <small>Coming next</small>
              </div>
            ),
          )}
        </aside>
        <div className="workspace-main">{children}</div>
      </div>
    </CommandShell>
  );
}

export function PlaceholderPage({ title }: { title: string }) {
  return (
    <IntelligenceShell title={title} purpose="This workspace is intentionally deferred to a later product sprint.">
      <section className="panel">
        <h2>Coming next</h2>
        <p className="muted">This workspace is intentionally deferred while Signal and Organization workspaces are built first.</p>
      </section>
    </IntelligenceShell>
  );
}
