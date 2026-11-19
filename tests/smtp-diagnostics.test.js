const test=require('node:test'),assert=require('node:assert/strict');
const {smtpReceipt,smtpFailureReceipt,sendSmtpRelayEmail}=require('../apps/api/dist/email/smtp-relay');
test('SMTP diagnostics preserve correlation and status without free-form provider data',()=>{const r=smtpReceipt({messageId:'<synthetic-123@synccommsystems.com>',response:'250 accepted password=hidden token=private recipient@example.invalid',accepted:['private@example.invalid'],rejected:[]});assert.equal(r.messageId,'<synthetic-123@synccommsystems.com>');assert.equal(r.responseCode,250);assert.equal(r.acceptedCount,1);assert.equal(r.deliveryStatus,'submission_only');assert.doesNotMatch(JSON.stringify(r),/hidden|private|recipient/);assert.equal(smtpReceipt({messageId:'unsafe\nAuthorization: secret'}).messageId,null);});
test('SMTP adapter returns submission receipt while enforcing TLS and sender policy',async()=>{const result=await sendSmtpRelayEmail({from:'notifications@synccommsystems.com',to:'synthetic@example.invalid',subject:'Synthetic',text:'No actual send'},{SMTP_HOST:'smtp.example.invalid',SMTP_PORT:'587'},config=>{assert.equal(config.requireTLS,true);return{sendMail:async()=>({messageId:'synthetic',response:'250 accepted',accepted:['synthetic@example.invalid'],rejected:[]})};});assert.equal(result.messageId,'synthetic');await assert.rejects(sendSmtpRelayEmail({from:'outsider@example.invalid',to:'synthetic@example.invalid',subject:'Test',text:'No send'},{}),/sender domain/);});

test('SMTP rejection diagnostics distinguish retryable connection failure from uncertain DATA',()=>{
 const r=smtpFailureReceipt({code:'EENVELOPE',command:'RCPT TO',responseCode:550,response:'550 5.1.1 recipient private@example.invalid password=secret'});
 assert.equal(r.enhancedStatus,'5.1.1');assert.equal(r.responseCode,550);assert.equal(r.safeToRetry,false);assert.doesNotMatch(JSON.stringify(r),/private|secret/);
 assert.equal(smtpFailureReceipt({code:'ECONNECTION',command:'CONN'}).safeToRetry,true);
 assert.equal(smtpFailureReceipt({code:'ETIMEDOUT',command:'DATA'}).safeToRetry,false);
 assert.equal(smtpReceipt({response:'250 2.0.0 queued as ABC123'}).providerQueueId,'ABC123');
 assert.equal(smtpReceipt({response:'250 2.0.0 OK abc-123 - gsmtp'}).providerQueueId,'abc-123');
});
