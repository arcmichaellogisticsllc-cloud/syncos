"use client";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { syncosFetch } from "../intelligence/api";
type Row = Record<string, any>;
export default function InternalWorkforcePage() {
    const [data, setData] = useState<Row>();
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState("");
    const [activation, setActivation] = useState("");
    async function load() { setData(await syncosFetch<Row>("internal-workforce")); }
    useEffect(() => { void load().catch(e => setError(e.message)); }, []);
    async function submit(event: FormEvent<HTMLFormElement>, path: (f: Row) => string, transform: (f: Row) => Row = f => f) {
        event.preventDefault();
        const form = event.currentTarget;
        const f = Object.fromEntries(new FormData(form).entries());
        setBusy(true);
        setError("");
        setMessage("");
        try {
            const result = await syncosFetch<Row>(path(f), { method: "POST", body: transform(f) });
            if (result.activation_path)
                setActivation(window.location.origin + result.activation_path);
            form.reset();
            await load();
            setMessage("Saved. Readiness is checked again before production can start.");
        }
        catch (e) {
            setError((e as Error).message);
        }
        finally {
            setBusy(false);
        }
    }
    const choices = (rows: Row[] = [], label = "name") => rows.map(r => <option key={r.id} value={r.id}>{r[label] || r.title || r.id}</option>);
    return <main className="workspace-page"><header className="workspace-header"><h1>Sync crews</h1><p>Manage your employees, field assignments and readiness approvals.</p><Link href="/operations">Back to operations</Link></header>
 {error && <p role="alert" className="error-state">{error}</p>}{message && <p role="status">{message}</p>}
 {!data ? <p>Loading workforce…</p> : <>
 <section className="workspace-panel"><h2>Invite a Sync employee</h2><p>Create an account and give the activation link directly to the employee. They choose their own password. No email is sent. Repeating this for an unactivated account replaces its previous link.</p><form onSubmit={e => submit(e, () => "internal-workforce/accounts")}><fieldset disabled={busy}><label>Full name<input name="display_name" required/></label><label>Email<input name="email" type="email" required/></label><button>Create activation link</button></fieldset></form>{activation && <label>Private activation link (expires in 24 hours)<input readOnly value={activation}/></label>}</section>
 <section className="workspace-panel"><h2>Create a crew</h2><form onSubmit={e => submit(e, () => "internal-workforce/crews")}><fieldset disabled={busy}><label>Sync operating organization<select name="organization_id" required><option value="">Select your company</option>{choices(data.organizations)}</select></label><label>Crew name<input name="name" required/></label><label>Work type<select name="crew_type">{['aerial', 'bore', 'trench', 'splicing', 'drop', 'restoration', 'inspection', 'project_management'].map(x => <option key={x}>{x}</option>)}</select></label><label>Required staffing<input name="target_staffing_level" type="number" min="1" max="100" defaultValue="4" required/></label><button>Create crew</button></fieldset></form></section>
 <section className="workspace-panel"><h2>Add a crew member</h2><form onSubmit={e => submit(e, f => `internal-workforce/crews/${f.crew_id}/members`)}><fieldset disabled={busy}><label>Crew<select name="crew_id" required><option value="">Choose crew</option>{choices(data.crews)}</select></label><label>First name<input name="first_name" required/></label><label>Last name<input name="last_name" required/></label><label>Role<select name="role"><option value="member">Crew member</option><option value="foreman">Foreman</option></select></label><label>Existing Sync account (required for foreman)<select name="user_id"><option value="">No account link</option>{choices(data.users, 'display_name')}</select></label><button>Add member</button></fieldset></form></section>
 <section className="workspace-panel"><h2>Assign work</h2><form onSubmit={e => submit(e, () => "internal-workforce/assignments")}><fieldset disabled={busy}><label>Crew<select name="crew_id" required><option value="">Choose crew</option>{choices(data.crews)}</select></label><label>Work order<select name="work_order_id" required><option value="">Choose work order</option>{choices(data.work_orders, 'work_order_number')}</select></label><label>Scope<textarea name="scope_summary" required/></label><label>Work area<input name="work_area" required/></label><label>Customer map/package reference<input name="map_reference" required/></label><button>Assign work</button></fieldset></form><p><Link href="/work-orders/new">Create a work order</Link> · <Link href="/field-setup">Upload and assign customer maps</Link></p></section>
 <section className="workspace-panel"><h2>Authorize field readiness</h2><p>Review the evidence package covering the named crew, current qualifications, insurance, inspected equipment, customer permission and safety plan. This approval does not replace the crew’s daily safety meeting or customer QC.</p><form onSubmit={e => submit(e, f => `internal-workforce/assignments/${f.assignment_id}/clearance`, f => ({ ...f, checklist: Object.fromEntries(data.required_checks.map((k: string) => [k, f[k] === 'on'])) }))}><fieldset disabled={busy}><label>Assignment<select name="assignment_id" required><option value="">Choose assignment</option>{data.assignments.map((r: Row) => <option key={r.id} value={r.id}>{r.work_order_number} — {r.crew_name}</option>)}</select></label><label>Decision<select name="status"><option value="authorized">Authorize</option><option value="held">Place on hold</option></select></label>{data.required_checks.map((k: string) => <label key={k}><input type="checkbox" name={k}/> {k.replaceAll('_', ' ')} verified</label>)}<label>Evidence package reference<input name="evidence_reference" required/></label><label>Valid through<input name="valid_until" type="date" required/></label><button>Record decision</button></fieldset></form></section>
 <section className="workspace-panel"><h2>Assignments</h2>{data.assignments.map((r: Row) => <p key={r.id}>{r.work_order_number} · {r.crew_name} · {r.clearance_status || 'Needs readiness review'} {r.valid_until ? `through ${String(r.valid_until).slice(0, 10)}` : ''}</p>)}</section>
 </>}</main>;
}
