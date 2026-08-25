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
  const [acceptedPath, setAcceptedPath] = useState("");
  const isForemanInvite = preview?.invitation?.intended_role_key === "partner_foreman";
  const roleLabel = isForemanInvite ? "Foreman" : "Partner Administrator";

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
      setAcceptedPath(accepted.next_path || "/partner/onboarding");
      setAccepting(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invitation acceptance failed.");
      setAccepting(false);
    }
  }

  return (
    <main className="partner-invite-shell">
      <section className="partner-invite-card">
        <div className="partner-invite-header">
          <p className="eyebrow">Sync Comm Systems</p>
          <h1>You've been invited to join SyncOS</h1>
          <p>{isForemanInvite ? "Activate your field account before opening SyncField." : "Create your account before continuing to Partner onboarding."}</p>
        </div>
        {loading ? <div className="partner-panel loading-state" role="status">Loading invitation...</div> : null}
        {error ? <div className="partner-banner error">{error}</div> : null}
        {acceptedPath ? (
          <div className="partner-invite-success">
            <p className="eyebrow">Account Activated</p>
            <h2>{isForemanInvite ? "SyncField access is ready" : "Continue to Partner onboarding"}</h2>
            <p>{isForemanInvite ? "Your account is active. Continue to your field workspace." : "Your account is active. Continue to company onboarding to prepare for Sync review."}</p>
            <button className="partner-button primary wide-touch" type="button" onClick={() => window.location.assign(acceptedPath)}>
              {isForemanInvite ? "Continue to SyncField" : "Continue to Partner Onboarding"}
            </button>
          </div>
        ) : null}
        {!acceptedPath && preview ? (
          <div className="partner-invite-grid">
            <aside className="partner-invite-summary" aria-label="Invitation summary">
              <span>Organization</span>
              <strong>{preview.invitation?.organization_name ?? "Partner Organization"}</strong>
              <span>Role</span>
              <strong>{roleLabel}</strong>
              <span>Email</span>
              <strong>{preview.invitation?.email ?? "Invited email"}</strong>
            </aside>
            <div className="partner-invite-form">
              <h2>Create your account</h2>
              <p>{preview.message}</p>
              <label className="form-field">
                <span>Display name</span>
                <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="name" />
              </label>
              <label className="form-field">
                <span>Password</span>
                <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" minLength={12} maxLength={128} />
              </label>
              <label className="form-field">
                <span>Confirm password</span>
                <input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" minLength={12} maxLength={128} />
              </label>
              <div className="partner-invite-actions">
                <button className="partner-button primary wide-touch" type="button" onClick={accept} disabled={accepting}>
                  {accepting ? "Activating..." : "Activate Account"}
                </button>
                <Link href="/login">Already have access? Sign in</Link>
              </div>
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}
