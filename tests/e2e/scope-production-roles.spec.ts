import {acknowledgeFixtureJsa} from "./helpers/individual-safety";
import { Client } from "pg";
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { personas } from "./fixtures/personas";
import { installStoredSession } from "./helpers/auth";
import { apiGet, expectApiDenied } from "./helpers/api";
import { readE2EManifest } from "./helpers/manifest";

// Exercise the intended operators, not an administrator with every grant. Each
// journey creates its own production record against an isolated Work Order cloned
// from the eligible demo fixture. No canonical records or assignments are rewritten.
for (const actor of [personas.opsManager, personas.fieldSupervisor]) {
  test(`${actor.slug} creates, edits and submits production while approval and money remain forbidden`, async ({ browser, request }) => {
    const manifest = readE2EManifest();
    const context = await browser.newContext({ storageState: actor.storageState });
    const page = await context.newPage();
    await installStoredSession(page, actor.storageState);
    try {
      const marker = `Scope preservation ${actor.slug} ${Date.now()}`;
      const database = new URL(process.env.DATABASE_URL!);
      if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/test|scope|browser|release|^\/syncos_synthetic_[a-z0-9_]+$/.test(database.pathname)) throw new Error("Scope tests require an explicitly disposable local test database");
      const workOrderId = randomUUID();
      const projectId = randomUUID();
      const versionId = randomUUID(), jsaId = randomUUID();
      const fixtureDb = new Client({ connectionString: process.env.DATABASE_URL });
      await fixtureDb.connect();
      try {
        await fixtureDb.query(`INSERT INTO projects SELECT (jsonb_populate_record(NULL::projects,to_jsonb(p) || jsonb_build_object('id',$1::text,'name',$2::text,'status','ready_for_work','source_project_handoff_id',NULL))).* FROM projects p JOIN work_orders w ON w.project_id=p.id AND w.tenant_id=p.tenant_id WHERE w.id=$3 AND w.tenant_id=$4`,[projectId,marker,manifest.records.workOrder.id,manifest.tenant.id]);
        const clone = await fixtureDb.query(`INSERT INTO work_orders SELECT (jsonb_populate_record(NULL::work_orders, to_jsonb(w) || jsonb_build_object('id',$1::text,'work_order_number',$1::text,'work_order_name',$2::text,'title',$2::text,'project_id',$5::text,'planned_quantity',1000,'expected_units',1000,'completed_quantity',0,'approved_quantity',0,'billable_quantity',0))).* FROM work_orders w WHERE id=$3 AND tenant_id=$4`, [workOrderId, marker, manifest.records.workOrder.id, manifest.tenant.id, projectId]);
        expect(clone.rowCount).toBe(1);
        const t = manifest.tenant.id, foreman = manifest.personas["partner-foreman"].userId;
        const source = (await fixtureDb.query(`SELECT * FROM partner_work_order_versions WHERE tenant_id=$1 AND work_order_id=$2 AND deleted_at IS NULL ORDER BY version_number DESC LIMIT 1`,[t,manifest.records.workOrder.id])).rows[0];
        expect(source).toBeTruthy();
        const crewId=randomUUID();
        await fixtureDb.query(`INSERT INTO crews SELECT (jsonb_populate_record(NULL::crews,to_jsonb(c)||jsonb_build_object('id',$1::text,'name',$1::text,'target_staffing_level',(SELECT count(*) FROM partner_crew_memberships m JOIN workers w ON w.id=m.worker_id AND w.tenant_id=m.tenant_id AND w.status='active' AND w.deleted_at IS NULL WHERE m.tenant_id=c.tenant_id AND m.crew_id=c.id AND m.status='active' AND m.deleted_at IS NULL)))).* FROM crews c WHERE id=$2 AND tenant_id=$3`,[crewId,source.assigned_crew_id,t]);
        await fixtureDb.query(`INSERT INTO partner_crew_memberships SELECT (jsonb_populate_record(NULL::partner_crew_memberships,to_jsonb(m)||jsonb_build_object('id',gen_random_uuid(),'crew_id',$1::text,'primary_membership',false))).* FROM partner_crew_memberships m JOIN workers w ON w.id=m.worker_id AND w.tenant_id=m.tenant_id AND w.status='active' AND w.deleted_at IS NULL WHERE m.tenant_id=$2 AND m.crew_id=$3 AND m.status='active' AND m.deleted_at IS NULL`,[crewId,t,source.assigned_crew_id]);
        await fixtureDb.query('UPDATE work_orders SET assigned_crew_id=$2 WHERE id=$1',[workOrderId,crewId]);
        await fixtureDb.query(`INSERT INTO partner_work_order_versions SELECT (jsonb_populate_record(NULL::partner_work_order_versions,to_jsonb(v)||jsonb_build_object('id',$1::text,'project_id',$2::text,'work_order_id',$3::text,'work_order_number',$1::text,'status','active','assigned_crew_id',$5::text,'safety_scope_reviewed_at',now(),'pre_bore_required',false))).* FROM partner_work_order_versions v WHERE id=$4`,[versionId,projectId,workOrderId,source.id,crewId]);
        await fixtureDb.query(`INSERT INTO production_start_authorizations SELECT (jsonb_populate_record(NULL::production_start_authorizations,to_jsonb(a)||jsonb_build_object('id',$1::text,'project_id',$2::text,'work_order_id',$3::text,'work_order_version_id',$4::text,'authorization_status','authorized','current',true,'crew_id',$7::text))).* FROM production_start_authorizations a WHERE tenant_id=$5 AND work_order_version_id=$6 LIMIT 1`,[randomUUID(),projectId,workOrderId,versionId,t,source.id,crewId]);
        const worker=(await fixtureDb.query("SELECT worker_id FROM partner_crew_memberships WHERE tenant_id=$1 AND crew_id=$2 AND status='active' AND deleted_at IS NULL ORDER BY (membership_role='foreman') DESC LIMIT 1",[t,crewId])).rows[0];
        await fixtureDb.query(`INSERT INTO daily_jsas(id,tenant_id,project_id,work_order_id,work_order_version_id,organization_id,capacity_provider_id,crew_id,foreman_worker_id,foreman_user_id,work_date,status,work_location,meeting_completed_at,foreman_certified) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'2026-09-23','completed','Synthetic scope authorization',now(),true)`,[jsaId,t,projectId,workOrderId,versionId,source.organization_id,source.capacity_provider_id,crewId,worker.worker_id,foreman]);
        await fixtureDb.query(`INSERT INTO daily_jsa_participants(tenant_id,daily_jsa_id,worker_id,participation_status) SELECT tenant_id,$1,worker_id,'present' FROM partner_crew_memberships WHERE tenant_id=$2 AND crew_id=$3 AND status='active' AND deleted_at IS NULL`,[jsaId,t,crewId]);
      } finally { await fixtureDb.end(); }
      await acknowledgeFixtureJsa(request,manifest.tenant.id,jsaId);
      await page.goto("/production/new");
      await page.getByRole("combobox", { name: "Work Order", exact: true }).selectOption(workOrderId);
      await page.getByRole("combobox", { name: "Status", exact: true }).selectOption("draft");
      await page.getByRole("combobox", { name: "Production Type", exact: true }).selectOption("daily_production");
      await page.getByLabel("Production Date", { exact: true }).fill("2026-09-23");
      await page.getByLabel("Claimed Quantity", { exact: true }).fill("12");
      await page.getByLabel("Location Summary", { exact: true }).fill(marker);
      await page.getByRole("textbox", { name: "Production Notes", exact: true }).fill(`${marker}: daily reported work`);
      // The existing form explicitly records a tenant foreman as performer.
      // Use the seeded foreman's identity; never impersonate an administrator.
      await page.getByLabel("Foreman User ID", { exact: true }).fill(manifest.personas["partner-foreman"].userId);
      const createdResponse = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/production-records'));
      await page.getByRole("button", { name: "Create Production", exact: true }).click();
      const created = await createdResponse;
      expect(created.status(), await created.text()).toBeLessThan(400);
      await expect(page).toHaveURL(/\/production\/[0-9a-f-]{36}$/);
      const id = page.url().split("/").pop()!;
      const readRecord = () => apiGet<Record<string, unknown>>(request, actor.storageState, `/production-records/${id}`);
      const draft = await readRecord();
      expect(draft.status).toBe("draft");
      expect(Number(draft.claimed_quantity)).toBe(12);
      const creationEvents = await apiGet<Array<Record<string, unknown>>>(request, actor.storageState, `/production-records/${id}/timeline`);
      expect(creationEvents).toEqual(expect.arrayContaining([expect.objectContaining({ event_type: "production.created", actor_id: manifest.personas[actor.slug].userId })]));
      expect(draft.foreman_user_id).toBe(manifest.personas["partner-foreman"].userId);

      await page.getByRole("link", { name: "Edit Production", exact: true }).click();
      await expect(page.getByLabel("Claimed Quantity", { exact: true })).toHaveValue(/^12(?:\.0+)?$/);
      await page.getByLabel("Claimed Quantity", { exact: true }).fill("15");
      await page.getByRole("textbox", { name: "Production Notes", exact: true }).fill(`${marker}: verified quantity before submission`);
      await page.getByRole("button", { name: "Save Production", exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/production/${id}$`));
      const edited = await readRecord();
      expect(edited.status).toBe("draft");
      expect(Number(edited.claimed_quantity)).toBe(15);
      expect(edited.production_notes).toContain("verified quantity before submission");

      await page.getByRole("button", { name: "Submit", exact: true }).click();
      const dialog = page.locator("form.modal-panel");
      await dialog.getByLabel("Submit note", { exact: true }).fill(`${marker}: ready for independent review`);
      await dialog.getByRole("button", { name: "Submit", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      const submitted = await readRecord();
      expect(submitted.status).toBe("submitted");
      expect(submitted.qc_status).toBe("not_started");
      expect(submitted.submitted_by).toBe(manifest.personas[actor.slug].userId);
      expect(Number(submitted.claimed_quantity)).toBe(15);
      expect(Number(submitted.approved_quantity ?? 0)).toBe(0);
      expect(Number(submitted.billable_quantity ?? 0)).toBe(0);
      for (const name of ["Start Review", "Approve", "Reject", "Mark Billable", "Archive"]) {
        await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
      }
      await expectApiDenied(request, actor.storageState, "POST", `/production-records/${id}/approve`, { approved_quantity: 15, approval_note: "Must remain denied" });
      await expectApiDenied(request, actor.storageState, "POST", "/invoices", { invoice_number: marker });
      expect((await readRecord()).status).toBe("submitted");
    } finally {
      await context.close().catch(() => undefined);
    }
  });
}
