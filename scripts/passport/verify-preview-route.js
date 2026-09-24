'use strict';
const assert=require('node:assert/strict');
require('reflect-metadata');
const {Reflector}=require('@nestjs/core');
const {PermissionGuard}=require('../../apps/api/dist/security/permission.guard');
const {PaymentRetainageAdjustmentsController:Controller}=require('../../apps/api/dist/routes/payment-retainage-adjustments.controller');
(async()=>{
 const handler=Controller.prototype.passportPreview;
 const request={method:'GET',auth:{tenantId:'tenant-test',userId:'finance-test'},header:()=>undefined};
 const context={getHandler:()=>handler,getClass:()=>Controller,switchToHttp:()=>({getRequest:()=>request})};
 for(const allowed of [false,true]){
  const guard=new PermissionGuard(new Reflector(),{query:async(_sql,params)=>{assert.deepEqual(params.slice(0,3),['tenant-test','finance-test','partner_payment.confirm']);return {rows:[{allowed}]};}});
  if(allowed)assert.equal(await guard.canActivate(context),true);else await assert.rejects(guard.canActivate(context),/Missing permission/);
 }
 const controller=new Controller({query:()=>{throw Error('Preview must not query operational records');},connect:()=>{throw Error('Preview must not connect to financial storage');}});
 const result=await controller.passportPreview();assert.equal(result.mode,'simulation');assert.equal(result.rows.length,8);assert.equal(result.lastSuccessfulSyncAt,null);assert.equal(result.automaticRecordingEnabled,false);assert.equal(result.paymentSendingEnabled,false);
 console.log('PASS: preview permission guard, denied account, synthetic result, no database reads/writes');
})().catch(error=>{console.error(error);process.exitCode=1;});
