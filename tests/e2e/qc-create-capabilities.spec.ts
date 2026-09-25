import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { personas } from './fixtures/personas';
import { authHeaders } from './helpers/auth';

test.describe('QC create supported advanced capabilities', () => {
  test.use({ storageState: personas.qcManager.storageState });
  let foreignReviewer: string;
  let foreignSource: string;
  test.beforeAll(async () => {
    const db = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(db.hostname) || !/test|scope|browser|release/.test(db.pathname)) {
      throw new Error("QC capability fixtures require a disposable local test database");
    }
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      await client.query('BEGIN');
      const suffix = randomUUID();
      const tenant = (await client.query("INSERT INTO tenants (name,slug) VALUES ('Foreign QC fixture',$1) RETURNING id", [`qc-foreign-${suffix}`])).rows[0].id;
      foreignReviewer = (await client.query("INSERT INTO users (email,display_name,status) VALUES ($1,'Foreign QC Reviewer','active') RETURNING id", [`qc-foreign-${suffix}@syncos.test`])).rows[0].id;
      await client.query("INSERT INTO tenant_users (tenant_id,user_id,status) VALUES ($1,$2,'active')", [tenant, foreignReviewer]);
      const project = (await client.query("INSERT INTO projects (tenant_id,name,status) VALUES ($1,'Foreign QC project','ready_for_work') RETURNING id", [tenant])).rows[0].id;
      const provider = (await client.query("INSERT INTO capacity_providers (tenant_id,name,provider_type,verification_status,contract_status,status) VALUES ($1,'Foreign internal workforce','internal_workforce','verified','contracted','activated') RETURNING id", [tenant])).rows[0].id;
      const workOrder = (await client.query("INSERT INTO work_orders (tenant_id,project_id,title,work_order_name,work_type,expected_units,unit_type,status) VALUES ($1,$2,'Foreign QC work','Foreign QC work','fiber',1,'feet','approved') RETURNING id", [tenant, project])).rows[0].id;
      const production = (await client.query("INSERT INTO production_records (tenant_id,project_id,work_order_id,capacity_provider_id,production_date,quantity_submitted,quantity,unit_type,unit,status) VALUES ($1,$2,$3,$4,current_date,1,1,'feet','feet','submitted') RETURNING id", [tenant, project, workOrder, provider])).rows[0].id;
      foreignSource = (await client.query("INSERT INTO qc_reviews (tenant_id,production_record_id,work_order_id,project_id,reviewer_user_id,review_status) VALUES ($1,$2,$3,$4,$5,'pending') RETURNING id", [tenant, production, workOrder, project, foreignReviewer])).rows[0].id;
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { await client.end(); }
  });

  test('named selections and structured reasons persist without approving the review', async ({ page, request }) => {
    const base = process.env.API_BASE_URL;
    const headers = authHeaders(personas.qcManager.storageState);
    const optionsResponse = await request.get(`${base}/qc-review-create-options`, { headers });
    expect(optionsResponse.status()).toBe(200);
    const options = await optionsResponse.json();
    expect(options.reviewers.length).toBeGreaterThan(0);
    expect(options.reviewers.some((row: { id: string }) => row.id === foreignReviewer)).toBe(false);
    expect(options.sourceReviews.some((row: { id: string }) => row.id === foreignSource)).toBe(false);
    for (const row of options.reviewers) expect(Object.keys(row).sort()).toEqual(['display_name', 'id']);
    const productionResponse = await request.get(`${base}/production-records?archived=false`, { headers });
    expect(productionResponse.status()).toBe(200);
    const production = (await productionResponse.json())[0];
    expect(production?.id).toBeTruthy();
    const sourceResponse = await request.post(`${base}/qc-reviews`, { headers, data: {
      production_record_id: production.id, review_type: 'internal_qc', review_notes: 'Isolated QC create capability source',
    } });
    expect(sourceResponse.ok()).toBeTruthy();
    const sourceResult = await sourceResponse.json();
    const source = sourceResult.qc_review;
    expect(source.reviewer_user_id).toBeTruthy();
    expect(source.reviewer_user_id).toBe(source.created_by);
    const reviewer = options.reviewers.find((row: { id: string }) => row.id !== source.reviewer_user_id);
    expect(reviewer).toBeTruthy();
    await page.goto('/qc/new');
    await expect(page.getByRole('combobox', { name: 'Reviewer', exact: true }).locator(`option[value="${reviewer.id}"]`)).toHaveText(reviewer.display_name);
    await expect(page.getByRole('combobox', { name: 'Reviewer', exact: true })).toHaveValue('');
    await page.getByRole('combobox', { name: 'Production Record', exact: true }).selectOption(production.id);
    await page.getByRole('combobox', { name: 'Reviewer', exact: true }).selectOption(reviewer.id);
    await page.getByText('Advanced review details', { exact: true }).click();
    await page.getByRole('combobox', { name: 'Source QC review', exact: true }).selectOption(source.id);
    await page.getByLabel('Quantity override reason', { exact: true }).fill('Quantity exception context');
    await page.getByLabel('Billable candidate override reason', { exact: true }).fill('Candidate exception context');
    await page.getByLabel('Self-approval override reason', { exact: true }).fill('Independent review exception context');
    const submitted = page.waitForResponse(response => response.url().endsWith('/qc-reviews') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Create QC Review', exact: true }).click();
    const response = await submitted;
    expect(response.ok()).toBeTruthy();
    const result = await response.json();
    const created = result.qc_review;
    const persistedResponse = await request.get(`${base}/qc-reviews/${created.id}/detail`, { headers });
    expect(persistedResponse.status()).toBe(200);
    const persisted = (await persistedResponse.json()).qc_review;
    expect(persisted.reviewer_user_id).toBe(reviewer.id);
    expect(persisted.source_qc_review_id).toBe(source.id);
    expect(persisted.review_status).toBe('pending');
    expect(persisted.override_reasons).toEqual({
      admin_override_reason: 'Quantity exception context',
      override_reason: 'Candidate exception context',
      self_approval_override_reason: 'Independent review exception context',
    });
    for (const invalid of [{ reviewer_user_id: foreignReviewer }, { source_qc_review_id: foreignSource }, { reviewer_user_id: randomUUID() }, { source_qc_review_id: randomUUID() }]) {
      const denied = await request.post(`${base}/qc-reviews`, { headers, data: { production_record_id: production.id, ...invalid } });
      expect(denied.status()).toBe(404);
    }
  });

  test('QC Manager findings request corrections without accepting or billing production', async ({ request, page }) => {
    const base = process.env.API_BASE_URL;
    const headers = authHeaders(personas.qcManager.storageState);
    const records = await (await request.get(`${base}/production-records?archived=false`, { headers })).json();
    const db = new Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    try {
      const id = randomUUID();
      await db.query(`INSERT INTO production_records (id,tenant_id,project_id,work_order_id,capacity_provider_id,production_date,quantity_submitted,quantity,claimed_quantity,unit_type,unit,status)
        SELECT $1,tenant_id,project_id,work_order_id,capacity_provider_id,current_date,5,5,5,unit_type,unit,'submitted' FROM production_records WHERE id=$2`, [id, records[0].id]);
      const created = await request.post(`${base}/qc-reviews`, { headers, data: {production_record_id:id,review_type:'internal_qc',review_notes:'Failed QC: required evidence is missing.'} });
      expect(created.ok(), await created.text()).toBeTruthy();
      const review = (await created.json()).qc_review;
      const path = `${base}/qc-reviews/${review.id}/request-correction`;
      const data = {correction_reason:'Required evidence is missing.',correction_required_quantity:5};
      expect((await request.post(path,{headers,data:{}})).status()).toBe(400);
      expect((await request.post(path,{headers:authHeaders(personas.readOnlyAuditor.storageState),data})).status()).toBe(403);
      await page.goto(`/qc/${review.id}`);
      await page.getByRole('button',{name:'Request Correction',exact:true}).click();
      const modal=page.locator('form.modal-card');
      await modal.getByLabel('Correction reason',{exact:true}).fill(data.correction_reason);
      await modal.getByLabel('Correction required quantity',{exact:true}).fill('5');
      const submitted=page.waitForResponse(r=>r.url().endsWith(`/qc-reviews/${review.id}/request-correction`)&&r.request().method()==='POST');
      await modal.getByRole('button',{name:'Request Correction',exact:true}).click();
      const response=await submitted;
      expect(response.status(),await response.text()).toBe(201);
      const saved = (await db.query('SELECT review_status,correction_reason,reviewer_user_id FROM qc_reviews WHERE id=$1',[review.id])).rows[0];
      expect(saved.review_status).toBe('correction_required');
      expect(saved.correction_reason).toBe(data.correction_reason);
      expect(saved.reviewer_user_id).toBe(review.created_by);
      const production = (await db.query('SELECT status,approved_quantity,billable_quantity FROM production_records WHERE id=$1',[id])).rows[0];
      expect(production.status).toBe('correction_required');
      expect(Number(production.approved_quantity ?? 0)).toBe(0);
      expect(Number(production.billable_quantity ?? 0)).toBe(0);
    } finally { await db.end(); }
  });

  test('read-only actor cannot enumerate create choices or create a review', async ({ request }) => {
    const headers = authHeaders(personas.readOnlyAuditor.storageState);
    expect((await request.get(`${process.env.API_BASE_URL}/qc-review-create-options`, { headers })).status()).toBe(403);
    expect((await request.post(`${process.env.API_BASE_URL}/qc-reviews`, { headers, data: { production_record_id: randomUUID() } })).status()).toBe(403);
  });
});
