const test=require('node:test'),assert=require('node:assert/strict');
const {validateEnvironment}=require('../apps/api/dist/config/environment');
test('email delivery features reject malformed switches and disabled providers in hosted environments',()=>{
 const base={NODE_ENV:'test',DATABASE_URL:'postgresql://synthetic/isolated',AUTH_JWT_SECRET:'synthetic-test-secret-with-at-least-32-characters'};
 for(const feature of ['PASSWORD_RECOVERY_ENABLED','INQUIRY_NOTIFICATION_DELIVERY_ENABLED','WORKFLOW_NOTIFICATION_DELIVERY_ENABLED']){
  assert.ok(validateEnvironment({...base,[feature]:'yes'}).errors.some(e=>e.includes(feature)));
  assert.ok(validateEnvironment({...base,NODE_ENV:'staging',EMAIL_PROVIDER:'disabled',[feature]:'true'}).errors.some(e=>e.includes('requires a configured email provider')));
  assert.ok(!validateEnvironment({...base,[feature]:'false'}).errors.some(e=>e.includes(feature)));
 }
});
