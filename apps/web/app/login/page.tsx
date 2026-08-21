"use client";

import Link from "next/link";
import { useState } from "react";
import { clearAuthContext, loadAuthContext, saveToken, workspaceRouteFor } from "../intelligence/api";

export default function LoginPage() {
  const [token, setToken] = useState("");
  const [message, setMessage] = useState("Enter your SyncOS access token to continue.");
  const [loading, setLoading] = useState(false);

  async function signIn() {
    if (!token.trim()) {
      setMessage("Enter a SyncOS access token to continue.");
      return;
    }
    setLoading(true);
    clearAuthContext();
    try {
      const nextToken = token.trim();
      saveToken(nextToken);
      const context = await loadAuthContext(nextToken);
      window.location.assign(workspaceRouteFor(context));
    } catch (error) {
      clearAuthContext();
      setMessage(error instanceof Error ? error.message : "Sign in failed.");
      setLoading(false);
    }
  }

  return (
    <main className="login-shell">
      <header className="login-header" aria-label="SyncOS access">
        <a className="login-logo-link" href="https://synccommsystems.com">
          <img src="/brand/sync-comm-systems-logo.png" alt="Sync Comm Systems" />
        </a>
        <a className="login-header-action" href="https://synccommsystems.com/partner.html">Become a Partner</a>
      </header>

      <section className="login-hero">
        <div className="login-hero-copy">
          <span className="login-eyebrow">Sync Comm Systems</span>
          <h1>SyncOS</h1>
          <p>Telecom Operations Platform</p>
        </div>

        <section className="login-panel" aria-label="Sign in to SyncOS">
          <div className="login-brand">
            <img src="/brand/sync-comm-systems-mark.png" alt="" aria-hidden="true" />
            <div>
              <strong>Sync Comm Systems</strong>
              <h2>Sign in to SyncOS</h2>
            </div>
          </div>
          <p className="login-copy">Access your workspace securely.</p>
          <label className="form-field login-field">
            <span>SyncOS access token</span>
            <input value={token} onChange={(event) => setToken(event.target.value)} autoComplete="username" />
          </label>
          <p id="login-note" className="login-copy">{message}</p>
          <div className="login-actions">
            <button className="primary-button login-submit" type="button" onClick={signIn} disabled={loading}>{loading ? "Signing In..." : "Sign In"}</button>
          </div>
          <div className="new-partner-cta">
            <span>New Partner?</span>
            <Link className="operator-link login-secondary" href="https://synccommsystems.com/partner.html">Become a Sync Partner</Link>
          </div>
        </section>
      </section>
    </main>
  );
}
