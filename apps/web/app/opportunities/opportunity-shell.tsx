import Link from "next/link";
import type { ReactNode } from "react";
import { CommandShell } from "../dashboard-components";

const opportunityNav = [
  ["/opportunities/candidates", "Candidate Board", "active"],
  ["/opportunities/pipeline", "Opportunity Pipeline", "active"],
  ["/opportunities/coverage", "Coverage Planning", "active"],
  ["/opportunities/pursuits", "Pursuit Management", "placeholder"],
];

export function OpportunityShell({ title, purpose, children }: { title: string; purpose: string; children: ReactNode }) {
  return (
    <CommandShell title={title} purpose={purpose}>
      <div className="workspace-layout">
        <aside className="workspace-nav">
          <div className="workspace-nav-title">Opportunity</div>
          {opportunityNav.map(([href, label, state]) =>
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
