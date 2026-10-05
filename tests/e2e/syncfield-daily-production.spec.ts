import {reviewFixtureQuantity} from "./helpers/quantity-review";
import { verifySafetyLifecycle } from "./helpers/safety-lifecycle";
import { acknowledgeFixtureJsa, reviewFixtureSafetyScope, safetyActor } from "./helpers/individual-safety";
import crypto from "node:crypto";
import fs from "node:fs/promises";
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

test.describe.serial("P9 SyncField Daily Production, map annotation, offline queue, and submission", () => {
  let client: Client;
  let seeded: Seeded;
  let downstreamCountsBefore: Awaited<ReturnType<typeof downstreamCounts>>;
  let codes: Record<string, string>;
  let reportId: string;
  let submittedRecordId: string;
  let designSegmentId: string;
  let spanCompletionId: string;
  let frontAssetObservationId: string;
  let frontCoilId: string;
  let rearCoilId: string;

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
    await page.goto("/work-safety");
    await expect(page.getByRole('heading',{name:'Safety reviews and work authorization'})).toBeVisible();
    await expect(page.getByRole('button',{name:'Place work on hold'})).toHaveCount(0);
    await expect(page.getByRole('button',{name:'Record verified approval'})).toHaveCount(0);
    await expect(page.getByText('Personally acknowledged at',{exact:false})).toBeVisible();
    await page.goto("/syncfield/production");
    await expect(page.locator("h2").filter({ hasText: "Production" })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("button", { name: "Asset" })).toBeVisible();
    await expect(page.locator("a.partner-button", { hasText: "Review & Submit" })).toBeVisible();
    await expect(page.getByText("Partner Rate")).toHaveCount(0);
    await expect(page.getByText("contractor_rate")).toHaveCount(0);

    const cross = await request.get(apiUrl("/syncfield/foreman/production/today"), { headers: auth(seeded.tenantBToken) });
    expect(cross.status()).toBeGreaterThanOrEqual(403);
  });

  test("changed safety conditions preserve the signed revision and block production until renewed review", async ({request}) => {
    const prior=await apiJson(request,seeded.foremanToken,"GET","/syncfield/foreman/jsa/today");
    const overwrite=await request.post(apiUrl('/syncfield/foreman/jsa/today/complete'),{headers:auth(seeded.foremanToken),data:{work_date:today(),work_location:'Different location',foreman_certified:true}});
    expect(overwrite.status()).toBe(400);
    const revised=await apiJson(request,seeded.foremanToken,"POST","/syncfield/foreman/jsa/today/revise",{work_date:today(),prior_jsa_id:prior.id,revision_reason:'Synthetic changing work conditions',work_location:'Revised work area'});
    expect(revised.prior_jsa_id).toBe(prior.id);expect(revised.revision_number).toBe(Number(prior.revision_number)+1);
    const blocked=await request.post(apiUrl('/syncfield/foreman/production/records'),{headers:auth(seeded.foremanToken),data:{work_date:today(),client_mutation_id:crypto.randomUUID(),production_code_id:codes.LABOR,location_type:'daily',reported_quantity:1,status:'complete'}});
    expect(blocked.status()).toBe(400);expect(await blocked.text()).toContain('jsa');
    await completeJsa(request,seeded);
    const history=(await client.query('SELECT id,status,current,work_location FROM daily_jsas WHERE tenant_id=$1 AND id=ANY($2::uuid[]) ORDER BY revision_number',[seeded.tenantA,[prior.id,revised.id]])).rows;
    expect(history[0]).toMatchObject({id:prior.id,status:'completed',current:false,work_location:prior.work_location});
    expect(history[1]).toMatchObject({id:revised.id,status:'completed',current:true});
    const participants=(await client.query('SELECT acknowledged FROM daily_jsa_participants WHERE tenant_id=$1 AND daily_jsa_id=$2',[seeded.tenantA,revised.id])).rows;
    expect(participants.length).toBeGreaterThan(0);expect(participants.every(p=>p.acknowledged===true)).toBe(true);
  });

  test("partner crew independently acknowledges, obtains pre-bore approval and completes ordered utility-strike restart",async({request})=>{
    await verifySafetyLifecycle(request,seeded.tenantA,seeded.workOrderVersionId,seeded.foremanToken,today());
  });

  test("evidence survives lost responses, reload and offline capture without duplicate uploads", async ({ page, context }) => {
    await installSession(page, seeded.foremanToken, seeded.foremanPermissions);
    await page.setViewportSize({width:390,height:844});
    await page.goto("/syncfield/production/review");
    const panel=page.getByRole('region',{name:'Photos and evidence'});
    const picture=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jLzQAAAAASUVORK5CYII=','base64');
    await panel.getByLabel('Evidence file').setInputFiles({name:'retry-photo.png',mimeType:'image/png',buffer:picture});
    await panel.getByLabel('What does this evidence show?').fill('Synthetic lost-response evidence');
    let interrupted=false;
    await page.route('**/syncfield/foreman/evidence',async route=>{
      if(route.request().method()==='POST'&&!interrupted){interrupted=true;const response=await route.fetch();expect(response.ok()).toBeTruthy();await route.abort('failed');}
      else await route.continue();
    });
    await panel.getByRole('button',{name:'Upload evidence',exact:true}).click();
    await expect(panel.getByRole('alert')).toBeVisible();
    await page.reload();
    await expect(panel.getByText(/Waiting for confirmation: retry-photo/)).toBeVisible();
    await panel.getByRole('button',{name:'Retry upload'}).click();
    await expect(panel.getByText('Evidence saved on the server.',{exact:true})).toBeVisible();
    const stored=await client.query("SELECT id,checksum FROM syncfield_field_evidence WHERE tenant_id=$1 AND daily_report_id=$2 AND file_name='retry-photo.png'",[seeded.tenantA,reportId]);
    expect(stored.rows).toHaveLength(1);expect(stored.rows[0].checksum).toBe(crypto.createHash('sha256').update(picture).digest('hex'));
    const audit=await client.query("SELECT count(*)::int AS n FROM audit_logs WHERE tenant_id=$1 AND entity_id=$2",[seeded.tenantA,stored.rows[0].id]);expect(audit.rows[0].n).toBe(1);
    await context.setOffline(true);
    await panel.getByLabel('Evidence file').setInputFiles({name:'offline-photo.png',mimeType:'image/png',buffer:picture});
    await panel.getByLabel('What does this evidence show?').fill('Synthetic offline evidence');
    await panel.getByRole('button',{name:'Upload evidence',exact:true}).click();
    await expect(panel.getByText(/Saved on this device; not uploaded/)).toBeVisible();
    await context.setOffline(false);
    await page.reload();
    await expect(panel.getByText(/Waiting for confirmation: offline-photo/)).toBeVisible();
    await panel.getByRole('button',{name:'Retry upload'}).click();
    await expect(panel.getByText('Evidence saved on the server.',{exact:true})).toBeVisible();
    expect((await client.query("SELECT id FROM syncfield_field_evidence WHERE tenant_id=$1 AND daily_report_id=$2 AND file_name='offline-photo.png'",[seeded.tenantA,reportId])).rows).toHaveLength(1);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  });

  test("large evidence resumes received chunks after reload and stores one original",async({page},testInfo)=>{
    const uploadBytes=Number(process.env.SYNCOS_E2E_UPLOAD_BYTES??(2*1048576+17));expect(Number.isSafeInteger(uploadBytes)&&uploadBytes>1048576&&uploadBytes<=100*1048576).toBeTruthy();if(uploadBytes>2*1048576+17)test.setTimeout(180000);
    await installSession(page,seeded.foremanToken,seeded.foremanPermissions);await page.goto('/syncfield/production/review');
    const panel=page.getByRole('region',{name:'Photos and evidence'}),picture=Buffer.alloc(uploadBytes,0);picture.set([255,216,255]);let dropped=false;const indices:number[]=[];
    await page.route('**/syncfield/foreman/evidence-uploads/*/chunks',async route=>{const body=route.request().postDataJSON();indices.push(body.index);if(body.index===1&&!dropped){dropped=true;const result=await route.fetch();expect(result.ok()).toBeTruthy();await route.abort('failed');}else await route.continue();});
    const filePath=testInfo.outputPath('resumable-original.jpg');await fs.mkdir(testInfo.outputPath(),{recursive:true});await fs.writeFile(filePath,picture);await panel.getByLabel('Evidence file').setInputFiles(filePath);await panel.getByLabel('What does this evidence show?').fill('Synthetic resumable original');await panel.getByRole('button',{name:'Upload evidence',exact:true}).click();await expect(panel.getByRole('alert')).toBeVisible();await page.reload();await expect(panel.getByText(/Waiting for confirmation: resumable-original/)).toBeVisible();await panel.getByRole('button',{name:'Retry upload'}).click();await expect(panel.getByText('Evidence saved on the server.',{exact:true})).toBeVisible({timeout:uploadBytes>2*1048576+17?120000:15000});expect(indices).toEqual(Array.from({length:Math.ceil(uploadBytes/1048576)},(_,i)=>i));const rows=(await client.query("SELECT checksum,octet_length(content_bytes) size FROM syncfield_field_evidence WHERE tenant_id=$1 AND daily_report_id=$2 AND file_name='resumable-original.jpg'",[seeded.tenantA,reportId])).rows;expect(rows).toHaveLength(1);expect(rows[0].checksum).toBe(crypto.createHash('sha256').update(picture).digest('hex'));expect(rows[0].size).toBe(picture.length);await fs.unlink(filePath);
  });

  test("incident device draft survives disconnect and lost response without duplicate records or audit",async({page,context})=>{
    await installSession(page,seeded.foremanToken,seeded.foremanPermissions);
    await page.goto('/syncfield/today');
    const panel=page.locator('details').filter({has:page.locator('summary',{hasText:'Report an incident or near miss'})});
    await panel.locator('summary').click();
    await panel.getByLabel('When did it happen?').fill('2026-10-01T09:00');
    await panel.getByLabel('Location',{exact:true}).fill('Synthetic practice site');
    const description='Synthetic device-recovery incident '+crypto.randomUUID();
    await panel.getByLabel('What happened?').fill(description);
    await panel.getByLabel('Immediate action taken').fill('Training report only');
    await context.setOffline(true);
    await panel.getByRole('button',{name:'Record incident',exact:true}).click();
    await expect(panel.getByText(/Saved on this device; not received/)).toBeVisible();
    await context.setOffline(false);await page.reload();await panel.locator('summary').click();
    await expect(panel.getByText(description,{exact:true})).toBeVisible();
    let lost=false;
    await page.route('**/syncfield/foreman/incidents',async route=>{if(!lost&&route.request().method()==='POST'){lost=true;const response=await route.fetch();expect(response.ok()).toBeTruthy();await route.abort('failed');}else await route.continue();});
    await panel.getByRole('button',{name:'Retry incident'}).click();
    await expect(panel.getByRole('button',{name:'Retry incident'})).toBeEnabled();
    await page.reload();await panel.locator('summary').click();await panel.getByRole('button',{name:'Retry incident'}).click();
    await expect(panel.getByText('Incident recorded. Follow your supervisor’s reporting procedure.')).toBeVisible();
    const rows=(await client.query('SELECT id FROM syncfield_field_incidents WHERE tenant_id=$1 AND description=$2',[seeded.tenantA,description])).rows;expect(rows).toHaveLength(1);
    expect((await client.query('SELECT count(*)::int n FROM audit_logs WHERE tenant_id=$1 AND entity_id=$2',[seeded.tenantA,rows[0].id])).rows[0].n).toBe(1);
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
    // Simulate an interrupted in-flight request and an exhausted automatic retry budget.
    await page.evaluate(async ids=>{await new Promise<void>((resolve,reject)=>{const open=indexedDB.open('syncos-field-production',1);open.onsuccess=()=>{const db=open.result,tx=db.transaction('mutations','readwrite'),store=tx.objectStore('mutations');ids.forEach((id,index)=>{const get=store.get(id);get.onsuccess=()=>store.put({...get.result,status:index===0?'SYNCING':'FAILED',retryCount:index===0?1:3,lastAttemptAt:new Date().toISOString()});});tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(Error('fixture queue save failed'));};});},[queued[0].mutationId,queued[1].mutationId]);

    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(page.locator("h2").filter({ hasText: "Production" })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("Sync Failed", { exact: true }).first()).toBeVisible({ timeout: 15000 });
    await page.getByRole('button',{name:'Retry Sync',exact:true}).click();
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

    const decreasing = await createProduction(request, seeded, { client_mutation_id: crypto.randomUUID(), production_code_id: codes.FIBER, location_type: "route", from_asset_identifier: "Pole 12301", to_asset_identifier: "Pole 12312", map_page: 1, start_x_ratio: 0.4, start_y_ratio: 0.5, end_x_ratio: 0.6, end_y_ratio: 0.55, tick_start_label: "Pole 12301 start", tick_end_label: "Pole 12312 end", reel_cable_id: "REEL-A", fiber_type: "144ct", sequence_start: 14826, sequence_end: 14685, reported_quantity: 141, status: "partial" });
    expect(decreasing.sequence_direction).toBe("decreasing");
    expect(decreasing.sequence_calculated_footage).toBe(141);
    expect(decreasing.sequence_reported_variance).toBe(0);
    expect(decreasing.sequence_variance_status).toBe("within_tolerance");
    const increasing = await createProduction(request, seeded, { client_mutation_id: crypto.randomUUID(), production_code_id: codes.FIBER, location_type: "route", from_asset_identifier: "Pole 12312", to_asset_identifier: "Pole 12323", map_page: 1, start_x_ratio: 0.6, start_y_ratio: 0.55, end_x_ratio: 0.7, end_y_ratio: 0.6, tick_start_label: "Pole 12312 start", tick_end_label: "Pole 12323 end", reel_cable_id: "REEL-B", fiber_type: "144ct", sequence_start: 14685, sequence_end: 14826, reported_quantity: 141, status: "complete" });
    expect(increasing.sequence_direction).toBe("increasing");
    expect(increasing.sequence_calculated_footage).toBe(141);
    const missingVarianceExplanation = await request.post(apiUrl("/syncfield/foreman/production/records"), {
      headers: auth(seeded.foremanToken),
      data: { work_date: today(), client_mutation_id: crypto.randomUUID(), production_code_id: codes.FIBER, location_type: "route", from_asset_identifier: "Pole 12323", to_asset_identifier: "Pole 12334", map_page: 1, start_x_ratio: 0.7, start_y_ratio: 0.6, end_x_ratio: 0.8, end_y_ratio: 0.65, sequence_start: 14826, sequence_end: 12131, reported_quantity: 3000, status: "partial" },
    });
    expect(missingVarianceExplanation.status()).toBe(400);
    const varianceReview = await createProduction(request, seeded, { client_mutation_id: crypto.randomUUID(), production_code_id: codes.FIBER, location_type: "route", from_asset_identifier: "Pole 12323", to_asset_identifier: "Pole 12334", map_page: 1, start_x_ratio: 0.7, start_y_ratio: 0.6, end_x_ratio: 0.8, end_y_ratio: 0.65, tick_start_label: "Pole 12323 start", tick_end_label: "Pole 12334 end", reel_cable_id: "REEL-C", fiber_type: "288ct", sequence_start: 14826, sequence_end: 12131, reported_quantity: 3000, sequence_variance_explanation: "Customer requested additional slack loop footage.", status: "partial" });
    expect(varianceReview.sequence_calculated_footage).toBe(2695);
    expect(varianceReview.sequence_reported_variance).toBe(305);
    expect(varianceReview.sequence_variance_status).toBe("review_required");
    await createProduction(request, seeded, { client_mutation_id: crypto.randomUUID(), production_code_id: codes.LABOR, location_type: "daily", reported_quantity: 8, status: "complete", notes: "Crew labor hours" });

    const detail = await apiJson(request, seeded.foremanToken, "GET", "/syncfield/foreman/production/today");
    expect(detail.records).toHaveLength(8);
    expect(detail.annotations).toHaveLength(6);
    expect(detail.annotations.filter((row: Record<string, unknown>) => row.annotation_type === "tick_span")).toHaveLength(4);
    expect(detail.totals.record_count).toBe(8);
    expect(detail.totals.status_counts.complete).toBe(6);
    expect(detail.totals.status_counts.partial).toBe(2);
    expect(detail.totals.by_code.find((row: Record<string, unknown>) => row.code === "FIBER").quantity).toBe(3423);

    const badCoordinate = await request.post(apiUrl("/syncfield/foreman/production/records"), {
      headers: auth(seeded.foremanToken),
      data: { client_mutation_id: crypto.randomUUID(), production_code_id: codes.TRANSFER, location_type: "asset", asset_type: "pole", asset_identifier: "Bad", map_page: 1, x_ratio: 1.4, y_ratio: 0.5, reported_quantity: 1, status: "complete" },
    });
    expect(badCoordinate.status()).toBe(400);
  });

  test("a crew work shutdown blocks new records and requires authorized release",async({request})=>{
    const actor=JSON.parse(Buffer.from(seeded.internalToken.split('.')[1],'base64url').toString()).sub;
    const role=crypto.randomUUID();
    await client.query("INSERT INTO roles(id,tenant_id,name,system_key) VALUES($1,$2,'Safety Manager',$3)",[role,seeded.tenantA,'p9_safety_'+role]);
    for(const permission of ['stop_work.issue','stop_work.release'])await ensurePermission(client,permission);
    await grantPermissions(client,seeded.tenantA,role,['stop_work.issue','stop_work.release']);
    await client.query("INSERT INTO user_roles(tenant_id,tenant_user_id,role_id,scope_type,scope_id) SELECT tenant_id,id,$3,'tenant',tenant_id FROM tenant_users WHERE tenant_id=$1 AND user_id=$2",[seeded.tenantA,actor,role]);
    await apiJson(request,seeded.internalToken,'POST',`/production-records/${submittedRecordId}/stop-work`,{reason:'Synthetic shutdown drill',utility_strike:false});
    const before=(await client.query('SELECT count(*)::int AS n FROM production_records WHERE tenant_id=$1',[seeded.tenantA])).rows[0].n;
    const blocked=await request.post(apiUrl('/syncfield/foreman/production/records'),{headers:auth(seeded.foremanToken),data:{work_date:today(),client_mutation_id:crypto.randomUUID(),production_code_id:codes.LABOR,location_type:'daily',reported_quantity:1,status:'complete'}});
    expect(blocked.status()).toBe(400);expect(await blocked.text()).toContain('crew_work_order_stopped');
    expect((await client.query('SELECT count(*)::int AS n FROM production_records WHERE tenant_id=$1',[seeded.tenantA])).rows[0].n).toBe(before);
    expect((await request.post(apiUrl(`/production-records/${submittedRecordId}/release-stop-work`),{headers:auth(seeded.foremanToken),data:{release_reason:'Unauthorized'}})).status()).toBe(403);
    const premature=await request.post(apiUrl(`/production-records/${submittedRecordId}/release-stop-work`),{headers:auth(seeded.internalToken),data:{release_reason:'Single release must not suffice'}});expect(premature.status()).toBe(400);
    const control=(await client.query("SELECT id FROM work_safety_controls WHERE tenant_id=$1 AND source_production_record_id=$2 AND status='active'",[seeded.tenantA,submittedRecordId])).rows[0];
    for(const [kind,roleKey] of [['safety','safety_manager'],['operations','operations_manager']]){
      const approver=await safetyActor(seeded.tenantA,roleKey);
      await apiJson(request,approver,'POST',`/work-safety/controls/${control.id}/approvals`,{approval_kind:kind,approver_name:'Synthetic '+kind,approved_at:new Date().toISOString(),evidence_reference:'SYNTHETIC restart '+kind,verified:true});
    }
    expect((await client.query('SELECT stop_work_status FROM production_records WHERE tenant_id=$1 AND id=$2',[seeded.tenantA,submittedRecordId])).rows[0].stop_work_status).toBe('released');
    // The production creation event retains the JSA actually used after revision.
    const current=(await client.query('SELECT id FROM daily_jsas WHERE tenant_id=$1 AND current=true',[seeded.tenantA])).rows[0];
    const creation=(await client.query("SELECT after_state FROM audit_logs WHERE tenant_id=$1 AND entity_id=$2 AND after_state ? 'safety_jsa_id'",[seeded.tenantA,submittedRecordId])).rows;
    expect(creation.some(row=>row.after_state.safety_jsa_id===current.id)).toBe(true);
    await apiJson(request,seeded.foremanToken,'POST','/syncfield/foreman/jsa/today/revise',{work_date:today(),prior_jsa_id:current.id,revision_reason:'Synthetic restart following reviewed shutdown',work_location:'P8 Initial Work Area'});
    await completeJsa(request,seeded);
  });

  test("DesignSegment, pole observations, and redline completion preserve design, ticks, authority, and idempotency", async ({ request, page }) => {
    const segmentBody = {
      page_number: 1,
      production_code_id: codes.FIBER,
      from_asset_identifier: "15-12-2",
      to_asset_identifier: "15-12-4",
      design_label: "ARL019 span 15-12-2 to 15-12-4",
      design_quantity: 141,
      design_unit: "FT",
      design_length_ft: 141,
      geometry_type: "pdf_polyline",
      geometry: { points: [{ x: 0.22, y: 0.48 }, { x: 0.5, y: 0.5 }, { x: 0.78, y: 0.52 }] },
      source: "manual",
      source_reference: "ARL019 synthetic planned span",
    };
    const segment = await apiJson(request, seeded.internalToken, "POST", `/syncfield/organizations/${seeded.orgA}/map-versions/${seeded.mapVersionId}/design-segments`, segmentBody);
    designSegmentId = segment.id;
    expect(segment.map_version_id).toBe(seeded.mapVersionId);
    expect(segment.from_asset_identifier).toBe("15-12-2");
    expect(segment.status).toBe("active");

    const foremanDesignEdit = await request.post(apiUrl(`/syncfield/organizations/${seeded.orgA}/map-versions/${seeded.mapVersionId}/design-segments`), {
      headers: auth(seeded.foremanToken),
      data: { ...segmentBody, client_mutation_id: crypto.randomUUID() },
    });
    expect(foremanDesignEdit.status()).toBe(403);

    const crossTenantDesign = await request.get(apiUrl("/syncfield/foreman/design-segments"), { headers: auth(seeded.tenantBToken) });
    expect(crossTenantDesign.status()).toBeGreaterThanOrEqual(403);

    const assignedSegments = await apiJson(request, seeded.foremanToken, "GET", `/syncfield/foreman/design-segments?assignment_id=${seeded.assignmentId}`);
    expect(assignedSegments.some((row: Record<string, unknown>) => row.id === designSegmentId && row.completion_status === "not_started")).toBe(true);

    const standaloneObservationMutation = crypto.randomUUID();
    const standaloneObservation = await apiJson(request, seeded.foremanToken, "POST", "/syncfield/foreman/asset-observations", {
      client_mutation_id: standaloneObservationMutation,
      assignment_id: seeded.assignmentId,
      work_date: today(),
      design_segment_id: designSegmentId,
      page_number: 1,
      asset_type: "pole",
      asset_identifier: "15-12-2",
      pdf_x: 0.22,
      pdf_y: 0.48,
      input_tick: 14826,
      output_tick: 14780,
      reel_cable_id: "REEL-ARL019-A",
      fiber_type: "144ct",
    });
    expect(standaloneObservation.input_tick).toBe(14826);
    expect(standaloneObservation.output_tick).toBe(14780);
    expect(standaloneObservation.tick_difference).toBe(46);
    const repeatedPoleObservation = await apiJson(request, seeded.foremanToken, "POST", "/syncfield/foreman/asset-observations", {
      client_mutation_id: crypto.randomUUID(),
      assignment_id: seeded.assignmentId,
      work_date: today(),
      design_segment_id: designSegmentId,
      page_number: 1,
      asset_type: "pole",
      asset_identifier: "15-12-2",
      pdf_x: 0.23,
      pdf_y: 0.49,
      input_tick: 14800,
      output_tick: 14775,
      notes: "Second same-day field observation is allowed when traceability differs.",
    });
    expect(repeatedPoleObservation.id).not.toBe(standaloneObservation.id);
    expect(await downstreamCounts(client)).toEqual({ ...downstreamCountsBefore, production: downstreamCountsBefore.production + 8 });

    const partnerAdminWrite = await request.post(apiUrl("/syncfield/foreman/asset-observations"), {
      headers: auth(seeded.adminToken),
      data: { client_mutation_id: crypto.randomUUID(), assignment_id: seeded.assignmentId, work_date: today(), page_number: 1, asset_identifier: "15-12-X", pdf_x: 0.2, pdf_y: 0.2 },
    });
    expect(partnerAdminWrite.status()).toBe(403);

    const badAssignment = await request.post(apiUrl("/syncfield/foreman/asset-observations"), {
      headers: auth(seeded.foremanToken),
      data: { client_mutation_id: crypto.randomUUID(), assignment_id: crypto.randomUUID(), work_date: today(), page_number: 1, asset_identifier: "15-12-X", pdf_x: 0.2, pdf_y: 0.2 },
    });
    expect(badAssignment.status()).toBeGreaterThanOrEqual(400);

    const spanMutationId = crypto.randomUUID();
    const spanBody = {
      client_mutation_id: spanMutationId,
      assignment_id: seeded.assignmentId,
      work_date: today(),
      design_segment_id: designSegmentId,
      production_code_id: codes.FIBER,
      page_number: 1,
      from_asset_identifier: "15-12-2",
      to_asset_identifier: "15-12-4",
      reported_quantity: 141,
      sequence_start: 14780,
      sequence_end: 14639,
      reel_cable_id: "REEL-ARL019-A",
      fiber_type: "144ct",
      from_observation: { asset_type: "pole", asset_identifier: "15-12-2", pdf_x: 0.22, pdf_y: 0.48, input_tick: 14826, output_tick: 14780 },
      to_observation: { asset_type: "pole", asset_identifier: "15-12-4", pdf_x: 0.78, pdf_y: 0.52, input_tick: 14639, output_tick: 14600 },
      redline_geometry: { points: [{ x: 0.22, y: 0.48 }, { x: 0.5, y: 0.5 }, { x: 0.78, y: 0.52 }] },
      design_deviation: false,
      notes: "Completed against planned ARL019 span.",
    };
    const span = await apiJson(request, seeded.foremanToken, "POST", "/syncfield/foreman/span-completions", spanBody);
    spanCompletionId = span.id;
    expect(span.design_segment_id).toBe(designSegmentId);
    expect(span.production_record_id).toBeTruthy();
    expect(span.quantity_submitted).toBe(141);
    expect(span.from_asset_observation_id).toBeTruthy();
    expect(span.to_asset_observation_id).toBeTruthy();
    frontAssetObservationId = span.from_asset_observation_id;
    expect(span.redline_geometry.points).toHaveLength(3);
    expect(span.design_deviation).toBe(false);

    const frontCoilMutationId = crypto.randomUUID();
    const frontCoil = await apiJson(request, seeded.foremanToken, "POST", "/syncfield/foreman/coil-observations", {
      client_mutation_id: frontCoilMutationId,
      assignment_id: seeded.assignmentId,
      work_date: today(),
      asset_observation_id: span.from_asset_observation_id,
      design_segment_id: designSegmentId,
      span_completion_id: span.id,
      production_record_id: span.production_record_id,
      easement_type: "FRONT",
      coil_type: "FRONT_EASEMENT",
      required_length_ft: 150,
      actual_length_ft: 150,
      reel_cable_id: "R-327",
      fiber_type: "96CT",
      rule_source: "WORK_ORDER_RULE",
      rule_source_reference: "Default front easement slack requirement",
      notes: "Front easement coil installed at pole 15-12-2.",
    });
    frontCoilId = frontCoil.id;
    expect(frontCoil.asset_identifier).toBe("15-12-2");
    expect(frontCoil.required_length_ft).toBe(150);
    expect(frontCoil.actual_length_ft).toBe(150);
    expect(frontCoil.variance_ft).toBe(0);
    expect(frontCoil.variance_status).toBe("within_expectation");
    expect(frontCoil.commercial_treatment).toBe("not_configured");

    const retryFrontCoil = await apiJson(request, seeded.foremanToken, "POST", "/syncfield/foreman/coil-observations", {
      client_mutation_id: frontCoilMutationId,
      assignment_id: seeded.assignmentId,
      work_date: today(),
      asset_observation_id: span.from_asset_observation_id,
      coil_type: "FRONT_EASEMENT",
      required_length_ft: 150,
      actual_length_ft: 150,
    });
    expect(retryFrontCoil.id).toBe(frontCoil.id);

    const rearCoil = await apiJson(request, seeded.foremanToken, "POST", "/syncfield/foreman/coil-observations", {
      client_mutation_id: crypto.randomUUID(),
      assignment_id: seeded.assignmentId,
      work_date: today(),
      asset_observation_id: span.to_asset_observation_id,
      design_segment_id: designSegmentId,
      span_completion_id: span.id,
      production_record_id: span.production_record_id,
      easement_type: "REAR",
      coil_type: "REAR_EASEMENT",
      required_length_ft: 80,
      actual_length_ft: 82,
      reel_cable_id: "R-327",
      fiber_type: "96CT",
      rule_source: "WORK_ORDER_RULE",
      rule_source_reference: "Default rear easement slack requirement",
      notes: "Rear easement coil varied by two feet.",
    });
    rearCoilId = rearCoil.id;
    expect(rearCoil.asset_identifier).toBe("15-12-4");
    expect(rearCoil.variance_ft).toBe(2);
    expect(rearCoil.variance_status).toBe("within_expectation");

    const expressSplice = await apiJson(request, seeded.foremanToken, "POST", "/syncfield/foreman/coil-observations", {
      client_mutation_id: crypto.randomUUID(),
      assignment_id: seeded.assignmentId,
      work_date: today(),
      asset_observation_id: span.from_asset_observation_id,
      design_segment_id: designSegmentId,
      span_completion_id: span.id,
      production_record_id: span.production_record_id,
      easement_type: "NOT_APPLICABLE",
      coil_type: "EXPRESS_SPLICE",
      required_length_ft: 250,
      actual_length_ft: 250,
      rule_source: "CUSTOMER_DESIGN",
      rule_source_reference: "Design note at splice location",
    });
    expect(expressSplice.asset_identifier).toBe("15-12-2");

    const otherWithoutNotes = await request.post(apiUrl("/syncfield/foreman/coil-observations"), {
      headers: auth(seeded.foremanToken),
      data: {
        client_mutation_id: crypto.randomUUID(),
        assignment_id: seeded.assignmentId,
        work_date: today(),
        asset_observation_id: span.from_asset_observation_id,
        coil_type: "OTHER",
        required_length_ft: 10,
        actual_length_ft: 10,
      },
    });
    expect(otherWithoutNotes.status()).toBe(400);

    const partnerAdminCoilWrite = await request.post(apiUrl("/syncfield/foreman/coil-observations"), {
      headers: auth(seeded.adminToken),
      data: {
        client_mutation_id: crypto.randomUUID(),
        assignment_id: seeded.assignmentId,
        work_date: today(),
        asset_observation_id: span.from_asset_observation_id,
        coil_type: "FRONT_EASEMENT",
        required_length_ft: 150,
        actual_length_ft: 150,
      },
    });
    expect(partnerAdminCoilWrite.status()).toBe(403);

    const crossTenantCoilWrite = await request.post(apiUrl("/syncfield/foreman/coil-observations"), {
      headers: auth(seeded.tenantBToken),
      data: {
        client_mutation_id: crypto.randomUUID(),
        assignment_id: seeded.assignmentId,
        work_date: today(),
        asset_observation_id: span.from_asset_observation_id,
        coil_type: "FRONT_EASEMENT",
        required_length_ft: 150,
        actual_length_ft: 150,
      },
    });
    expect(crossTenantCoilWrite.status()).toBeGreaterThanOrEqual(400);

    const retry = await apiJson(request, seeded.foremanToken, "POST", "/syncfield/foreman/span-completions", spanBody);
    expect(retry.id).toBe(span.id);
    const duplicateRows = await client.query("SELECT count(*)::int AS count FROM syncfield_span_completions WHERE tenant_id = $1 AND client_mutation_id = $2", [seeded.tenantA, spanMutationId]);
    expect(duplicateRows.rows[0].count).toBe(1);

    const missingReason = await request.post(apiUrl("/syncfield/foreman/span-completions"), {
      headers: auth(seeded.foremanToken),
      data: { ...spanBody, client_mutation_id: crypto.randomUUID(), design_segment_id: null, from_asset_identifier: "15-12-5", to_asset_identifier: "15-12-6", design_deviation: true },
    });
    expect(missingReason.status()).toBe(400);
    const missingOtherNotes = await request.post(apiUrl("/syncfield/foreman/span-completions"), {
      headers: auth(seeded.foremanToken),
      data: { ...spanBody, client_mutation_id: crypto.randomUUID(), design_segment_id: null, from_asset_identifier: "15-12-5", to_asset_identifier: "15-12-6", design_deviation: true, deviation_reason: "OTHER" },
    });
    expect(missingOtherNotes.status()).toBe(400);

    const unchangedDesign = await client.query("SELECT status, geometry, design_length_ft FROM syncfield_design_segments WHERE tenant_id = $1 AND id = $2", [seeded.tenantA, designSegmentId]);
    expect(unchangedDesign.rows[0].status).toBe("active");
    expect(unchangedDesign.rows[0].design_length_ft).toBe("141.00");
    expect(unchangedDesign.rows[0].geometry.points).toHaveLength(3);

    const detail = await apiJson(request, seeded.foremanToken, "GET", "/syncfield/foreman/production/today");
    expect(detail.records).toHaveLength(9);
    expect(detail.annotations).toHaveLength(7);
    expect(detail.span_completions.some((row: Record<string, unknown>) => row.id === spanCompletionId)).toBe(true);
    expect(detail.asset_observations.some((row: Record<string, unknown>) => row.input_tick === 14826 && row.output_tick === 14780)).toBe(true);
    expect(detail.coil_observations.some((row: Record<string, unknown>) => row.id === frontCoilId && row.actual_length_ft === 150)).toBe(true);
    expect(detail.coil_observations.some((row: Record<string, unknown>) => row.id === rearCoilId && row.variance_ft === 2)).toBe(true);
    expect(detail.totals.coils.actual_coil_ft).toBe(482);
    expect(detail.totals.by_code.find((row: Record<string, unknown>) => row.code === "FIBER").quantity).toBe(3564);
    expect(await downstreamCounts(client)).toEqual({ ...downstreamCountsBefore, production: downstreamCountsBefore.production + 9 });

    await installSession(page, seeded.foremanToken, seeded.foremanPermissions);
    await page.goto("/syncfield/map");
    await expect(page.locator('iframe[title^="Assigned PDF map:"]')).toHaveAttribute("src", /^blob:.*#page=1&zoom=100$/);
    await expect(page.getByRole("heading", { name: "Production marks", exact: true })).toBeVisible();
    await expect(page.getByText("Planned Segments", { exact: true })).toBeVisible();
    await expect(page.getByText("Completed Redlines", { exact: true })).toBeVisible();
    await expect(page.getByText("Production marks are listed below; they are not drawn on this original PDF.", { exact: false })).toBeVisible();
    await expect(page.locator(".field-construction-list-item.design").getByText("15-12-2 -> 15-12-4")).toBeVisible();
    await expect(page.locator(".field-construction-list-item.redline").getByText("15-12-2 -> 15-12-4")).toBeVisible();
    await expect(page.getByText("Coil / Slack")).toBeVisible();
    await expect(page.getByText("482 FT actual")).toBeVisible();
  });

  test("submission creates immutable revision snapshot and blocks ordinary edits without QC or finance", async ({ page, request }) => {
    const beforeReadiness = await apiJson(request, seeded.foremanToken, "GET", "/partner-mobilization/foreman/readiness");
    await installSession(page, seeded.foremanToken, seeded.foremanPermissions);
    await page.goto("/syncfield/production/review");
    let firstMutationId = "";
    await page.route("**/syncfield/foreman/production/review-day/submit", async route => {
      firstMutationId = route.request().postDataJSON().client_mutation_id;
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "Temporary submission outage" }) });
    }, { times: 1 });
    await page.getByRole("button", { name: "Submit Daily Production" }).click();
    await expect(page.getByRole("alert").filter({hasText: "Temporary submission outage"})).toBeVisible();
    await expect(page.getByRole("button", { name: "Submit Daily Production" })).toBeEnabled();
    const responsePromise = page.waitForResponse(response => response.url().endsWith("/syncfield/foreman/production/review-day/submit") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Submit Daily Production" }).click();
    const submissionResponse = await responsePromise;
    expect(submissionResponse.ok()).toBe(true);
    expect(submissionResponse.request().postDataJSON().client_mutation_id).toBe(firstMutationId);
    const submitted = await submissionResponse.json();
    await expect(page.getByText("Daily production submitted. Records are read-only and awaiting customer QC.", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Submit Daily Production" })).toBeDisabled();
    expect(submitted.status).toBe("submitted");
    expect(submitted.records.every((record: Record<string, unknown>) => record.locked === true)).toBe(true);
    const revision = await client.query("SELECT snapshot_json FROM daily_production_report_revisions WHERE tenant_id = $1 AND daily_report_id = $2", [seeded.tenantA, submitted.id]);
    expect(revision.rowCount).toBe(1);
    expect(revision.rows[0].snapshot_json.records).toHaveLength(9);
    expect(revision.rows[0].snapshot_json.records.some((record: Record<string, unknown>) => record.sequence_variance_status === "review_required")).toBe(true);
    expect(revision.rows[0].snapshot_json.span_completions.some((span: Record<string, unknown>) => span.id === spanCompletionId)).toBe(true);
    expect(revision.rows[0].snapshot_json.asset_observations.some((observation: Record<string, unknown>) => observation.input_tick === 14826 && observation.output_tick === 14780)).toBe(true);
    expect(revision.rows[0].snapshot_json.coil_observations.some((coil: Record<string, unknown>) => coil.id === frontCoilId && coil.actual_length_ft === 150)).toBe(true);
    const lockedChildren = await client.query(
      `
      SELECT
        (SELECT count(*)::int FROM syncfield_asset_observations WHERE tenant_id = $1 AND daily_report_id = $2 AND status = 'submitted' AND submitted_revision_id IS NOT NULL) AS observations,
        (SELECT count(*)::int FROM syncfield_span_completions WHERE tenant_id = $1 AND daily_report_id = $2 AND completion_status = 'submitted' AND submitted_revision_id IS NOT NULL) AS spans,
        (SELECT count(*)::int FROM syncfield_coil_observations WHERE tenant_id = $1 AND daily_report_id = $2 AND status = 'submitted' AND submitted_revision_id IS NOT NULL) AS coils
      `,
      [seeded.tenantA, submitted.id],
    );
    expect(lockedChildren.rows[0].observations).toBeGreaterThanOrEqual(4);
    expect(lockedChildren.rows[0].spans).toBe(1);
    expect(lockedChildren.rows[0].coils).toBe(3);

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
    const coilAfterSubmit = await request.post(apiUrl("/syncfield/foreman/coil-observations"), {
      headers: auth(seeded.foremanToken),
      data: { client_mutation_id: crypto.randomUUID(), assignment_id: seeded.assignmentId, work_date: today(), asset_observation_id: frontAssetObservationId, coil_type: "FRONT_EASEMENT", required_length_ft: 150, actual_length_ft: 150 },
    });
    expect(coilAfterSubmit.status()).toBe(400);
    const afterReadiness = await apiJson(request, seeded.foremanToken, "GET", "/partner-mobilization/foreman/readiness");
    expect(afterReadiness.overall_status).toBe(beforeReadiness.overall_status);
    expect(await downstreamCounts(client)).toEqual({ ...downstreamCountsBefore, production: downstreamCountsBefore.production + 9 });

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
    await expect(page.getByText("In Progress", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Schedule Information Unavailable", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("submitted", { exact: true })).toHaveCount(0);
    await expect(page.getByText("in_progress", { exact: true })).toHaveCount(0);
    await expect(page.getByText("insufficient_schedule_data", { exact: true })).toHaveCount(0);
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
  test('required evidence blocks missing and unreadable handoffs, preserves originals and pins approved requirements',async({request,page})=>{
    test.setTimeout(90000);
    if(!codes){const all=await apiJson(request,seeded.foremanToken,'GET','/syncfield/foreman/production/codes');codes=Object.fromEntries(all.map((c:any)=>[c.code,c.id]));}
    const ops=await safetyActor(seeded.tenantA,'operations_manager');
    const approvePolicy=(requirements:Record<string,number>)=>apiJson(request,ops,'POST',`/work-safety/work-orders/${seeded.workOrderVersionId}/evidence-policy`,{requirements,capture_time_required:true,source_reference:'SYNTHETIC customer requires one readable after-work photo'});
    await installSession(page,ops,[]);await page.goto('/work-safety');
    await page.getByText(/WO-P8-A · version 1 · Reviewed/).click();
    await page.getByLabel('Minimum after files',{exact:true}).fill('1');
    await page.getByLabel('Governing customer requirements and approval reference').fill('SYNTHETIC customer requires one readable after-work photo');
    await page.getByRole('button',{name:'Approve evidence requirements',exact:true}).click();
    await expect(page.getByRole('status').filter({hasText:'Safety record saved'})).toBeVisible();
    const date=new Date();date.setUTCDate(date.getUTCDate()-1);const workDate=date.toISOString().slice(0,10);
    await completeJsa(request,seeded,workDate);
    const record=await createProduction(request,seeded,{work_date:workDate,client_mutation_id:crypto.randomUUID(),production_code_id:codes.LABOR,location_type:'daily',reported_quantity:1,status:'complete'});
    const report=record.daily_report_id;
    const submit=()=>request.post(apiUrl('/syncfield/foreman/production/review-day/submit'),{headers:auth(seeded.foremanToken),data:{work_date:workDate,client_mutation_id:crypto.randomUUID()}});
    const absent=await submit();expect(absent.status()).toBe(400);expect(await absent.text()).toContain('after');
    await ensurePermission(client,'customer_qc.completeness_review');
    const reviewer=await safetyActor(seeded.tenantA,'qc_manager');
    const role=(await client.query("SELECT id FROM roles WHERE tenant_id=$1 AND system_key='qc_manager'",[seeded.tenantA])).rows[0].id;
    await grantPermissions(client,seeded.tenantA,role,['customer_qc.completeness_review','daily_production.completeness_read','customer_qc.evidence_read','customer_qc.decision_record']);
    const body={daily_report_id:report,production_record_id:record.id,evidence_kind:'after',captured_at:new Date().toISOString(),capture_location:'Synthetic pole',file_name:'after.png',mime_type:'image/png',description:'Synthetic after-work evidence',content_base64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jLzQAAAAASUVORK5CYII=',client_mutation_id:crypto.randomUUID()};
    const first=await apiJson(request,seeded.foremanToken,'POST','/syncfield/foreman/evidence',body);
    await apiJson(request,reviewer,'POST',`/field-evidence/${first.id}/review`,{readability_status:'unreadable',review_notes:'Synthetic photo is too small to read a pole identifier',verified:true});
    const rejected=await submit();expect(rejected.status()).toBe(400);expect(await rejected.text()).toContain('after');
    const replacement=await apiJson(request,seeded.foremanToken,'POST','/syncfield/foreman/evidence',{...body,file_name:'replacement.png',client_mutation_id:crypto.randomUUID()});
    const changed=await request.post(apiUrl('/syncfield/foreman/evidence'),{headers:auth(seeded.foremanToken),data:{...body,capture_location:'Changed location'}});expect(changed.status()).toBe(400);
    expect((await submit()).ok()).toBe(true); // unreviewed uploads may reach the review queue
    const {requireEvidenceReady}=require('../../apps/api/dist/routes/field-evidence-readiness');
    await client.query('BEGIN');try{await expect(requireEvidenceReady(client,seeded.tenantA,report,true)).rejects.toThrow('not reviewed');}finally{await client.query('ROLLBACK');}
    // Synthetic assessment exercises the review control, not physical photo quality.
    await installSession(page,reviewer,['customer_qc.completeness_review','daily_production.completeness_read','customer_qc.evidence_read','customer_qc.decision_record']);
    await page.goto('/customer-qc');await page.getByLabel('Submitted daily report').selectOption(report);
    await expect(page.getByRole('button',{name:'Confirm completeness'})).toBeDisabled();
    const reviewForm=page.getByRole('form',{name:'Review replacement.png'});
    await reviewForm.getByLabel('Review findings').fill('Synthetic review-control fixture only; actual-phone readability is a separate acceptance test');
    await reviewForm.getByLabel('I opened the original and checked the required details.').check();
    await reviewForm.getByRole('button',{name:'Save evidence review'}).click();
    await expect(page.getByRole('status').filter({hasText:'Evidence readability review recorded'})).toBeVisible();
    await expect(page.getByRole('button',{name:'Confirm completeness'})).toBeEnabled();
    const customer=crypto.randomUUID();await client.query("INSERT INTO organizations(id,tenant_id,name,organization_type,status) VALUES($1,$2,'Synthetic evidence acceptance customer','customer','active')",[customer,seeded.tenantA]);
    await client.query('UPDATE work_orders SET qc_authority_organization_id=$3 WHERE tenant_id=$1 AND id=(SELECT work_order_id FROM partner_work_order_versions WHERE tenant_id=$1 AND id=$2)',[seeded.tenantA,seeded.workOrderVersionId,customer]);
    await page.getByRole('button',{name:'Confirm completeness'}).click();await expect(page.getByRole('status').filter({hasText:'Completeness confirmed'})).toBeVisible();
    await page.getByLabel('Customer source reference').fill('SYNTHETIC customer evidence decision');await page.getByRole('button',{name:'Open customer inspection cycle'}).click();await expect(page.getByRole('status').filter({hasText:'inspection cycle opened'})).toBeVisible();
    const detail=await apiJson(request,reviewer,'GET',`/syncfield/customer-qc/reports/${report}`);
    const quantityForm=page.getByRole('group',{name:'Quantity relationship',exact:true});
    await page.getByText(/LABOR.*Quantity review required/).click();
    await quantityForm.getByLabel('Stable work-item reference (primary or additional work)').fill(`synthetic-work-${record.id}`);
    await quantityForm.getByLabel('Governing work or additional-work approval reference').fill('SYNTHETIC assigned work');
    await quantityForm.getByLabel('Reconciliation findings').fill('Synthetic original unit counted once');
    await quantityForm.getByRole('button',{name:'Save quantity review'}).click();
    await expect(page.getByText(/LABOR.*primary work/)).toBeVisible();
    const noEvidence=await request.post(apiUrl(`/syncfield/customer-qc/cycles/${detail.cycles[0].id}/decisions`),{headers:auth(reviewer),data:{production_record_id:record.id,decision:'accepted',customer_accepted_quantity:1,client_mutation_id:crypto.randomUUID()}});expect(noEvidence.status()).toBe(400);
    await page.getByLabel('Production record',{exact:true}).selectOption(record.id);await page.getByLabel('Customer-accepted quantity').fill('1');
    await page.getByLabel('replacement.png · after',{exact:true}).check();await page.getByRole('button',{name:'Record customer decision',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Customer decision recorded'})).toBeVisible();
    const accepted=(await client.query('SELECT accepted_evidence_ids FROM customer_qc_decisions WHERE tenant_id=$1 AND production_record_id=$2',[seeded.tenantA,record.id])).rows[0];expect(accepted.accepted_evidence_ids).toEqual([replacement.id]);
    await approvePolicy({after:2});
    await client.query('BEGIN');try{const checked=await requireEvidenceReady(client,seeded.tenantA,report,true);expect(checked.policy.requirements).toEqual({after:1});}finally{await client.query('ROLLBACK');}
    const original=(await client.query('SELECT content_bytes,readability_status FROM syncfield_field_evidence WHERE tenant_id=$1 AND id=$2',[seeded.tenantA,first.id])).rows[0];expect(original.content_bytes.toString('base64')).toBe(body.content_base64);expect(original.readability_status).toBe('unreadable');
    const snapshot=(await client.query('SELECT snapshot_json FROM daily_production_report_revisions WHERE tenant_id=$1 AND daily_report_id=$2',[seeded.tenantA,report])).rows[0].snapshot_json;
    expect(snapshot.evidence.map((e:any)=>e.id)).toContain(replacement.id);
    expect(snapshot.evidence_policy_id).toBeTruthy();
  });
  test('quantity reconciliation excludes rock subsets and overlapping summaries and protects stable work identities',async({request})=>{
    if(!codes){const all=await apiJson(request,seeded.foremanToken,'GET','/syncfield/foreman/production/codes');codes=Object.fromEntries(all.map((c:any)=>[c.code,c.id]));}
    let prototype=(await client.query("SELECT * FROM production_records WHERE tenant_id=$1 AND status='submitted' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1",[seeded.tenantA])).rows[0];
    if(!prototype){
      await createProduction(request,seeded,{work_date:today(),client_mutation_id:crypto.randomUUID(),production_code_id:codes.LABOR,location_type:'daily',reported_quantity:1,status:'complete',notes:'Synthetic reconciliation fixture'});
      await apiJson(request,seeded.foremanToken,'POST','/syncfield/foreman/production/review-day/submit',{work_date:today(),end_time:'17:00',client_mutation_id:crypto.randomUUID()});
      prototype=(await client.query("SELECT * FROM production_records WHERE tenant_id=$1 AND status='submitted' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1",[seeded.tenantA])).rows[0];
    }
    const reviewer=await safetyActor(seeded.tenantA,'qc_manager');
    const reviewRole=(await client.query("SELECT id FROM roles WHERE tenant_id=$1 AND system_key='qc_manager'",[seeded.tenantA])).rows[0].id;
    await grantPermissions(client,seeded.tenantA,reviewRole,['customer_qc.completeness_review','daily_production.completeness_read']);
    const before=await apiJson(request,reviewer,'GET',`/syncfield/customer-qc/reports/${prototype.daily_production_report_id}`);
    const base=before.totals.by_code.find((r:any)=>r.code==='FIBER')?.quantity??0;
    const ids:string[]=[];
    for(const quantity of [886,180,404,144,548,886]){
      const id=crypto.randomUUID();ids.push(id);
      await client.query(`INSERT INTO production_records SELECT (jsonb_populate_record(NULL::production_records,to_jsonb(p)||$3::jsonb)).* FROM production_records p WHERE p.tenant_id=$1 AND p.id=$2`,[seeded.tenantA,prototype.id,JSON.stringify({id,quantity_submitted:quantity,quantity,claimed_quantity:quantity,unit:'LF',unit_type:'LF',syncfield_production_code_id:codes.FIBER,quantity_review_id:null,asset_identifier:null,from_asset_identifier:`SYNTHETIC-${id}-A`,to_asset_identifier:`SYNTHETIC-${id}-B`,client_mutation_id:crypto.randomUUID()})]);
    }
    const [installed,rock,first,second,summary,duplicate]=ids;
    const body=(disposition:string,id:string,refs:string[]=[])=>({disposition,canonical_reference:`synthetic-work-${id}`,related_record_ids:refs,source_reference:'SYNTHETIC reconciliation source',review_notes:'Synthetic quantity controls, not operational approval',client_mutation_id:crypto.randomUUID()});
    const review=(id:string,data:any,bearer=reviewer)=>request.post(apiUrl(`/production-quantity/${id}/review`),{headers:auth(bearer),data});
    expect((await review(installed,body('primary_work',installed),seeded.foremanToken)).status()).toBe(403);
    for(const id of [installed,first,second])expect((await review(id,body('primary_work',id))).ok()).toBeTruthy();
    const rockBody=body('included_subset',rock,[installed]);const originalReview=await review(rock,rockBody);expect(originalReview.ok(),await originalReview.text()).toBeTruthy();
    const firstResult=await originalReview.json();expect(firstResult.id).toBeTruthy();const replay=await review(rock,rockBody);expect((await replay.json()).id).toBe(firstResult.id);
    expect((await review(summary,body('summary',summary,[first,second]))).ok()).toBeTruthy();
    expect((await review(duplicate,{...body('primary_work',duplicate),canonical_reference:`synthetic-work-${installed}`})).status()).toBe(400);
    expect((await review(summary,body('summary',summary,[first,first]))).status()).toBe(400);
    const after=await apiJson(request,reviewer,'GET',`/syncfield/customer-qc/reports/${prototype.daily_production_report_id}`);
    const field=await apiJson(request,seeded.foremanToken,'GET',`/syncfield/foreman/production/today?work_date=${String(prototype.production_date instanceof Date?prototype.production_date.toISOString():prototype.production_date).slice(0,10)}`);
    expect(JSON.stringify(field)).not.toContain('SYNTHETIC reconciliation source');
    expect((await request.get(apiUrl(`/production-quantity/${rock}/candidates`),{headers:auth(seeded.foremanToken)})).status()).toBe(403);
    const choices=await apiJson(request,reviewer,'GET',`/production-quantity/${rock}/candidates`);expect(choices.some((choice:any)=>choice.id===installed&&choice.label.includes('886'))).toBe(true);
    // The unreviewed duplicate stays visible as reported work; reviewed references do not add quantity.
    expect(after.totals.by_code.find((r:any)=>r.code==='FIBER').quantity-base).toBe(886+404+144+886);
    expect(after.totals.excluded_reference_count).toBeGreaterThanOrEqual(2);
    const {requireReviewedProductionQuantity}=require('../../apps/api/dist/routes/production-quantity-integrity');
    await client.query('BEGIN');try{await expect(requireReviewedProductionQuantity(client,seeded.tenantA,rock)).rejects.toThrow(/not additional billable/);await expect(requireReviewedProductionQuantity(client,seeded.tenantA,duplicate)).rejects.toThrow(/Review the current/);}finally{await client.query('ROLLBACK');}
    const originals=await client.query('SELECT id,quantity_submitted FROM production_records WHERE tenant_id=$1 AND id=ANY($2::uuid[])',[seeded.tenantA,ids]);
    expect(Number(originals.rows.find(r=>r.id===installed).quantity_submitted)).toBe(886);expect(Number(originals.rows.find(r=>r.id===rock).quantity_submitted)).toBe(180);
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
  const adminPermissions = ["partner_context.read", "partner_actions.read", "partner_profile.read", "partner_compliance.summary.read", "partner_compliance.profile.read", "partner_compliance.w9.read", "partner_compliance.payment.read", "partner_compliance.insurance.read", "partner_workforce.worker.read", "partner_workforce.crew.read", "partner_workforce.readiness.read", "partner_agreement.read", "partner_agreement.artifact.read", "partner_work_order.read", "partner_work_order.rate.read", "partner_vehicle_assignment.read", "partner_vehicle_assignment.allocation.read", "partner_mobilization.read", "partner_notice.read", "partner_notice.acknowledge", "partner_map.read", "partner_jsa.read", "partner_jsa_history.read", "partner_daily_production.read_org", "partner_production.read_org"];
  const foremanPermissions = ["partner_context.read", "partner_actions.read", "partner_compliance.summary.read", "partner_workforce.foreman_roster.read", "partner_work_order.foreman_summary.read", "partner_mobilization.foreman.read", "partner_notice.foreman.read", "partner_notice.foreman.acknowledge", "partner_map.read_assigned", "partner_jsa.create", "partner_jsa.update_draft", "partner_jsa.complete", "partner_jsa.read_own", "partner_daily_production.read", "partner_daily_production.create", "partner_daily_production.update_draft", "partner_daily_production.delete_draft", "partner_daily_production.submit", "partner_production_record.create", "partner_production_record.update_draft", "partner_production_record.delete_draft", "partner_production_photo.create", "partner_field_sync.submit"];
  const internalPermissions = ["capacity_provider.read", "partner_mobilization.review", "partner_mobilization.evaluate", "partner_mobilization.approve", "partner_notice.issue", "syncfield_map.create", "syncfield_map.version.upload", "syncfield_map.read", "syncfield_map.assignment.manage", "syncfield_map.work_zone.manage", "syncfield_jsa.read_all", "daily_production.read_all", "daily_production.completeness_read"];
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
    for (const [label, value] of Object.entries({ "From pole": "Pole 12301", "To pole": "Pole 12312", "Reel / cable": "REEL-A", "Fiber type": "144ct", "Sequence start": "14826", "Sequence end": "14685", "Reported footage": "141", "Map page": "1", "Start across page (%)": "42", "Start down page (%)": "48", "End across page (%)": "66", "End down page (%)": "52" })) await form.getByLabel(label, { exact: true }).fill(value);
    await form.getByRole("button", { name: "Save Fiber Span" }).click();
  } else {
    const form = page.getByRole("form", { name: "Production entry" });
    await form.getByLabel("Quantity", { exact: true }).fill("1");
    if (kind === "asset") {
      await form.getByRole("combobox", { name: "Asset type", exact: true }).selectOption("pole");
      for (const [label, value] of Object.entries({ "Asset identifier": "Pole 12301", "Map page": "1", "Across page (%)": "42", "Down page (%)": "48" })) await form.getByLabel(label, { exact: true }).fill(value);
    }
    await form.getByLabel("Work notes", { exact: true }).fill("Observed pilot test work");
    await form.getByRole("button", { name: "Save production", exact: true }).click();
  }
}
