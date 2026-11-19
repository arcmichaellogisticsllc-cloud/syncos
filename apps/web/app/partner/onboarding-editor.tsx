"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { syncosFetch } from "../intelligence/api";

type RecordValue = Record<string, unknown>;
type Field = { name: string; label: string; type?: string; required?: boolean; options?: Array<[string, string]>; value?: unknown; pattern?: string; max?: number };
const field = (name: string, label: string, type = "text", required = false): Field => ({ name, label, type, required });
const select = (name: string, label: string, options: string[]): Field => ({ name, label, required: true, options: options.map(value => [value, value.replaceAll("_", " ")]) });
const file = (name: string, label: string, required = true): Field => ({ name, label, type: "file", required });
const four = (name: string, label: string, required = false): Field => ({ name, label, pattern: "[0-9]{4}", required });

async function evidenceUpload(file: File) {
  if (file.size > 5 * 1024 * 1024) throw new Error("Choose a file no larger than 5 MB.");
  if (!["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("Choose a PDF, JPEG, PNG, or WebP file.");
  const content_base64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(new Error("The file could not be read.")); reader.onload = () => resolve(String(reader.result).split(",")[1]); reader.readAsDataURL(file); });
  return { file_name: file.name, mime_type: file.type, size_bytes: file.size, content_base64 };
}

function ActionForm({ title, path, fields, initial = {}, method = "POST", onSaved, note, transform }: { title: string; path: string; fields: Field[]; initial?: RecordValue; method?: "POST" | "PATCH"; onSaved: () => Promise<void>; note?: string; transform?: (body: RecordValue) => RecordValue }) {
  const locked = useRef(false);
  const mutation = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (locked.current) return; locked.current = true; setBusy(true); setError(""); setSaved(false);
    const form = event.currentTarget;
    try {
      mutation.current ??= crypto.randomUUID();
      const values = new FormData(form); const body: RecordValue = { client_mutation_id: mutation.current };
      for (const f of fields) {
        const value = values.get(f.name);
        if (f.type === "file") { if (value instanceof File && value.size) body[f.name] = await evidenceUpload(value); }
        else if (f.type === "checkbox") body[f.name] = values.has(f.name);
        else if (typeof value === "string" && value.trim()) body[f.name] = f.type === "number" ? Number(value) : value.trim();
      }
      await syncosFetch(path, { method, body: transform ? transform(body) : body });
      setSaved(true);
      try { await onSaved(); } catch { setError("Saved, but the summary could not refresh. Reload this page before submitting again."); }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save. Your entries are retained; try again."); setTimeout(() => errorRef.current?.focus(), 0); }
    finally { locked.current = false; setBusy(false); }
  }
  return <details className="partner-panel"><summary style={{ minHeight: 44, cursor: "pointer", fontWeight: 700 }}>{title}</summary><form onSubmit={submit} onChange={() => { if (!busy && !saved) mutation.current = null; }} className="partner-stack" aria-label={title}>
    {note && <p>{note}</p>}{error && <p role="alert" tabIndex={-1} ref={errorRef}>{error}</p>}{saved && <p role="status">Saved. Sync review and readiness requirements still apply.</p>}
    <fieldset disabled={busy || saved} style={{ border: 0, padding: 0, margin: 0, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))", gap: 16 }}>
      {fields.map(f => <label key={f.name} style={{ display: "grid", gap: 6 }}>{f.label}{f.required ? " *" : ""}
        {f.options ? <select name={f.name} required={f.required} defaultValue={String(initial[f.name] ?? f.value ?? "")} style={{ minHeight: 44, maxWidth: "100%" }}><option value="">Choose…</option>{f.options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          : <input name={f.name} type={f.type ?? "text"} required={f.required} pattern={f.pattern} min={f.type === "number" ? 0 : undefined} step={f.type === "number" ? "any" : undefined} accept={f.type === "file" ? "application/pdf,image/jpeg,image/png,image/webp" : undefined} defaultValue={f.type === "file" || f.type === "checkbox" ? undefined : String(initial[f.name] ?? f.value ?? "")} defaultChecked={f.type === "checkbox" ? Boolean(initial[f.name]) : undefined} style={{ minHeight: 44, maxWidth: "100%", minWidth: 0 }} />}
      </label>)}
    </fieldset><button className="button primary" disabled={busy || saved} type="submit">{busy ? "Saving…" : saved ? "Saved" : title}</button>{saved && <button type="button" className="button secondary" onClick={() => { mutation.current = null; setSaved(false); }}>Enter another update</button>}
  </form></details>;
}

export function PartnerOnboardingEditor({ section, permissions, company, workers = [], crews = [], itemId, onSaved }: { section: string; permissions: string[]; company?: RecordValue; workers?: RecordValue[]; crews?: RecordValue[]; itemId?: string; onSaved: () => Promise<void> }) {
  const [workerId, setWorkerId] = useState(itemId ?? "");
  const [crewId, setCrewId] = useState(itemId ?? "");
  const can = (permission: string) => permissions.includes(permission);
  const worker = workers.find(row => row.id === workerId);
  const crew = crews.find(row => row.id === crewId);
  const workerOptions: Field = { name: "worker_id", label: "Worker", required: true, options: workers.map(row => [String(row.id), `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim()]) };
  const workerFields = [field("first_name", "First name", "text", true), field("last_name", "Last name", "text", true), field("worker_role", "Work role"), field("partner_worker_reference", "Your worker reference")];
  const crewFields = [field("name", "Crew name", "text", true), select("crew_type", "Crew type", ["aerial", "underground", "fiber_splicing", "mixed"]), field("target_staffing_level", "Target staffing level", "number", true)];
  const form = (permission: string, title: string, path: string, fields: Field[], extra: Partial<Parameters<typeof ActionForm>[0]> = {}) => can(permission) ? <ActionForm key={`${title}-${path}`} title={title} path={path} fields={fields} onSaved={onSaved} {...extra} /> : null;
  if (!["company", "compliance", "workers", "worker-detail", "crews", "crew-detail", "vehicles"].includes(section)) return null;
  return <section className="partner-stack" aria-label="Partner self-service setup">
    {["company", "vehicles"].includes(section) && can("partner_compliance.profile.read") && <SetupRequests type={section === "vehicles" ? "equipment" : "capability_territory"} canSubmit={can("partner_compliance.profile.submit")} />}
    <p>Maintain your company records here. Submitting information does not approve your company, make a crew ready, or authorize work to start.</p>
    {section === "company" && form("partner_compliance.profile.submit", "Save company profile", "partner-compliance/me/company-profile", [field("legal_business_name", "Legal business name", "text", true), field("dba_name", "Doing business as"), field("state_of_formation", "State of formation"), field("entity_type", "Business entity type"), field("primary_business_email", "Business email", "email"), field("primary_business_phone", "Business phone", "tel"), ...["primary", "compliance", "settlement"].flatMap(kind => [field(`${kind}_contact_name`, `${kind} contact name`), field(`${kind}_contact_email`, `${kind} contact email`, "email"), field(`${kind}_contact_phone`, `${kind} contact phone`, "tel")]), ...["line1", "city", "state", "postal_code"].map(key => field(`address_${key}`, `Business address ${key.replaceAll("_", " ")}`))], { initial: { ...company, ...Object.fromEntries(Object.entries((company?.business_address as RecordValue) ?? {}).map(([key, value]) => [`address_${key}`, value])) }, transform: body => { const result = { ...body, business_address: Object.fromEntries(Object.entries(body).filter(([key]) => key.startsWith("address_")).map(([key, value]) => [key.slice(8), value])) }; Object.keys(result).filter(key => key.startsWith("address_")).forEach(key => delete (result as RecordValue)[key]); return result; } })}
    {section === "compliance" && <>
      {form("partner_compliance.w9.submit", "Submit W-9", "partner-compliance/me/w9", [field("legal_name_on_w9", "Legal name on W-9", "text", true), field("dba_name_on_w9", "W-9 business name"), field("federal_tax_classification", "Federal tax classification", "text", true), select("tin_type", "Tax identifier type", ["ein", "ssn"]), four("tin_last_four", "Tax identifier last four digits only", true), field("signed_date", "Signed date", "date", true), file("evidence", "Signed W-9 file")], { note: "Upload the signed document privately. Enter only the last four identifier digits in the form. Files: PDF/JPEG/PNG/WebP, up to 5 MB." })}
      {form("partner_compliance.payment.submit", "Submit payment enrollment", "partner-compliance/me/payment-profile", [field("enrollment_contact_name", "Enrollment contact name", "text", true), field("enrollment_contact_email", "Enrollment contact email", "email", true), field("enrollment_contact_phone", "Enrollment contact phone", "tel"), field("bank_display_name", "Bank display name"), select("account_type", "Account type", ["business_checking", "checking", "savings", "other"]), four("account_last_four", "Account last four digits only"), file("ach_evidence", "ACH authorization document", false), file("bank_verification_evidence", "Bank verification document", false)], { note: "This submits enrollment evidence for review; it does not activate Passport or send a payment. Do not enter full bank account or routing numbers.", transform: body => ({ ...body, priority_passport_status: "pending", backup_ach_status: body.ach_evidence ? "submitted" : "not_provided" }) })}
      {form("partner_compliance.insurance.submit", "Submit insurance policy", "partner-compliance/me/insurance-policies", [select("policy_type", "Policy type", ["commercial_general_liability", "commercial_auto", "umbrella_excess", "workers_compensation", "employers_liability"]), field("carrier", "Carrier", "text", true), field("policy_reference", "Policy reference"), field("effective_date", "Effective date", "date", true), field("expiration_date", "Expiration date", "date", true), ...["occurrence_limit", "general_aggregate", "products_completed_operations_aggregate", "combined_single_auto_limit", "employer_liability_accident_limit", "employer_liability_disease_each_employee_limit", "employer_liability_disease_policy_limit"].map(name => field(`${name}_dollars`, `${name.replaceAll("_", " ")} ($)`, "number")), field("workers_compensation_statutory", "Workers compensation statutory coverage", "checkbox"), ...["owned_auto_covered", "hired_rented_auto_covered", "non_owned_auto_covered"].map(name => field(name, name.replaceAll("_", " "), "checkbox")), ...["additional_insured_status", "waiver_of_subrogation_status", "primary_non_contributory_status"].map(name => select(name, name.replaceAll("_", " "), ["not_provided", "submitted", "not_required"])), file("coi_evidence", "Certificate of insurance"), file("endorsement_evidence", "Endorsement document", false)], { note: "Submit each applicable policy type separately. Updating a policy returns it to Sync review.", transform: body => Object.fromEntries(Object.entries(body).map(([key, value]) => key.endsWith("_dollars") ? [key.replace(/_dollars$/, "_cents"), Math.round(Number(value) * 100)] : [key, value])) })}
    </>}
    {["workers", "worker-detail"].includes(section) && <>
      {form("partner_workforce.worker.create", "Add worker", "partner-workforce/me/workers", workerFields)}
      {workers.length > 0 && <label>Worker to maintain<select value={workerId} onChange={event => setWorkerId(event.target.value)} style={{ minHeight: 44 }}><option value="">Choose a worker…</option>{workerOptions.options?.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>}
      {worker && <>
        {form("partner_workforce.worker.update", "Save worker details", `partner-workforce/me/workers/${workerId}`, workerFields, { initial: worker, method: "PATCH" })}
        {form("partner_workforce.headshot.submit", "Submit worker photo", `partner-workforce/me/workers/${workerId}/headshots`, [file("image", "Worker photo"), { ...field("attestation_accepted", "I confirm this is a current, accurate photo of this worker", "checkbox"), required: true }], { note: "JPEG, PNG, or WebP; maximum 2 MB.", transform: body => ({ ...(body.image as RecordValue), attestation_accepted: body.attestation_accepted, client_mutation_id: body.client_mutation_id }) })}
        {form("partner_workforce.credential.submit", "Submit worker credential", `partner-workforce/me/workers/${workerId}/credentials`, [select("credential_type", "Credential", ["driver_license", "osha_10", "osha_30", "first_aid_cpr", "bucket_truck_aerial_lift", "fall_protection_harness", "pole_climbing", "bucket_rescue", "pole_top_rescue", "traffic_control", "background_check", "drug_screen", "customer_badge_or_clearance", "other"]), field("issuer", "Issuer"), field("issued_date", "Issue date", "date"), field("expiration_date", "Expiration date", "date"), file("evidence", "Credential document")])}
        {form("partner_workforce.worker.submit", "Submit worker for review", `partner-workforce/me/workers/${workerId}/submit`, [])}
      </>}
    </>}
    {["crews", "crew-detail"].includes(section) && <>
      {form("partner_workforce.crew.create", "Add crew", "partner-workforce/me/crews", crewFields)}
      {crews.length > 0 && <label>Crew to maintain<select value={crewId} onChange={event => setCrewId(event.target.value)} style={{ minHeight: 44 }}><option value="">Choose a crew…</option>{crews.map(row => <option key={String(row.id)} value={String(row.id)}>{String(row.name)}</option>)}</select></label>}
      {crew && <>
        {form("partner_workforce.crew.update", "Save crew details", `partner-workforce/me/crews/${crewId}`, crewFields, { initial: crew, method: "PATCH" })}
        {form("partner_workforce.membership.manage", "Add crew member", `partner-workforce/me/crews/${crewId}/members`, [workerOptions], { transform: body => ({ ...body, membership_role: "member" }) })}
        {form("partner_workforce.foreman.assign", "Assign crew foreman", `partner-workforce/me/crews/${crewId}/foreman`, [workerOptions])}
        {form("partner_workforce.foreman.assign", "Assign alternate foreman", `partner-workforce/me/crews/${crewId}/alternate-foreman`, [workerOptions])}
      </>}
    </>}
  </section>;
}

function SetupRequests({ type, canSubmit }: { type: "equipment" | "capability_territory"; canSubmit: boolean }) {
  const [rows, setRows] = useState<RecordValue[]>([]);
  const [error, setError] = useState("");
  async function refresh() { try { setRows(await syncosFetch<RecordValue[]>("partner-compliance/me/setup-requests")); setError(""); } catch (reason) { setError(reason instanceof Error ? reason.message : "Requests could not load"); } }
  useEffect(() => { void refresh(); }, []);
  return <section className="partner-panel"><h3>{type === "equipment" ? "Equipment declarations" : "Capabilities and territories"}</h3>
    <p>Tell Sync what you can provide. Sync must review this declaration and maintain the approved records separately. This does not assign equipment, establish vehicle custody, or authorize mobilization.</p>
    {error && <p role="alert">{error}</p>}
    {canSubmit && <ActionForm title={type === "equipment" ? "Send equipment declaration" : "Send capability declaration"} path="partner-compliance/me/setup-requests" fields={[field("description", type === "equipment" ? "Equipment type, name, ownership, inspection dates, and proposed crew" : "Work capabilities, crew capacity, territories, and availability", "text", true)]} transform={body => ({ ...body, request_type: type })} onSaved={refresh} />}
    <ul>{rows.filter(row => row.request_type === type).map(row => <li key={String(row.id)}><strong>{String(row.status).replaceAll("_", " ")}</strong> — {String(row.description)}{Boolean(row.response) && <p>Sync response: {String(row.response)}</p>}</li>)}</ul>
  </section>;
}
