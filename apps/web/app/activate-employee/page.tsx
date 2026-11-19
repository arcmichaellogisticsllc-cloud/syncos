"use client";
import { PermissionLink as Link } from "../access-control";
import { useEffect, useState, type FormEvent } from "react";
import { syncosFetch } from "../intelligence/api";
export default function ActivateEmployee() {
    const [token, setToken] = useState('');
    const [error, setError] = useState('');
    const [done, setDone] = useState(false);
    const [busy, setBusy] = useState(false);
    useEffect(() => { const invitation = new URLSearchParams(window.location.search).get('token') ?? ''; setToken(invitation); if (!invitation)
        setError('Open the activation link supplied by your Sync administrator.'); window.history.replaceState({}, '', window.location.pathname); }, []);
    async function activate(e: FormEvent<HTMLFormElement>) { e.preventDefault(); const values = new FormData(e.currentTarget); if (values.get('password') !== values.get('confirm')) {
        setError('Passwords must match.');
        return;
    } setBusy(true); setError(''); try {
        await syncosFetch('internal-workforce/activate', { method: 'POST', body: { token, password: values.get('password') } });
        setToken('');
        setDone(true);
    }
    catch (e) {
        setError((e as Error).message);
    }
    finally {
        setBusy(false);
    } }
    return <main className="workspace-page"><section className="workspace-panel"><h1>Activate your Sync account</h1>{error && <p role="alert">{error}</p>}{done ? <p>Your account is activated. <Link href="/login">Sign in</Link></p> : <form onSubmit={activate}><fieldset disabled={busy || !token}><label>Password (12–128 characters)<input type="password" autoComplete="new-password" name="password" minLength={12} maxLength={128} required/></label><label>Confirm password<input type="password" autoComplete="new-password" name="confirm" required/></label><button>{busy ? 'Activating…' : 'Activate account'}</button></fieldset></form>}</section></main>;
}
