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
      if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/test|scope|browser|release/.test(database.pathname)) throw new Error("Scope tests require an explicitly disposable local test database");
      const workOrderId = randomUUID();
      const fixtureDb = new Client({ connectionString: process.env.DATABASE_URL });
      await fixtureDb.connect();
      try {
        const clone = await fixtureDb.query(`INSERT INTO work_orders SELECT (jsonb_populate_record(NULL::work_orders, to_jsonb(w) || jsonb_build_object('id',$1::text,'work_order_number',$1::text,'work_order_name',$2::text,'title',$2::text,'planned_quantity',1000,'expected_units',1000,'completed_quantity',0,'approved_quantity',0,'billable_quantity',0))).* FROM work_orders w WHERE id=$3 AND tenant_id=$4`, [workOrderId, marker, manifest.records.workOrder.id, manifest.tenant.id]);
        expect(clone.rowCount).toBe(1);
      } finally { await fixtureDb.end(); }
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
      await page.getByRole("button", { name: "Create Production", exact: true }).click();
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
