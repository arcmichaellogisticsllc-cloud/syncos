const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const {createAuthToken,verifyAuthToken,hashPassword,verifyPasswordAsync}=require('../packages/auth/dist');
const {assertNoPublicDemoCredentials}=require('../apps/api/dist/security/demo-credential-gate');
const {redactLogContext}=require('../apps/api/dist/instrumentation/structured-logger');
const {SafeExceptionFilter}=require('../apps/api/dist/security/safe-exception.filter');
const secret='synthetic-security-regression-key-not-a-real-secret';
test('staging deployment rejects published fixture credentials and accepts rotated accounts',async()=>{const seed=fs.readFileSync('packages/database/scripts/seed-e2e-demo.js','utf8');const fixture=seed.match(/const demoPassword = "([^"]+)"/)[1];const unsafe={query:async()=>({rows:[{password_hash:hashPassword(fixture)}]})};await assert.rejects(assertNoPublicDemoCredentials(unsafe,'staging'),/Deployment blocked/);await assert.rejects(assertNoPublicDemoCredentials(unsafe,'production'),/Deployment blocked/);await assertNoPublicDemoCredentials({query:async()=>({rows:[{password_hash:hashPassword(crypto.randomBytes(32).toString('hex'))}]})},'staging');await assertNoPublicDemoCredentials(unsafe,'test');});
test('signed tokens require a finite future expiry; default issuer always adds expiry',()=>{const sign=claims=>{const h=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),p=Buffer.from(JSON.stringify({sub:'test',tenant_id:'test',...claims})).toString('base64url');return h+'.'+p+'.'+crypto.createHmac('sha256',secret).update(h+'.'+p).digest('base64url');};for(const exp of [undefined,0,-1,'9999999999',null])assert.throws(()=>verifyAuthToken(sign({exp}),secret));const issued=verifyAuthToken(createAuthToken({sub:'test',tenant_id:'test'},secret),secret);assert.ok(issued.exp>Date.now()/1000);});
test('password verification stays compatible and handles unknown identities',async()=>{const password='Synthetic-only-password-2026',hash=hashPassword(password);assert.equal(await verifyPasswordAsync(password,hash),true);assert.equal(await verifyPasswordAsync('wrong-password-2026',hash),false);assert.equal(await verifyPasswordAsync(password,null),false);});
test('structured logging redacts nested secrets and bounds attacker-controlled context',()=>{const value=redactLogContext({password:'do-not-log',child:{authorization:'Bearer example',bank_account:'123',safe:'visible'},array:[{access_token:'hidden'}],message:'Bearer some.token.value'});assert.equal(value.password,'[redacted]');assert.equal(value.child.authorization,'[redacted]');assert.equal(value.child.bank_account,'[redacted]');assert.equal(value.child.safe,'visible');assert.equal(value.array[0].access_token,'[redacted]');assert.doesNotMatch(JSON.stringify(value),/do-not-log|some.token.value|123|hidden/);});
test('database exceptions do not expose database text to clients',()=>{let status,payload;const host={switchToHttp:()=>({getResponse:()=>({status:n=>{status=n;return{json:x=>payload=x};}})})};new SafeExceptionFilter().catch({code:'22P02',message:'invalid input syntax for uuid: private-id'},host);assert.equal(status,400);assert.doesNotMatch(JSON.stringify(payload),/uuid|private-id/);});

test('financial replay returns the original record only for matching source and amount facts',async()=>{
 const {PaymentRetainageAdjustmentsController}=require('../apps/api/dist/routes/payment-retainage-adjustments.controller');
 const c=new PaymentRetainageAdjustmentsController({});
 c.write=async(_r,_a,_e,_t,work)=>work({});
 const request={auth:{tenantId:'synthetic-tenant',userId:'synthetic-user'}};
 for(const [method,original,changed] of [
  ['createInstruction',{id:'instruction',contractor_payable_id:'payable',amount:'100.00'},{amount:101}],
  ['createRetainageRelease',{id:'release',contractor_payable_id:'payable',settlement_item_id:null,release_reason:'Reviewed release',source_reference:'proof',release_amount:'10.00'},{source_reference:'other-proof'}],
  ['creditRebill',{id:'adjustment',accepted_production_source_id:'accepted',reason:'Reviewed correction',source_reference:'proof'},{accepted_production_source_id:'other-source'}],
 ]){
  c.findByIdempotency=async()=>original;
  const exact=await c[method](request,{...original,idempotency_key:'same-key'});
  assert.equal(exact.entityId,original.id);
  await assert.rejects(c[method](request,{...original,...changed,idempotency_key:'same-key'}),/Idempotency key belongs to different financial details/);
 }
});

test('public credential startup gate works from the API workspace directory',async()=>{
 const previous=process.cwd();try{process.chdir(require('node:path').resolve(__dirname,'../apps/api'));await assertNoPublicDemoCredentials({query:async()=>({rows:[]})},'staging');}finally{process.chdir(previous);}
});
