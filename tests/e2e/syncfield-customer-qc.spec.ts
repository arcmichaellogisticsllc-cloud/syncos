import {approveFixtureCommercialTerms,verifyInvoicePackageLifecycle} from "./helpers/commercial-approval";
import {reviewFixtureQuantity} from "./helpers/quantity-review";
import { acknowledgeFixtureJsa, reviewFixtureSafetyScope, safetyActor } from "./helpers/individual-safety";
import crypto from "node:crypto";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { Client } from "pg";

type Seeded = {
  tenantA: string;
  tenantB: string;
  orgA: string;
  orgTenantB: string;
  crewA: string;
  foremanWorkerId: string;
  workOrderVersionId: string;
  internalToken: string;
  adminToken: string;
  foremanToken: string;
  tenantBToken: string;
  adminPermissions: string[];
  foremanPermissions: string[];
  internalPermissions: string[];
  mapDocumentId?: string;
  mapVersionId?: string;
  assignmentId?: string;
};

test.describe.serial("P10 Customer QC intake, correction relay, and reinspection", () => {
  let client: Client;
  let seeded: Seeded;
  let downstreamCountsBefore: Awaited<ReturnType<typeof downstreamCounts>>;
  let codes: Record<string, string>;
  let reportId: string;
  let submittedRecordId: string;
  let correctionId: string;

  test.beforeAll(async ({ request }) => {
    const connectionString = process.env.DATABASE_URL;
    const secret = process.env.AUTH_JWT_SECRET;
    if (!connectionString) throw new Error("DATABASE_URL is required");
    if (!secret) throw new Error("AUTH_JWT_SECRET is required");
    client = new Client({ connectionString });
    await client.connect();
    seeded = await seedSyncfieldFixture(client, secret);
    await authorizeMobilization(request, seeded);
    await reviewFixtureSafetyScope(request,seeded.tenantA,seeded.workOrderVersionId);
    await createAssignedMap(request, seeded);
    await completeJsa(request, seeded);
    downstreamCountsBefore = await downstreamCounts(client);
  });

  test.afterAll(async () => {
    await client?.end();
  });

  test("production gate, Work Order codes, and field UI hydrate without rates", async ({ page, request }) => {
    test.setTimeout(90_000);
    const missingJsa = await request.post(apiUrl(`/syncfield/foreman/production/today?work_date=${tomorrow()}`), { headers: auth(seeded.foremanToken), data: { client_mutation_id: crypto.randomUUID() } });
    expect(missingJsa.status()).toBe(400);

    const codeList = await apiJson(request, seeded.foremanToken, "GET", "/syncfield/foreman/production/codes");
    codes = Object.fromEntries(codeList.map((code: Record<string, unknown>) => [String(code.code), String(code.id)]));
    expect(codes.FIBER).toBeTruthy();
    expect(codeList[0]).not.toHaveProperty("amount");
    expect(codeList[0]).not.toHaveProperty("contractor_rate");

    const opened = await apiJson(request, seeded.foremanToken, "POST", "/syncfield/foreman/production/today", { work_date: today(), client_mutation_id: crypto.randomUUID(), weather: "Clear" });
    reportId = opened.id;
    expect(opened.status).toBe("draft");
    expect(opened.gate).toBeUndefined();

    await installSession(page, seeded.foremanToken, seeded.foremanPermissions);
    await page.setViewportSize({ width: 820, height: 1040 });
    await page.goto("/syncfield/production");
    await expect(page.locator("h2").filter({ hasText: "Production" })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("button", { name: "Asset" })).toBeVisible();
    await expect(page.locator("a.partner-button", { hasText: "Review & Submit" })).toBeVisible();
    await expect(page.getByText("Partner Rate")).toHaveCount(0);
    await expect(page.getByText("contractor_rate")).toHaveCount(0);

    const cross = await request.get(apiUrl("/syncfield/foreman/production/today"), { headers: auth(seeded.tenantBToken) });
    expect(cross.status()).toBeGreaterThanOrEqual(403);
  });

  test("browser offline queue persists and automatically replays Asset, Route, and Daily production exactly once", async ({ page, context, request }) => {
    await installSession(page, seeded.foremanToken, seeded.foremanPermissions);
    await page.setViewportSize({ width: 820, height: 1040 });
    await page.goto("/syncfield/production");
    await expect(page.locator("h2").filter({ hasText: "Production" })).toBeVisible({ timeout: 60_000 });

    const before = await productionCountsForReport(client, seeded.tenantA, reportId);
    await context.setOffline(true);
    await enterObservedProduction(page, "asset");
    await enterObservedProduction(page, "route");
    await enterObservedProduction(page, "daily");
    await expect(page.getByText("Offline — 3 changes saved locally")).toBeVisible();

    const queued = await queuedFieldMutations(page);
    expect(queued).toHaveLength(3);
    expect(queued.every((mutation) => mutation.scopeKey.includes(seeded.orgA))).toBe(true);
    expect(JSON.stringify(queued)).not.toMatch(/contractor_rate|storage_key|margin|driver_license/i);

    const duplicatePayload = queued[0].payload;
    await createProduction(request, seeded, duplicatePayload);

    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(page.locator("h2").filter({ hasText: "Production" })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("Synchronized", { exact: true }).first()).toBeVisible({ timeout: 15000 });

    const after = await productionCountsForReport(client, seeded.tenantA, reportId);
    expect(after.records).toBe(before.records + 3);
    expect(after.annotations).toBe(before.annotations + 2);
    await expect.poll(async () => (await queuedFieldMutations(page)).filter((mutation) => mutation.status !== "SYNCED").length).toBe(0);

    await page.goto("/syncfield/production/review");
    await expect(page.getByText("Unsynced Mutations")).toBeVisible();
    await expect(page.getByText("0").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Submit Daily Production" })).toBeEnabled();
  });

  test("offline replay revalidates lost production-start authorization and keeps failed work traceable", async ({ page, context }) => {
    await installSession(page, seeded.foremanToken, seeded.foremanPermissions);
    await page.goto("/syncfield/production");
    await expect(page.locator("h2").filter({ hasText: "Production" })).toBeVisible({ timeout: 60_000 });
    const before = await productionCountsForReport(client, seeded.tenantA, reportId);
    await context.setOffline(true);
    await enterObservedProduction(page, "asset");
    await expect(page.getByText("Offline — 1 change saved locally")).toBeVisible();

    await client.query("UPDATE production_start_authorizations SET authorization_status = 'held' WHERE tenant_id = $1 AND current = true", [seeded.tenantA]);
    try {
      await context.setOffline(false);
      await page.evaluate(() => window.dispatchEvent(new Event("online")));
      await expect(page.getByText("Sync Failed")).toBeVisible({ timeout: 15000 });
      await expect(page.getByText("Production start is no longer authorized. Local changes were not applied.")).toBeVisible();
      const after = await productionCountsForReport(client, seeded.tenantA, reportId);
      expect(after).toEqual(before);
      const pending = await queuedFieldMutations(page);
      expect(pending.filter((mutation) => mutation.status === "FAILED")).toHaveLength(1);
    } finally {
      await client.query("UPDATE production_start_authorizations SET authorization_status = 'authorized' WHERE tenant_id = $1 AND current = true", [seeded.tenantA]);
    }
  });

  test("Asset, Route, and Daily production create authoritative records with subordinate annotations and idempotency", async ({ request }) => {
    const assetMutation = crypto.randomUUID();
    const asset = await createProduction(request, seeded, { client_mutation_id: assetMutation, production_code_id: codes.TRANSFER, location_type: "asset", asset_type: "pole", asset_identifier: "Pole 12301", map_page: 1, x_ratio: 0.4, y_ratio: 0.5, reported_quantity: 1, status: "complete" });
    submittedRecordId = asset.id;
    const assetRetry = await createProduction(request, seeded, { client_mutation_id: assetMutation, production_code_id: codes.TRANSFER, location_type: "asset", asset_type: "pole", asset_identifier: "Pole 12301", map_page: 1, x_ratio: 0.4, y_ratio: 0.5, reported_quantity: 1, status: "complete" });
    expect(assetRetry.id).toBe(asset.id);

    await createProduction(request, seeded, { client_mutation_id: crypto.randomUUID(), production_code_id: codes.FIBER, location_type: "route", from_asset_identifier: "Pole 12301", to_asset_identifier: "Pole 12312", map_page: 1, start_x_ratio: 0.4, start_y_ratio: 0.5, end_x_ratio: 0.6, end_y_ratio: 0.55, reported_quantity: 141, status: "partial" });
    await createProduction(request, seeded, { client_mutation_id: crypto.randomUUID(), production_code_id: codes.LABOR, location_type: "daily", reported_quantity: 8, status: "complete", notes: "Crew labor hours" });

    const detail = await apiJson(request, seeded.foremanToken, "GET", "/syncfield/foreman/production/today");
    expect(detail.records).toHaveLength(6);
    expect(detail.annotations).toHaveLength(4);
    expect(detail.totals.record_count).toBe(6);
    expect(detail.totals.status_counts.complete).toBe(5);
    expect(detail.totals.by_code.find((row: Record<string, unknown>) => row.code === "FIBER").quantity).toBe(282);

    const badCoordinate = await request.post(apiUrl("/syncfield/foreman/production/records"), {
      headers: auth(seeded.foremanToken),
      data: { client_mutation_id: crypto.randomUUID(), production_code_id: codes.TRANSFER, location_type: "asset", asset_type: "pole", asset_identifier: "Bad", map_page: 1, x_ratio: 1.4, y_ratio: 0.5, reported_quantity: 1, status: "complete" },
    });
    expect(badCoordinate.status()).toBe(400);
  });

  test("submission creates immutable revision snapshot and blocks ordinary edits without QC or finance", async ({ page, request }) => {
    const beforeReadiness = await apiJson(request, seeded.foremanToken, "GET", "/partner-mobilization/foreman/readiness");
    const submitted = await apiJson(request, seeded.foremanToken, "POST", "/syncfield/foreman/production/review-day/submit", { work_date: today(), client_mutation_id: crypto.randomUUID(), general_notes: "Submitted by Foreman." });
    expect(submitted.status).toBe("submitted");
    expect(submitted.records.every((record: Record<string, unknown>) => record.locked === true)).toBe(true);
    const revision = await client.query("SELECT snapshot_json FROM daily_production_report_revisions WHERE tenant_id = $1 AND daily_report_id = $2", [seeded.tenantA, submitted.id]);
    expect(revision.rowCount).toBe(1);
    expect(revision.rows[0].snapshot_json.records).toHaveLength(6);

    const edit = await request.post(apiUrl(`/syncfield/foreman/production/records/${submittedRecordId}`), {
      headers: auth(seeded.foremanToken),
      data: { client_mutation_id: crypto.randomUUID(), reported_quantity: 2 },
    });
    expect(edit.status()).toBe(400);
    const addAfterSubmit = await request.post(apiUrl("/syncfield/foreman/production/records"), {
      headers: auth(seeded.foremanToken),
      data: { client_mutation_id: crypto.randomUUID(), production_code_id: codes.TRANSFER, location_type: "asset", asset_type: "pole", asset_identifier: "Pole 999", map_page: 1, x_ratio: 0.1, y_ratio: 0.1, reported_quantity: 1, status: "complete" },
    });
    expect(addAfterSubmit.status()).toBe(400);
    const afterReadiness = await apiJson(request, seeded.foremanToken, "GET", "/partner-mobilization/foreman/readiness");
    expect(afterReadiness.overall_status).toBe(beforeReadiness.overall_status);
    expect(await downstreamCounts(client)).toEqual({ ...downstreamCountsBefore, production: downstreamCountsBefore.production + 6 });

    await installSession(page, seeded.foremanToken, seeded.foremanPermissions);
    await page.setViewportSize({ width: 390, height: 860 });
    await page.goto("/syncfield/production/review");
    await expect(page.getByRole("heading", { name: "Review & Submit" })).toBeVisible();
    await expect(page.getByText("Submitted", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("submitted", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Submit Daily Production" })).toBeDisabled();
    await expect(page.getByText("Customer QC")).toHaveCount(0);
    await expect(page.getByText("accepted quantity")).toHaveCount(0);
  });

  test("field evidence is scoped, idempotent, readable by QC and rejects disguised files; incidents persist", async ({ request, page }) => {
    const evidenceBody={daily_report_id:reportId,production_record_id:submittedRecordId,file_name:"pilot-evidence.png",mime_type:"image/png",content_base64:"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",description:"Pole identifier before correction",client_mutation_id:crypto.randomUUID()};
    const evidence=await apiJson(request,seeded.foremanToken,"POST","/syncfield/foreman/evidence",evidenceBody);
    const retry=await apiJson(request,seeded.foremanToken,"POST","/syncfield/foreman/evidence",evidenceBody); expect(retry.id).toBe(evidence.id);
    const invalid=await request.post(apiUrl("/syncfield/foreman/evidence"),{headers:auth(seeded.foremanToken),data:{...evidenceBody,content_base64:Buffer.from("<script>alert(1)</script>").toString("base64"),client_mutation_id:crypto.randomUUID()}});expect(invalid.status()).toBe(400);
    const otherTenant=await request.get(apiUrl(`/syncfield/customer-qc/reports/${reportId}`),{headers:auth(seeded.tenantBToken)});expect([403,404]).toContain(otherTenant.status());
    const denied=await request.get(apiUrl(`/syncfield/customer-qc/evidence/${evidence.id}`),{headers:auth(seeded.adminToken)});expect(denied.status()).toBe(403);
    const file=await apiJson(request,seeded.internalToken,"GET",`/syncfield/customer-qc/evidence/${evidence.id}`);expect(file.content_base64).toBe(evidenceBody.content_base64);expect(file).not.toHaveProperty("storage_key");
    const incidentBody={assignment_id:seeded.assignmentId,occurred_at:new Date().toISOString(),incident_type:"near_miss",location:"Pole 12301",description:"Training near miss",immediate_action:"Stopped work and notified supervisor",client_mutation_id:crypto.randomUUID()};
    const incident=await apiJson(request,seeded.foremanToken,"POST","/syncfield/foreman/incidents",incidentBody);
    expect((await apiJson(request,seeded.foremanToken,"POST","/syncfield/foreman/incidents",incidentBody)).id).toBe(incident.id);
    await installSession(page,seeded.internalToken,seeded.internalPermissions);await page.goto("/customer-qc");await page.getByLabel("Submitted daily report").selectOption(reportId);await expect(page.getByRole("button",{name:"Download pilot-evidence.png"})).toBeVisible();await expect(page.getByText("Pole 12301: Training near miss")).toBeVisible();
  });

  test("Customer QC intake preserves reported quantities and creates Partner-safe correction history without finance", async ({ request, page }) => {
    const queue = await apiJson(request, seeded.internalToken, "GET", "/syncfield/customer-qc/completeness-queue");
    expect(queue.find((row: Record<string, unknown>) => row.id === reportId)).toBeTruthy();

    const partnerComplete = await request.post(apiUrl(`/syncfield/customer-qc/reports/${reportId}/complete`), {
      headers: auth(seeded.adminToken),
      data: { client_mutation_id: crypto.randomUUID() },
    });
    expect(partnerComplete.status()).toBe(403);

    await installSession(page,seeded.internalToken,seeded.internalPermissions);
    await page.goto("/customer-qc");await page.getByLabel("Submitted daily report").selectOption(reportId);
    await page.getByRole("button",{name:"Confirm completeness"}).click();await expect(page.getByRole("status").filter({hasText:"Completeness confirmed"})).toBeVisible();
    await page.getByLabel("Customer source reference").fill("customer-email-arl019");await page.getByRole("button",{name:"Open customer inspection cycle"}).click();await expect(page.getByRole("status").filter({hasText:"inspection cycle opened"})).toBeVisible();
    const inspection=await apiJson(request,seeded.internalToken,"GET",`/syncfield/customer-qc/reports/${reportId}`);
    expect(inspection.completeness_status).toBe("complete");expect(inspection).toHaveProperty("customer_qc_outcome");
    const cycle=inspection.cycles[0];expect(cycle.status).toBe("awaiting_customer");expect(cycle.qc_authority_organization_id).toBeTruthy();

    const fiber = await client.query(
      `
      SELECT pr.id, pr.quantity_submitted
      FROM production_records pr
      JOIN syncfield_production_codes pc ON pc.tenant_id = pr.tenant_id AND pc.id = pr.syncfield_production_code_id
      WHERE pr.tenant_id = $1 AND pr.daily_production_report_id = $2 AND pc.code = 'FIBER'
      ORDER BY pr.created_at
      LIMIT 1
      `,
      [seeded.tenantA, reportId],
    );
    expect(Number(fiber.rows[0].quantity_submitted)).toBe(141);

    await reviewFixtureQuantity(request,seeded.internalToken,fiber.rows[0].id);
    const partial = await apiJson(request, seeded.internalToken, "POST", `/syncfield/customer-qc/cycles/${cycle.id}/decisions`, {
      production_record_id: fiber.rows[0].id,
      decision: "partially_accepted",
      customer_accepted_quantity: 132,
      customer_reason_code: "customer_measured_difference",
      customer_comments: "Customer measurement accepted 132 LF.",
      client_mutation_id: crypto.randomUUID(),
    });
    expect(partial.reported_quantity).toBe(141);
    expect(partial.customer_accepted_quantity).toBe(132);

    const correction = await apiJson(request, seeded.internalToken, "POST", `/syncfield/customer-qc/cycles/${cycle.id}/decisions`, {
      production_record_id: submittedRecordId,
      decision: "correction_required",
      customer_reason_code: "asset_identifier",
      customer_comments: "Customer requires corrected pole identifier.",
      correction_type: "asset_identifier",
      allowed_fields: ["asset_identifier", "notes"],
      partner_safe_instructions: "Correct the pole identifier and resubmit for Customer reinspection.",
      client_mutation_id: crypto.randomUUID(),
    });
    correctionId = correction.correction.id;
    expect(correction.decision).toBe("correction_required");
    expect(correction.correction.status).toBe("open");

    const unchanged = await client.query("SELECT quantity_submitted FROM production_records WHERE tenant_id = $1 AND id = $2", [seeded.tenantA, fiber.rows[0].id]);
    expect(Number(unchanged.rows[0].quantity_submitted)).toBe(141);
    const report = await client.query("SELECT customer_qc_outcome FROM daily_production_reports WHERE tenant_id = $1 AND id = $2", [seeded.tenantA, reportId]);
    expect(report.rows[0].customer_qc_outcome).toBe("customer_correction_required");

    const adminView = await apiJson(request, seeded.adminToken, "GET", "/syncfield/partner/customer-qc");
    expect(JSON.stringify(adminView)).toContain("customer_correction_required");
    expect(JSON.stringify(adminView)).toContain("Correct the pole identifier");
    expect(JSON.stringify(adminView)).not.toMatch(/storage_key|contractor_rate|margin|internal_note/i);

    const foremanView = await apiJson(request, seeded.foremanToken, "GET", "/syncfield/foreman/customer-qc");
    expect(JSON.stringify(foremanView)).toContain(correctionId);

    await installSession(page, seeded.adminToken, seeded.adminPermissions);
    await page.goto("/partner/customer-qc");
    await expect(page.locator("h2").filter({ hasText: "QC & Corrections" })).toBeVisible();
    await expect(page.getByText("Customer Correction Required", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Correction Required", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: /Asset Identifier/ }).first()).toBeVisible();
    await expect(page.getByText("customer_correction_required", { exact: true })).toHaveCount(0);
    await expect(page.getByText("correction_required", { exact: true })).toHaveCount(0);
    await expect(page.getByText("asset_identifier", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Customer Accepted", { exact: false })).toHaveCount(0);
    await expect(page.getByText("approved by Sync", { exact: false })).toHaveCount(0);

    expect(await downstreamCounts(client)).toEqual({ ...downstreamCountsBefore, production: downstreamCountsBefore.production + 6 });
  });

  test("prime policy derives deadlines from original receipt and preserves scheduled dates across revisions", async ({request,page}) => {
    const before=await apiJson(request,seeded.internalToken,"GET",`/prime-correction-policies/reports/${reportId}`);
    expect(before.can_manage).toBe(false);expect(before.corrections.find((c:any)=>c.id===correctionId).deadline_status).toBe('needs_policy_review');
    const manager=await safetyActor(seeded.tenantA,'qc_manager');
    const role=(await client.query("SELECT id FROM roles WHERE tenant_id=$1 AND system_key='qc_manager'",[seeded.tenantA])).rows[0].id;
    await grantPermissions(client,seeded.tenantA,role,seeded.internalPermissions);
    const endpoint=`/prime-correction-policies/work-orders/${seeded.workOrderVersionId}`;
    const policy={duration:1,duration_unit:'business_days',trigger_event:'customer_received',time_zone:'America/New_York',holidays:['2026-09-07'],effective_from:'2026-01-01T00:00:00Z',source_reference:'SYNTHETIC approved prime policy for deadline acceptance only',verified:true,client_mutation_id:crypto.randomUUID()};
    expect((await request.post(apiUrl(endpoint),{headers:auth(seeded.internalToken),data:policy})).status()).toBe(403);
    expect((await request.post(apiUrl(endpoint),{headers:auth(seeded.foremanToken),data:policy})).status()).toBe(403);
    expect((await request.get(apiUrl(`/prime-correction-policies/reports/${reportId}`),{headers:auth(seeded.foremanToken)})).status()).toBe(403);
    const saved=await apiJson(request,manager,'POST',endpoint,policy);
    expect((await apiJson(request,manager,'POST',endpoint,policy)).id).toBe(saved.id);
    expect((await request.post(apiUrl(endpoint),{headers:auth(manager),data:{...policy,duration:2}})).status()).toBe(400);
    const schedule=`/prime-correction-policies/corrections/${correctionId}/schedule`;
    const missing=await apiJson(request,seeded.internalToken,'POST',schedule,{});expect(missing.deadline_status).toBe('needs_received_time');
    const received={customer_received_at:'2026-09-04T15:00:00-04:00',verified:true};
    const scheduled=await apiJson(request,seeded.internalToken,'POST',schedule,received);
    expect(scheduled.due_at).toBe('2026-09-08T19:00:00.000Z');expect(scheduled.responsible_user_id).toBeTruthy();
    await apiJson(request,manager,'POST',endpoint,{...policy,duration:5,client_mutation_id:crypto.randomUUID()});
    expect((await apiJson(request,seeded.internalToken,'POST',schedule,received)).due_at).toBe(scheduled.due_at);
    expect((await request.post(apiUrl(schedule),{headers:auth(seeded.internalToken),data:{customer_received_at:'2026-09-05T15:00:00-04:00',verified:true}})).status()).toBe(400);
    await installSession(page,seeded.internalToken,seeded.internalPermissions);await page.goto('/customer-qc');
    await page.getByLabel('Submitted daily report').selectOption(reportId);
    await expect(page.getByRole('heading',{name:'Correction deadlines and ownership'})).toBeVisible();
    await expect(page.getByText('Approve a prime correction policy',{exact:true})).toHaveCount(0);
    await expect(page.getByText(/America\/New_York/).first()).toBeVisible();
    await installSession(page,manager,seeded.internalPermissions);await page.goto('/customer-qc');await page.getByLabel('Submitted daily report').selectOption(reportId);
    await page.getByText('Approve a prime correction policy',{exact:true}).click();
    const form=page.locator('form').filter({has:page.getByRole('button',{name:'Approve correction policy',exact:true})});
    await form.getByLabel('Duration',{exact:true}).fill('2');
    await form.getByLabel('Policy time zone').fill('America/New_York');
    await form.getByLabel('Effective from, with UTC offset').fill('2026-01-01T00:00:00Z');
    await form.getByLabel('Governing policy and approval reference').fill('SYNTHETIC UI-approved policy; not commercial terms');
    await form.getByRole('checkbox').check();await form.getByRole('button',{name:'Approve correction policy',exact:true}).click();
    await expect(page.getByRole('status').filter({hasText:'Saved. Review the deadline status'})).toBeVisible();
    expect((await apiJson(request,seeded.internalToken,'GET',`/prime-correction-policies/reports/${reportId}`)).policies).toHaveLength(3);

  });

  test("Partner correction resubmission creates Revision 2 and Customer reinspection cycle without reopening Revision 1", async ({ request, page }) => {
    const forbidden = await request.post(apiUrl(`/syncfield/foreman/corrections/${correctionId}/resubmit`), {
      headers: auth(seeded.adminToken),
      data: { asset_identifier: "Pole 12301A", client_mutation_id: crypto.randomUUID() },
    });
    expect(forbidden.status()).toBe(403);

    const unrelated = await request.post(apiUrl(`/syncfield/foreman/corrections/${correctionId}/resubmit`), {
      headers: auth(seeded.foremanToken),
      data: { reported_quantity: 2, client_mutation_id: crypto.randomUUID() },
    });
    expect(unrelated.status()).toBe(400);

    await installSession(page, seeded.foremanToken, seeded.foremanPermissions);
    await page.goto("/syncfield/corrections");
    const editor = page.getByRole("form", { name: "Correction editor" });
    await expect(editor.getByLabel("Corrected asset identifier")).toBeVisible();
    await expect(editor.getByLabel("Corrected quantity")).toHaveCount(0);
    await editor.getByLabel("Corrected asset identifier").fill("Pole 12301A");
    await editor.getByLabel("Correction notes").fill("Customer correction applied.");
    await editor.getByRole("button", { name: "Review correction", exact: true }).click();
    const beforeSend = await client.query("SELECT revision_number FROM daily_production_reports WHERE tenant_id=$1 AND id=$2", [seeded.tenantA, reportId]);
    expect(beforeSend.rows[0].revision_number).toBe(1);
    const submission = page.waitForResponse((response) => response.url().includes(`/corrections/${correctionId}/resubmit`) && response.request().method() === "POST");
    await editor.getByRole("button", { name: "Resubmit Correction", exact: true }).click();
    const response = await submission;
    expect(response.ok()).toBe(true);
    const correctionPayload = response.request().postDataJSON();
    const resubmitted = await response.json();
    await expect(page.getByText("Correction submitted for customer reinspection.", { exact: false })).toBeVisible();
    // A lost response must be safely retryable without a second report revision or QC cycle.
    const replay = await apiJson(request, seeded.foremanToken, "POST", `/syncfield/foreman/corrections/${correctionId}/resubmit`, correctionPayload);
    expect(replay.id).toBe(resubmitted.id);
    const wrongCorrection = await request.post(apiUrl(`/syncfield/foreman/corrections/${crypto.randomUUID()}/resubmit`), { headers: auth(seeded.foremanToken), data: correctionPayload });
    expect(wrongCorrection.status()).toBe(404);
    const changedMutation = await request.post(apiUrl(`/syncfield/foreman/corrections/${correctionId}/resubmit`), { headers: auth(seeded.foremanToken), data: { ...correctionPayload, client_mutation_id: crypto.randomUUID() } });
    expect(changedMutation.status()).toBe(400);
    expect(resubmitted.status).toBe("awaiting_customer_reinspection");

    const revisions = await client.query("SELECT revision_number, reason, snapshot_json FROM daily_production_report_revisions WHERE tenant_id = $1 AND daily_report_id = $2 ORDER BY revision_number", [seeded.tenantA, reportId]);
    expect(revisions.rowCount).toBe(2);
    expect(revisions.rows[0].revision_number).toBe(1);
    expect(revisions.rows[1].revision_number).toBe(2);
    expect(revisions.rows[1].reason).toBe("customer_correction_resubmitted");
    expect(revisions.rows[1].snapshot_json.proposed_correction.asset_identifier).toBe("Pole 12301A");

    const cycleCount = await client.query("SELECT count(*)::int AS count FROM customer_qc_cycles WHERE tenant_id = $1 AND daily_report_id = $2", [seeded.tenantA, reportId]);
    expect(cycleCount.rows[0].count).toBe(2);
    const originalRecord = await client.query("SELECT quantity_submitted FROM production_records WHERE tenant_id = $1 AND id = $2", [seeded.tenantA, submittedRecordId]);
    expect(Number(originalRecord.rows[0].quantity_submitted)).toBe(1);

    await installSession(page, seeded.foremanToken, seeded.foremanPermissions);
    await page.goto("/partner/corrections");
    await expect(page.locator("h2").filter({ hasText: "Corrections" })).toBeVisible();
    await expect(page.getByText("Awaiting Customer Reinspection", { exact: true })).toBeVisible();
    await expect(page.getByText("awaiting_customer_reinspection", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Partner Rate")).toHaveCount(0);
    await expect(page.getByText("storage_key")).toHaveCount(0);
    expect(await downstreamCounts(client)).toEqual({ ...downstreamCountsBefore, production: downstreamCountsBefore.production + 6 });
  });

  test("submitted-report offline conflict does not reopen the report or create production", async ({ page, context }) => {
    await installSession(page, seeded.foremanToken, seeded.foremanPermissions);
    await page.goto("/syncfield/production");
    await expect(page.locator("h2").filter({ hasText: "Production" })).toBeVisible({ timeout: 60_000 });
    const before = await productionCountsForReport(client, seeded.tenantA, reportId);
    await context.setOffline(true);
    await enterObservedProduction(page, "daily");
    await expect(page.getByText("Offline — 1 change saved locally")).toBeVisible();
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(page.getByText("Sync Failed")).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("REPORT ALREADY SUBMITTED - LOCAL CHANGES NOT APPLIED")).toBeVisible();
    expect(await productionCountsForReport(client, seeded.tenantA, reportId)).toEqual(before);
  });

  test("Partner-local queue isolation hides pending field work after account switch", async ({ page, context }) => {
    await installSession(page, seeded.foremanToken, seeded.foremanPermissions);
    await page.goto("/syncfield/production");
    await expect(page.locator("h2").filter({ hasText: "Production" })).toBeVisible({ timeout: 30_000 });
    await context.setOffline(true);
    await enterObservedProduction(page, "asset");
    await expect(page.getByText("Offline — 1 change saved locally")).toBeVisible();
    await installSession(page, seeded.tenantBToken, seeded.adminPermissions);
    await context.setOffline(false);
    await page.goto("/syncfield/production");
    await expect(page.getByText("Offline — 1 change saved locally")).toHaveCount(0);
  });

  test("Partner Admin receives safe read-only report and duplicate submitted work requires traceability", async ({ request, page }) => {
    await installSession(page, seeded.adminToken, seeded.adminPermissions);
    await page.goto("/partner/production");
    await expect(page.locator("h2").filter({ hasText: "Production" })).toBeVisible();
    await expect(page.getByText("Submitted", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("submitted", { exact: true })).toHaveCount(0);
    await expect(page.getByText("contractor_rate")).toHaveCount(0);
    await expect(page.getByText("storage_key")).toHaveCount(0);

    const workDate = tomorrow();
    await completeJsa(request, seeded, workDate);
    await apiJson(request, seeded.foremanToken, "POST", "/syncfield/foreman/production/today", { work_date: workDate, client_mutation_id: crypto.randomUUID() });
    const duplicate = await request.post(apiUrl("/syncfield/foreman/production/records"), {
      headers: auth(seeded.foremanToken),
      data: { work_date: workDate, client_mutation_id: crypto.randomUUID(), production_code_id: codes.TRANSFER, location_type: "asset", asset_type: "pole", asset_identifier: "Pole 12301", map_page: 1, x_ratio: 0.3, y_ratio: 0.3, reported_quantity: 1, status: "rework" },
    });
    expect(duplicate.status()).toBe(400);
    const traced = await createProduction(request, seeded, { work_date: workDate, client_mutation_id: crypto.randomUUID(), production_code_id: codes.TRANSFER, location_type: "asset", asset_type: "pole", asset_identifier: "Pole 12301", map_page: 1, x_ratio: 0.3, y_ratio: 0.3, reported_quantity: 1, status: "rework", duplicate_reason: "Customer requested additional pass." });
    expect(traced.duplicate_reason).toBe("Customer requested additional pass.");
  });
  test("extended correction keeps authorized code, map and evidence in immutable revision and rejects unrelated references", async ({request}) => {
    const detail=await apiJson(request,seeded.internalToken,"GET",`/syncfield/customer-qc/reports/${reportId}`);
    const created=await apiJson(request,seeded.internalToken,"POST",`/syncfield/customer-qc/cycles/${detail.cycles[0].id}/decisions`,{production_record_id:submittedRecordId,decision:"correction_required",customer_reason_code:"evidence_review",customer_comments:"Provide the corrected map marker and supporting image",allowed_fields:["production_code_id","map_location","evidence"],client_mutation_id:crypto.randomUUID()});
    const id=created.correction.id;
    const options=await apiJson(request,seeded.foremanToken,"GET",`/syncfield/foreman/corrections/${id}/options`);expect(options.codes.some((code:any)=>code.id===codes.TRANSFER)).toBe(true);expect(options.codes.some((code:any)=>code.id===codes.LABOR)).toBe(false);
    for(const invalid of [{production_code_id:codes.LABOR},{map_location:{page:1,x_ratio:2,y_ratio:0.5}},{evidence:[crypto.randomUUID()]}]){
      const denied=await request.post(apiUrl(`/syncfield/foreman/corrections/${id}/resubmit`),{headers:auth(seeded.foremanToken),data:{...invalid,client_mutation_id:crypto.randomUUID()}});expect(denied.status()).toBe(400);
    }
    const proposed={production_code_id:codes.TRANSFER,map_location:{page:1,x_ratio:0.25,y_ratio:0.75},evidence:[options.evidence[0].id]};
    await apiJson(request,seeded.foremanToken,"POST",`/syncfield/foreman/corrections/${id}/resubmit`,{...proposed,client_mutation_id:crypto.randomUUID()});
    const revision=await client.query("SELECT snapshot_json FROM daily_production_report_revisions WHERE tenant_id=$1 AND daily_report_id=$2 ORDER BY revision_number DESC LIMIT 1",[seeded.tenantA,reportId]);expect(revision.rows[0].snapshot_json.proposed_correction).toMatchObject(proposed);
    const original=await client.query("SELECT syncfield_production_code_id,quantity_submitted FROM production_records WHERE tenant_id=$1 AND id=$2",[seeded.tenantA,submittedRecordId]);expect(original.rows[0].syncfield_production_code_id).toBe(codes.TRANSFER);expect(Number(original.rows[0].quantity_submitted)).toBe(1);
    const after=await apiJson(request,seeded.internalToken,"GET",`/syncfield/customer-qc/reports/${reportId}`);
    const latest=after.cycles[0];
    await reviewFixtureQuantity(request,seeded.internalToken,submittedRecordId);
    await apiJson(request,seeded.internalToken,"POST",`/syncfield/customer-qc/cycles/${latest.id}/decisions`,{production_record_id:submittedRecordId,decision:"accepted",customer_accepted_quantity:1,client_mutation_id:crypto.randomUUID()});
    const resolved=await client.query("SELECT status FROM production_corrections WHERE tenant_id=$1 AND id=$2",[seeded.tenantA,id]);expect(resolved.rows[0].status).toBe("resolved");
    const incomplete=await apiJson(request,seeded.internalToken,"GET",`/syncfield/customer-qc/reports/${reportId}`);expect(incomplete.customer_qc_outcome).not.toBe("customer_accepted");
    const outdated=await request.post(apiUrl(`/syncfield/customer-qc/cycles/${detail.cycles[0].id}/decisions`),{headers:auth(seeded.internalToken),data:{production_record_id:submittedRecordId,decision:"accepted",customer_accepted_quantity:1,client_mutation_id:crypto.randomUUID()}});expect(outdated.status()).toBe(400);
    // Complete outstanding lines once, retaining the earlier partial-acceptance decision.
    const allDecided=new Set(after.cycles.flatMap((item:any)=>item.decisions.map((decision:any)=>decision.production_record_id)));
    allDecided.add(submittedRecordId);
    for(const record of after.records.filter((item:any)=>!allDecided.has(item.id))) {
      await reviewFixtureQuantity(request,seeded.internalToken,record.id);
      await apiJson(request,seeded.internalToken,"POST",`/syncfield/customer-qc/cycles/${latest.id}/decisions`,{production_record_id:record.id,decision:"accepted",customer_accepted_quantity:record.reported_quantity,client_mutation_id:crypto.randomUUID()});
    }
    const beforeRepeat=await apiJson(request,seeded.internalToken,"GET",`/syncfield/customer-qc/reports/${reportId}`);expect(beforeRepeat.customer_qc_outcome).toBe("customer_partially_accepted");
    const repeatCycle=await apiJson(request,seeded.internalToken,"POST",`/syncfield/customer-qc/reports/${reportId}/cycles`,{source_reference:"Repeat targeted customer inspection",client_mutation_id:crypto.randomUUID()});
    const repeatCorrection=await apiJson(request,seeded.internalToken,"POST",`/syncfield/customer-qc/cycles/${repeatCycle.id}/decisions`,{production_record_id:submittedRecordId,decision:"correction_required",customer_reason_code:"notes",customer_comments:"Clarify final note",allowed_fields:["notes"],client_mutation_id:crypto.randomUUID()});
    await apiJson(request,seeded.foremanToken,"POST",`/syncfield/foreman/corrections/${repeatCorrection.correction.id}/resubmit`,{notes:"Final customer clarification",client_mutation_id:crypto.randomUUID()});
    const repeatDetail=await apiJson(request,seeded.internalToken,"GET",`/syncfield/customer-qc/reports/${reportId}`);
    await reviewFixtureQuantity(request,seeded.internalToken,submittedRecordId);
    await apiJson(request,seeded.internalToken,"POST",`/syncfield/customer-qc/cycles/${repeatDetail.cycles[0].id}/decisions`,{production_record_id:submittedRecordId,decision:"accepted",customer_accepted_quantity:1,client_mutation_id:crypto.randomUUID()});
    const aggregate=await apiJson(request,seeded.internalToken,"GET",`/syncfield/customer-qc/reports/${reportId}`);expect(aggregate.customer_qc_outcome).toBe("customer_partially_accepted");expect(aggregate.cycles[0].status).toBe("accepted");expect(aggregate.cycles[0].decisions).toHaveLength(1);
    const dashboard=await apiJson(request,seeded.internalToken,"GET",`/syncfield/production-dashboard?daily_report_id=${reportId}`);
    expect(dashboard.headline.production_record_count).toBe(6);
    expect(dashboard.headline.pending_customer_qc).toBe(0);
    expect(dashboard.closeout.open_correction_count).toBe(0);



  });
  test("the same Partner field work reaches accepted billing, funded payable and one external payment", async ({request}) => {
    const tenant=seeded.tenantA, user=crypto.randomUUID(), membership=crypto.randomUUID(), role=crypto.randomUUID();
    const grants=['contract.read','contract.update','invoice.read','invoice.update','invoice.mark_sent','invoice.approve','billing.read','billing.create_billable','billing.create_invoice','cash_receipt.record','payment_application.create','partner_settlement.create','contractor_payable.create','contractor_payable.calculate_eligibility','partner_payment.execute','partner_payment.confirm'];
    await client.query("INSERT INTO users(id,email,display_name) VALUES($1,$2,'Synthetic independent finance reviewer')",[user,`${user}@syncos.test`]);
    await client.query('INSERT INTO tenant_users(id,tenant_id,user_id) VALUES($1,$2,$3)',[membership,tenant,user]);
    await client.query("INSERT INTO roles(id,tenant_id,name,system_key) VALUES($1,$2,'Pilot Finance','pilot_finance')",[role,tenant]);
    for(const key of grants)await ensurePermission(client,key);
    await grantPermissions(client,tenant,role,grants);
    await client.query("INSERT INTO user_roles(tenant_id,tenant_user_id,role_id,scope_type,scope_id) VALUES($1,$2,$3,'tenant',$1)",[tenant,membership,role]);
    const finance=token(user,tenant,process.env.AUTH_JWT_SECRET!);
    const work=(await client.query('SELECT w.*,p.customer_organization_id FROM partner_work_order_versions w JOIN projects p ON p.tenant_id=w.tenant_id AND p.id=w.project_id WHERE w.tenant_id=$1 AND w.id=$2',[tenant,seeded.workOrderVersionId])).rows[0];
    const customerSchedule=crypto.randomUUID();
    await client.query("INSERT INTO rate_schedules(id,tenant_id,organization_id,name,effective_date,status) VALUES($1,$2,$3,'Synthetic approved customer rates','2026-01-01','active')",[customerSchedule,tenant,work.customer_organization_id]);
    const decision=(await client.query('SELECT d.*,c.code,c.unit_of_measure AS code_unit FROM customer_qc_decisions d JOIN customer_qc_cycles cycle ON cycle.tenant_id=d.tenant_id AND cycle.id=d.qc_cycle_id JOIN production_records p ON p.tenant_id=d.tenant_id AND p.id=d.production_record_id JOIN syncfield_production_codes c ON c.tenant_id=p.tenant_id AND c.id=p.syncfield_production_code_id WHERE d.tenant_id=$1 AND d.production_record_id=$2 AND d.current=true AND d.deleted_at IS NULL ORDER BY cycle.cycle_number DESC LIMIT 1',[tenant,submittedRecordId])).rows[0];
    // This work's final correction changes its code; seed the approved rates for that code.
    const codesToPrice=(await client.query('SELECT code,unit_of_measure FROM syncfield_production_codes WHERE tenant_id=$1 AND active=true',[tenant])).rows;
    for(const code of codesToPrice){
      for(const [schedule,rate] of [[customerSchedule,10],[work.rate_schedule_id,5]] as const){
        await client.query("INSERT INTO rate_codes(tenant_id,rate_schedule_id,code,description,unit,unit_type,amount,customer_rate,contractor_rate,status) VALUES($1,$2,$3,'Synthetic approved rate',$4,$4,$5,$5,$5,'active') ON CONFLICT DO NOTHING",[tenant,schedule,code.code,code.unit_of_measure,rate]);
      }
    }
    const approvedContract=await approveFixtureCommercialTerms(client,request,finance,tenant,customerSchedule,'customer');
    await approveFixtureCommercialTerms(client,request,finance,tenant,work.rate_schedule_id,'partner');
    await client.query('UPDATE work_orders SET customer_rate_schedule_id=$3 WHERE tenant_id=$1 AND id=$2',[tenant,work.work_order_id,customerSchedule]);
    await client.query("UPDATE partner_agreement_versions SET executed_at='2026-08-16' WHERE tenant_id=$1 AND id=$2",[tenant,work.governing_agreement_version_id]);
    await reviewFixtureQuantity(request,seeded.internalToken,submittedRecordId);
    const staleAcceptance=await request.post(apiUrl('/accepted-production-financials/billables/convert'),{headers:auth(finance),data:{customer_qc_decision_id:decision.id}});
    expect(staleAcceptance.status()).toBe(400);expect(await staleAcceptance.text()).toContain('current quantity review');
    const inspection=await apiJson(request,seeded.internalToken,'POST',`/syncfield/customer-qc/reports/${reportId}/cycles`,{source_reference:'SYNTHETIC documented customer confirmation of renewed quantity review',client_mutation_id:crypto.randomUUID()});
    const renewed=await apiJson(request,seeded.internalToken,'POST',`/syncfield/customer-qc/cycles/${inspection.id}/decisions`,{production_record_id:submittedRecordId,decision:'accepted',customer_accepted_quantity:1,client_mutation_id:crypto.randomUUID()});
    const billable=await apiJson(request,finance,'POST','/accepted-production-financials/billables/convert',{customer_qc_decision_id:renewed.id});
    expect(Number(billable.net_billable_amount)).toBe(10);
    const invoice=await apiJson(request,finance,'POST','/accepted-production-financials/invoices/create',{billable_item_ids:[billable.id],retainage_percent:0});
    expect(invoice.due_date).toBeNull();
    await verifyInvoicePackageLifecycle(request,finance,invoice.id,approvedContract);
    const source=(await client.query('SELECT * FROM accepted_production_financial_sources WHERE tenant_id=$1 AND billable_item_id=$2',[tenant,billable.id])).rows[0];
    const settlement=await apiJson(request,finance,'POST','/accepted-production-financials/partner-settlements/create',{accepted_production_source_ids:[source.id]});
    const payable=await apiJson(request,finance,'POST','/accepted-production-financials/contractor-payables/create',{settlement_id:settlement.id});
    expect(Number(payable.net_payable_amount)).toBe(5);expect(Number(payable.eligible_amount)).toBe(0);
    const paymentBody={contractor_payable_id:payable.id,amount:5,payment_date:today(),method:'ach',reference:crypto.randomUUID(),evidence_reference:'SYNTHETIC-COMPLETED-BANK-RECEIPT',idempotency_key:crypto.randomUUID(),confirmed_completed:true};
    const endpoint='/payment-retainage-adjustments/external-payments';
    expect((await request.post(apiUrl(endpoint),{headers:auth(finance),data:paymentBody})).status()).toBe(400);
    const receipt=await apiJson(request,finance,'POST','/accepted-production-financials/cash-receipts',{customer_organization_id:work.customer_organization_id,amount:10,payment_reference:crypto.randomUUID(),idempotency_key:crypto.randomUUID()});
    await apiJson(request,finance,'POST',`/accepted-production-financials/cash-receipts/${receipt.id}/clear`,{});
    await apiJson(request,finance,'POST','/accepted-production-financials/payment-applications',{cash_receipt_id:receipt.id,invoice_id:invoice.id,amount:10});
    const eligible=await apiJson(request,finance,'POST',`/accepted-production-financials/contractor-payables/${payable.id}/calculate-eligibility`,{});expect(Number(eligible.eligible_amount)).toBe(5);
    const payment=await apiJson(request,finance,'POST',endpoint,paymentBody);
    const replay=await apiJson(request,finance,'POST',endpoint,paymentBody);expect(replay.id).toBe(payment.id);
    const result=(await client.query('SELECT paid_amount FROM contractor_payables WHERE tenant_id=$1 AND id=$2',[tenant,payable.id])).rows[0];expect(Number(result.paid_amount)).toBe(5);
    expect((await client.query('SELECT id FROM external_partner_payments WHERE tenant_id=$1 AND contractor_payable_id=$2',[tenant,payable.id])).rows).toHaveLength(1);
  });
});

async function seedSyncfieldFixture(client: Client, secret: string): Promise<Seeded> {
  const suffix = crypto.randomUUID();
  const tenantA = crypto.randomUUID();
  const tenantB = crypto.randomUUID();
  const orgA = crypto.randomUUID();
  const orgTenantB = crypto.randomUUID();
  const providerA = crypto.randomUUID();
  const providerTenantB = crypto.randomUUID();
  const customerOrg = crypto.randomUUID();
  const adminUser = crypto.randomUUID();
  const foremanUser = crypto.randomUUID();
  const internalUser = crypto.randomUUID();
  const tenantBUser = crypto.randomUUID();
  const adminTenantUser = crypto.randomUUID();
  const foremanTenantUser = crypto.randomUUID();
  const internalTenantUser = crypto.randomUUID();
  const tenantBTenantUser = crypto.randomUUID();
  const adminRole = crypto.randomUUID();
  const foremanRole = crypto.randomUUID();
  const internalRole = crypto.randomUUID();
  const tenantBRole = crypto.randomUUID();
  const projectId = crypto.randomUUID();
  const contractId = crypto.randomUUID();
  const agreementVersionId = crypto.randomUUID();
  const workOrderId = crypto.randomUUID();
  const workOrderVersionId = crypto.randomUUID();
  const crewA = crypto.randomUUID();
  const crewAssignmentId = crypto.randomUUID();
  const equipmentId = crypto.randomUUID();
  const vehicleAssignmentId = crypto.randomUUID();
  const operatorAuthorizationId = crypto.randomUUID();
  const workerIds = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  const adminPermissions = ["partner_context.read", "partner_actions.read", "partner_profile.read", "partner_compliance.summary.read", "partner_compliance.profile.read", "partner_compliance.w9.read", "partner_compliance.payment.read", "partner_compliance.insurance.read", "partner_workforce.worker.read", "partner_workforce.crew.read", "partner_workforce.readiness.read", "partner_agreement.read", "partner_agreement.artifact.read", "partner_work_order.read", "partner_work_order.rate.read", "partner_vehicle_assignment.read", "partner_vehicle_assignment.allocation.read", "partner_mobilization.read", "partner_notice.read", "partner_notice.acknowledge", "partner_map.read", "partner_jsa.read", "partner_jsa_history.read", "partner_daily_production.read_org", "partner_production.read_org", "partner_customer_qc.read", "partner_customer_qc.corrections_read", "partner_customer_qc.history_read"];
  const foremanPermissions = ["partner_context.read", "partner_actions.read", "partner_compliance.summary.read", "partner_workforce.foreman_roster.read", "partner_work_order.foreman_summary.read", "partner_mobilization.foreman.read", "partner_notice.foreman.read", "partner_notice.foreman.acknowledge", "partner_map.read_assigned", "partner_jsa.create", "partner_jsa.update_draft", "partner_jsa.complete", "partner_jsa.read_own", "partner_daily_production.read", "partner_daily_production.create", "partner_daily_production.update_draft", "partner_daily_production.delete_draft", "partner_daily_production.submit", "partner_production_record.create", "partner_production_record.update_draft", "partner_production_record.delete_draft", "partner_production_photo.create", "partner_field_sync.submit", "partner_customer_qc.read_own", "partner_correction.read_own", "partner_correction.update_allowed", "partner_correction.resubmit"];
  const internalPermissions = ["production_dashboard.read", "capacity_provider.read", "partner_mobilization.review", "partner_mobilization.evaluate", "partner_mobilization.approve", "partner_notice.issue", "syncfield_map.create", "syncfield_map.version.upload", "syncfield_map.read", "syncfield_map.assignment.manage", "syncfield_map.work_zone.manage", "syncfield_jsa.read_all", "daily_production.read_all", "daily_production.completeness_read", "customer_qc.completeness_review", "customer_qc.decision_record", "customer_qc.evidence_read", "customer_qc.evidence_upload", "customer_qc.correction_publish", "customer_qc.history_read"];
  for (const permission of [...adminPermissions, ...foremanPermissions, ...internalPermissions]) await ensurePermission(client, permission);
  await client.query("BEGIN");
  try {
    await client.query("INSERT INTO tenants (id, name, slug) VALUES ($1,$2,$3),($4,$5,$6)", [tenantA, "P8 Tenant A", `p8-a-${suffix}`, tenantB, "P8 Tenant B", `p8-b-${suffix}`]);
    await client.query("INSERT INTO users (id,email,display_name) VALUES ($1,$2,'P8 Partner Admin'),($3,$4,'P8 Partner Foreman'),($5,$6,'P8 Internal'),($7,$8,'P8 Tenant B')", [adminUser, `p8-admin-${suffix}@syncos.test`, foremanUser, `p8-foreman-${suffix}@syncos.test`, internalUser, `p8-internal-${suffix}@syncos.test`, tenantBUser, `p8-tenantb-${suffix}@syncos.test`]);
    await client.query("INSERT INTO tenant_users (id,tenant_id,user_id) VALUES ($1,$2,$3),($4,$2,$5),($6,$2,$7),($8,$9,$10)", [adminTenantUser, tenantA, adminUser, foremanTenantUser, foremanUser, internalTenantUser, internalUser, tenantBTenantUser, tenantB, tenantBUser]);
    await client.query("INSERT INTO roles (id,tenant_id,name,system_key) VALUES ($1,$2,'P8 Partner Admin','partner_admin'),($3,$2,'P8 Partner Foreman','partner_foreman'),($4,$2,'P8 Internal',$5),($6,$7,'P8 Tenant B Partner Admin','partner_admin')", [adminRole, tenantA, foremanRole, internalRole, `p8_internal_${suffix}`, tenantBRole, tenantB]);
    await grantPermissions(client, tenantA, adminRole, adminPermissions);
    await grantPermissions(client, tenantA, foremanRole, foremanPermissions);
    await grantPermissions(client, tenantA, internalRole, internalPermissions);
    await grantPermissions(client, tenantB, tenantBRole, adminPermissions);
    await client.query("INSERT INTO organizations (id,tenant_id,name,organization_type,actor_roles,status) VALUES ($1,$2,'P8 Partner A','subcontractor',ARRAY['capacity_provider']::text[],'active'),($3,$2,'P8 Customer','customer',ARRAY['work_creator']::text[],'active'),($4,$5,'P8 Tenant B Partner','subcontractor',ARRAY['capacity_provider']::text[],'active')", [orgA, tenantA, customerOrg, orgTenantB, tenantB]);
    await client.query("INSERT INTO capacity_providers (id,tenant_id,organization_id,name,provider_type,status,verification_status,contract_status) VALUES ($1,$2,$3,'P8 Provider A','subcontractor','activated','verified','contracted'),($4,$5,$6,'P8 Tenant B Provider','subcontractor','activated','verified','contracted')", [providerA, tenantA, orgA, providerTenantB, tenantB, orgTenantB]);
    await client.query("INSERT INTO user_roles (tenant_id,tenant_user_id,role_id,scope_type,scope_id) VALUES ($1,$2,$3,'organization',$4),($1,$5,$6,'organization',$4),($1,$7,$8,'tenant',$1),($9,$10,$11,'organization',$12)", [tenantA, adminTenantUser, adminRole, orgA, foremanTenantUser, foremanRole, internalTenantUser, internalRole, tenantB, tenantBTenantUser, tenantBRole, orgTenantB]);
    await seedReadyCompliance(client, tenantA, orgA, providerA);
    await client.query("INSERT INTO projects (id,tenant_id,customer_organization_id,name,status) VALUES ($1,$2,$3,'P8 Synthetic Project','active')", [projectId, tenantA, customerOrg]);
    await client.query("INSERT INTO contracts (id,tenant_id,organization_id,partner_organization_id,capacity_provider_id,name,contract_type,status,agreement_lifecycle_status,agreement_effective_date) VALUES ($1,$2,$3,$3,$4,'P8-MSA','partner_master_agreement','active','active','2026-08-16')", [contractId, tenantA, orgA, providerA]);
    await client.query("INSERT INTO partner_restricted_file_objects (tenant_id,organization_id,capacity_provider_id,category,related_entity_type,related_entity_id,file_name,mime_type,size_bytes,checksum,storage_key,uploaded_by_user_id) VALUES ($1,$2,$3,'partner_msa_executed','partner_agreement_version',$4,'msa.pdf','application/pdf',12,'checksum',$5,$6)", [tenantA, orgA, providerA, agreementVersionId, `${tenantA}/${orgA}/msa.pdf`, internalUser]);
    const msaFile = await client.query("SELECT id FROM partner_restricted_file_objects WHERE tenant_id = $1 AND related_entity_id = $2", [tenantA, agreementVersionId]);
    await client.query("INSERT INTO partner_agreement_versions (id,tenant_id,organization_id,capacity_provider_id,contract_id,version_number,status,effective_date,artifact_file_object_id,artifact_verified_at,created_by_user_id) VALUES ($1,$2,$3,$4,$5,1,'effective','2026-08-16',$6,now(),$7)", [agreementVersionId, tenantA, orgA, providerA, contractId, msaFile.rows[0].id, internalUser]);
    const rateScheduleId = crypto.randomUUID();
    const rateCodeId = crypto.randomUUID();
    await client.query("INSERT INTO rate_schedules (id,tenant_id,organization_id,name,effective_date,status) VALUES ($1,$2,$3,'P8 Partner Rate','2026-08-16','active')", [rateScheduleId, tenantA, orgA]);
    await client.query("INSERT INTO rate_codes (id,tenant_id,rate_schedule_id,code,description,unit,unit_type,amount,contractor_rate,status) VALUES ($1,$2,$3,'accepted_foot','Partner rate','feet','production_unit',0.70,0.70,'active')", [rateCodeId, tenantA, rateScheduleId]);
    await client.query("INSERT INTO crews (id,tenant_id,capacity_provider_id,organization_id,name,crew_type,status,lifecycle_status,target_staffing_level) VALUES ($1,$2,$3,$4,'P8 Ready Crew','aerial','active','active',4)", [crewA, tenantA, providerA, orgA]);
    for (const [index, workerId] of workerIds.entries()) {
      await client.query("INSERT INTO workers (id,tenant_id,capacity_provider_id,crew_id,organization_id,first_name,last_name,status,review_status) VALUES ($1,$2,$3,$4,$5,$6,'Worker','active','approved')", [workerId, tenantA, providerA, crewA, orgA, `P8-${index}`]);
      await client.query("INSERT INTO partner_crew_memberships (tenant_id,organization_id,capacity_provider_id,crew_id,worker_id,membership_role,status) VALUES ($1,$2,$3,$4,$5,$6,'active')", [tenantA, orgA, providerA, crewA, workerId, index === 0 ? "foreman" : index === 1 ? "alternate_foreman" : "member"]);
      const headshotFile = crypto.randomUUID();
      await client.query("INSERT INTO partner_restricted_file_objects (id,tenant_id,organization_id,capacity_provider_id,category,related_entity_type,related_entity_id,file_name,mime_type,size_bytes,checksum,storage_key,uploaded_by_user_id) VALUES ($1,$2,$3,$4,'worker_headshot','worker',$5,'headshot.png','image/png',8,'checksum',$6,$7)", [headshotFile, tenantA, orgA, providerA, workerId, `${tenantA}/${workerId}/headshot.png`, internalUser]);
      await client.query("INSERT INTO partner_worker_headshots (tenant_id,organization_id,capacity_provider_id,worker_id,file_object_id,status) VALUES ($1,$2,$3,$4,$5,'approved')", [tenantA, orgA, providerA, workerId, headshotFile]);
      await client.query("INSERT INTO partner_worker_credentials (tenant_id,organization_id,capacity_provider_id,worker_id,credential_type,required,status,expiration_date) VALUES ($1,$2,$3,$4,'driver_license',true,'verified','2027-08-16')", [tenantA, orgA, providerA, workerId]);
    }
    await client.query("INSERT INTO partner_worker_user_links (tenant_id,organization_id,worker_id,tenant_user_id,status) VALUES ($1,$2,$3,$4,'active')", [tenantA, orgA, workerIds[0], foremanTenantUser]);
    await client.query("INSERT INTO work_orders (id,tenant_id,project_id,assigned_capacity_provider_id,assigned_crew_id,title,work_type,expected_units,unit_type,status,work_order_name,work_order_number,scope_summary,map_link,assignment_type,assigned_organization_id,partner_organization_id,partner_rate_schedule_id,governing_agreement_version_id,partner_execution_status,partner_effective_date,unit,planned_quantity) VALUES ($1,$2,$3,$4,$5,'P8 WO','fiber',3000,'feet','assigned','P8 WO','WO-P8-A','fiber hanging and overlash only','MAP-P8-A','partner_contractor',$6,$6,$7,$8,'active','2026-08-22','feet',3000)", [workOrderId, tenantA, projectId, providerA, crewA, orgA, rateScheduleId, agreementVersionId]);
    await client.query("INSERT INTO partner_restricted_file_objects (tenant_id,organization_id,capacity_provider_id,category,related_entity_type,related_entity_id,file_name,mime_type,size_bytes,checksum,storage_key,uploaded_by_user_id) VALUES ($1,$2,$3,'partner_work_order_executed','partner_work_order_version',$4,'wo.pdf','application/pdf',12,'checksum',$5,$6)", [tenantA, orgA, providerA, workOrderVersionId, `${tenantA}/${orgA}/wo.pdf`, internalUser]);
    const woFile = await client.query("SELECT id FROM partner_restricted_file_objects WHERE tenant_id = $1 AND related_entity_id = $2", [tenantA, workOrderVersionId]);
    await client.query("INSERT INTO partner_work_order_versions (id,tenant_id,organization_id,capacity_provider_id,project_id,work_order_id,version_number,governing_agreement_version_id,assigned_crew_id,rate_schedule_id,rate_code_id,work_order_number,scope_summary,primary_work_area,map_work_package_ref,production_unit,performance_target,status,effective_date,artifact_file_object_id,artifact_verified_at,created_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,1,$7,$8,$9,$10,'WO-P8-A','fiber hanging and overlash only','P8 Initial Work Area','MAP-P8-A','feet',3000,'active','2026-08-22',$11,now(),$12)", [workOrderVersionId, tenantA, orgA, providerA, projectId, workOrderId, agreementVersionId, crewA, rateScheduleId, rateCodeId, woFile.rows[0].id, internalUser]);
    await client.query("INSERT INTO partner_work_order_crew_assignments (id,tenant_id,organization_id,capacity_provider_id,work_order_id,work_order_version_id,crew_id,status,assigned_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,'active',$8)", [crewAssignmentId, tenantA, orgA, providerA, workOrderId, workOrderVersionId, crewA, internalUser]);
    await client.query("INSERT INTO equipment (id,tenant_id,name,equipment_type,status) VALUES ($1,$2,'P8 Bucket Truck','bucket_truck','active')", [equipmentId, tenantA]);
    await client.query("INSERT INTO partner_vehicle_assignments (id,tenant_id,organization_id,capacity_provider_id,equipment_id,work_order_id,work_order_version_id,crew_id,rental_provider,partner_custody_start_date,daily_allocation_amount,status,aerial_inspection_expires_at,created_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'Synthetic Rental','2026-08-23',100,'active_custody','2027-08-16',$9)", [vehicleAssignmentId, tenantA, orgA, providerA, equipmentId, workOrderId, workOrderVersionId, crewA, internalUser]);
    await client.query("INSERT INTO partner_vehicle_condition_records (tenant_id,organization_id,vehicle_assignment_id,record_type,odometer,fuel_level,recorded_by_user_id) VALUES ($1,$2,$3,'pre_assignment',1200,'full',$4)", [tenantA, orgA, vehicleAssignmentId, internalUser]);
    await client.query("INSERT INTO partner_vehicle_operator_authorizations (id,tenant_id,organization_id,vehicle_assignment_id,worker_id,crew_id,authorization_role,qualification_status,approved_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,'driver_operator','approved',$7)", [operatorAuthorizationId, tenantA, orgA, vehicleAssignmentId, workerIds[0], crewA, internalUser]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
  return { tenantA, tenantB, orgA, orgTenantB, crewA, foremanWorkerId: workerIds[0], workOrderVersionId, internalToken: token(internalUser, tenantA, secret), adminToken: token(adminUser, tenantA, secret), foremanToken: token(foremanUser, tenantA, secret), tenantBToken: token(tenantBUser, tenantB, secret), adminPermissions, foremanPermissions, internalPermissions };
}

async function authorizeMobilization(request: APIRequestContext, fixture: Seeded) {
  const evaluation = await apiJson(request, fixture.internalToken, "POST", `/partner-mobilization/organizations/${fixture.orgA}/work-order-versions/${fixture.workOrderVersionId}/evaluate`);
  expect(evaluation.overall_status).toBe("ready");
  const decision = await apiJson(request, fixture.internalToken, "POST", `/partner-mobilization/organizations/${fixture.orgA}/work-order-versions/${fixture.workOrderVersionId}/approve`, {});
  expect(decision.decision).toBe("approved_to_mobilize");
  const notice = await apiJson(request, fixture.internalToken, "POST", `/partner-mobilization/organizations/${fixture.orgA}/work-order-versions/${fixture.workOrderVersionId}/notices`, { production_start_date: "2026-08-25", production_start_time: "07:30:00", timezone: "America/New_York", initial_work_area: "P8 Initial Work Area", external_instructions: "Open field map and complete Daily JSA before work." });
  expect(notice.production_start.authorization_status).toBe("authorized");
}

async function createAssignedMap(request: APIRequestContext, fixture: Seeded) {
  const document = await apiJson(request, fixture.internalToken, "POST", `/syncfield/organizations/${fixture.orgA}/work-order-versions/${fixture.workOrderVersionId}/map-documents`, {
    name: "ARL019 Construction Map",
    customer_document_number: "ARL019",
    document_type: "construction_map",
  });
  fixture.mapDocumentId = document.id;
  const version = await apiJson(request, fixture.internalToken, "POST", `/syncfield/organizations/${fixture.orgA}/map-documents/${document.id}/versions`, {
    file_name: "ARL019 Rev 0.pdf",
    mime_type: "application/pdf",
    content_base64: pdfBase64(),
    revision_number: 1,
    revision_label: "Rev 0",
  });
  fixture.mapVersionId = version.id;
  await apiJson(request, fixture.internalToken, "POST", `/syncfield/organizations/${fixture.orgA}/map-versions/${version.id}/work-zones`, {
    name: "South Ave",
    page_number: 1,
    x_ratio: 0.44,
    y_ratio: 0.58,
    zoom_level: 1.5,
  });
  const assignment = await apiJson(request, fixture.internalToken, "POST", `/syncfield/organizations/${fixture.orgA}/map-versions/${version.id}/assign`, {
    crew_id: fixture.crewA,
    foreman_worker_id: fixture.foremanWorkerId,
  });
  fixture.assignmentId = assignment.id;
}

async function completeJsa(request: APIRequestContext, fixture: Seeded, workDate = today()) {
  const result = await apiJson(request, fixture.foremanToken, "POST", `/syncfield/foreman/jsa/today/complete?work_date=${workDate}`, {
    work_date: workDate,
    work_location: "P9 Initial Work Area",
    hazards: ["traffic"],
    controls: ["ppe_reviewed", "emergency_procedures_reviewed", "stop_work_authority_reviewed"],
    foreman_certified: true,
  });
  expect(result.status).toBe("completed");
  await acknowledgeFixtureJsa(request,fixture.tenantA,result.id);
}

async function createProduction(request: APIRequestContext, fixture: Seeded, body: Record<string, unknown>) {
  return apiJson(request, fixture.foremanToken, "POST", "/syncfield/foreman/production/records", { work_date: today(), ...body });
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function tomorrow() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

async function seedReadyCompliance(client: Client, tenantId: string, orgId: string, providerId: string) {
  await client.query("INSERT INTO partner_company_profiles (tenant_id,organization_id,capacity_provider_id,legal_business_name,dba_name,state_of_formation,entity_type,primary_contact_name,primary_contact_email,compliance_contact_name,compliance_contact_email,settlement_contact_name,settlement_contact_email,business_address,status) VALUES ($1,$2,$3,'P8 Partner A LLC','P8 A','OH','llc','Admin Contact','admin@p8.test','Compliance Contact','compliance@p8.test','Settlement Contact','settlement@p8.test','{}','verified')", [tenantId, orgId, providerId]);
  await client.query("INSERT INTO partner_tax_profiles (tenant_id,organization_id,capacity_provider_id,legal_name_on_w9,federal_tax_classification,tin_type,tin_last_four,status) VALUES ($1,$2,$3,'P8 Partner A LLC','corporation','ein','1234','verified')", [tenantId, orgId, providerId]);
  await client.query("INSERT INTO partner_payment_profiles (tenant_id,organization_id,capacity_provider_id,priority_passport_status,status,account_last_four,bank_display_name) VALUES ($1,$2,$3,'active','active','6789','Synthetic Bank')", [tenantId, orgId, providerId]);
  for (const type of ["commercial_general_liability", "commercial_auto", "umbrella_excess", "workers_compensation", "employers_liability"]) {
    await client.query("INSERT INTO partner_insurance_policies (tenant_id,organization_id,capacity_provider_id,policy_type,carrier,effective_date,expiration_date,status,occurrence_limit_cents,general_aggregate_cents,products_completed_operations_aggregate_cents,combined_single_auto_limit_cents,workers_compensation_statutory,employer_liability_accident_limit_cents,employer_liability_disease_each_employee_limit_cents,employer_liability_disease_policy_limit_cents,additional_insured_status,waiver_of_subrogation_status,primary_non_contributory_status) VALUES ($1,$2,$3,$4,'Synthetic Carrier','2026-01-01','2027-08-16','verified',100000000,200000000,200000000,100000000,true,50000000,50000000,50000000,'verified','verified','verified')", [tenantId, orgId, providerId, type]);
  }
}

async function ensurePermission(client: Client, key: string) {
  await client.query("INSERT INTO permissions (key, name, description) VALUES ($1, $1, 'P8 SyncField test permission') ON CONFLICT (key) DO NOTHING", [key]);
}

async function grantPermissions(client: Client, tenantId: string, roleId: string, keys: string[]) {
  for (const key of keys) await client.query("INSERT INTO role_permissions (tenant_id, role_id, permission_id) SELECT $1, $2, id FROM permissions WHERE key = $3 ON CONFLICT (role_id, permission_id) DO NOTHING", [tenantId, roleId, key]);
}

async function downstreamCounts(client: Client) {
  const result = await client.query("SELECT (SELECT count(*)::int FROM production_records) AS production, (SELECT count(*)::int FROM qc_reviews) AS qc, (SELECT count(*)::int FROM billable_items) AS billable, (SELECT count(*)::int FROM settlements) AS settlements, (SELECT count(*)::int FROM contractor_payables) AS payables, (SELECT count(*)::int FROM payments) AS payments");
  return result.rows[0];
}

async function customerOrgId(client: Client, tenantId: string) {
  const result = await client.query("SELECT id FROM organizations WHERE tenant_id = $1 AND organization_type = 'customer' ORDER BY created_at DESC LIMIT 1", [tenantId]);
  return String(result.rows[0].id);
}

async function productionCountsForReport(client: Client, tenantId: string, dailyReportId: string) {
  const result = await client.query(
    `
    SELECT
      (SELECT count(*)::int FROM production_records WHERE tenant_id = $1 AND daily_production_report_id = $2 AND deleted_at IS NULL) AS records,
      (SELECT count(*)::int FROM map_annotations ma JOIN production_records pr ON pr.tenant_id = ma.tenant_id AND pr.id = ma.production_record_id WHERE ma.tenant_id = $1 AND pr.daily_production_report_id = $2 AND ma.deleted_at IS NULL) AS annotations
    `,
    [tenantId, dailyReportId],
  );
  return result.rows[0] as { records: number; annotations: number };
}

async function queuedFieldMutations(page: Page): Promise<Array<Record<string, any>>> {
  return page.evaluate(async () => {
    const open = indexedDB.open("syncos-field-production", 1);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      open.onupgradeneeded = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains("mutations")) {
          const store = db.createObjectStore("mutations", { keyPath: "mutationId" });
          store.createIndex("scopeKey", "scopeKey", { unique: false });
        }
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const rows = await new Promise<Array<Record<string, any>>>((resolve, reject) => {
      const tx = db.transaction("mutations", "readonly");
      const request = tx.objectStore("mutations").getAll();
      request.onsuccess = () => resolve(request.result as Array<Record<string, any>>);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return rows;
  });
}

async function installSession(page: Page, nextToken: string, nextPermissions: string[]) {
  if (!page.url().startsWith(process.env.WEB_BASE_URL!)) await page.goto("/login");
  await page.evaluate(({ tokenValue, permissionValue }) => {
    window.localStorage.setItem("syncos.apiToken", tokenValue);
    window.localStorage.setItem("syncos.permissions", permissionValue.join(","));
  }, { tokenValue: nextToken, permissionValue: nextPermissions });
}

async function apiJson(request: APIRequestContext, bearer: string, method: "GET" | "POST", route: string, body?: unknown) {
  const response = method === "GET" ? await request.get(apiUrl(route), { headers: auth(bearer) }) : await request.post(apiUrl(route), { headers: auth(bearer), data: body });
  expect(response.status(), `${method} ${route}: ${await response.text()}`).toBeLessThan(400);
  return response.json();
}

function auth(bearer: string) {
  return { authorization: `Bearer ${bearer}`, "content-type": "application/json" };
}

function apiUrl(route: string): string {
  const base = process.env.API_BASE_URL;
  if (!base) throw new Error("API_BASE_URL is required");
  return `${base}/${route.replace(/^\//, "")}`;
}

function pdfBase64() {
  return Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >> endobj\n4 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF").toString("base64");
}

function token(userId: string, tenantId: string, secret: string) {
  const header = encode({ alg: "HS256", typ: "JWT" });
  const payload = encode({ sub: userId, tenant_id: tenantId, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 600 });
  const signature = crypto.createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

async function enterObservedProduction(page: Page, kind: "asset" | "route" | "daily") {
  await page.getByRole("button", { name: kind === "asset" ? "Asset" : kind === "route" ? "Route / Span" : "Daily", exact: true }).click();
  if (kind === "route") {
    const form = page.getByRole("form", { name: "Fiber span entry" });
    await expect(form.getByLabel("From pole", { exact: true })).toHaveValue("");
    for (const [label, value] of Object.entries({ "From pole": "Offline Pole 12301", "To pole": "Offline Pole 12312", "Reel / cable": "REEL-A", "Fiber type": "144ct", "Sequence start": "14826", "Sequence end": "14685", "Reported footage": "141", "Map page": "1", "Start across page (%)": "42", "Start down page (%)": "48", "End across page (%)": "66", "End down page (%)": "52" })) await form.getByLabel(label, { exact: true }).fill(value);
    await form.getByRole("button", { name: "Save Fiber Span" }).click();
  } else {
    const form = page.getByRole("form", { name: "Production entry" });
    await form.getByLabel("Quantity", { exact: true }).fill("1");
    if (kind === "asset") {
      await form.getByRole("combobox", { name: "Asset type", exact: true }).selectOption("pole");
      for (const [label, value] of Object.entries({ "Asset identifier": "Offline Pole 12301", "Map page": "1", "Across page (%)": "42", "Down page (%)": "48" })) await form.getByLabel(label, { exact: true }).fill(value);
    }
    await form.getByLabel("Work notes", { exact: true }).fill("Observed pilot test work");
    await form.getByRole("button", { name: "Save production", exact: true }).click();
  }
}
