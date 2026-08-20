"use client";

import Link from "next/link";
import { useState } from "react";
import { saveToken } from "../intelligence/api";

export default function LoginPage() {
  const [token, setToken] = useState("");
  const [message, setMessage] = useState("Use your SyncOS access token or invitation-issued session.");

  function signIn() {
    if (!token.trim()) {
      setMessage("Enter an access token to continue.");
      return;
    }
    saveToken(token.trim());
    window.location.assign("/command-center");
  }

  return (
    <main className="login-shell">
      <section className="login-panel">
        <div className="login-brand">
          <strong>Sync Comm Systems</strong>
          <h1>SyncOS</h1>
          <p>Telecom Operations Platform</p>
        </div>
        <p className="login-copy">{message}</p>
        <label className="form-field">
          <span>Email or access token</span>
          <input value={token} onChange={(event) => setToken(event.target.value)} autoComplete="username" />
        </label>
        <label className="form-field">
          <span>Password</span>
          <input type="password" autoComplete="current-password" aria-describedby="login-note" />
        </label>
        <p id="login-note" className="login-copy">Password sign-in is connected by the production auth provider. Invitation acceptance opens SyncOS directly.</p>
        <div className="login-actions">
          <button className="primary-button" type="button" onClick={signIn}>Sign In</button>
          <Link className="operator-link" href="https://synccommsystems.com/partner.html">Become a Sync Partner</Link>
        </div>
      </section>
    </main>
  );
}
