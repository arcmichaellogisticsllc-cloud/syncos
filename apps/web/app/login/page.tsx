"use client";

import Link from "next/link";
import { useState } from "react";
import { clearAuthContext, saveToken, syncosFetch, workspaceRouteFor, type AuthContext } from "../intelligence/api";

type LoginResult = {
  token: string;
  context: AuthContext;
};

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("Enter your email and password to continue.");
  const [loading, setLoading] = useState(false);

  async function signIn() {
    if (!email.trim() || !password) {
      setMessage("Enter your email and password to continue.");
      return;
    }
    setLoading(true);
    clearAuthContext();
    try {
      const result = await syncosFetch<LoginResult>("auth/login", {
        method: "POST",
        token: "",
        body: { email, password },
      });
      saveToken(result.token);
      window.location.assign(workspaceRouteFor(result.context));
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
            <span>Email</span>
            <input value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" inputMode="email" />
          </label>
          <label className="form-field login-field">
            <span>Password</span>
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" minLength={12} maxLength={128} />
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
