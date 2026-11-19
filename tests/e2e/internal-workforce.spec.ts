import {approveFixtureCommercialTerms,verifyInvoicePackageLifecycle} from "./helpers/commercial-approval";
import {reviewFixtureQuantity} from "./helpers/quantity-review";
import { verifySafetyLifecycle } from "./helpers/safety-lifecycle";
import { acknowledgeFixtureJsa } from "./helpers/individual-safety";
import { test, expect, type APIRequestContext } from '@playwright/test';
import { Client } from 'pg';
import crypto from 'node:crypto';
function token(user: string, tenant: string) { const h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'); const p = Buffer.from(JSON.stringify({ sub: user, tenant_id: tenant, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url'); return `${h}.${p}.${crypto.createHmac('sha256', process.env.AUTH_JWT_SECRET!).update(`${h}.${p}`).digest('base64url')}`; }
async function api(r: APIRequestContext, bearer: string, path: string, data?: any) { const response = await r.fetch(`${process.env.API_BASE_URL}/${path}`, { method: data ? 'POST' : 'GET', headers: { authorization: `Bearer ${bearer}` }, data }); expect(response.ok(), `${path}: ${await response.text()}`).toBeTruthy(); return response.json(); }
test('Sync management provisions a real internal crew through field production with strict readiness and access boundaries', async ({ request, page }) => {
    test.setTimeout(120000);
    const db = new Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    try {
        const admin = (await db.query(`SELECT tu.tenant_id,tu.user_id FROM tenant_users tu JOIN user_roles ur ON ur.tenant_user_id=tu.id JOIN roles r ON r.id=ur.role_id WHERE r.system_key='system_admin' AND ur.scope_type='tenant' ORDER BY tu.created_at LIMIT 1`)).rows[0];
        const t = admin.tenant_id;
        // Fixture provisioning only: transactions below use distinct business actors,
        // never the system administrator discovered above.
        async function actor(key: string, grants: string[]) {
            const user = crypto.randomUUID(), membership = crypto.randomUUID();
            const role = (await db.query("SELECT id FROM roles WHERE tenant_id=$1 AND system_key=$2 AND deleted_at IS NULL", [t, key])).rows[0];
            expect(role, `canonical role ${key}`).toBeTruthy();
            await db.query("INSERT INTO users(id,email,display_name) VALUES($1,$2,$3)", [user, `${user}@syncos.test`, `Scope ${key}`]);
            await db.query("INSERT INTO tenant_users(id,tenant_id,user_id) VALUES($1,$2,$3)", [membership,t,user]);
            // Explicit fixture permission contract; no wildcard/admin grants.
            for (const grant of grants) await db.query("INSERT INTO role_permissions(tenant_id,role_id,permission_id) SELECT $1,$2,id FROM permissions WHERE key=$3 ON CONFLICT DO NOTHING",[t,role.id,grant]);
            await db.query("INSERT INTO user_roles(tenant_id,tenant_user_id,role_id,scope_type,scope_id) VALUES($1,$2,$3,'tenant',$1)",[t,membership,role.id]);
            const bearer=token(user,t);
            const identity=await api(request,bearer,'auth/me');
            expect(identity.roles).not.toContain('system_admin');
            return bearer;
        }
        const management = await actor('operations_manager', ['form.manage','form.read','inventory.manage','inventory.read','crew.read','crew.create','worker.create','work_order.assign','work_order.start','syncfield_map.create','syncfield_map.version.upload','syncfield_map.assignment.manage']);
        const customerQc = await actor('qc_manager', ['customer_qc.completeness_review','customer_qc.decision_record']);
        const finance = await actor('billing_manager', ['billing.create_billable','billing.create_invoice','contract.read','contract.update','invoice.read','invoice.update','invoice.mark_sent','invoice.approve']);
        const collections = await actor('finance_manager', ['cash_receipt.record','payment_application.create']);
        const org = crypto.randomUUID();
        const customer = crypto.randomUUID();
        const schedule = crypto.randomUUID();
        const project = crypto.randomUUID();
        const wo = crypto.randomUUID();
        await db.query("INSERT INTO organizations (id,tenant_id,name,status) VALUES ($1,$2,'Synthetic Sync operating company','active')", [org, t]);
        const email = `${crypto.randomUUID()}@syncos.test`;
        const invitation = await api(request, management, 'internal-workforce/accounts', { email, display_name: 'Synthetic employee foreman' });
        const staff = invitation.id;
        const replaced = await api(request, management, 'internal-workforce/accounts', { email, display_name: 'Synthetic employee foreman' });
        const oldToken = new URL(invitation.activation_path, 'http://localhost').searchParams.get('token');
        expect((await request.post(`${process.env.API_BASE_URL}/internal-workforce/activate`, { data: { token: oldToken, password: 'Synthetic-test-password-2026' } })).status()).toBe(400);
        invitation.activation_path = replaced.activation_path;
        const activationToken = new URL(invitation.activation_path, 'http://localhost').searchParams.get('token');
        const activation = { token: activationToken, password: 'Synthetic-test-password-2026' };
        const activated = await request.post(`${process.env.API_BASE_URL}/internal-workforce/activate`, { data: activation });
        expect(activated.ok(), await activated.text()).toBeTruthy();
        expect((await request.post(`${process.env.API_BASE_URL}/internal-workforce/activate`, { data: activation })).status()).toBe(400);
        const login = await request.post(`${process.env.API_BASE_URL}/auth/login`, { data: { email, password: activation.password } });
        expect(login.ok(), await login.text()).toBeTruthy();
        await db.query("INSERT INTO projects (id,tenant_id,name,status) VALUES ($1,$2,'Synthetic internal project','active')", [project, t]);
        await db.query("INSERT INTO work_orders (id,tenant_id,project_id,title,work_type,expected_units,unit_type,status,work_order_number) VALUES ($1,$2,$3,'Internal aerial work','fiber',1000,'feet','assigned',$4)", [wo, t, project, `SYNC-${wo.slice(0, 8)}`]);
        await db.query("INSERT INTO organizations (id,tenant_id,name,organization_type,status) VALUES ($1,$2,'Synthetic customer','customer','active')", [customer, t]);
        await db.query("INSERT INTO rate_schedules (id,tenant_id,organization_id,name,effective_date,status) VALUES ($1,$2,$3,'Synthetic customer rates','2026-01-01','active')", [schedule, t, customer]);
        await db.query("INSERT INTO rate_codes (tenant_id,rate_schedule_id,code,description,unit,unit_type,amount,customer_rate,status) VALUES ($1,$2,'LABOR','Crew labor','hours','hours',100,100,'active')", [t, schedule]);
        await db.query("INSERT INTO rate_codes (tenant_id,rate_schedule_id,code,description,unit,unit_type,amount,customer_rate,status) VALUES ($1,$2,'FIBER','Fiber placement','feet','feet',2,2,'active'),($1,$2,'POLE-ATT','Pole attachment','each','each',50,50,'active')",[t,schedule]);
        const approvedContract=await approveFixtureCommercialTerms(db,request,finance,t,schedule,'customer',10);
        await db.query("UPDATE projects SET customer_organization_id=$3 WHERE tenant_id=$1 AND id=$2", [t, project, customer]);
        await db.query("UPDATE work_orders SET customer_rate_schedule_id=$3,qc_authority_organization_id=$4 WHERE tenant_id=$1 AND id=$2", [t, wo, schedule, customer]);
        const crew = await api(request, management, 'internal-workforce/crews', { organization_id: org, name: 'Sync employee crew', crew_type: 'aerial', target_staffing_level: 1 });
        const worker = await api(request, management, `internal-workforce/crews/${crew.id}/members`, { first_name: 'Synthetic', last_name: 'Foreman', role: 'foreman', user_id: staff });
        const employee = token(staff, t);
        const identity = await api(request, employee, 'syncfield/foreman/context');
        expect(identity.workforce_kind).toBe('internal');
        expect(identity.capacity_provider.provider_type).toBe('internal_workforce');
        const auth = await api(request, employee, 'auth/me');
        expect(auth.routing.workspace).toBe('/syncfield/today');
        expect((await request.get(`${process.env.API_BASE_URL}/partner-personas/me/context`, { headers: { authorization: `Bearer ${employee}` } })).status()).toBe(403);
        expect((await request.get(`${process.env.API_BASE_URL}/internal-workforce`, { headers: { authorization: `Bearer ${employee}` } })).status()).toBe(403);
        const assignment = await api(request, management, 'internal-workforce/assignments', { crew_id: crew.id, work_order_id: wo, scope_summary: 'Aerial fiber', work_area: 'Synthetic block', map_reference: 'CUSTOMER-01' });
        expect(assignment.execution_model).toBe('internal');
        expect(assignment.governing_agreement_version_id).toBeNull();
        const managerAuth = await api(request, management, 'auth/me');
        const setupPage = await page.context().newPage();
        await setupPage.addInitScript(({ bearer, permissions }) => { localStorage.setItem('syncos.apiToken', bearer); localStorage.setItem('syncos.permissions', permissions.join(',')); }, { bearer: management, permissions: managerAuth.permissions });
        await setupPage.goto('/field-setup');
        await setupPage.getByRole('combobox', {name:/^Work assignment/}).selectOption(assignment.id);
        await setupPage.getByLabel('Map name').fill('Customer map');
        await setupPage.getByLabel('Revision', { exact: true }).fill('A');
        await setupPage.getByLabel('Source / customer').fill('Synthetic customer');
        await setupPage.getByLabel('Customer map PDF').setInputFiles({ name: 'map.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n1 0 obj << /Type /Page /MediaBox [0 0 612 792] >> endobj\n%%EOF') });
        await setupPage.getByRole('button', { name: 'Upload and assign map' }).click();
        await expect(setupPage.getByRole('status')).toContainText('Map assigned');
        await setupPage.close();
        const date = new Date().toISOString().slice(0, 10);
        const produce = () => request.post(`${process.env.API_BASE_URL}/syncfield/foreman/production/today`, { headers: { authorization: `Bearer ${employee}` }, data: { work_date: date, client_mutation_id: crypto.randomUUID() } });
        expect((await produce()).status()).toBe(400);
        const checklist = Object.fromEntries(['customer_authorization', 'crew_qualifications', 'insurance', 'equipment_inspection', 'safety_plan'].map(k => [k, true]));
        const invalidDecision=await request.post(`${process.env.API_BASE_URL}/internal-workforce/assignments/${assignment.id}/clearance`,{headers:{authorization:`Bearer ${management}`},data:{status:'typo',checklist,evidence_reference:'SYNTHETIC',valid_until:date}});expect(invalidDecision.status()).toBe(400);
        await api(request, management, `internal-workforce/assignments/${assignment.id}/clearance`, { status: 'authorized', checklist, evidence_reference: 'SYNTHETIC-READINESS-PACK', valid_until: date });
        await api(request, management, `work-safety/work-orders/${assignment.id}/scope-review`, {pre_bore_required:false,evidence_reference:'SYNTHETIC aerial-only scope'});
        await api(request,management,`work-safety/work-orders/${assignment.id}/evidence-policy`,{requirements:{},capture_time_required:false,source_reference:'SYNTHETIC fixture baseline: evidence requirements tested independently'});
        expect((await produce()).status()).toBe(400); // daily JSA still mandatory
        await api(request, employee, 'syncfield/foreman/jsa/today/complete', { work_date: date, work_location: 'Synthetic block', hazards: ['traffic'], controls: ['ppe_reviewed', 'emergency_procedures_reviewed', 'stop_work_authority_reviewed'], foreman_certified: true });
        const originalJsa = await api(request, employee, `syncfield/foreman/jsa/today?work_date=${date}`);
        const revision = await api(request, employee, 'syncfield/foreman/jsa/today/revise', { work_date: date, prior_jsa_id: originalJsa.id, revision_reason: 'Moved to next synthetic block', work_location: 'Synthetic second block' });
        expect(revision.status).toBe('draft');
        expect((await produce()).status()).toBe(400);
        await api(request, employee, 'syncfield/foreman/jsa/today/complete', { work_date: date, work_location: 'Synthetic second block', hazards: ['traffic'], controls: ['ppe_reviewed', 'emergency_procedures_reviewed', 'stop_work_authority_reviewed'], foreman_certified: true });
        const history = (await db.query('SELECT status,current,work_location FROM daily_jsas WHERE tenant_id=$1 AND crew_id=$2 ORDER BY revision_number',[t,crew.id])).rows;
        expect(history).toEqual([{status:'completed',current:false,work_location:'Synthetic block'},{status:'completed',current:true,work_location:'Synthetic second block'}]);
        expect((await db.query('SELECT acknowledged FROM daily_jsa_participants WHERE tenant_id=$1 AND daily_jsa_id=$2',[t,revision.id])).rows.every(row=>row.acknowledged===false)).toBe(true);
        expect((await produce()).status()).toBe(400); // every present worker must personally acknowledge
        await acknowledgeFixtureJsa(request,t,revision.id);
        await verifySafetyLifecycle(request,t,assignment.id,employee,date);
        expect((await produce()).ok()).toBeTruthy();
        const codes = await api(request, employee, 'syncfield/foreman/production/codes');
        const code = codes.find((r: any) => r.code === 'LABOR');
        const record = await api(request, employee, 'syncfield/foreman/production/records', { work_date: date, client_mutation_id: crypto.randomUUID(), production_code_id: code.id, location_type: 'daily', reported_quantity: 8, status: 'complete', notes: 'Synthetic employee work' });
        expect(record.id).toBeTruthy();
        const fieldAssignment=await api(request,employee,'syncfield/foreman/map-assignment');
        const form=await api(request,management,'supplemental-forms/versions',{request_key:crypto.randomUUID(),schema:{name:'Internal crew notes',fields:[{key:'note',label:'Note',type:'text',required:true}]}});
        await api(request,management,`supplemental-forms/versions/${form.id}/publish`,{approved:true});
        await api(request,management,'supplemental-forms/assignments',{version_id:form.id,assignment_id:fieldAssignment.id,active:true});
        const answer={assignment_id:fieldAssignment.id,version_id:form.id,request_key:crypto.randomUUID(),answers:{note:'Synthetic Sync observation'}};
        const formResponse=await api(request,employee,'syncfield/foreman/supplemental-forms',answer);
        expect((await api(request,employee,'syncfield/foreman/supplemental-forms',answer)).id).toBe(formResponse.id);
        const lot=await api(request,management,'material-inventory/lots',{label:'Synthetic fiber',serial_number:crypto.randomUUID(),unit:'feet'});
        const location=await api(request,management,'material-inventory/locations',{label:'Synthetic crew custody '+crypto.randomUUID(),crew_id:crew.id});
        await api(request,management,'material-inventory/movements',{lot_id:lot.id,to_location_id:location.id,kind:'receipt',quantity:'100',reference:'SYNTHETIC RECEIPT',reason:'Acceptance fixture',request_key:crypto.randomUUID()});
        const materials=await api(request,employee,`syncfield/foreman/materials?assignment_id=${fieldAssignment.id}`);expect(materials.balances.find((x:any)=>x.lot_id===lot.id).balance).toBe('100.0000');
        const materialUse={assignment_id:fieldAssignment.id,lot_id:lot.id,from_location_id:location.id,work_order_id:wo,work_date:date,kind:'installed',quantity:'10',reference:'SYNTHETIC INSTALL',reason:'Acceptance fixture',request_key:crypto.randomUUID()};
        const usage=await api(request,employee,'syncfield/foreman/materials',materialUse);expect((await api(request,employee,'syncfield/foreman/materials',materialUse)).id).toBe(usage.id);
        expect((await api(request,employee,`syncfield/foreman/materials?assignment_id=${fieldAssignment.id}`)).balances.find((x:any)=>x.lot_id===lot.id).balance).toBe('90.0000');

        // Scoped shutdown fixture: queued/new work must be rechecked by the server.
        await db.query("UPDATE production_records SET stop_work_status='active' WHERE tenant_id=$1 AND id=$2",[t,record.id]);
        const queuedBody = {work_date:date,client_mutation_id:crypto.randomUUID(),production_code_id:code.id,location_type:'daily',reported_quantity:1,status:'complete'};
        const stopped = await request.post(`${process.env.API_BASE_URL}/syncfield/foreman/production/records`,{headers:{authorization:`Bearer ${employee}`},data:queuedBody});
        expect(stopped.status()).toBe(400);expect(await stopped.text()).toContain('crew_work_order_stopped');
        expect((await request.post(`${process.env.API_BASE_URL}/syncfield/foreman/supplemental-forms`,{headers:{authorization:`Bearer ${employee}`},data:{...answer,request_key:crypto.randomUUID()}})).status()).toBe(400);
        expect((await request.post(`${process.env.API_BASE_URL}/syncfield/foreman/materials`,{headers:{authorization:`Bearer ${employee}`},data:{...materialUse,request_key:crypto.randomUUID()}})).status()).toBe(400);

        expect((await api(request,employee,'syncfield/foreman/materials',materialUse)).id).toBe(usage.id); // Existing movement is reconciled during a stop; no second deduction.
        await db.query("UPDATE production_records SET stop_work_status='released' WHERE tenant_id=$1 AND id=$2",[t,record.id]);
        const photo=Buffer.alloc(3500000);photo.set([255,216,255]);
        const evidenceBody={daily_report_id:record.daily_report_id,production_record_id:record.id,file_name:'synthetic-photo.jpg',mime_type:'image/jpeg',description:'Synthetic crossing evidence',content_base64:photo.toString('base64'),client_mutation_id:crypto.randomUUID()};
        const evidence=await api(request,employee,'syncfield/foreman/evidence',evidenceBody);
        const evidenceRetry=await api(request,employee,'syncfield/foreman/evidence',evidenceBody);expect(evidenceRetry.id).toBe(evidence.id);
        const changedEvidence=await request.post(`${process.env.API_BASE_URL}/syncfield/foreman/evidence`,{headers:{authorization:`Bearer ${employee}`},data:{...evidenceBody,description:'Different content'}});expect(changedEvidence.status()).toBe(400);
        const fiber=await api(request,employee,'syncfield/foreman/production/records',{work_date:date,client_mutation_id:crypto.randomUUID(),production_code_id:codes.find((r:any)=>r.code==='FIBER').id,location_type:'route',from_asset_identifier:'P-1',to_asset_identifier:'P-2',map_page:1,start_x_ratio:0.2,start_y_ratio:0.3,end_x_ratio:0.6,end_y_ratio:0.3,reported_quantity:10,status:'complete'});
        const pole=await api(request,employee,'syncfield/foreman/production/records',{work_date:date,client_mutation_id:crypto.randomUUID(),production_code_id:codes.find((r:any)=>r.code==='POLE-ATT').id,location_type:'asset',asset_type:'pole',asset_identifier:'P-1',map_page:1,x_ratio:0.2,y_ratio:0.3,reported_quantity:1,status:'complete'});
        await page.addInitScript(({ bearer, permissions }) => { localStorage.setItem('syncos.apiToken', bearer); localStorage.setItem('syncos.permissions', permissions.join(',')); }, { bearer: employee, permissions: auth.permissions });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto('/syncfield/production');
        await expect(page.getByRole('heading', { name: 'Production', exact: true })).toBeVisible();
        await api(request, management, `internal-workforce/assignments/${assignment.id}/clearance`, { status: 'held', evidence_reference: 'SYNTHETIC-HOLD', valid_until: date });
        const blocked = await request.post(`${process.env.API_BASE_URL}/syncfield/foreman/production/records`, { headers: { authorization: `Bearer ${employee}` }, data: { work_date: date, client_mutation_id: crypto.randomUUID(), production_code_id: code.id, location_type: 'daily', reported_quantity: 1, status: 'complete' } });
        expect(blocked.status()).toBe(400);
        const editOnHold = await request.post(`${process.env.API_BASE_URL}/syncfield/foreman/production/records/${record.id}`, { headers: { authorization: `Bearer ${employee}` }, data: { client_mutation_id: crypto.randomUUID(), reported_quantity: 9 } });
        expect(editOnHold.status()).toBe(400);
        await api(request, management, `internal-workforce/assignments/${assignment.id}/clearance`, { status: 'authorized', checklist, evidence_reference: 'SYNTHETIC-REVIEWED', valid_until: date });
        const submitted = await api(request, employee, 'syncfield/foreman/production/review-day/submit', { work_date: date, client_mutation_id: crypto.randomUUID() });
        expect(submitted.status).toBe('submitted');
        expect((await request.post(`${process.env.API_BASE_URL}/syncfield/customer-qc/reports/${submitted.id}/complete`, {headers:{authorization:`Bearer ${employee}`},data:{qc_authority_organization_id:customer,client_mutation_id:crypto.randomUUID()}})).status()).toBe(403);
        await api(request, customerQc, `syncfield/customer-qc/reports/${submitted.id}/complete`, { qc_authority_organization_id: customer, client_mutation_id: crypto.randomUUID() });
        let cycle = await api(request, customerQc, `syncfield/customer-qc/reports/${submitted.id}/cycles`, { source_type: 'manual_recorded_from_customer', source_reference: 'SYNTHETIC-CUSTOMER-ACCEPTANCE', client_mutation_id: crypto.randomUUID() });
        const correction = await api(request, customerQc, `syncfield/customer-qc/cycles/${cycle.id}/decisions`, {
            production_record_id: record.id, decision: 'correction_required', customer_reason_code: 'quantity',
            customer_comments: 'Customer requests verified labor quantity.', correction_type: 'quantity',
            allowed_fields: ['reported_quantity', 'notes'], partner_safe_instructions: 'Correct the labor quantity for customer reinspection.', client_mutation_id: crypto.randomUUID(),
        });
        await page.goto('/syncfield/corrections');
        const editor = page.getByRole('form', { name: 'Correction editor' });
        await editor.getByLabel('Corrected quantity').fill('7');
        await editor.getByLabel('Correction notes').fill('Verified seven hours for customer reinspection.');
        await editor.getByRole('button', { name: 'Review correction', exact: true }).click();
        const submission = page.waitForResponse(response => response.url().includes(`/corrections/${correction.correction.id}/resubmit`) && response.request().method() === 'POST');
        await editor.getByRole('button', { name: 'Resubmit Correction', exact: true }).click();
        const response = await submission;
        expect(response.ok(), await response.text()).toBeTruthy();
        const resubmitted = await response.json();
        expect(resubmitted.status).toBe('awaiting_customer_reinspection');
        const replay = await api(request, employee, `syncfield/foreman/corrections/${correction.correction.id}/resubmit`, response.request().postDataJSON());
        expect(replay.id).toBe(resubmitted.id);
        const revisions = await db.query('SELECT revision_number,snapshot_json FROM daily_production_report_revisions WHERE tenant_id=$1 AND daily_report_id=$2 ORDER BY revision_number', [t, submitted.id]);
        expect(revisions.rows.map(row => row.revision_number)).toEqual([1, 2]);
        expect(Number(revisions.rows[1].snapshot_json.proposed_correction.reported_quantity)).toBe(7);
        const original = await db.query('SELECT quantity_submitted FROM production_records WHERE tenant_id=$1 AND id=$2', [t, record.id]);
        expect(Number(original.rows[0].quantity_submitted)).toBe(8);
        const cycles = await db.query('SELECT id,status FROM customer_qc_cycles WHERE tenant_id=$1 AND daily_report_id=$2 ORDER BY cycle_number', [t, submitted.id]);
        expect(cycles.rows).toHaveLength(2);
        cycle = cycles.rows[1];
        expect(cycle.status).toBe('awaiting_reinspection');
        await reviewFixtureQuantity(request,customerQc,record.id);
        const decision = await api(request, customerQc, `syncfield/customer-qc/cycles/${cycle.id}/decisions`, { production_record_id: record.id, decision: 'accepted', customer_accepted_quantity: 7, client_mutation_id: crypto.randomUUID() });
        const billable = await api(request, finance, 'accepted-production-financials/billables/convert', { customer_qc_decision_id: decision.id });
        expect(Number(billable.net_billable_amount)).toBe(700);
        expect(billable.unit).toBe('HR');
        for(const item of [{record:fiber,quantity:10,amount:20,unit:'LF'},{record:pole,quantity:1,amount:50,unit:'EA'}]){
          await reviewFixtureQuantity(request,customerQc,item.record.id);
          const accepted=await api(request,customerQc,`syncfield/customer-qc/cycles/${cycle.id}/decisions`,{production_record_id:item.record.id,decision:'accepted',customer_accepted_quantity:item.quantity,client_mutation_id:crypto.randomUUID()});
          const billed=await api(request,finance,'accepted-production-financials/billables/convert',{customer_qc_decision_id:accepted.id});expect(Number(billed.net_billable_amount)).toBe(item.amount);expect(billed.unit).toBe(item.unit);
        }
        const invoice=await api(request,finance,'accepted-production-financials/invoices/create',{billable_item_ids:[billable.id]});
        expect(Number(invoice.original_amount)).toBe(630);
        expect(Number(invoice.retainage_amount)).toBe(70);
        expect(invoice.due_date).toBeNull();
        await verifyInvoicePackageLifecycle(request,finance,invoice.id,approvedContract);
        const receipt=await api(request,collections,'accepted-production-financials/cash-receipts',{customer_organization_id:customer,amount:630,payment_reference:crypto.randomUUID(),idempotency_key:crypto.randomUUID()});
        await api(request,collections,`accepted-production-financials/cash-receipts/${receipt.id}/clear`,{});
        await api(request,collections,'accepted-production-financials/payment-applications',{cash_receipt_id:receipt.id,invoice_id:invoice.id,amount:630});
        expect(Number((await db.query('SELECT balance_amount FROM invoices WHERE tenant_id=$1 AND id=$2',[t,invoice.id])).rows[0].balance_amount)).toBe(0);
        const effects = await db.query("SELECT (SELECT count(*) FROM contractor_payables WHERE tenant_id=$1 AND capacity_provider_id=$2)::int AS payables,(SELECT count(*) FROM partner_agreement_versions WHERE tenant_id=$1 AND capacity_provider_id=$2)::int AS agreements", [t, crew.capacity_provider_id]);
        expect(effects.rows[0]).toEqual({ payables: 0, agreements: 0 });
    }
    finally {
        await db.end();
    }
});
