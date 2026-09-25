import { test, expect } from '@playwright/test';
const fullPermissions = ['billing.read','billing.create_billable','billing.create_invoice','cash_receipt.record','payment_application.create','partner_settlement.create','contractor_payable.create','contractor_payable.calculate_eligibility','partner_payment.execute','partner_payment.confirm','retainage.release','financial_adjustment.create'];
const choices = {
 accepted:[{customer_qc_decision_id:'decision',production_code:'FIBER',production_description:'Fiber placement',accepted_quantity:100,unit_of_measure:'FT'}],
 billables:[{id:'billable',label:'Customer A · Fiber 100 FT',customer_organization_id:'customer-a'}],
 invoices:[{id:'invoice-a',label:'INV-A · Customer A',customer_organization_id:'customer-a',balance_amount:100},{id:'invoice-b',label:'INV-B · Customer B',customer_organization_id:'customer-b',balance_amount:200}],
 receipts:[{id:'receipt-a',label:'CR-A · Customer A',customer_organization_id:'customer-a',clearance_status:'cleared',unapplied_amount:100},{id:'receipt-b',label:'CR-B · Customer B',customer_organization_id:'customer-b',clearance_status:'cleared',unapplied_amount:200},{id:'receipt-new',label:'CR-NEW',customer_organization_id:'customer-a',clearance_status:'not_cleared',unapplied_amount:100}],
 sources:[{id:'source-partner',label:'Partner A · Fiber',partner_organization_id:'partner',source_kind:'accepted_production',provider_type:'subcontractor'},{id:'source-employee',label:'Sync employee · Fiber',partner_organization_id:'sync',source_kind:'accepted_production',provider_type:'internal_workforce'}],
 settlements:[{id:'settlement',label:'PSET-1'}], payables:[{id:'payable',label:'CP-1 · Partner A'}]
};
async function setup(page: any, permissions=fullPermissions) {
 await page.addInitScript(()=>localStorage.setItem('syncos.apiToken','synthetic-finance'));
 await page.route('**/api/syncos/**',async(route:any)=> {
  const path=new URL(route.request().url()).pathname.split('/api/syncos/')[1];
  if(path==='auth/me')return route.fulfill({json:{user_id:'finance',tenant_id:'test',roles:['finance_user'],permissions}});
  if(path==='accepted-production-financials/workflow-choices')return route.fulfill({json:choices});
  return route.fulfill({json:path?.includes('dashboard')?{}:[]});
 });
}
test('accepted finance buttons use canonical endpoints, filter employee debt and preserve retry key',async({page})=>{
 await setup(page); const writes:Array<{path:string;body:any}>=[];let fail=true;
 await page.route('**/api/syncos/accepted-production-financials/payment-applications',async route=>{const body=route.request().postDataJSON();writes.push({path:'payment-applications',body});return fail?route.fulfill({status:503,json:{message:'Temporary outage'}}):route.fulfill({json:{entityType:'payment_application',afterState:{status:'applied'}}});});
 await page.goto('/accepted-production-financials');await expect(page.getByText('Loading current financial records…')).toHaveCount(0);
 await page.getByText('6. Create partner settlement',{exact:true}).click();
 await expect(page.getByLabel('Unsettled partner production').locator('option')).toHaveCount(2);
 await expect(page.getByLabel('Unsettled partner production')).not.toContainText('Sync employee');
 await page.getByText('5. Apply cleared cash to invoice',{exact:true}).click();
 await page.getByLabel('Invoice receiving cash').selectOption('invoice-a');
 await expect(page.getByLabel('Matching cleared receipt').locator('option')).toHaveCount(2);
 await expect(page.getByLabel('Matching cleared receipt')).not.toContainText('Customer B');
 await page.getByLabel('Matching cleared receipt').selectOption('receipt-a');await page.getByLabel('Amount to apply').fill('50');
 await page.getByRole('button',{name:'Apply cleared customer cash',exact:true}).click();await expect(page.locator('p[role=alert]')).toContainText('Temporary outage');
 await expect(page.getByLabel('Amount to apply')).toHaveValue('50');fail=false;
 await page.getByRole('button',{name:'Apply cleared customer cash',exact:true}).click();await expect(page.locator('p[role=status]').filter({hasText:'Apply cleared customer cash completed'})).toBeVisible();
 expect(writes).toHaveLength(2);expect(writes[1].body.idempotency_key).toBe(writes[0].body.idempotency_key);expect(writes[1].body).toMatchObject({invoice_id:'invoice-a',cash_receipt_id:'receipt-a',amount:50});
});
test('read-only finance sees metrics without any financial action controls',async({page})=>{
 await setup(page,['billing.read']);await page.goto('/accepted-production-financials');await expect(page.getByRole('heading',{name:'Accepted Production Financials',exact:true})).toBeVisible();
 for(const name of ['Create billable','Create customer invoice','Record customer receipt','Confirm cash cleared','Apply cleared customer cash','Create partner settlement','Create partner payable','Calculate payment eligibility'])await expect(page.getByRole('button',{name,exact:true})).toHaveCount(0);
 await page.goto('/payment-retainage-adjustments');await expect(page.getByRole('heading',{name:'Access unavailable'})).toBeVisible();
});
test('retainage-only reviewer loads scoped release data without payment execution calls',async({page})=>{
 await setup(page,['retainage.release']);let paymentReads=0;const writes:any[]=[];
 await page.route('**/api/syncos/payment-retainage-adjustments/**',route=>{
  const path=new URL(route.request().url()).pathname;
  if(route.request().method()==='POST'){writes.push(route.request().postDataJSON());return route.fulfill({json:{entityType:'retainage_release',afterState:{status:'pending'}}});}
  if(path.endsWith('/retainage-choices'))return route.fulfill({json:{payables:[{id:'payable',label:'CP-1 · retained $50'}],releases:[]}});
  paymentReads++;return route.fulfill({json:[]});
 });
 await page.goto('/payment-retainage-adjustments');await page.getByText('Request retainage release',{exact:true}).first().click();
 await page.getByLabel('Payable with retained funds').selectOption('payable');await page.getByLabel('Release amount').fill('20');await page.getByLabel('Release reason').fill('Customer released retained work');await page.getByLabel('Release evidence reference').fill('Letter 123');
 await page.getByRole('button',{name:'Request retainage release',exact:true}).click();await expect(page.locator('p[role=status]').filter({hasText:'Request retainage release completed'})).toBeVisible();expect(writes[0]).toMatchObject({contractor_payable_id:'payable',release_amount:20,source_reference:'Letter 123'});expect(paymentReads).toBe(0);
 await expect(page.getByRole('heading',{name:'Record a completed payment'})).toHaveCount(0);
});
test('each financial handoff form sends its intended canonical action',async({page})=>{
 await setup(page);const writes:any[]=[];
 await page.route('**/api/syncos/accepted-production-financials/**',route=>{
  const path=new URL(route.request().url()).pathname.split('accepted-production-financials/')[1];
  if(route.request().method()==='POST'){writes.push({path,body:route.request().postDataJSON()});return route.fulfill({json:{id:'saved',status:'saved'}});}
  return route.fulfill({json:path==='workflow-choices'?choices:path==='dashboard'?{}:[]});
 });
 await page.goto('/accepted-production-financials');
 const action=async(title:string,button:string,fill:()=>Promise<void>,path:string)=>{await page.getByText(title,{exact:true}).click();await fill();await page.getByRole('button',{name:button,exact:true}).click();await expect.poll(()=>writes.at(-1)?.path).toBe(path);await expect(page.getByRole('button',{name:button,exact:true})).toBeEnabled();};
 await action('1. Convert accepted production','Create billable',async()=>{await page.getByLabel('Accepted production',{exact:true}).selectOption('decision');},'billables/convert');expect(writes.at(-1).body.customer_qc_decision_id).toBe('decision');
 await action('2. Create customer invoice','Create customer invoice',async()=>{await page.getByLabel('Customer billable',{exact:true}).selectOption('billable');await page.getByLabel('Billing period start').fill('2026-09-01');await page.getByLabel('Billing period end').fill('2026-09-07');},'invoices/create');expect(writes.at(-1).body.billable_item_ids).toEqual(['billable']);
 await action('3. Record customer cash received','Record customer receipt',async()=>{await page.getByLabel('Invoice identifying the paying customer').selectOption('invoice-a');await page.getByLabel('Amount received').fill('100');await page.getByLabel('Receipt date').fill('2026-09-08');await page.getByLabel('Customer bank/payment reference').fill('BANK-100');},'cash-receipts');expect(writes.at(-1).body.customer_organization_id).toBe('customer-a');
 await action('4. Confirm customer cash cleared','Confirm cash cleared',async()=>{await page.getByLabel('Uncleared customer receipt').selectOption('receipt-new');await page.getByLabel('I verified this receipt cleared in the bank.').check();},'cash-receipts/receipt-new/clear');
 await action('6. Create partner settlement','Create partner settlement',async()=>{await page.getByLabel('Unsettled partner production').selectOption('source-partner');},'partner-settlements/create');expect(writes.at(-1).body.accepted_production_source_ids).toEqual(['source-partner']);
 await action('7. Create partner payable','Create partner payable',async()=>{await page.getByLabel('Partner settlement awaiting payable').selectOption('settlement');},'contractor-payables/create');
 await action('8. Calculate payment eligibility','Calculate payment eligibility',async()=>{await page.getByLabel('Partner payable',{exact:true}).selectOption('payable');},'contractor-payables/payable/calculate-eligibility');
 expect(writes).toHaveLength(7);
});
test('retainage authorization and reduced-acceptance review use selected record lineage',async({page})=>{
 await setup(page);const writes:any[]=[];
 await page.route('**/api/syncos/payment-retainage-adjustments/**',route=>{
  const path=new URL(route.request().url()).pathname.split('payment-retainage-adjustments/')[1];
  if(route.request().method()==='POST'){writes.push({path,body:route.request().postDataJSON()});return route.fulfill({json:{id:'saved',status:'review_required'}});}
  if(path==='retainage-choices')return route.fulfill({json:{payables:[],releases:[{id:'release',label:'CP-1 · release $20',status:'pending'}]}});
  if(path==='adjustment-choices')return route.fulfill({json:{sources:[{id:'source',label:'INV-1 · 100 → 80 FT',contractor_payable_id:'linked-payable'}],adjustments:[]}});
  return route.fulfill({json:path==='dashboard'?{}:[]});
 });
 await page.goto('/payment-retainage-adjustments');await page.getByText('Authorize pending retainage release',{exact:true}).click();await page.getByLabel('Pending retainage release',{exact:true}).selectOption('release');await page.getByLabel('I reviewed the evidence and authorize this retained amount to become a separate payable.').check();await page.getByRole('button',{name:'Authorize retainage release',exact:true}).click();await expect.poll(()=>writes.at(-1)?.path).toBe('retainage-releases/release/authorize');
 await page.getByText('Request credit/rebill review',{exact:true}).first().click();await page.getByLabel('Billed production with reduced acceptance').selectOption('source');await page.getByLabel('Adjustment reason').fill('Customer revised accepted quantity');await page.getByLabel('Customer decision evidence reference').fill('QC-letter');await page.getByRole('button',{name:'Request credit/rebill review',exact:true}).click();await expect.poll(()=>writes.at(-1)?.path).toBe('financial-adjustments/credit-rebill');expect(writes.at(-1).body).toMatchObject({accepted_production_source_id:'source',contractor_payable_id:'linked-payable',source_reference:'QC-letter'});
});
