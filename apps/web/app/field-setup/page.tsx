"use client";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { syncosFetch } from "../intelligence/api";
type Assignment = {
    id: string;
    organization_id: string;
    work_order_number: string;
    crew_id: string;
    crew_name: string;
    organization_name: string;
    foreman_worker_id: string;
    map_version_id?: string;
    map_document_id?: string;
};
export default function FieldSetup() {
    const [rows, setRows] = useState<Assignment[]>([]);
    const [selected, setSelected] = useState("");
    const [error, setError] = useState("");
    const [message, setMessage] = useState("");
    const [busy, setBusy] = useState(false);
    async function load() { setRows(await syncosFetch<Assignment[]>("syncfield/setup/assignments")); }
    useEffect(() => { void load().catch(e => setError(e.message)); }, []);
    async function upload(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const form = event.currentTarget;
        const values = new FormData(form);
        const assignment = rows.find(r => r.id === selected);
        if (!assignment)
            return;
        if (!assignment.foreman_worker_id) {
            setError("Assign a foreman to this crew first.");
            return;
        }
        const file = values.get('map') as File;
        if (!file?.size || file.size > 15 * 1024 * 1024) {
            setError("Choose a PDF no larger than 15 MB.");
            return;
        }
        setBusy(true);
        setError("");
        setMessage("");
        try {
            const content = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(new Error("Could not read PDF")); reader.readAsDataURL(file); });
            const root = `syncfield/organizations/${assignment.organization_id}`;
            const doc = assignment.map_document_id ? { id: assignment.map_document_id } : await syncosFetch<{
                id: string;
            }>(`${root}/work-order-versions/${assignment.id}/map-documents`, { method: 'POST', body: { name: String(values.get('name')), document_type: 'construction_map' } });
            const version = await syncosFetch<{
                id: string;
            }>(`${root}/map-documents/${doc.id}/versions`, { method: 'POST', body: { file_name: file.name, mime_type: 'application/pdf', content_base64: content, revision_label: String(values.get('revision')), source_name: String(values.get('source')) } });
            await syncosFetch(`${root}/map-versions/${version.id}/assign`, { method: 'POST', body: { crew_id: assignment.crew_id, foreman_worker_id: assignment.foreman_worker_id } });
            await load();
            form.reset();
            setSelected("");
            setMessage("Map assigned. The foreman can open it in SyncField; production still requires readiness approval and a completed daily safety meeting.");
        }
        catch (e) {
            setError((e as Error).message);
        }
        finally {
            setBusy(false);
        }
    }
    return <main className="workspace-page"><h1>Field map setup</h1><p>Assign customer PDFs to Sync crews and partner crews. A replacement creates a new revision and preserves the original.</p><Link href="/operations">Back to operations</Link>
 {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
 <section className="workspace-panel"><form onSubmit={upload}><fieldset disabled={busy}><label>Work assignment<select required value={selected} onChange={e => setSelected(e.target.value)}><option value="">Choose work and crew</option>{rows.map(r => <option key={r.id} value={r.id}>{r.organization_name} · {r.work_order_number} · {r.crew_name}</option>)}</select></label><label>Map name<input name="name" required/></label><label>Revision<input name="revision" required/></label><label>Source / customer<input name="source" required/></label><label>Customer map PDF<input name="map" type="file" accept="application/pdf" required/></label><button>{busy ? 'Assigning…' : 'Upload and assign map'}</button></fieldset></form></section>
 <section className="workspace-panel"><h2>Current maps</h2>{rows.map(r => <p key={r.id}>{r.work_order_number} · {r.crew_name} · {r.map_version_id ? 'Map assigned' : 'Needs map'}{r.map_version_id && <> · <Link href={`/syncfield/design-prep?organization_id=${r.organization_id}&map_version_id=${r.map_version_id}`}>Prepare planned spans</Link></>}</p>)}</section></main>;
}
