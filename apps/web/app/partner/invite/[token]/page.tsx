"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { loadAuthContext, savePermissions, saveToken, syncosFetch } from "../../../intelligence/api";

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
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const isForemanInvite = preview?.invitation?.intended_role_key === "partner_foreman";

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
      if (password.length < 12 || password.length > 128) {
        setError("Use a password between 12 and 128 characters.");
        return;
      }
      if (password !== confirmPassword) {
        setError("Password confirmation must match.");
        return;
      }
      setAccepting(true);
      setError(null);
      const accepted = await syncosFetch<AcceptResult>("partner-invitations/accept", { method: "POST", token: "", body: { token, display_name: displayName, password } });
      saveToken(accepted.token);
      const context = await loadAuthContext(accepted.token);
      savePermissions(context.permissions);
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
          <h1>{isForemanInvite ? "Activate SyncOS field access" : "Complete partner onboarding"}</h1>
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
                  <span className="status-pill">{isForemanInvite ? "Field Access" : "Partner Admin"}</span>
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
              <label className="form-field">
                <span>Password</span>
                <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" minLength={12} maxLength={128} />
              </label>
              <label className="form-field">
                <span>Confirm password</span>
                <input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" minLength={12} maxLength={128} />
              </label>
              <button className="primary-button" type="button" onClick={accept} disabled={accepting}>
                {accepting ? "Opening..." : isForemanInvite ? "Activate Field Access" : "Complete Onboarding"}
              </button>
              <Link href="/partner">I already have access</Link>
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}
