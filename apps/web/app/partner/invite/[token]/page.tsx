"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { savePermissions, saveToken, syncosFetch } from "../../../intelligence/api";

type InvitePreview = {
  invitation?: {
    organization_name?: string;
    primary_contact_name?: string;
    email?: string;
    intended_role_key?: string;
    expires_at?: string;
  };
  message?: string;
  checklist?: { items?: Array<{ key?: string; label?: string; requirement?: string }> };
};

type AcceptResult = {
  token: string;
  next_path: string;
  user: { display_name?: string; email?: string };
};

export default function PartnerInviteAcceptancePage() {
  const params = useParams<{ token: string }>();
  const token = useMemo(() => String(params?.token ?? ""), [params]);
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const next = await syncosFetch<InvitePreview>("partner-invitations/token/preview", { method: "POST", token: "", body: { token } });
        if (!cancelled) {
          setPreview(next);
          setDisplayName(next.invitation?.primary_contact_name ?? "");
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Invitation could not be loaded.");
          setLoading(false);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function accept() {
    try {
      setAccepting(true);
      setError(null);
      const accepted = await syncosFetch<AcceptResult>("partner-invitations/accept", { method: "POST", token: "", body: { token, display_name: displayName } });
      saveToken(accepted.token);
      const permissions = await syncosFetch<{ permissions: string[] }>("auth/me/permissions", { token: accepted.token });
      savePermissions(permissions.permissions);
      window.location.assign(accepted.next_path || "/partner/onboarding");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invitation acceptance failed.");
      setAccepting(false);
    }
  }

  return (
    <main className="partner-portal-shell">
      <section className="partner-main">
        <div className="partner-panel">
          <p className="eyebrow">Sync Comm Systems</p>
          <h1>Complete company onboarding</h1>
          {loading ? <p>Loading invitation...</p> : null}
          {error ? <div className="partner-banner error">{error}</div> : null}
          {preview ? (
            <div className="partner-stack">
              <p>{preview.message}</p>
              <div className="partner-list">
                <div className="partner-list-row">
                  <div>
                    <strong>{preview.invitation?.organization_name ?? "Partner Organization"}</strong>
                    <span>{preview.invitation?.email}</span>
                  </div>
                  <span className="status-pill">Partner Admin</span>
                </div>
                {(preview.checklist?.items ?? []).map((item) => (
                  <div className="partner-list-row" key={item.key ?? item.label}>
                    <div>
                      <strong>{item.label}</strong>
                      <span>{item.requirement}</span>
                    </div>
                  </div>
                ))}
              </div>
              <label className="form-field">
                <span>Display name</span>
                <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
              </label>
              <button className="primary-button" type="button" onClick={accept} disabled={accepting}>
                {accepting ? "Opening..." : "Complete Onboarding"}
              </button>
              <Link href="/partner">I already have access</Link>
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}
