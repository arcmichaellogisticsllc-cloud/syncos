"use client";

import { useEffect, useState } from "react";
import { CommandShell } from "./dashboard-components";
import { syncosFetch } from "./intelligence/api";
import type { DashboardData } from "./dashboard-data";

type DashboardKind = "executive" | "operations" | "finance" | "growth" | "constraints" | "recommendations" | "kpis" | "workflows";

export function useDashboardData(kind: DashboardKind, enabled = true) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{ data: DashboardData | null; loading: boolean; error: string }>({ data: null, loading: enabled, error: "" });
  useEffect(() => {
    let current = true;
    if (!enabled) { setState({ data: null, loading: false, error: "" }); return; }
    setState({ data: null, loading: true, error: "" });
    // The browser proxy forwards only this signed-in user's token. There is no shared dashboard identity.
    syncosFetch<DashboardData>(`dashboard/${kind}`).then(data => {
      if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("The dashboard returned no usable data.");
      if (current) setState({ data, loading: false, error: "" });
    }).catch(error => { if (current) setState({ data: null, loading: false, error: error instanceof Error ? error.message : "Could not load this dashboard." }); });
    return () => { current = false; };
  }, [kind, enabled, revision]);
  return { ...state, retry: () => setRevision(value => value + 1) };
}

export function DashboardStatus({ title, state }: { title: string; state: ReturnType<typeof useDashboardData> }) {
  return <CommandShell title={title} purpose="Review the information available to your account.">
    {state.loading ? <p role="status">Loading dashboard…</p> : <section className="workspace-panel"><h2>Dashboard unavailable</h2><p role="alert">{state.error || "Dashboard data is not available."}</p><button type="button" onClick={state.retry}>Retry dashboard</button></section>}
  </CommandShell>;
}
